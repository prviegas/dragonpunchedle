import type pg from "pg";
import type { Player } from "./guesses.js";

// Streaks are worked out from the guesses table on demand rather than kept in
// a counter column. A counter has to be updated correctly on every write
// forever; deriving it means it can never drift out of sync with the guesses.
//
// The trick for finding runs of consecutive days ("gaps and islands"): number
// a player's solved days 1, 2, 3... in date order and subtract that number
// from the date. Consecutive days all land on the same result, and a missed
// day shifts it, so grouping by the result gives one group per streak:
//
//   solved day   row number   day - row number
//   Jun 1        1            May 31   ┐
//   Jun 2        2            May 31   ┘ streak of 2
//   Jun 4        3            Jun 1    ┐
//   Jun 5        4            Jun 1    ┘ streak of 2 (Jun 3 was missed)

export interface PlayerStats {
  played: number;
  solved: number;
  /** Average guesses on solved days, or null before the first solve. */
  averageGuesses: number | null;
  currentStreak: number;
  maxStreak: number;
  solvedToday: boolean;
}

export async function playerStats(pool: pg.Pool, userId: number, today: string): Promise<PlayerStats> {
  const { rows } = await pool.query<{
    played: number;
    solved: number;
    average_guesses: number | null;
    current_streak: number;
    max_streak: number;
    solved_today: boolean;
  }>(
    `WITH days AS (
       SELECT g.puzzle_date,
              count(*) AS guesses,
              bool_or(g.character_id = p.character_id) AS solved
       FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
       WHERE g.user_id = $1 AND g.puzzle_date <= $2
       GROUP BY g.puzzle_date
     ),
     runs AS (
       SELECT puzzle_date, puzzle_date - (row_number() OVER (ORDER BY puzzle_date))::int AS run_id
       FROM days WHERE solved
     ),
     streaks AS (
       SELECT count(*)::int AS length, max(puzzle_date) AS last_day FROM runs GROUP BY run_id
     )
     SELECT
       (SELECT count(*)::int FROM days) AS played,
       (SELECT count(*)::int FROM days WHERE solved) AS solved,
       (SELECT round(avg(guesses), 2)::float8 FROM days WHERE solved) AS average_guesses,
       (SELECT coalesce(max(length), 0) FROM streaks) AS max_streak,
       -- Still alive if the run reaches today, or yesterday (today isn't over yet).
       (SELECT coalesce(max(length), 0) FROM streaks WHERE last_day >= $2::date - 1) AS current_streak,
       (SELECT coalesce(bool_or(solved), false) FROM days WHERE puzzle_date = $2) AS solved_today`,
    [userId, today],
  );
  const row = rows[0]!;
  return {
    played: row.played,
    solved: row.solved,
    averageGuesses: row.average_guesses,
    currentStreak: row.current_streak,
    maxStreak: row.max_streak,
    solvedToday: row.solved_today,
  };
}

export interface ScoreDistribution {
  /** Players who finished the day's round, accounts and guests: solved it, or ran out of guesses. */
  players: number;
  /** solvedIn[0] players solved it in 1 guess, solvedIn[1] in 2, and so on up to the limit. */
  solvedIn: number[];
  /** Players who ran out of guesses. */
  lost: number;
  /** The viewer's own finished result: guesses taken, "lost", or null (not finished). */
  you: number | "lost" | null;
}

/**
 * How everyone did on one day, for the results chart. Only finished rounds
 * count: someone halfway through isn't a loss yet. Counts only, no names.
 */
