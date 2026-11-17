import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type pg from "pg";
import { dashboard, looksLikeBot, recordVisit, referrerHost, resetStatsSince } from "../db/site-stats.js";
import { MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface SiteStatsOptions {
  pool: pg.Pool;
  now: () => Date;
  /** Account ids that may open the dashboard. Empty: nobody. */
  adminUserIds: readonly number[];
  /** Local development: anyone, logged in or not, may open the dashboard. */
  dashboardOpen?: boolean;
}

/**
 * The owner, by account id rather than username: an id is never reused, while a
 * username could be freed (a deleted or renamed account) and claimed by someone else.
 */
export function isAdmin(request: FastifyRequest, adminUserIds: readonly number[]): boolean {
  const id = request.user?.id;
  return id !== undefined && adminUserIds.includes(Number(id));
}

/** "3, 12" → [3, 12]. Anything that isn't a whole positive number is ignored. */
export function parseUserIds(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[1-9]\d*$/.test(part))
    .map(Number);
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

export const siteStatsRoutes: FastifyPluginAsync<SiteStatsOptions> = async (app, { pool, now, adminUserIds, dashboardOpen = false }) => {
  await app.register(rateLimit, { global: false });

  // The page reports each view with this, so only real browsers that run the
  // game are counted (most bots never run scripts). The owner's own visits
  // are left out, so testing the site doesn't inflate the numbers.
  app.post<VisitBody>(
    "/api/visit",
    { schema: visitSchema, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const userAgent = request.headers["user-agent"] ?? "";
      if (!looksLikeBot(userAgent) && !isAdmin(request, adminUserIds)) {
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
    if (!dashboardOpen && !isAdmin(request, adminUserIds)) return reply.code(404).send({ error: "Not found." });
    reply.header("cache-control", "no-store");
    return dashboard(pool, puzzleDateFor(now()), MAX_GUESSES);
  });

  // Reset counting: the dashboard counts from this moment on. Owner only, even
  // in local open mode, since it changes what the dashboard shows for good.
  // Deletes nothing: visits, guesses and accounts all stay.
  app.post("/api/admin/stats/reset", async (request, reply) => {
    if (!isAdmin(request, adminUserIds)) return reply.code(404).send({ error: "Not found." });
    return { since: await resetStatsSince(pool) };
  });
};
