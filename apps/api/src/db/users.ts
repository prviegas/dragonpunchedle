import type pg from "pg";
import type { User } from "../auth/sessions.js";

const UNIQUE_VIOLATION = "23505";

/** Creates an account, or returns "taken" if the name exists in any capitalisation. */
export async function createUser(pool: pg.Pool, username: string, passwordHash: string): Promise<User | "taken"> {
  try {
    const { rows } = await pool.query<{ id: string; username: string }>(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, passwordHash],
    );
    return { id: Number(rows[0]!.id), username: rows[0]!.username };
  } catch (error) {
    // Checking first and inserting second would leave a gap where two people
    // could claim the same name; letting the unique index decide closes it.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return "taken";
    throw error;
  }
}

export async function findUserForLogin(
  pool: pg.Pool,
  username: string,
): Promise<(User & { passwordHash: string }) | undefined> {
  const { rows } = await pool.query<{ id: string; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), username: row.username, passwordHash: row.password_hash } : undefined;
}
