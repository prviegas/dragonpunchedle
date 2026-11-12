import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply } from "fastify";
import type pg from "pg";

export const SESSION_COOKIE = "dp_session";
export const SESSION_DAYS = 30;

export interface User {
  id: number;
  username: string;
}

// The token is 32 random bytes: impossible to guess. Only its hash is stored,
// so even someone reading the database can't turn a row back into a login.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(pool: pg.Pool, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{ expires_at: Date }>(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))
     RETURNING expires_at`,
    [hashToken(token), userId, SESSION_DAYS],
  );
  return { token, expiresAt: rows[0]!.expires_at };
}

/** Logs the user in: a new session row, and its token in the session cookie.
 *  Shared by password login, sign-up, and Discord/Google sign-in. */
export async function startSession(pool: pg.Pool, reply: FastifyReply, userId: number, secureCookies: boolean) {
  const { token, expiresAt } = await createSession(pool, userId);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, // page scripts can't read it, so an injected script can't steal it
    sameSite: "lax", // not sent on cross-site POSTs, which blocks forged requests from other sites
    secure: secureCookies,
    path: "/",
    expires: expiresAt,
  });
}

/** The logged-in user for a session token, or undefined if it's unknown or expired. */
export async function findSessionUser(pool: pg.Pool, token: string): Promise<User | undefined> {
  const { rows } = await pool.query<{ id: string; username: string }>(
    `SELECT u.id, u.username
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  // bigint columns arrive as strings (they can exceed JavaScript's safe integer
  // range); user ids won't, so convert.
  return rows[0] ? { id: Number(rows[0].id), username: rows[0].username } : undefined;
}

export async function deleteSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}
