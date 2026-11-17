import type pg from "pg";
import type { Player } from "./guesses.js";

// Arcade Ladder storage. See migrations/013_arcade.sql.

/** Guesses per floor: fewer than the daily round's 10, to keep a run tense. */
export const ARCADE_GUESSES = 8;

export interface ArcadeFloor {
  floor: number;
  characterId: string;
  guesses: string[];
  solved: boolean;
}

export interface ArcadeRun {
  id: number;
  floorsCleared: number;
  over: boolean;
  /** Oldest floor first; the last one is the floor being played (or the one that was lost). */
  floors: ArcadeFloor[];
}

function playerColumn(player: Player): { column: "user_id" | "guest_id"; value: number | string } {
  return "userId" in player ? { column: "user_id", value: player.userId } : { column: "guest_id", value: player.guestId };
}

/** Runs one change to a player's arcade state at a time, like saveGuess does for the daily round. */
async function withPlayerLock<T>(pool: pg.Pool, player: Player, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const { column, value } = playerColumn(player);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`arcade:${column}:${value}`]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadRun(db: pg.Pool | pg.PoolClient, runId: number): Promise<ArcadeRun> {
  const { rows: runs } = await db.query<{ id: string; floors_cleared: number; ended_at: Date | null }>(
    "SELECT id, floors_cleared, ended_at FROM arcade_runs WHERE id = $1",
    [runId],
  );
  const run = runs[0]!;
  const { rows: floors } = await db.query<{ floor: number; character_id: string; guesses: string[]; solved: boolean }>(
    "SELECT floor, character_id, guesses, solved FROM arcade_floors WHERE run_id = $1 ORDER BY floor",
    [runId],
  );
  return {
    id: Number(run.id),
    floorsCleared: run.floors_cleared,
    over: run.ended_at !== null,
    floors: floors.map((f) => ({ floor: f.floor, characterId: f.character_id, guesses: f.guesses, solved: f.solved })),
  };
}

/**
 * The player's latest run: the one in progress, or the last one they finished
 * (so a game-over screen survives a reload). Undefined if they never played.
 */
