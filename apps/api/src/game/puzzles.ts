import type pg from "pg";

/** A character can't be the answer again until this many days have passed. */
export const REPEAT_COOLDOWN_DAYS = 60;

/** Guesses per player per day. Running out ends the round and reveals the answer. */
export const MAX_GUESSES = 10;

/** The puzzle date for a moment in time. Every player shares one day, in UTC. */
export function puzzleDateFor(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/**
 * Returns the answer's character id for a date, picking one first if needed.
 *
 * Safe to call from several places at once (the scheduled job and a request
 * arriving just after midnight): the INSERT only wins if no row exists yet,
 * thanks to ON CONFLICT DO NOTHING, and everyone then reads the same winner.
 */
export async function ensurePuzzle(pool: pg.Pool, date: string): Promise<string> {
  await pool.query(
    `INSERT INTO daily_puzzles (puzzle_date, character_id)
     SELECT $1::date, id FROM characters
     WHERE id NOT IN (
       SELECT character_id FROM daily_puzzles
       WHERE puzzle_date > $1::date - $2::int AND puzzle_date < $1::date + $2::int
     )
     ORDER BY random()
     LIMIT 1
     ON CONFLICT (puzzle_date) DO NOTHING`,
    [date, REPEAT_COOLDOWN_DAYS],
  );

  const { rows } = await pool.query<{ character_id: string }>(
    "SELECT character_id FROM daily_puzzles WHERE puzzle_date = $1",
    [date],
  );
  if (!rows[0]) {
    throw new Error(`No puzzle for ${date}: is the characters table empty?`);
  }
  return rows[0].character_id;
}
