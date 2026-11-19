import type pg from "pg";
import { bestFloor } from "./arcade.js";
import { playerStats, type PlayerStats } from "./stats.js";

// The private profile: one account's numbers and badges, for its own eyes only.
// Everything here is worked out from tables the game already writes (guesses,
// first_solves, arcade_runs), so there's nothing new to keep in sync. Trophies
// are not stored either: the page decides them from these numbers.

export interface FirstSolveEntry {
  date: string;
  answer: { id: string; name: string; franchise: string; portraitUrl: string | null };
}

/** Where the player stands among others. */
export interface Standing {
  /** 0-100: the percentage of other players this one beats outright (ties don't count). */
  betterThan: number;
  /** How many other players were compared. */
  of: number;
  /** Other players doing strictly better: the player ranks just after them (rank = ahead + 1). */
  ahead: number;
  /** Other players with exactly the same result: they share the rank. */
  tied: number;
}

/** A finished round on its own day: guesses taken, "lost", or null (not played or not finished). */
export type DayResult = number | "lost" | null;

export interface RoundComparison {
  date: string;
  you: DayResult;
  /** Average guesses among that day's solvers; null if nobody solved it. */
  everyoneAverage: number | null;
  /** Players who finished it on the day. */
  players: number;
}

export interface Comparison {
  /** Every player's finished rounds, on their day, accounts and guests together. */
  everyone: {
    solvedIn: number[];
    lost: number;
    /** Finished rounds counted above. */
    rounds: number;
    averageGuesses: number | null;
    /** 0-100. */
    solveRate: number | null;
  };
  /**
   * Average guesses and solve rate compare with every player, account or
   * guest, who finished at least one round on its day; best streak with the
   * logged-in ones among them (a guest's streak doesn't carry across days);
   * the Tower tile with everyone who climbed.
   * Null when the player hasn't played that part yet, or nobody else has.
   */
  standing: {
    averageGuesses: Standing | null;
    solveRate: Standing | null;
    maxStreak: Standing | null;
    towerFloor: Standing | null;
  };
  /** The last ROUNDS_SHOWN days with a puzzle, oldest first. */
  rounds: RoundComparison[];
}

const ROUNDS_SHOWN = 30;

