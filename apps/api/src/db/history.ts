import type pg from "pg";
import type { Player } from "./guesses.js";

export interface PastRound {
  date: string;
  /** The day's character. The route hides it from players who can still play the round. */
  answer: { id: string; name: string; franchise: string; portraitUrl: string | null };
  /** How many guesses this player made that day (0 if they didn't play). */
  guesses: number;
  solved: boolean;
  /** Some of those guesses came after the day: the round was played later. */
  late: boolean;
  /** The player chose "Show answer". */
  revealed: boolean;
  /** This account was the day's first logged-in solver. Never true for guests. */
  firstSolve: boolean;
}

/**
 * Finished days, newest first, each with its answer and how this player did.
 * Only days before `today`: the daily job picks answers a week ahead, and
 * those must never leave the server.
 *
 * With no player (a guest who has never guessed), the join matches nothing,
 * so every day reads as not played.
 */
export async function listPastRounds(
  pool: pg.Pool,
  player: Player | undefined,
  today: string,
  limit = 120,
): Promise<PastRound[]> {
  // The column name comes from this code, never from a request.
  const column = player && "guestId" in player ? "guest_id" : "user_id";
  const value = player ? ("userId" in player ? player.userId : player.guestId) : null;

  const { rows } = await pool.query<{
    date: string;
    id: string;
    name: string;
    franchise: string;
    hash: string | null;
    guesses: number;
    solved: boolean;
    late: boolean;
    revealed: boolean;
    first_solve: boolean;
  }>(
    `SELECT p.puzzle_date::text AS date, c.id, c.name, c.franchise, cp.hash,
            count(g.id)::int AS guesses,
            coalesce(bool_or(g.character_id = p.character_id), false) AS solved,
            coalesce(bool_or(g.late), false) AS late,
            EXISTS (SELECT 1 FROM round_reveals r WHERE r.puzzle_date = p.puzzle_date AND r.${column} = $1) AS revealed,
            ${column === "user_id" ? "EXISTS (SELECT 1 FROM first_solves f WHERE f.puzzle_date = p.puzzle_date AND f.user_id = $1)" : "false"} AS first_solve
     FROM daily_puzzles p
     JOIN characters c ON c.id = p.character_id
     LEFT JOIN character_portraits cp ON cp.character_id = c.id
     LEFT JOIN guesses g ON g.puzzle_date = p.puzzle_date AND g.${column} = $1
     WHERE p.puzzle_date < $2::date
     GROUP BY p.puzzle_date, c.id, cp.hash
     ORDER BY p.puzzle_date DESC
     LIMIT $3`,
    [value, today, limit],
  );

  return rows.map((row) => ({
    date: row.date,
    answer: {
      id: row.id,
      name: row.name,
      franchise: row.franchise,
      portraitUrl: row.hash ? `/api/portraits/${encodeURIComponent(row.id)}?v=${row.hash.slice(0, 12)}` : null,
    },
    guesses: row.guesses,
    solved: row.solved,
    late: row.late,
    revealed: row.revealed,
    firstSolve: row.first_solve,
  }));
}

/** The answer's character id for a day, if that day had a puzzle. Doesn't create one. */
export async function findPuzzleAnswerId(pool: pg.Pool, date: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ character_id: string }>(
    "SELECT character_id FROM daily_puzzles WHERE puzzle_date = $1",
    [date],
  );
  return rows[0]?.character_id;
}
