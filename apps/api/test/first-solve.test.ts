import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SESSION_COOKIE, createSession } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

// Made-up days in 2097, so real rows are never touched.
const DAY = "2097-05-10";
const EARLIER = "2097-05-09"; // a past day, played late
const NEXT = "2097-05-11";
const ANSWER = "street-fighter-ryu";
const WRONG = "street-fighter-ken";
const PREFIX = "zz_first_";

describe.skipIf(!process.env.DATABASE_URL)("first solve of the day", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${DAY}T12:00:00Z`) });
  const tomorrow = buildApp({ pool, now: () => new Date(`${NEXT}T12:00:00Z`) });
  const cookies: Record<string, string> = {};

  const guess = (date: string, characterId: string, as?: string, guestCookie?: string) =>
    app.inject({
      method: "POST",
      url: `/api/puzzles/${date}/guesses`,
      cookies: as ? { [SESSION_COOKIE]: cookies[as]! } : guestCookie ? { dp_guest: guestCookie } : {},
      payload: { characterId },
    });

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
    for (const date of [EARLIER, DAY, NEXT]) {
      await pool.query("INSERT INTO daily_puzzles (puzzle_date, character_id) VALUES ($1, $2)", [date, ANSWER]);
    }
    for (const name of ["alice", "bob", "carol"]) {
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id",
        [PREFIX + name],
      );
      cookies[name] = (await createSession(pool, Number(rows[0]!.id))).token;
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await tomorrow.close();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM users WHERE username LIKE $1", [PREFIX + "%"]);
    await pool.query("DELETE FROM guesses WHERE puzzle_date BETWEEN $1 AND $2", [EARLIER, NEXT]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date BETWEEN $1 AND $2", [EARLIER, NEXT]);
  }

  it("goes to the first logged-in solver only, never to a guest", async () => {
    // A guest solves first: no badge, and it doesn't use the day's badge up.
    const guest = await guess(DAY, ANSWER);
    expect(guest.statusCode).toBe(200);
    expect(guest.json().firstSolve).toBeUndefined();

    // Alice misses, then solves: hers.
    expect((await guess(DAY, WRONG, "alice")).json().firstSolve).toBeUndefined();
    expect((await guess(DAY, ANSWER, "alice")).json().firstSolve).toBe(true);

    // Bob solves later: no badge.
    expect((await guess(DAY, ANSWER, "bob")).json().firstSolve).toBeUndefined();
  });

  it("stays with its owner on reload and in Past rounds", async () => {
    const today = (as: string) =>
      app.inject({ method: "GET", url: "/api/puzzles/today/guesses", cookies: { [SESSION_COOKIE]: cookies[as]! } });
    expect((await today("alice")).json().firstSolve).toBe(true);
    expect((await today("bob")).json().firstSolve).toBeUndefined();

    // The next day, it shows in each player's history.
    const history = async (as: string) =>
      (await tomorrow.inject({ method: "GET", url: "/api/history", cookies: { [SESSION_COOKIE]: cookies[as]! } }))
        .json()
        .rounds.find((round: { date: string }) => round.date === DAY);
    expect((await history("alice")).firstSolve).toBe(true);
    expect((await history("bob")).firstSolve).toBe(false);

    const pastDay = (as: string) =>
      tomorrow.inject({ method: "GET", url: `/api/history/${DAY}`, cookies: { [SESSION_COOKIE]: cookies[as]! } });
    expect((await pastDay("alice")).json().firstSolve).toBe(true);
    expect((await pastDay("bob")).json().firstSolve).toBe(false);
  });

  it("can't be earned on a past day played late", async () => {
    // Nobody solved EARLIER on the day; Carol solving it later still gets nothing.
    expect((await guess(EARLIER, ANSWER, "carol")).json().firstSolve).toBeUndefined();
    const { rows } = await pool.query("SELECT 1 FROM first_solves WHERE puzzle_date = $1", [EARLIER]);
    expect(rows).toHaveLength(0);
  });
});
