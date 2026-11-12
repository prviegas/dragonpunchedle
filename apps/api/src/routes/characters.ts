import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { findPortraitImage, listCharacterSummaries } from "../db/characters.js";

export const characterRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.get("/api/characters", async (_request, reply) => {
    // The roster rarely changes, so browsers may reuse it for five minutes.
    reply.header("cache-control", "public, max-age=300");
    return listCharacterSummaries(pool);
  });

  // A character's portrait. Any character's can be fetched, which gives
  // nothing away: the page only asks for portraits of characters already
  // guessed, and the list of characters is public anyway.
  app.get<{ Params: { id: string } }>(
    "/api/portraits/:id",
    { schema: { params: { type: "object", properties: { id: { type: "string", maxLength: 100 } } } } },
    async (request, reply) => {
      const portrait = await findPortraitImage(pool, request.params.id);
      if (!portrait) return reply.code(404).send({ error: "No portrait for that character." });

      const etag = `"${portrait.hash}"`;
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply
        .header("content-type", portrait.contentType)
        .header("etag", etag)
        // A day, not a year: if a publisher asks for an image to come down,
        // browsers stop showing their saved copy within a day.
        .header("cache-control", "public, max-age=86400")
        .send(portrait.image);
    },
  );
};
