import type pg from "pg";

const UNIQUE_VIOLATION = "23505";

/** Records a logged-in player's guess. Returns false if they already guessed that character today. */
export async function saveGuess(pool: pg.Pool, userId: number, date: string, characterId: string): Promise<boolean> {
  try {
    await pool.query("INSERT INTO guesses (user_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [
      userId,
      date,
      characterId,
    ]);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return false;
    throw error;
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

export async function hasSolved(pool: pg.Pool, userId: number, date: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM guesses g
     JOIN daily_puzzles p ON p.puzzle_date = g.puzzle_date AND p.character_id = g.character_id
     WHERE g.user_id = $1 AND g.puzzle_date = $2`,
    [userId, date],
  );
  return rows.length > 0;
}
