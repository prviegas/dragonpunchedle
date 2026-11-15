import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type pg from "pg";
import { readGuestId } from "../auth/guests.js";
import { findCharacter } from "../db/characters.js";
import { listGuessIds, type Player } from "../db/guesses.js";
import { findPuzzleAnswerId, listPastRounds } from "../db/history.js";
import { scoreDistribution } from "../db/stats.js";
import { CLUES } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";
import { MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface HistoryRouteOptions {
  pool: pg.Pool;
  now: () => Date;
}

const dateSchema = {
  params: {
    type: "object",
    required: ["date"],
    properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
  },
} as const;

/**
 * Past rounds: what each finished day's answer was, and how the player did.
 * Read-only: old days can be looked at, not played. Today never appears here
 * (its answer is still secret), and neither do the days the job has already
 * picked ahead.
 */
export const historyRoutes: FastifyPluginAsync<HistoryRouteOptions> = async (app, { pool, now }) => {
  function playerOf(request: FastifyRequest): Player | undefined {
    if (request.user) return { userId: request.user.id };
    const guestId = readGuestId(request);
    return guestId ? { guestId } : undefined;
  }

  app.get("/api/history", async (request) => {
    const rounds = await listPastRounds(pool, playerOf(request), puzzleDateFor(now()));
    return { maxGuesses: MAX_GUESSES, rounds };
  });

  app.get<{ Params: { date: string } }>("/api/history/:date", { schema: dateSchema }, async (request, reply) => {
    const { date } = request.params;
    // Plain string comparison works for YYYY-MM-DD.
    if (date >= puzzleDateFor(now())) {
      return reply.code(404).send({ error: "That round isn't over yet." });
    }
    const answerId = await findPuzzleAnswerId(pool, date);
    const answer = answerId && (await findCharacter(pool, answerId));
    if (!answer) {
      return reply.code(404).send({ error: "There was no round that day." });
    }

    const player = playerOf(request);
    const guesses = [];
    for (const id of player ? await listGuessIds(pool, player, date) : []) {
      const guess = await findCharacter(pool, id);
      if (guess) guesses.push({ guess, ...compareGuess(guess, answer) });
    }

    return {
      date,
      maxGuesses: MAX_GUESSES,
      clues: CLUES.map(({ key, label, kind }) => ({ key, label, kind })),
      answer,
      guesses: guesses.reverse(), // newest first, as on today's board
      results: await scoreDistribution(pool, date, player ?? null, MAX_GUESSES),
    };
  });
};
