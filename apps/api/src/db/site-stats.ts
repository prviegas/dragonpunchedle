import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

// The owner's dashboard: page views (counted without cookies) and each day's
// numbers. See migrations/010_site_stats.sql for what is stored and why.

export interface Visit {
  day: string;
  ip: string;
  userAgent: string;
  path: string;
  referrer: string | null;
  timezone: string | null;
  language: string | null;
}

export interface DayNumbers {
  day: string;
  views: number;
  visitors: number;
  /** Played that day's round on the day (accounts and guests). */
  players: number;
  /** Of those, how many reached the end: solved, or used every guess. */
  finished: number;
  won: number;
  signups: number;
  /** Older rounds played that day from Past rounds (player + round pairs). */
  latePlayers: number;
}

const salts = new Map<string, string>();

/** The day's salt, created on first use. Shared through the database, so two servers hash alike. */
async function saltFor(pool: pg.Pool, day: string): Promise<string> {
  const cached = salts.get(day);
  if (cached) return cached;
  await pool.query("INSERT INTO visitor_salts (day, salt) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING", [
    day,
    randomBytes(16).toString("hex"),
  ]);
  const { rows } = await pool.query<{ salt: string }>("SELECT salt FROM visitor_salts WHERE day = $1", [day]);
  const salt = rows[0]!.salt;
  salts.clear(); // only today's is ever needed
  salts.set(day, salt);
  return salt;
}

export function deviceOf(userAgent: string): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? "mobile" : "desktop";
}

export function looksLikeBot(userAgent: string): boolean {
  return userAgent === "" || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget/i.test(userAgent);
}

/** "https://www.reddit.com/r/Fighters/..." → "reddit.com". Null for none, a bad address, or this site itself. */
export function referrerHost(referrer: string | undefined, ownHost: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    // Through URL, so a port and an IPv6 address ("[::1]:5180") both parse.
    const own = ownHost ? new URL(`http://${ownHost}`).hostname.replace(/^www\./, "").toLowerCase() : undefined;
    return host && host !== own ? host : null;
  } catch {
    return null;
  }
}

export async function recordVisit(pool: pg.Pool, visit: Visit): Promise<void> {
  const salt = await saltFor(pool, visit.day);
  const visitor = createHash("sha256").update(`${salt}|${visit.ip}|${visit.userAgent}`).digest("hex").slice(0, 32);
  await pool.query(
    `INSERT INTO page_views (day, visitor, path, referrer, device, timezone, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [visit.day, visitor, visit.path, visit.referrer, deviceOf(visit.userAgent), visit.timezone, visit.language],
  );
}

// UTC day boundaries, whatever time zone the database session uses.
const DAY_START = (param: string) => `(${param}::date)::timestamp AT TIME ZONE 'UTC'`;

/**
 * Each day's numbers worked out from the raw rows. With `since`, only what
 * happened from that moment on counts (the dashboard's Reset counting).
 */
export async function liveDayNumbers(
  pool: pg.Pool,
  from: string,
  to: string,
  maxGuesses: number,
  since: string | null = null,
): Promise<DayNumbers[]> {
  const { rows } = await pool.query<DayNumbers>(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS d
     ),
     v AS (
       SELECT day, count(*) AS views, count(DISTINCT visitor) AS visitors
       FROM page_views WHERE day BETWEEN $1 AND $2 AND created_at >= $4 GROUP BY day
     ),
     per_player AS (
       SELECT g.puzzle_date AS day, coalesce(g.user_id::text, 'g:' || g.guest_id) AS who,
              bool_or(g.character_id = d.character_id) AS won, count(*) AS n
       FROM guesses g JOIN daily_puzzles d USING (puzzle_date)
       WHERE NOT g.late AND g.puzzle_date BETWEEN $1 AND $2 AND g.created_at >= $4
       GROUP BY 1, 2
     ),
     p AS (
       SELECT day, count(*) AS players,
              count(*) FILTER (WHERE won OR n >= $3) AS finished,
              count(*) FILTER (WHERE won) AS won
       FROM per_player GROUP BY day
     ),
     l AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
              count(DISTINCT (coalesce(user_id::text, 'g:' || guest_id), puzzle_date)) AS late_players
       FROM guesses
       WHERE late AND created_at >= ${DAY_START("$1")} AND created_at < ${DAY_START("$2")} + interval '1 day'
         AND created_at >= $4
       GROUP BY 1
     ),
     s AS (
       SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS signups
       FROM users
       WHERE created_at >= ${DAY_START("$1")} AND created_at < ${DAY_START("$2")} + interval '1 day'
         AND created_at >= $4
       GROUP BY 1
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
            coalesce(v.views, 0)::int AS views,
            coalesce(v.visitors, 0)::int AS visitors,
            coalesce(p.players, 0)::int AS players,
            coalesce(p.finished, 0)::int AS finished,
            coalesce(p.won, 0)::int AS won,
            coalesce(s.signups, 0)::int AS signups,
            coalesce(l.late_players, 0)::int AS "latePlayers"
     FROM days
     LEFT JOIN v USING (day) LEFT JOIN p USING (day) LEFT JOIN l USING (day) LEFT JOIN s USING (day)
     ORDER BY days.day`,
    [from, to, maxGuesses, since ?? "-infinity"],
  );
  return rows;
}