export async function latestRun(pool: pg.Pool, player: Player): Promise<ArcadeRun | undefined> {
  const { column, value } = playerColumn(player);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM arcade_runs WHERE ${column} = $1 ORDER BY ended_at IS NULL DESC, started_at DESC, id DESC LIMIT 1`,
    [value],
  );
  return rows[0] ? loadRun(pool, Number(rows[0].id)) : undefined;
}

/**
 * Local testing only: ARCADE_TEST_CHARACTER=street-fighter-ryu makes every
 * floor that fighter, to try combos and the K.O. quickly. Ignored in
 * production and while the automated tests run.
 */
function testOpponent(): string | undefined {
  if (process.env.NODE_ENV === "production" || process.env.VITEST) return undefined;
  return process.env.ARCADE_TEST_CHARACTER || undefined;
}

/** A random fighter this run hasn't met yet. */
async function addFloor(client: pg.PoolClient, runId: number, floor: number): Promise<void> {
  const forced = testOpponent();
  if (forced) {
    await client.query("INSERT INTO arcade_floors (run_id, floor, character_id) VALUES ($1, $2, $3)", [runId, floor, forced]);
    return;
  }
  const inserted = await client.query(
    `INSERT INTO arcade_floors (run_id, floor, character_id)
     SELECT $1, $2, id FROM characters
     WHERE id NOT IN (SELECT character_id FROM arcade_floors WHERE run_id = $1)
     ORDER BY random() LIMIT 1`,
    [runId, floor],
  );
  // Every fighter beaten: the ladder has no more floors, and the run ends as a full clear.
  if (inserted.rowCount === 0) await client.query("UPDATE arcade_runs SET ended_at = now() WHERE id = $1", [runId]);
}

/**
 * Gives up the run in progress: it ends on the current floor, like losing it,
 * and the floors cleared so far still count. False if there was nothing to end.
 */
export async function giveUpRun(pool: pg.Pool, player: Player): Promise<boolean> {
  const { column, value } = playerColumn(player);
  return withPlayerLock(pool, player, async (client) => {
    const ended = await client.query(`UPDATE arcade_runs SET ended_at = now() WHERE ${column} = $1 AND ended_at IS NULL`, [value]);
    return (ended.rowCount ?? 0) > 0;
  });
}

/** Starts a new run, ending any run still in progress. */
export async function startRun(pool: pg.Pool, player: Player): Promise<ArcadeRun> {
  const { column, value } = playerColumn(player);
  return withPlayerLock(pool, player, async (client) => {
    await client.query(`UPDATE arcade_runs SET ended_at = now() WHERE ${column} = $1 AND ended_at IS NULL`, [value]);
    const { rows } = await client.query<{ id: string }>(`INSERT INTO arcade_runs (${column}) VALUES ($1) RETURNING id`, [value]);
    const runId = Number(rows[0]!.id);
    await addFloor(client, runId, 1);
    return loadRun(client, runId);
  });
}

export type ArcadeGuessResult =
  | { saved: true; floor: number; guessNumber: number; solved: boolean; runOver: boolean; answerId: string }
  | { saved: false; reason: "no-run" | "duplicate" };

/**
 * A guess on the current floor. A solve clears the floor and opens the next
 * one; missing with the last guess ends the run. Checked and saved under the
 * player's lock, so two guesses at once can't both land.
 */
export async function arcadeGuess(pool: pg.Pool, player: Player, characterId: string): Promise<ArcadeGuessResult> {
  const { column, value } = playerColumn(player);
  return withPlayerLock(pool, player, async (client) => {
    const { rows } = await client.query<{ id: string; floor: number; character_id: string; guesses: string[] }>(
      `SELECT r.id, f.floor, f.character_id, f.guesses
       FROM arcade_runs r JOIN arcade_floors f ON f.run_id = r.id
       WHERE r.${column} = $1 AND r.ended_at IS NULL
       ORDER BY f.floor DESC LIMIT 1`,
      [value],
    );
    const current = rows[0];
    if (!current) return { saved: false, reason: "no-run" } as const;
    if (current.guesses.includes(characterId)) return { saved: false, reason: "duplicate" } as const;

    const runId = Number(current.id);
    const solved = characterId === current.character_id;
    const guessNumber = current.guesses.length + 1;
    await client.query(
      "UPDATE arcade_floors SET guesses = array_append(guesses, $3), solved = $4 WHERE run_id = $1 AND floor = $2",
      [runId, current.floor, characterId, solved],
    );

    let runOver = false;
    if (solved) {
      await client.query("UPDATE arcade_runs SET floors_cleared = floors_cleared + 1 WHERE id = $1", [runId]);
      await addFloor(client, runId, current.floor + 1);
      runOver = (await client.query("SELECT 1 FROM arcade_runs WHERE id = $1 AND ended_at IS NOT NULL", [runId])).rows.length > 0;
    } else if (guessNumber >= ARCADE_GUESSES) {
      await client.query("UPDATE arcade_runs SET ended_at = now() WHERE id = $1", [runId]);
      runOver = true;
    }
    return { saved: true, floor: current.floor, guessNumber, solved, runOver, answerId: current.character_id } as const;
  });
}

export interface LadderEntry {
  rank: number;
  username: string;
  floor: number;
  you: boolean;
}

/**
 * Accounts' best runs, highest floor first; a tie goes to whoever got there
 * first. Guests play, but only accounts are ranked.
 */
export async function arcadeLeaderboard(pool: pg.Pool, viewerId: number | null, limit = 10) {
  const { rows } = await pool.query<{ user_id: string; username: string; floor: number; rank: string }>(
    `WITH best AS (
       SELECT DISTINCT ON (r.user_id) r.user_id, r.floors_cleared AS floor, coalesce(r.ended_at, now()) AS reached
       FROM arcade_runs r
       WHERE r.user_id IS NOT NULL AND r.floors_cleared > 0
       ORDER BY r.user_id, r.floors_cleared DESC, coalesce(r.ended_at, now())
     ),
     ranked AS (
       SELECT b.user_id, u.username, b.floor, rank() OVER (ORDER BY b.floor DESC, b.reached) AS rank
       FROM best b JOIN users u ON u.id = b.user_id
     )
     SELECT * FROM ranked WHERE rank <= $1 OR user_id = $2 ORDER BY rank`,
    [limit, viewerId],
  );
  const entries: LadderEntry[] = rows.map((row) => ({
    rank: Number(row.rank),
    username: row.username,
    floor: row.floor,
    you: viewerId !== null && Number(row.user_id) === viewerId,
  }));
  return { top: entries.filter((e) => e.rank <= limit), you: entries.find((e) => e.you && e.rank > limit) };
}

/** The player's highest floor ever, for the "best" line on the ladder. */
export async function bestFloor(pool: pg.Pool, player: Player): Promise<number> {
  const { column, value } = playerColumn(player);
  const { rows } = await pool.query<{ best: number | null }>(`SELECT max(floors_cleared) AS best FROM arcade_runs WHERE ${column} = $1`, [value]);
  return rows[0]?.best ?? 0;
}
