import type pg from "pg";

/** Whoever is guessing: an account, or a guest known only by an anonymous cookie id. */
export type Player = { userId: number } | { guestId: string };

/** The guesses column and value for a player. The column name comes from this
 *  code, never from a request, so building it into SQL text is safe. */
function playerColumn(player: Player): { column: "user_id" | "guest_id"; value: number | string } {
  return "userId" in player ? { column: "user_id", value: player.userId } : { column: "guest_id", value: player.guestId };
}

/**
 * The first round with a first-solve badge. It launched mid-round on Nov 17,
 * when many players had already solved that day logged in: awarding it then
 * would have handed it to whoever happened to solve right after the deploy.
 */
export const FIRST_SOLVE_FROM = "2026-11-18";

export type SaveGuessResult =
  /** firstSolve: this guess made the player the day's first logged-in solver. */
  | { saved: true; guessNumber: number; firstSolve: boolean }
  | { saved: false; reason: "solved" | "duplicate" | "out-of-guesses" | "revealed" };

/**
 * Records a guess, if the rules allow it: not after solving, not the same
 * character twice, no more than maxGuesses a day, and not after "Show answer".
 *
 * `late` marks a guess on a past day's round: kept for the player's history,
 * left out of that day's chart, the leaderboards and streaks.
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
  late = false,
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
    const revealed = await client.query(`SELECT 1 FROM round_reveals WHERE ${column} = $1 AND puzzle_date = $2`, [
      value,
      date,
    ]);

    let result: SaveGuessResult;
    if (solved) result = { saved: false, reason: "solved" };
    else if (revealed.rows.length > 0) result = { saved: false, reason: "revealed" };
    else if (repeated) result = { saved: false, reason: "duplicate" };
    else if (count >= maxGuesses) result = { saved: false, reason: "out-of-guesses" };
    else {
      await client.query(`INSERT INTO guesses (${column}, puzzle_date, character_id, late) VALUES ($1, $2, $3, $4)`, [
        value,
        date,
        characterId,
        late,
      ]);

      // The day's first logged-in solve, on the day, earns the badge for good.
      // The primary key on the day settles a tie: if two players solve at the
      // same moment, only one insert lands. Guests and late plays never qualify.
      let firstSolve = false;
      if ("userId" in player && !late && date >= FIRST_SOLVE_FROM) {
        const award = await client.query(
          `INSERT INTO first_solves (puzzle_date, user_id)
           SELECT $1, $2 FROM daily_puzzles WHERE puzzle_date = $1 AND character_id = $3
           ON CONFLICT (puzzle_date) DO NOTHING`,
          [date, player.userId, characterId],
        );
        firstSolve = (award.rowCount ?? 0) > 0;
      }
      result = { saved: true, guessNumber: count + 1, firstSolve };
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

/** Whether this account earned the day's first-solve badge. Guests never have it. */
export async function hasFirstSolve(pool: pg.Pool, player: Player, date: string): Promise<boolean> {
  if (!("userId" in player)) return false;
  const { rows } = await pool.query("SELECT 1 FROM first_solves WHERE puzzle_date = $1 AND user_id = $2", [
    date,
    player.userId,
  ]);
  return rows.length > 0;
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

/**
 * "Show answer" on a past round: records that this player saw the answer, so
 * the round is over for them. Takes the same per-player lock as saveGuess, so
 * a guess can't slip in alongside it. Doing it twice is harmless.
 */
export async function revealRound(pool: pg.Pool, player: Player, date: string): Promise<void> {
  const { column, value } = playerColumn(player);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${column}:${value}`]);
    await client.query(
      `INSERT INTO round_reveals (${column}, puzzle_date) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [value, date],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Whether this player chose "Show answer" for a day. */
export async function hasRevealed(pool: pg.Pool, player: Player, date: string): Promise<boolean> {
  const { column, value } = playerColumn(player);
  const { rows } = await pool.query(`SELECT 1 FROM round_reveals WHERE ${column} = $1 AND puzzle_date = $2`, [
    value,
    date,
  ]);
  return rows.length > 0;
}

/** Whether any of this player's guesses for a day were made after it: played late. */
export async function playedLate(pool: pg.Pool, player: Player, date: string): Promise<boolean> {
  const { column, value } = playerColumn(player);
  const { rows } = await pool.query(`SELECT 1 FROM guesses WHERE ${column} = $1 AND puzzle_date = $2 AND late LIMIT 1`, [
    value,
    date,
  ]);
  return rows.length > 0;
}