/** When the dashboard started counting: the last Reset counting, or null for all along. */
export async function statsSince(pool: pg.Pool): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>("SELECT value FROM site_settings WHERE key = 'stats_since'");
  return rows[0]?.value ?? null;
}

/**
 * Start counting again from now. Nothing is deleted: only the mark moves.
 * "Now" is the database's clock, the same one that stamps every visit, guess
 * and account, so nothing slips through a gap between two clocks.
 */
export async function resetStatsSince(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ now: Date }>("SELECT now() AS now");
  const since = rows[0]!.now.toISOString();
  await pool.query(
    `INSERT INTO site_settings (key, value) VALUES ('stats_since', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [since],
  );
  return since;
}

/**
 * Writes the totals of finished days that don't have them yet, before guests'
 * guesses (30 days) and page views (90 days) are deleted. Uses the database's
 * clock, like the rest of the daily job, so a test's made-up date can't freeze
 * days that haven't happened. Days before the first puzzle are skipped.
 */
export async function freezeFinishedDays(pool: pg.Pool, maxGuesses: number): Promise<number> {
  const { rows } = await pool.query<{ day: string }>(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS day
     FROM generate_series(current_date - 29, current_date - 1, interval '1 day') AS d
     WHERE d::date >= (SELECT min(puzzle_date) FROM daily_puzzles)
       AND NOT EXISTS (SELECT 1 FROM daily_totals t WHERE t.day = d::date)`,
  );
  let frozen = 0;
  for (const { day } of rows) {
    const [numbers] = await liveDayNumbers(pool, day, day, maxGuesses);
    const result = await pool.query(
      `INSERT INTO daily_totals (day, views, visitors, players, finished, won, signups, late_players)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (day) DO NOTHING`,
      [day, numbers!.views, numbers!.visitors, numbers!.players, numbers!.finished, numbers!.won, numbers!.signups, numbers!.latePlayers],
    );
    frozen += result.rowCount ?? 0;
  }
  return frozen;
}

/** Old salts can't be needed again; deleting them makes old hashes one-way for good. */
export async function purgeOldVisitData(pool: pg.Pool): Promise<number> {
  await pool.query("DELETE FROM visitor_salts WHERE day < current_date");
  const views = await pool.query("DELETE FROM page_views WHERE day < current_date - 90");
  return views.rowCount ?? 0;
}

interface Count {
  label: string;
  count: number;
}

export interface Dashboard {
  today: string;
  /** Counting since this moment (ISO), or null when it never was reset. */
  since: string | null;
  days: DayNumbers[];
  accounts: { total: number; google: number; newThisWeek: number };
  rounds: {
    day: string;
    answer: string;
    franchise: string;
    players: number;
    won: number;
    finished: number;
    /** Average guesses of the players who solved it; null when nobody did. */
    averageGuesses: number | null;
  }[];
  referrers: Count[];
  devices: Count[];
  timezones: Count[];
  languages: Count[];
  pages: Count[];
  firstGuesses: Count[];
}

async function topCounts(
  pool: pg.Pool,
  column: "referrer" | "device" | "timezone" | "language" | "path",
  from: string,
  to: string,
  since: string | null,
  limit = 8,
): Promise<Count[]> {
  // Visitors, not views: one person reloading ten times is still one.
  const { rows } = await pool.query<Count>(
    `SELECT coalesce(${column}, '${column === "referrer" ? "Direct or bookmark" : "(unknown)"}') AS label, count(DISTINCT (day, visitor))::int AS count
     FROM page_views WHERE day BETWEEN $1 AND $2 AND created_at >= $4
     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT $3`,
    [from, to, limit, since ?? "-infinity"],
  );
  return rows;
}

