import { sep } from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyServerOptions } from "fastify";
import type pg from "pg";
import { findSessionUser, SESSION_COOKIE, type User } from "./auth/sessions.js";
import { authRoutes, type OAuthOptions } from "./routes/auth.js";
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
  /** Sign in with Discord / Google. Left out, only passwords are offered. */
  oauth?: OAuthOptions;
  /** Absolute path to the built web app. When set, the API also serves the
   *  page, so production needs only one server. Unset in development, where
   *  Vite serves the page. */
  staticDir?: string;
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
  oauth,
  staticDir,
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
      if (!request.url.startsWith("/api/")) return; // page files don't need a login lookup
      const token = request.cookies[SESSION_COOKIE];
      request.user = (token && (await findSessionUser(pool, token))) || null;
    });

    app.register(authRoutes, { pool, secureCookies, rateLimitPerMinute: authRateLimitPerMinute, oauth });
    app.register(characterRoutes, { pool });
    app.register(puzzleRoutes, { pool, now });
    app.register(statsRoutes, { pool, now });
  }

  if (staticDir) {
    app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false, // one route per file that exists, instead of a catch-all
      cacheControl: false, // set below, per file
      setHeaders(res, filePath) {
        // Vite puts a content hash in every file name under assets/, so a new
        // version gets a new name: those can be cached for a year. index.html
        // keeps its name, so browsers must check for a new one every time.
        const hashed = filePath.includes(`${sep}assets${sep}`);
        res.header("cache-control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  // Unknown API paths get a JSON 404. Any other unknown path gets the page
  // itself, so a shared link to a route the page handles still opens the game.
  app.setNotFoundHandler((request, reply) => {
    if (staticDir && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  return app;
}
