import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { ensurePuzzle } from "../src/game/puzzles.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

// Made-up days of this file's own. "Today" is the 10th; the 11th stands in for
// the answers the daily job picks ahead of time.
const TODAY = "2096-07-10";
const SOLVED_DAY = "2096-07-09";
const SKIPPED_DAY = "2096-07-08";
const TOMORROW = "2096-07-11";
const DATES = [SKIPPED_DAY, SOLVED_DAY, TODAY, TOMORROW];
const GUEST = "zz_test_history_guest_0000000000".slice(0, 32);

describe.skipIf(!process.env.DATABASE_URL)("past rounds", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T12:00:00Z`) });
  const answers: Record<string, string> = {};
  let wrongId: string;

  const cleanUp = async () => {
    await pool.query("DELETE FROM guesses WHERE puzzle_date = ANY($1)", [DATES]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = ANY($1)", [DATES]);
  };

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
    for (const date of DATES) answers[date] = await ensurePuzzle(pool, date);
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM characters WHERE id <> $1 LIMIT 1", [
      answers[SOLVED_DAY],
    ]);
    wrongId = rows[0]!.id;
    // The guest missed once, then solved it.
    for (const id of [wrongId, answers[SOLVED_DAY]]) {
      await pool.query("INSERT INTO guesses (guest_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [
        GUEST,
        SOLVED_DAY,
        id,
      ]);
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  const asGuest = (url: string) => app.inject({ method: "GET", url, cookies: { dp_guest: GUEST } });

  it("lists finished days with their answers and the player's result, newest first", async () => {
    const response = await asGuest("/api/history");
    const { rounds } = response.json<{ rounds: { date: string; answer: { id: string }; guesses: number; solved: boolean }[] }>();

    expect(response.statusCode).toBe(200);
    expect(rounds.slice(0, 2)).toMatchObject([
      { date: SOLVED_DAY, answer: { id: answers[SOLVED_DAY] }, guesses: 2, solved: true },
      { date: SKIPPED_DAY, answer: { id: answers[SKIPPED_DAY] }, guesses: 0, solved: false },
    ]);
  });

  it("never lists today or the days picked ahead", async () => {
    const body = (await asGuest("/api/history")).body;

    expect(body).not.toContain(TODAY);
    expect(body).not.toContain(TOMORROW);
  });

  it("shows a past day's board, newest guess first, with the answer and everyone's results", async () => {
    const response = await asGuest(`/api/history/${SOLVED_DAY}`);
    const day = response.json();

    expect(response.statusCode).toBe(200);
    expect(day.answer.id).toBe(answers[SOLVED_DAY]);
    expect(day.guesses.map((g: { guess: { id: string } }) => g.guess.id)).toEqual([answers[SOLVED_DAY], wrongId]);
    expect(day.guesses[0].solved).toBe(true);
    expect(day.results).toMatchObject({ players: 1, you: 2 });
  });

  it("shows the answer to someone who didn't play", async () => {
    const day = (await app.inject({ method: "GET", url: `/api/history/${SOLVED_DAY}` })).json();

    expect(day.answer.id).toBe(answers[SOLVED_DAY]);
    expect(day.guesses).toEqual([]);
    expect(day.results.you).toBeNull();
  });

  it("refuses today, the days ahead, days without a round and malformed dates", async () => {
    for (const date of [TODAY, TOMORROW]) {
      const response = await asGuest(`/api/history/${date}`);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(answers[date]!);
    }
    expect((await asGuest("/api/history/1999-01-01")).statusCode).toBe(404);
    expect((await asGuest("/api/history/yesterday")).statusCode).toBe(400);
  });
});