export async function scoreDistribution(
  pool: pg.Pool,
  date: string,
  viewer: Player | null,
  maxGuesses: number,
): Promise<ScoreDistribution> {
  // One row per player: an account ("u" + id) or a guest ("g" + cookie id).
  const { rows } = await pool.query<{ player: string; guesses: number; solved: boolean }>(
    `SELECT coalesce('u' || g.user_id::text, 'g' || g.guest_id) AS player,
            count(*)::int AS guesses, bool_or(g.character_id = p.character_id) AS solved
     FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
     WHERE g.puzzle_date = $1
     GROUP BY 1
     HAVING bool_or(g.character_id = p.character_id) OR count(*) >= $2`,
    [date, maxGuesses],
  );

  const solvedIn = Array.from({ length: maxGuesses }, () => 0);
  let lost = 0;
  let you: ScoreDistribution["you"] = null;
  const viewerKey = viewer && ("userId" in viewer ? `u${viewer.userId}` : `g${viewer.guestId}`);
  for (const row of rows) {
    const result = row.solved ? Math.min(row.guesses, maxGuesses) : "lost";
    if (result === "lost") lost++;
    else solvedIn[result - 1]!++;
    if (row.player === viewerKey) you = result;
  }
  return { players: rows.length, solvedIn, lost, you };
}

export interface TodayEntry {
  rank: number;
  username: string;
  guesses: number;
  solvedAt: Date;
  /** True on the row of the player asking, so the page can highlight it. */
  you: boolean;
}

/** Today's solvers: fewest guesses first, and the earlier solve wins a tie. */
export async function todayLeaderboard(
  pool: pg.Pool,
  date: string,
  viewerId: number | null,
  limit = 20,
): Promise<TodayEntry[]> {
  const { rows } = await pool.query<{ rank: number; username: string; guesses: number; solved_at: Date; you: boolean }>(
    `WITH day AS (
       SELECT g.user_id,
              count(*)::int AS guesses,
              max(g.created_at) FILTER (WHERE g.character_id = p.character_id) AS solved_at
       FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
       WHERE g.puzzle_date = $1 AND g.user_id IS NOT NULL -- accounts only: guests have no name to show
       GROUP BY g.user_id
     )
     SELECT rank() OVER (ORDER BY d.guesses, d.solved_at)::int AS rank,
            u.username, d.guesses, d.solved_at,
            coalesce(u.id = $2, false) AS you
     FROM day d JOIN users u ON u.id = d.user_id
     WHERE d.solved_at IS NOT NULL
     ORDER BY d.guesses, d.solved_at
     LIMIT $3`,
    [date, viewerId, limit],
  );
  return rows.map((row) => ({
    rank: row.rank,
    username: row.username,
    guesses: row.guesses,
    solvedAt: row.solved_at,
    you: row.you,
  }));
}

export interface StreakEntry {
  rank: number;
  username: string;
  streak: number;
  you: boolean;
}

/** Longest streaks still alive (solved today or yesterday). Ties share a rank. */
export async function streakLeaderboard(
  pool: pg.Pool,
  today: string,
  viewerId: number | null,
  limit = 20,
): Promise<StreakEntry[]> {
  const { rows } = await pool.query<StreakEntry>(
    `WITH solves AS (
       SELECT g.user_id, g.puzzle_date
       FROM guesses g
       JOIN daily_puzzles p ON p.puzzle_date = g.puzzle_date AND p.character_id = g.character_id
       WHERE g.puzzle_date <= $1 AND g.user_id IS NOT NULL
     ),
     runs AS (
       SELECT user_id, puzzle_date,
              puzzle_date - (row_number() OVER (PARTITION BY user_id ORDER BY puzzle_date))::int AS run_id
       FROM solves
     ),
     alive AS (
       SELECT user_id, count(*)::int AS streak
       FROM runs
       GROUP BY user_id, run_id
       HAVING max(puzzle_date) >= $1::date - 1
     )
     SELECT rank() OVER (ORDER BY a.streak DESC)::int AS rank,
            u.username, a.streak,
            coalesce(u.id = $2, false) AS you
     FROM alive a JOIN users u ON u.id = a.user_id
     ORDER BY a.streak DESC, u.username
     LIMIT $3`,
    [today, viewerId, limit],
  );
  return rows;
}
