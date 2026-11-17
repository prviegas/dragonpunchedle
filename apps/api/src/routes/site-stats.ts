import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type pg from "pg";
import { dashboard, looksLikeBot, recordVisit, referrerHost } from "../db/site-stats.js";
import { MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface SiteStatsOptions {
  pool: pg.Pool;
  now: () => Date;
  /** Who may open the dashboard (case-insensitive). Empty: nobody. */
  adminUsernames: readonly string[];
}

export function isAdmin(request: FastifyRequest, adminUsernames: readonly string[]): boolean {
  const name = request.user?.username.toLowerCase();
  return name !== undefined && adminUsernames.some((admin) => admin.toLowerCase() === name);
}

const text = (maxLength: number) => ({ type: "string", maxLength });

interface VisitBody {
  Body: { path: string; referrer?: string; timezone?: string; language?: string };
}

const visitSchema = {
  body: {
    type: "object",
    required: ["path"],
    additionalProperties: false,
    properties: { path: text(200), referrer: text(500), timezone: text(64), language: text(35) },
  },
};

export const siteStatsRoutes: FastifyPluginAsync<SiteStatsOptions> = async (app, { pool, now, adminUsernames }) => {
  await app.register(rateLimit, { global: false });

  // The page reports each view with this, so only real browsers that run the
  // game are counted (most bots never run scripts). The owner's own visits
  // are left out, so testing the site doesn't inflate the numbers.
  app.post<VisitBody>(
    "/api/visit",
    { schema: visitSchema, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const userAgent = request.headers["user-agent"] ?? "";
      if (!looksLikeBot(userAgent) && !isAdmin(request, adminUsernames)) {
        const { path, referrer, timezone, language } = request.body;
        await recordVisit(pool, {
          day: puzzleDateFor(now()),
          ip: request.ip,
          userAgent,
          path,
          referrer: referrerHost(referrer, request.headers.host),
          timezone: timezone || null,
          language: language || null,
        });
      }
      return reply.code(204).send();
    },
  );

  // Anyone else gets the same 404 as a path that doesn't exist.
  app.get("/api/admin/dashboard", async (request, reply) => {
    if (!isAdmin(request, adminUsernames)) return reply.code(404).send({ error: "Not found." });
    reply.header("cache-control", "no-store");
    return dashboard(pool, puzzleDateFor(now()), MAX_GUESSES);
  });
};
