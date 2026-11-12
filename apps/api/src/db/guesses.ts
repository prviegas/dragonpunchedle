import type pg from "pg";

/** Whoever is guessing: an account, or a guest known only by an anonymous cookie id. */
export type Player = { userId: number } | { guestId: string };

/** The guesses column and value for a player. The column name comes from this
 *  code, never from a request, so building it into SQL text is safe. */
function playerColumn(player: Player): { column: "user_id" | "guest_id"; value: number | string } {
  return "userId" in player ? { column: "user_id", value: player.userId } : { column: "guest_id", value: player.guestId };
}

export type SaveGuessResult =
  | { saved: true; guessNumber: number }
  | { saved: false; reason: "solved" | "duplicate" | "out-of-guesses" };

/**
 * Records a guess, if the rules allow it: not after solving, not the same
 * character twice, and no more than maxGuesses a day.
 *
 * The checks and the insert run in one transaction that first takes a lock
 * for this player. Without it, two guesses sent at the same moment could both
 * see "9 guesses so far" and both be saved, making 11; or both arrive after a
 * solve. With it, the second waits for the first to finish, then sees its
 * result. It's an advisory lock (a named lock Postgres keeps for us), so it
 * works the same for guests, who have no row of their own to lock.
 */
export async function saveGuess(
  pool: pg.Pool,
  player: Player,
  date: string,
  characterId: string,
  maxGuesses: number,
): Promise<SaveGuessResult> {
  const { column, value } = playerColumn(player);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${column}:${value}`]);

    const { rows } = await client.query<{ count: number; solved: boolean; repeated: boolean }>(
      `SELECT count(*)::int AS count,
              coalesce(bool_or(g.character_id = p.character_id), false) AS solved,
              coalesce(bool_or(g.character_id = $3), false) AS repeated
       FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
       WHERE g.${column} = $1 AND g.puzzle_date = $2`,
      [value, date, characterId],
    );
    const { count, solved, repeated } = rows[0]!;

    let result: SaveGuessResult;
    if (solved) result = { saved: false, reason: "solved" };
    else if (repeated) result = { saved: false, reason: "duplicate" };
    else if (count >= maxGuesses) result = { saved: false, reason: "out-of-guesses" };
    else {
      await client.query(`INSERT INTO guesses (${column}, puzzle_date, character_id) VALUES ($1, $2, $3)`, [
        value,
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
export async function listGuessIds(pool: pg.Pool, player: Player, date: string): Promise<string[]> {
  const { column, value } = playerColumn(player);
  const { rows } = await pool.query<{ character_id: string }>(
    `SELECT character_id FROM guesses WHERE ${column} = $1 AND puzzle_date = $2 ORDER BY id`,
    [value, date],
  );
  return rows.map((row) => row.character_id);
}

/**
 * When a guest logs in, their guesses for today move into the account, so
 * the round carries on and nobody is counted twice. If the account already
 * played today, its own round wins and the guest's is dropped.
 */
export async function claimGuestGuesses(pool: pg.Pool, guestId: string, userId: number, date: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user_id:${userId}`]);
    const { rows } = await client.query("SELECT 1 FROM guesses WHERE user_id = $1 AND puzzle_date = $2 LIMIT 1", [
      userId,
      date,
    ]);
    if (rows.length > 0) {
      await client.query("DELETE FROM guesses WHERE guest_id = $1 AND puzzle_date = $2", [guestId, date]);
    } else {
      await client.query(
        "UPDATE guesses SET user_id = $1, guest_id = NULL WHERE guest_id = $2 AND puzzle_date = $3",
        [userId, guestId, date],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
