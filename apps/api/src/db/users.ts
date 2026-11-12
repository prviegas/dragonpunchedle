import type pg from "pg";
import type { User } from "../auth/sessions.js";

const UNIQUE_VIOLATION = "23505";

type Queryable = pg.Pool | pg.PoolClient;

/** Creates an account, or returns "taken" if the name exists in any capitalisation.
 *  passwordHash is null for accounts that sign in through Discord or Google. */
export async function createUser(db: Queryable, username: string, passwordHash: string | null): Promise<User | "taken"> {
  try {
    const { rows } = await db.query<{ id: string; username: string }>(
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
): Promise<(User & { passwordHash: string | null }) | undefined> {
  const { rows } = await pool.query<{ id: string; username: string; password_hash: string | null }>(
    "SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), username: row.username, passwordHash: row.password_hash } : undefined;
}

export type Provider = "discord" | "google";

/** The player who signed in with this Discord or Google account before, if any. */
export async function findUserByExternalLogin(
  pool: pg.Pool,
  provider: Provider,
  providerUserId: string,
): Promise<User | undefined> {
  const { rows } = await pool.query<{ id: string; username: string }>(
    `SELECT u.id, u.username
     FROM external_logins e JOIN users u ON u.id = e.user_id
     WHERE e.provider = $1 AND e.provider_user_id = $2`,
    [provider, providerUserId],
  );
  return rows[0] ? { id: Number(rows[0].id), username: rows[0].username } : undefined;
}

/**
 * A new account for a first-time Discord or Google sign-in. Tries each
 * candidate name in turn until one is free. The account and its link are
 * created in one transaction, so a failure never leaves a half-made account.
 */
export async function createUserWithExternalLogin(
  pool: pg.Pool,
  provider: Provider,
  providerUserId: string,
  candidateNames: string[],
): Promise<User | "no-free-name"> {
  const client = await pool.connect();
  try {
    for (const name of candidateNames) {
      await client.query("BEGIN");
      const user = await createUser(client, name, null);
      if (user === "taken") {
        // The failed insert aborted the transaction; start over with the next name.
        await client.query("ROLLBACK");
        continue;
      }
      await client.query(
        "INSERT INTO external_logins (provider, provider_user_id, user_id) VALUES ($1, $2, $3)",
        [provider, providerUserId, user.id],
      );
      await client.query("COMMIT");
      return user;
    }
    return "no-free-name";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
