import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { ensurePuzzle } from "../src/game/puzzles.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

// Far-future dates, so the tests never touch a real day's puzzle.
const TODAY = "2099-01-01";
const TEST_DATES = [TODAY, "2099-02-01", "2099-02-02"];

describe.skipIf(!process.env.DATABASE_URL)("puzzle API", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T12:00:00Z`) });
  let answerId: string;
  let rosterSize: number;

  beforeAll(async () => {
    await migrate(pool);
    const characters = (await loadRoster()).map(toCharacter);
    rosterSize = characters.length;
    await seedCharacters(pool, characters);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = ANY($1)", [TEST_DATES]);
    answerId = await ensurePuzzle(pool, TODAY);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = ANY($1)", [TEST_DATES]);
    await app.close();
    await pool.end();
  });

  it("lists every character by name only, without clue values", async () => {
    const response = await app.inject({ method: "GET", url: "/api/characters" });
    const characters = response.json<Record<string, unknown>[]>();

    expect(response.statusCode).toBe(200);
    expect(characters).toHaveLength(rosterSize);
    expect(Object.keys(characters[0]!).sort()).toEqual(["franchise", "id", "name"]);
  });

  it("describes today's puzzle without revealing the answer", async () => {
    const response = await app.inject({ method: "GET", url: "/api/puzzles/today" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ date: TODAY });
    expect(response.json().clues).toHaveLength(7);
    expect(response.body).not.toContain(answerId);
  });

  it("is solved by guessing the answer", async () => {
    const response = await guess(TODAY, answerId);

    expect(response.statusCode).toBe(200);
    expect(response.json().solved).toBe(true);
    expect(response.json().clues.every((clue: { status: string }) => clue.status === "correct")).toBe(true);
  });

  it("returns a result per clue for a wrong guess", async () => {
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM characters WHERE id <> $1 LIMIT 1", [answerId]);
    const response = await guess(TODAY, rows[0]!.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().solved).toBe(false);
    expect(response.json().guess.id).toBe(rows[0]!.id);
    expect(response.json().clues).toHaveLength(7);
  });

  it("rejects an unknown character", async () => {
    expect((await guess(TODAY, "nobody")).statusCode).toBe(400);
  });

  it("rejects guesses for any day but today", async () => {
    expect((await guess("2098-12-31", answerId)).statusCode).toBe(400);
  });

  it("rejects a malformed request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/puzzles/${TODAY}/guesses`,
      payload: { characterId: answerId, cheat: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it("doesn't repeat yesterday's answer", async () => {
    const first = await ensurePuzzle(pool, "2099-02-01");
    const second = await ensurePuzzle(pool, "2099-02-02");

    expect(second).not.toBe(first);
    // And asking again for the same day gives the same answer.
    expect(await ensurePuzzle(pool, "2099-02-01")).toBe(first);
  });

  function guess(date: string, characterId: string) {
    return app.inject({ method: "POST", url: `/api/puzzles/${date}/guesses`, payload: { characterId } });
  }
});
