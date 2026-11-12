import type pg from "pg";
import { ensurePuzzle, puzzleDateFor } from "../game/puzzles.js";

/** How many days of answers to keep picked in advance, beyond today. */
export const DAYS_AHEAD = 7;

export interface DailyJobResult {
  /** Dates that didn't have an answer yet and got one on this run. */
  puzzlesCreated: string[];
  expiredSessionsRemoved: number;
  oldGuestGuessesRemoved: number;
}

export function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return puzzleDateFor(moment);
}

/**
 * The housekeeping job. Every step is idempotent: running it twice, or on two
 * servers at once, gives the same result as running it once. That's what lets
 * it run every hour instead of exactly at midnight, so a restart or a missed
 * run can never leave a day without a puzzle.
 */
export async function runDailyJob(pool: pg.Pool, now = new Date(), daysAhead = DAYS_AHEAD): Promise<DailyJobResult> {
  const today = puzzleDateFor(now);
  const lastDay = addDays(today, daysAhead);

  // 1. Answers for today and the coming week. Picking ahead means midnight
  //    needs no work at all, and the no-repeat rule already sees future picks.
  const { rows } = await pool.query<{ puzzle_date: string }>(
    "SELECT puzzle_date FROM daily_puzzles WHERE puzzle_date BETWEEN $1 AND $2",
    [today, lastDay],
  );
  const existing = new Set(rows.map((row) => row.puzzle_date));
  const puzzlesCreated: string[] = [];
  for (let offset = 0; offset <= daysAhead; offset++) {
    const date = addDays(today, offset);
    if (existing.has(date)) continue;
    await ensurePuzzle(pool, date); // safe even if another server got there first
    puzzlesCreated.push(date);
  }

  // 2. Sessions past their expiry can never be used again; stop storing them.
  //    This uses the database's clock, the same one that set expires_at, never
  //    the `now` passed in: a test running the job "in 2097" must not wipe out
  //    every real session in the database.
  const removed = await pool.query("DELETE FROM sessions WHERE expires_at < now()");

  // 3. Guests' guesses are kept 30 days, for the results chart, then deleted.
  //    Database clock again, for the same reason.
  const guests = await pool.query(
    "DELETE FROM guesses WHERE guest_id IS NOT NULL AND puzzle_date < current_date - 30",
  );

  return {
    puzzlesCreated,
    expiredSessionsRemoved: removed.rowCount ?? 0,
    oldGuestGuessesRemoved: guests.rowCount ?? 0,
  };
}
