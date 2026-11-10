import cookie from "@fastify/cookie";
import Fastify, { type FastifyServerOptions } from "fastify";
import type pg from "pg";
import { findSessionUser, SESSION_COOKIE, type User } from "./auth/sessions.js";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { puzzleRoutes } from "./routes/puzzles.js";
import { statsRoutes } from "./routes/stats.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The logged-in player, or null for a guest. */
    user: User | null;
  }
}

export interface AppOptions extends FastifyServerOptions {
  /** Without a pool, only the health route is available. */
  pool?: pg.Pool;
  now?: () => Date;
  secureCookies?: boolean;
  authRateLimitPerMinute?: number;
}

// Building the app separately from listening on a port lets tests send
// requests straight to it with app.inject(), without opening a real socket.
// Its dependencies (database, clock) are passed in rather than created here,
// so a test can hand it a test database and a fixed date.
export function buildApp({
  pool,
  now = () => new Date(),
  secureCookies = false,
  authRateLimitPerMinute = 10,
  ...fastifyOptions
}: AppOptions = {}) {
  const app = Fastify({
    // Fastify's default is to silently drop fields a schema doesn't allow.
    // Rejecting them instead makes a client bug show up as a clear 400.
    ajv: { customOptions: { removeAdditional: false } },
    ...fastifyOptions,
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  if (pool) {
    app.register(cookie);
    app.decorateRequest("user", null);

    // Runs before every route handler: turns the session cookie, if any, into
    // request.user. preHandler runs after the cookie plugin has parsed cookies.
    app.addHook("preHandler", async (request) => {
      const token = request.cookies[SESSION_COOKIE];
      request.user = (token && (await findSessionUser(pool, token))) || null;
    });

    app.register(authRoutes, { pool, secureCookies, rateLimitPerMinute: authRateLimitPerMinute });
    app.register(characterRoutes, { pool });
    app.register(puzzleRoutes, { pool, now });
    app.register(statsRoutes, { pool, now });
  }

  return app;
}
