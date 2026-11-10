import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/passwords.js";
import { SESSION_COOKIE, createSession } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { playerStats, streakLeaderboard, todayLeaderboard } from "../src/db/stats.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

// A made-up ten days in 2098 with known answers, written straight into the
// database: the API only takes guesses for "today", and these tests need history.
const PREFIX = "zz_stats_";
const TODAY = "2098-06-10";
const day = (n: number) => `2098-06-${String(n).padStart(2, "0")}`;
const ANSWER = "street-fighter-ryu";
const WRONG = ["street-fighter-ken", "tekken-kazuya-mishima"];

/** Who played which day, and how many wrong guesses before solving (or "miss"). */
const HISTORY: Record<string, Record<number, number | "miss">> = {
  // Solves days 1-3, misses day 4, skips day 5, solves 6-9, hasn't played today:
  // a 4-day streak still alive, because yesterday counts.
  alex: { 1: 0, 2: 1, 3: 2, 4: "miss", 6: 0, 7: 0, 8: 1, 9: 0 },
  // Only solved today, first try, early.
  blair: { 10: 0 },
  // Solved day 5 and nothing since: that streak is over.
  casey: { 5: 0 },
  // Solved today in 3 guesses.
  drew: { 10: 2 },
  // Solved today first try, but later than blair.
  emery: { 10: 0 },
};
const SOLVE_TIME: Record<string, string> = { blair: "08:00", drew: "09:00", emery: "10:00" };

describe.skipIf(!process.env.DATABASE_URL)("stats and leaderboards", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T23:00:00Z`) });
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();

    for (let n = 1; n <= 10; n++) {
      await pool.query("INSERT INTO daily_puzzles (puzzle_date, character_id) VALUES ($1, $2)", [day(n), ANSWER]);
    }
    const hash = await hashPassword("not-used-here");
    for (const [name, days] of Object.entries(HISTORY)) {
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [PREFIX + name, hash],
      );
      ids[name] = Number(rows[0]!.id);
      for (const [n, outcome] of Object.entries(days)) {
        const picks = outcome === "miss" ? WRONG : [...WRONG.slice(0, outcome), ANSWER];
        for (const [i, characterId] of picks.entries()) {
          const at = `${day(Number(n))}T${SOLVE_TIME[name] ?? "12:00"}:0${i}Z`;
          await pool.query(
            "INSERT INTO guesses (user_id, puzzle_date, character_id, created_at) VALUES ($1, $2, $3, $4)",
            [ids[name], day(Number(n)), characterId, at],
          );
        }
      }
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date BETWEEN $1 AND $2", [day(1), day(10)]);
  }

  // Other test files may have their own users in the database at the same
  // time, so leaderboard checks only look at this file's players.
  const ours = <T extends { username: string }>(rows: T[]) => rows.filter((r) => r.username.startsWith(PREFIX));

  it("counts a streak that's still alive because yesterday was solved", async () => {
    expect(await playerStats(pool, ids.alex!, TODAY)).toEqual({
      played: 8,
      solved: 7,
      averageGuesses: 1.57, // (1+2+3+1+1+2+1) / 7
      currentStreak: 4,
      maxStreak: 4,
      solvedToday: false,
    });
  });

  it("ends a streak after a missed day", async () => {
    const stats = await playerStats(pool, ids.casey!, TODAY);
    expect(stats).toMatchObject({ currentStreak: 0, maxStreak: 1 });
  });

  it("counts a solve today", async () => {
    expect(await playerStats(pool, ids.blair!, TODAY)).toMatchObject({ currentStreak: 1, solvedToday: true });
  });

  it("ranks today by fewest guesses, then by who solved first", async () => {
    const board = ours(await todayLeaderboard(pool, TODAY, ids.drew!));
    expect(board.map(({ username, guesses, you }) => [username, guesses, you])).toEqual([
      [`${PREFIX}blair`, 1, false],
      [`${PREFIX}emery`, 1, false],
      [`${PREFIX}drew`, 3, true],
    ]);
  });

  it("lists only streaks that are still alive, longest first", async () => {
    const board = ours(await streakLeaderboard(pool, TODAY, null));
    expect(board.map(({ username, streak }) => [username, streak])).toEqual([
      [`${PREFIX}alex`, 4],
      [`${PREFIX}blair`, 1],
      [`${PREFIX}drew`, 1],
      [`${PREFIX}emery`, 1],
    ]);
  });

  it("serves stats to the logged-in player only", async () => {
    const { token } = await createSession(pool, ids.alex!);
    const mine = await app.inject({ method: "GET", url: "/api/me/stats", headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const guest = await app.inject({ method: "GET", url: "/api/me/stats" });

    expect(mine.json()).toMatchObject({ currentStreak: 4 });
    expect(guest.statusCode).toBe(401);
  });

  it("serves both leaderboards to everyone", async () => {
    const today = await app.inject({ method: "GET", url: "/api/leaderboards/today" });
    const streaks = await app.inject({ method: "GET", url: "/api/leaderboards/streaks" });

    expect(ours(today.json())).toHaveLength(3);
    expect(ours(streaks.json())).toHaveLength(4);
  });
});
