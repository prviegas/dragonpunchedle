import "../src/env.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/passwords.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { addDays, runDailyJob } from "../src/jobs/daily.js";
import { startScheduler } from "../src/jobs/scheduler.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("startScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs right away and then on every interval", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const stop = startScheduler(task, 1000, () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(4);
  });

  it("skips a run while the previous one is still going", async () => {
    vi.useFakeTimers();
    const task = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
    const stop = startScheduler(task, 1000, () => {});

    await vi.advanceTimersByTimeAsync(2000); // ticks at 1s and 2s find it busy
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // finished at 2.5s; the 3s tick runs
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a failed run and keeps going", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const task = vi.fn().mockRejectedValueOnce(new Error("database down")).mockResolvedValue(undefined);
    const stop = startScheduler(task, 1000, onError);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "database down" }));
    expect(task).toHaveBeenCalledTimes(2);
    stop();
  });
});

// Dates of their own, so no other test file's puzzles get in the way.
const NOW = new Date("2097-01-01T05:00:00Z");
const DATES = Array.from({ length: 4 }, (_, i) => addDays("2097-01-01", i));
const PREFIX = "zz_jobs_";

describe.skipIf(!process.env.DATABASE_URL)("runDailyJob", () => {
  const pool = createPool();

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = ANY($1)", [DATES]);
  }

  it("picks today's and upcoming answers once, without repeats", async () => {
    const first = await runDailyJob(pool, NOW, 3);
    const second = await runDailyJob(pool, NOW, 3);

    expect(first.puzzlesCreated).toEqual(DATES);
    expect(second.puzzlesCreated).toEqual([]); // nothing left to do

    const { rows } = await pool.query<{ character_id: string }>(
      "SELECT character_id FROM daily_puzzles WHERE puzzle_date = ANY($1)",
      [DATES],
    );
    expect(new Set(rows.map((r) => r.character_id)).size).toBe(4);
  });

  it("removes expired sessions and keeps live ones", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [`${PREFIX}player`, await hashPassword("not-used-here")],
    );
    const userId = rows[0]!.id;
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
         ('zz-jobs-expired', $1, now() - interval '1 day'),
         ('zz-jobs-live', $1, now() + interval '1 day')`,
      [userId],
    );

    const result = await runDailyJob(pool, NOW, 3);

    const left = await pool.query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE user_id = $1", [userId]);
    expect(left.rows.map((r) => r.token_hash)).toEqual(["zz-jobs-live"]);
    expect(result.expiredSessionsRemoved).toBeGreaterThanOrEqual(1);
  });
});
