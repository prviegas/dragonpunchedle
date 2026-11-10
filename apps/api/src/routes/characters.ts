import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { listCharacterSummaries } from "../db/characters.js";

export const characterRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get("/api/characters", async (_request, reply) => {
    // The roster rarely changes, so browsers may reuse it for five minutes.
    reply.header("cache-control", "public, max-age=300");
    return listCharacterSummaries(pool);
  });
};