export async function dashboard(pool: pg.Pool, today: string, maxGuesses: number, dayCount = 30): Promise<Dashboard> {
  const { rows: range } = await pool.query<{ from: string }>(
    "SELECT to_char($1::date - $2::int + 1, 'YYYY-MM-DD') AS from",
    [today, dayCount],
  );
  const from = range[0]!.from;
  const since = await statsSince(pool);
  const sinceDay = since?.slice(0, 10);
  const after = since ?? "-infinity";

  // Frozen totals where a day has them, the raw rows for the rest (today, at
  // least). Frozen totals count the whole day, so the day of a reset, and the
  // days before it, always come from the raw rows, filtered from the reset on.
  const live = await liveDayNumbers(pool, from, today, maxGuesses, since);
  const { rows: frozen } = await pool.query<DayNumbers>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, views, visitors, players, finished, won, signups, late_players AS "latePlayers"
     FROM daily_totals WHERE day BETWEEN $1 AND $2`,
    [from, today],
  );
  const frozenByDay = new Map(frozen.map((row) => [row.day, row]));
  const days = live.map((row) =>
    row.day === today || (sinceDay !== undefined && row.day <= sinceDay) ? row : (frozenByDay.get(row.day) ?? row),
  );

  const { rows: accountRows } = await pool.query<Dashboard["accounts"]>(
    `SELECT (SELECT count(*) FROM users)::int AS total,
            (SELECT count(DISTINCT user_id) FROM external_logins WHERE provider = 'google')::int AS google,
            (SELECT count(*) FROM users
              WHERE created_at > greatest(now() - interval '7 days', $1::timestamptz))::int AS "newThisWeek"`,
    [after],
  );

  const { rows: rounds } = await pool.query<Dashboard["rounds"][number]>(
    `WITH per_player AS (
       SELECT g.puzzle_date, coalesce(g.user_id::text, 'g:' || g.guest_id) AS who,
              bool_or(g.character_id = d.character_id) AS won, count(*) AS n
       FROM guesses g JOIN daily_puzzles d USING (puzzle_date)
       WHERE NOT g.late AND g.puzzle_date BETWEEN $1::date - 13 AND $1 AND g.created_at >= $3
       GROUP BY 1, 2
     )
     SELECT to_char(d.puzzle_date, 'YYYY-MM-DD') AS day, c.name AS answer, c.franchise,
            count(p.who)::int AS players,
            (count(*) FILTER (WHERE p.won))::int AS won,
            (count(*) FILTER (WHERE p.won OR p.n >= $2))::int AS finished,
            round(avg(p.n) FILTER (WHERE p.won), 1)::float AS "averageGuesses"
     FROM daily_puzzles d
     JOIN characters c ON c.id = d.character_id
     LEFT JOIN per_player p ON p.puzzle_date = d.puzzle_date
     WHERE d.puzzle_date BETWEEN $1::date - 13 AND $1
     GROUP BY d.puzzle_date, c.name, c.franchise
     ORDER BY d.puzzle_date DESC`,
    [today, maxGuesses, after],
  );

  // Each player's opening guess of each day: what people try first.
  const { rows: firstGuesses } = await pool.query<Count>(
    `WITH firsts AS (
       SELECT DISTINCT ON (puzzle_date, coalesce(user_id::text, 'g:' || guest_id)) character_id
       FROM guesses WHERE puzzle_date BETWEEN $1 AND $2 AND created_at >= $3
       ORDER BY puzzle_date, coalesce(user_id::text, 'g:' || guest_id), created_at, id
     )
     SELECT c.name AS label, count(*)::int AS count
     FROM firsts f JOIN characters c ON c.id = f.character_id
     GROUP BY c.name ORDER BY 2 DESC, 1 LIMIT 8`,
    [from, today, after],
  );

  return {
    today,
    since,
    days,
    accounts: accountRows[0]!,
    rounds,
    referrers: await topCounts(pool, "referrer", from, today, since),
    devices: await topCounts(pool, "device", from, today, since),
    timezones: await topCounts(pool, "timezone", from, today, since),
    languages: await topCounts(pool, "language", from, today, since),
    pages: await topCounts(pool, "path", from, today, since),
    firstGuesses,
  };
}
