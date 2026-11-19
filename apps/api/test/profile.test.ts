import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SESSION_COOKIE, createSession } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { playerProfile, standing } from "../src/db/profile.js";
import { seedCharacters } from "../src/db/seed.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

// Made-up days in 2097 (stats.test.ts uses 2098), written straight into the database.
const PREFIX = "zz_profile_";
const TODAY = "2097-03-10";
const day = (n: number) => `2097-03-${String(n).padStart(2, "0")}`;
const ANSWER = "street-fighter-ryu";
const MAX = 10;
const GUEST = "zz-profile-guest";
// Already played when the comparison test starts, so there's someone to compare with even on an empty database.
const OTHER_GUEST = "zz-profile-guest-2";

describe.skipIf(!process.env.DATABASE_URL)("private profile", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T23:00:00Z`) });
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await migrate(pool);
    const roster = (await loadRoster()).map(toCharacter);
    await seedCharacters(pool, roster);
    await cleanUp();
    const wrong = roster.map((c) => c.id).filter((id) => id !== ANSWER).slice(0, MAX);

    for (let n = 1; n <= 4; n++) {
      await pool.query("INSERT INTO daily_puzzles (puzzle_date, character_id) VALUES ($1, $2)", [day(n), ANSWER]);
    }
    for (const name of ["pat", "sam"]) {
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id",
        [PREFIX + name],
      );
      ids[name] = Number(rows[0]!.id);
    }

    const guess = (user: string, n: number, picks: string[], late = false) =>
      Promise.all(
        picks.map((characterId) =>
          pool.query("INSERT INTO guesses (user_id, puzzle_date, character_id, late) VALUES ($1, $2, $3, $4)", [
            ids[user],
            day(n),
            characterId,
            late,
          ]),
        ),
      );
    await guess("pat", 1, [ANSWER]); // perfect
    await guess("pat", 2, [...wrong.slice(0, 2), ANSWER]); // solved in 3
    await guess("pat", 3, wrong); // out of guesses
    await guess("pat", 4, [ANSWER], true); // solved, but late: doesn't count

    await pool.query("INSERT INTO first_solves (puzzle_date, user_id) VALUES ($1, $2), ($3, $4)", [
      day(1),
      ids.pat,
      day(2),
      ids.sam,
    ]);
    await pool.query(
      "INSERT INTO arcade_runs (user_id, floors_cleared, ended_at) VALUES ($1, 4, now()), ($1, 11, now())",
      [ids.pat],
    );
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM guesses WHERE guest_id = ANY($1)", [[GUEST, OTHER_GUEST]]);
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date BETWEEN $1 AND $2", [day(1), day(4)]);
  }

  it("adds up rounds, badges and the Tower for one account", async () => {
    const profile = await playerProfile(pool, ids.pat!, TODAY, MAX);
    expect(profile).toMatchObject({
      username: `${PREFIX}pat`,
      stats: { played: 3, solved: 2 },
      lost: 1,
      tower: { runs: 2, bestFloor: 12, floorsCleared: 15, averageFloor: 8.5 }, // climbs ended on floors 5 and 12
    });
    expect(profile!.solvedIn).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    // Only pat's own badge: sam's first solve on day 2 isn't theirs.
    expect(profile!.firstSolves.map((f) => [f.date, f.answer.id])).toEqual([[day(1), ANSWER]]);
  });

  it("lines up each recent round with that day's average", async () => {
    const { rounds } = (await playerProfile(pool, ids.pat!, TODAY, MAX))!.compare;
    // Oldest first, ending today. Day 4 was only solved late, so it's not a result.
    expect(rounds.slice(-4)).toEqual([
      { date: day(1), you: 1, everyoneAverage: 1, players: 1 },
      { date: day(2), you: 3, everyoneAverage: 3, players: 1 },
      { date: day(3), you: "lost", everyoneAverage: null, players: 1 },
      { date: day(4), you: null, everyoneAverage: null, players: 0 },
    ]);
  });

  it("compares every daily tile with everyone who finished a round, guests with one round included", async () => {
    await pool.query("INSERT INTO guesses (guest_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [OTHER_GUEST, day(2), ANSWER]);
    const before = (await playerProfile(pool, ids.pat!, TODAY, MAX))!.compare.standing;
    await pool.query("INSERT INTO guesses (guest_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [GUEST, day(1), ANSWER]);
    const after = (await playerProfile(pool, ids.pat!, TODAY, MAX))!.compare.standing;

    // One group for all three daily tiles...
    expect(after.solveRate!.of).toBe(after.averageGuesses!.of);
    expect(after.maxStreak!.of).toBe(after.averageGuesses!.of);
    // ...and a guest who played once is in it, for streaks too.
    expect(after.averageGuesses!.of).toBe(before.averageGuesses!.of + 1);
    expect(after.maxStreak!.of).toBe(before.maxStreak!.of + 1);
    // The Tower compares with climbers only.
    expect(after.towerFloor).toEqual(before.towerFloor);
  });

  it("starts empty for a new account", async () => {
    const profile = await playerProfile(pool, ids.sam!, TODAY, MAX);
    expect(profile).toMatchObject({ lost: 0, tower: { runs: 0, bestFloor: 0, floorsCleared: 0, averageFloor: null } });
    expect(profile!.solvedIn.every((n) => n === 0)).toBe(true);
  });

  it("only shows the logged-in player their own profile", async () => {
    const guest = await app.inject({ method: "GET", url: "/api/me/profile" });
    expect(guest.statusCode).toBe(401);

    const { token } = await createSession(pool, ids.pat!);
    const mine = await app.inject({ method: "GET", url: "/api/me/profile", headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ username: `${PREFIX}pat` });
  });
});

describe("standing", () => {
  const fewer = (a: number, b: number) => a < b;

  it("counts only players beaten outright, never ties", () => {
    expect(standing(3, [2, 3, 4, 5], fewer)).toEqual({ betterThan: 50, of: 4 });
  });

  it("has nothing to say with nobody to compare against", () => {
    expect(standing(3, [], fewer)).toBeNull();
  });
});
