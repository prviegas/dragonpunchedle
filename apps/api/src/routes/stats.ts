import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { playerStats, scoreDistribution, streakLeaderboard, todayLeaderboard } from "../db/stats.js";
import { readGuestId } from "../auth/guests.js";
import { MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface StatsRouteOptions {
  pool: pg.Pool;
  now: () => Date;
}

export const statsRoutes: FastifyPluginAsync<StatsRouteOptions> = async (app, { pool, now }) => {
  app.get("/api/me/stats", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Log in to see your stats." });
    }
    return playerStats(pool, request.user.id, puzzleDateFor(now()));
  });

  // Leaderboards are public; the viewer's id only marks their own row.
  app.get("/api/leaderboards/today", async (request) =>
    todayLeaderboard(pool, puzzleDateFor(now()), request.user?.id ?? null),
  );

  // How everyone did today, accounts and guests, for the results chart.
  // Counts only, no names.
  app.get("/api/puzzles/today/results", async (request) => {
    const guestId = readGuestId(request);
    const viewer = request.user ? { userId: request.user.id } : guestId ? { guestId } : null;
    return scoreDistribution(pool, puzzleDateFor(now()), viewer, MAX_GUESSES);
  });

  app.get("/api/leaderboards/streaks", async (request) =>
    streakLeaderboard(pool, puzzleDateFor(now()), request.user?.id ?? null),
  );
};
