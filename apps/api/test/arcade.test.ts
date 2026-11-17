import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SESSION_COOKIE, createSession } from "../src/auth/sessions.js";
import { ARCADE_GUESSES } from "../src/db/arcade.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

const PREFIX = "zz_arcade_";

describe.skipIf(!process.env.DATABASE_URL)("arcade ladder", () => {
  const pool = createPool();
  const app = buildApp({ pool });
  let session = "";
  let guestCookie = "";

  const as = (who: "user" | "guest"): Record<string, string> =>
    who === "user" ? { [SESSION_COOKIE]: session } : guestCookie ? { dp_guest: guestCookie } : {};
  const get = (who: "user" | "guest") => app.inject({ method: "GET", url: "/api/arcade", cookies: as(who) });
  const start = (who: "user" | "guest") => app.inject({ method: "POST", url: "/api/arcade/start", cookies: as(who) });
  const guess = (who: "user" | "guest", characterId: string) =>
    app.inject({ method: "POST", url: "/api/arcade/guess", cookies: as(who), payload: { characterId } });

  /** The secret opponent of a player's current floor, read straight from the database. */
  async function opponent(column: "user_id" | "guest_id", value: string | number): Promise<string> {
    const { rows } = await pool.query(
      `SELECT f.character_id FROM arcade_runs r JOIN arcade_floors f ON f.run_id = r.id
       WHERE r.${column} = $1 AND r.ended_at IS NULL ORDER BY f.floor DESC LIMIT 1`,
      [value],
    );
    return rows[0].character_id;
  }
  async function others(not: string, count: number): Promise<string[]> {
    const { rows } = await pool.query("SELECT id FROM characters WHERE id <> $1 ORDER BY id LIMIT $2", [not, count]);
    return rows.map((row) => row.id);
  }
  let userId = 0;

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id",
      [PREFIX + "climber"],
    );
    userId = Number(rows[0]!.id);
    session = (await createSession(pool, userId)).token;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM users WHERE username LIKE $1", [PREFIX + "%"]);
    if (guestCookie) await pool.query("DELETE FROM arcade_runs WHERE guest_id = $1", [guestCookie]);
  }

  it("starts a guest run at floor 1 without giving the opponent away", async () => {
    expect((await get("guest")).json().run).toBeNull();
    const response = await start("guest");
    expect(response.statusCode).toBe(200);
    guestCookie = response.cookies.find((c) => c.name === "dp_guest")!.value;

    const body = response.json();
    expect(body.maxGuesses).toBe(ARCADE_GUESSES);
    expect(body.run).toMatchObject({ floor: 1, floorsCleared: 0, over: false, cleared: [], guesses: [] });
    const secret = await opponent("guest_id", guestCookie);
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("clears a floor on a solve and opens the next one", async () => {
    const secret = await opponent("guest_id", guestCookie);
    const [miss] = await others(secret, 1);
    expect((await guess("guest", miss!)).json()).toMatchObject({ solved: false, floor: 1, guessNumber: 1, runOver: false });
    expect((await guess("guest", miss!)).statusCode).toBe(409); // same character twice

    expect((await guess("guest", secret)).json()).toMatchObject({ solved: true, floor: 1, guessNumber: 2, runOver: false });
    const run = (await get("guest")).json().run;
    expect(run).toMatchObject({ floor: 2, floorsCleared: 1, over: false, guesses: [] });
    expect(run.cleared).toEqual([expect.objectContaining({ floor: 1, guesses: 2, character: expect.objectContaining({ id: secret }) })]);
    // Never the same fighter twice in a run.
    expect(await opponent("guest_id", guestCookie)).not.toBe(secret);
  });

  it("ends the run when a floor is lost, and only then shows who it was", async () => {
    const secret = await opponent("guest_id", guestCookie);
    const misses = await others(secret, ARCADE_GUESSES);
    let last;
    for (const id of misses) last = (await guess("guest", id)).json();
    expect(last).toMatchObject({ solved: false, runOver: true, floor: 2, answer: expect.objectContaining({ id: secret }) });

    const after = (await get("guest")).json();
    expect(after.run).toMatchObject({ over: true, floorsCleared: 1, answer: expect.objectContaining({ id: secret }) });
    expect(after.best).toBe(1);
    expect((await guess("guest", misses[0]!)).statusCode).toBe(409); // no run in progress
  });

  it("starts over from floor 1, and ranks accounts only", async () => {
    // The account clears two floors.
    await start("user");
    for (let floor = 0; floor < 2; floor++) await guess("user", await opponent("user_id", userId));
    // The guest starts a new run: back to floor 1.
    expect((await start("guest")).json().run).toMatchObject({ floor: 1, floorsCleared: 0, over: false });

    const board = (await app.inject({ method: "GET", url: "/api/arcade/leaderboard", cookies: as("user") })).json();
    const mine = board.top.find((entry: { you: boolean }) => entry.you);
    expect(mine).toMatchObject({ username: PREFIX + "climber", floor: 2 });
    expect(JSON.stringify(board)).not.toContain(guestCookie);
  });

  it("gives up a run: it ends on the current floor and the cleared floors count", async () => {
    // The account's run from the test above: 2 floors cleared, on floor 3.
    const secret = await opponent("user_id", userId);
    const giveUp = () => app.inject({ method: "POST", url: "/api/arcade/give-up", cookies: as("user") });

    const body = (await giveUp()).json();
    expect(body.run).toMatchObject({ over: true, floorsCleared: 2, floor: 3, answer: expect.objectContaining({ id: secret }) });
    expect(body.best).toBe(2);
    expect((await giveUp()).statusCode).toBe(409); // nothing left to give up
  });

  it("never touches the daily game", async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM guesses WHERE user_id = $1", [userId]);
    expect(rows[0].n).toBe(0);
  });
});
