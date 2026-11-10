import Fastify, { type FastifyServerOptions } from "fastify";
import type pg from "pg";
import { characterRoutes } from "./routes/characters.js";
import { puzzleRoutes } from "./routes/puzzles.js";

export interface AppOptions extends FastifyServerOptions {
  /** Without a pool, only the health route is available. */
  pool?: pg.Pool;
  now?: () => Date;
}

// Building the app separately from listening on a port lets tests send
// requests straight to it with app.inject(), without opening a real socket.
// Its dependencies (database, clock) are passed in rather than created here,
// so a test can hand it a test database and a fixed date.
export function buildApp({ pool, now = () => new Date(), ...fastifyOptions }: AppOptions = {}) {
  const app = Fastify({
    // Fastify's default is to silently drop fields a schema doesn't allow.
    // Rejecting them instead makes a client bug show up as a clear 400.
    ajv: { customOptions: { removeAdditional: false } },
    ...fastifyOptions,
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  if (pool) {
    app.register(characterRoutes, { pool });
    app.register(puzzleRoutes, { pool, now });
  }

  return app;
}