/** The share of `others` that `mine` beats; `better(a, b)` says whether a beats b. */
export function standing(mine: number, others: number[], better: (a: number, b: number) => boolean): Standing | null {
  if (others.length === 0) return null;
  const beaten = others.filter((other) => better(mine, other)).length;
  const ahead = others.filter((other) => better(other, mine)).length;
  return {
    betterThan: Math.round((beaten / others.length) * 100),
    of: others.length,
    ahead,
    tied: others.length - beaten - ahead,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PlayerProfile {
  username: string;
  /** When the account was made (ISO). */
  memberSince: string;
  stats: PlayerStats;
  /** Rounds solved on their day: solvedIn[0] in 1 guess, solvedIn[1] in 2, and so on up to the limit. */
  solvedIn: number[];
  /** Rounds lost on their day: every guess used, no solve. */
  lost: number;
  /** Every day this account was the first logged-in solver, newest first. */
  firstSolves: FirstSolveEntry[];
  tower: {
    runs: number;
    /** The highest floor reached (the one a run ended on, or is on now); 0 if never played. */
    bestFloor: number;
    /** Floors beaten across every run. */
    floorsCleared: number;
    /** The floor a climb ends on (or is on now), on average; null if never played. */
    averageFloor: number | null;
  };
  compare: Comparison;
}

export async function playerProfile(
  pool: pg.Pool,
  userId: number,
  today: string,
  maxGuesses: number,
): Promise<PlayerProfile | undefined> {
  const { rows: users } = await pool.query<{ username: string; created_at: Date }>(
    "SELECT username, created_at FROM users WHERE id = $1",
    [userId],
  );
  const user = users[0];
  if (!user) return undefined;

  const [stats, days, firsts, tower, best, compare] = await Promise.all([
    playerStats(pool, userId, today),
    // Same rules as the stats: rounds played on their own day only.
    pool.query<{ guesses: number; solved: boolean }>(
      `SELECT count(*)::int AS guesses, bool_or(g.character_id = p.character_id) AS solved
       FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
       WHERE g.user_id = $1 AND g.puzzle_date <= $2 AND NOT g.late
       GROUP BY g.puzzle_date`,
      [userId, today],
    ),
    pool.query<{ date: string; id: string; name: string; franchise: string; hash: string | null }>(
      `SELECT f.puzzle_date::text AS date, c.id, c.name, c.franchise, cp.hash
       FROM first_solves f
       JOIN daily_puzzles p ON p.puzzle_date = f.puzzle_date
       JOIN characters c ON c.id = p.character_id
       LEFT JOIN character_portraits cp ON cp.character_id = c.id
       WHERE f.user_id = $1
       ORDER BY f.puzzle_date DESC`,
      [userId],
    ),
    pool.query<{ runs: number; floors_cleared: number; average_floor: number | null }>(
      `SELECT count(*)::int AS runs, coalesce(sum(floors_cleared), 0)::int AS floors_cleared,
              round(avg(floors_cleared + 1), 1)::float8 AS average_floor
       FROM arcade_runs WHERE user_id = $1`,
      [userId],
    ),
    bestFloor(pool, { userId }),
    comparison(pool, userId, today, maxGuesses),
  ]);

  const solvedIn = Array.from({ length: maxGuesses }, () => 0);
  let lost = 0;
  for (const day of days.rows) {
    if (day.solved) solvedIn[Math.min(day.guesses, maxGuesses) - 1]!++;
    else if (day.guesses >= maxGuesses) lost++;
  }

  return {
    username: user.username,
    memberSince: user.created_at.toISOString(),
    stats,
    solvedIn,
    lost,
    firstSolves: firsts.rows.map((row) => ({
      date: row.date,
      answer: {
        id: row.id,
        name: row.name,
        franchise: row.franchise,
        portraitUrl: row.hash ? `/api/portraits/${encodeURIComponent(row.id)}?v=${row.hash.slice(0, 12)}` : null,
      },
    })),
    tower: {
      runs: tower.rows[0]!.runs,
      bestFloor: best,
      floorsCleared: tower.rows[0]!.floors_cleared,
      averageFloor: tower.rows[0]!.average_floor,
    },
    compare,
  };
}

// Every player's finished rounds on their own day, one row per player and day.
// Accounts and guests alike ("u" + id, "g" + cookie id), like the results chart.
const FINISHED_ROUNDS = `
  WITH played AS (
    SELECT coalesce('u' || g.user_id::text, 'g' || g.guest_id) AS player, g.puzzle_date,
           count(*)::int AS guesses, bool_or(g.character_id = p.character_id) AS solved
    FROM guesses g JOIN daily_puzzles p USING (puzzle_date)
    WHERE g.puzzle_date <= $1 AND NOT g.late
    GROUP BY 1, 2
  ),
  finished AS (
    SELECT player, puzzle_date, least(guesses, $2) AS guesses, solved
    FROM played WHERE solved OR guesses >= $2
  )`;

/**
 * How one account compares with everyone else. Totals only: no other
 * player's name or rounds ever leave the server.
 */
async function comparison(pool: pg.Pool, userId: number, today: string, maxGuesses: number): Promise<Comparison> {
  const me = `u${userId}`;
  const [players, recent, streaks, towers] = await Promise.all([
    pool.query<{ player: string; rounds: number; solved: number; solved_guesses: number; buckets: number[] }>(
      `${FINISHED_ROUNDS}
       SELECT player, count(*)::int AS rounds, count(*) FILTER (WHERE solved)::int AS solved,
              coalesce(sum(guesses) FILTER (WHERE solved), 0)::int AS solved_guesses,
              array_agg(CASE WHEN solved THEN guesses ELSE 0 END) AS buckets
       FROM finished GROUP BY player`,
      [today, maxGuesses],
    ),
    pool.query<{ date: string; average: number | null; players: number; mine: number | null; mine_solved: boolean | null }>(
      `${FINISHED_ROUNDS},
       days AS (
         SELECT puzzle_date FROM daily_puzzles WHERE puzzle_date <= $1 ORDER BY puzzle_date DESC LIMIT $4
       )
       SELECT d.puzzle_date::text AS date,
              round(avg(f.guesses) FILTER (WHERE f.solved), 2)::float8 AS average,
              count(f.player)::int AS players,
              max(f.guesses) FILTER (WHERE f.player = $3) AS mine,
              bool_or(f.solved) FILTER (WHERE f.player = $3) AS mine_solved
       FROM days d LEFT JOIN finished f ON f.puzzle_date = d.puzzle_date
       GROUP BY d.puzzle_date ORDER BY d.puzzle_date`,
      [today, maxGuesses, me, ROUNDS_SHOWN],
    ),
    // Every account's best streak, worked out like playerStats does it.
    pool.query<{ player: string; best: number }>(
      `WITH solves AS (
         SELECT DISTINCT coalesce('u' || g.user_id::text, 'g' || g.guest_id) AS player, g.puzzle_date
         FROM guesses g JOIN daily_puzzles p ON p.puzzle_date = g.puzzle_date AND p.character_id = g.character_id
         WHERE g.user_id IS NOT NULL AND NOT g.late AND g.puzzle_date <= $1
       ),
       runs AS (
         SELECT player, puzzle_date - (row_number() OVER (PARTITION BY player ORDER BY puzzle_date))::int AS run_id
         FROM solves
       )
       SELECT player, max(length)::int AS best
       FROM (SELECT player, count(*) AS length FROM runs GROUP BY player, run_id) s
       GROUP BY player`,
      [today],
    ),
    pool.query<{ player: string; best: number }>(
      `SELECT coalesce('u' || user_id::text, 'g' || guest_id) AS player, max(floors_cleared)::int + 1 AS best
       FROM arcade_runs GROUP BY 1`,
    ),
  ]);

  // Everyone's rounds, added up.
  const solvedIn = Array.from({ length: maxGuesses }, () => 0);
  let lost = 0;
  let solvedGuesses = 0;
  for (const player of players.rows) {
    for (const bucket of player.buckets) {
      if (bucket === 0) lost++;
      else solvedIn[bucket - 1]!++;
    }
    solvedGuesses += player.solved_guesses;
  }
  const solved = solvedIn.reduce((a, b) => a + b, 0);
  const rounds = solved + lost;

  // Everyone else who finished a round on its day; streaks only count the accounts among them.
  const mine = players.rows.find((p) => p.player === me);
  const others = players.rows.filter((p) => p.player !== me);
  const average = (p: { solved: number; solved_guesses: number }) => (p.solved > 0 ? p.solved_guesses / p.solved : null);
  const myAverage = mine && average(mine);
  const fewerGuesses = (a: number, b: number) => a < b;
  const higher = (a: number, b: number) => a > b;

  const bestStreak = new Map(streaks.rows.map((r) => [r.player, r.best]));
  const myFloor = towers.rows.find((r) => r.player === me)?.best ?? 0;

  return {
    everyone: {
      solvedIn,
      lost,
      rounds,
      averageGuesses: solved > 0 ? round2(solvedGuesses / solved) : null,
      solveRate: rounds > 0 ? Math.round((solved / rounds) * 100) : null,
    },
    standing: {
      // Someone who never solved has no average: they're behind every player who has.
      averageGuesses:
        myAverage == null
          ? null
          : standing(myAverage, others.map((p) => average(p) ?? Infinity), fewerGuesses),
      solveRate: mine ? standing(mine.solved / mine.rounds, others.map((p) => p.solved / p.rounds), higher) : null,
      // An account that never solved has a best streak of 0.
      maxStreak: mine
        ? standing(
            bestStreak.get(me) ?? 0,
            others.filter((p) => p.player.startsWith("u")).map((p) => bestStreak.get(p.player) ?? 0),
            higher,
          )
        : null,
      towerFloor:
        myFloor > 0 ? standing(myFloor, towers.rows.filter((r) => r.player !== me).map((r) => r.best), higher) : null,
    },
    rounds: recent.rows.map((row) => ({
      date: row.date,
      you: row.mine === null ? null : row.mine_solved ? row.mine : "lost",
      everyoneAverage: row.average,
      players: row.players,
    })),
  };
}
