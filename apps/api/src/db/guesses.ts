import type pg from "pg";

export type SaveGuessResult =
  | { saved: true; guessNumber: number }
  | { saved: false; reason: "solved" | "duplicate" | "out-of-guesses" };

/**
 * Records a logged-in player's guess, if the rules allow it: not after
 * solving, not the same character twice, and no more than maxGuesses a day.
 *
 * The checks and the insert run in one transaction that first locks the
 * player's row. Without the lock, two guesses sent at the same moment could
 * both see "9 guesses so far" and both be saved, making 11; or both arrive
 * after a solve. With it, the second waits for the first to finish, then
 * sees its result.
 */
export async function saveGuess(
  pool: pg.Pool,
  userId: number,
  date: string,
  characterId: string,
  maxGuesses: number,
): Promise<SaveGuessResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const { rows } = await client.query<{ count: number; solved: boolean; repeated: boolean }>(
      `SELECT count(*)::int AS count,
              coalesce(bool_or(g.character_id = p.character_id), false) AS solved,
              coalesce(bool_or(g.character_id = $3), false) AS repeated
       FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
       WHERE g.user_id = $1 AND g.puzzle_date = $2`,
      [userId, date, characterId],
    );
    const { count, solved, repeated } = rows[0]!;

    let result: SaveGuessResult;
    if (solved) result = { saved: false, reason: "solved" };
    else if (repeated) result = { saved: false, reason: "duplicate" };
    else if (count >= maxGuesses) result = { saved: false, reason: "out-of-guesses" };
    else {
      await client.query("INSERT INTO guesses (user_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [
        userId,
        date,
        characterId,
      ]);
      result = { saved: true, guessNumber: count + 1 };
    }

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The player's guesses for a day, oldest first. */
export async function listGuessIds(pool: pg.Pool, userId: number, date: string): Promise<string[]> {
  const { rows } = await pool.query<{ character_id: string }>(
    "SELECT character_id FROM guesses WHERE user_id = $1 AND puzzle_date = $2 ORDER BY id",
    [userId, date],
  );
  return rows.map((row) => row.character_id);
}
