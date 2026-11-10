import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type pg from "pg";
import { hashForUnknownUser, hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, deleteSession, SESSION_COOKIE, type User } from "../auth/sessions.js";
import { createUser, findUserForLogin } from "../db/users.js";

interface AuthRouteOptions {
  pool: pg.Pool;
  /** Cookies only sent over HTTPS. On in production, off for local http://. */
  secureCookies: boolean;
  /** Login and sign-up attempts allowed per IP address per minute. */
  rateLimitPerMinute: number;
}

const credentialsSchema = {
  body: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", pattern: "^[A-Za-z0-9_-]{3,20}$" },
      // The upper bound stops someone making the server hash a huge string.
      password: { type: "string", minLength: 8, maxLength: 200 },
    },
  },
} as const;

type Credentials = { Body: { username: string; password: string } };

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { pool, secureCookies, rateLimitPerMinute },
) => {
  // Limits only the routes below that opt in, so the game itself is unaffected.
  await app.register(rateLimit, { global: false });
  const limited = { rateLimit: { max: rateLimitPerMinute, timeWindow: "1 minute" } };

  async function startSession(reply: FastifyReply, user: User) {
    const { token, expiresAt } = await createSession(pool, user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, // page scripts can't read it, so an injected script can't steal it
      sameSite: "lax", // not sent on cross-site POSTs, which blocks forged requests from other sites
      secure: secureCookies,
      path: "/",
      expires: expiresAt,
    });
  }

  app.post<Credentials>("/api/auth/register", { schema: credentialsSchema, config: limited }, async (request, reply) => {
    const { username, password } = request.body;
    const user = await createUser(pool, username, await hashPassword(password));
    if (user === "taken") {
      return reply.code(409).send({ error: "That username is taken." });
    }
    await startSession(reply, user);
    return reply.code(201).send({ user });
  });

  app.post<Credentials>("/api/auth/login", { schema: credentialsSchema, config: limited }, async (request, reply) => {
    const { username, password } = request.body;
    const found = await findUserForLogin(pool, username);
    const valid = await verifyPassword(password, found?.passwordHash ?? (await hashForUnknownUser()));
    if (!found || !valid) {
      // One message for both cases, so the login form can't be used to find out which usernames exist.
      return reply.code(401).send({ error: "Wrong username or password." });
    }
    const user = { id: found.id, username: found.username };
    await startSession(reply, user);
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(pool, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request) => ({ user: request.user }));
};
