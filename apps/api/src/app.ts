import { sep } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
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
  guessRateLimitPerMinute?: number;
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
  guessRateLimitPerMinute = 120,
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

  // Security headers on every response. Mostly they tell the browser to refuse
  // things this site never does, so if an attacker ever slips something in,
  // the browser blocks it instead of running it.
  app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        // Content Security Policy: everything comes from this site, nothing else.
        defaultSrc: ["'self'"],
        // Only our own script files. No inline <script> and no onclick="...":
        // the usual way an injected script runs is exactly what this blocks.
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // Inline styles are allowed: the static privacy page carries its own
        // <style> block, and styles can't run code.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"], // fetch() only to our own API
        objectSrc: ["'none'"], // no plugins
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"], // no other site can show the game in a frame (clickjacking)
        // On HTTPS, any stray http:// link on the page is fetched over https://.
        // Left out for plain-http local runs, where it would break every asset.
        ...(secureCookies && { upgradeInsecureRequests: [] }),
      },
    },
    // HTTPS only from now on, for a year. Browsers ignore it over plain http.
    strictTransportSecurity: { maxAge: 365 * 24 * 60 * 60, includeSubDomains: false },
    // Don't tell other sites which page a player came from.
    referrerPolicy: { policy: "no-referrer" },
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

    app.register(authRoutes, { pool, secureCookies, rateLimitPerMinute: authRateLimitPerMinute, oauth, now });
    app.register(characterRoutes, { pool });
    app.register(puzzleRoutes, { pool, now, secureCookies, guessRateLimitPerMinute });
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
