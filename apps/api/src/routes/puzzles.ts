import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { findCharacter } from "../db/characters.js";
import { CLUES } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";
import { ensurePuzzle, puzzleDateFor } from "../game/puzzles.js";

interface PuzzleRouteOptions {
  pool: pg.Pool;
  /** The current time. Injected so tests can pretend it's any day. */
  now: () => Date;
}

// Fastify checks requests against these JSON schemas before the handler runs,
// and answers 400 with the reason when they don't match.
const guessSchema = {
  params: {
    type: "object",
    required: ["date"],
    properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
  },
  body: {
    type: "object",
    required: ["characterId"],
    additionalProperties: false,
    properties: { characterId: { type: "string", minLength: 1, maxLength: 100 } },
  },
} as const;

export const puzzleRoutes: FastifyPluginAsync<PuzzleRouteOptions> = async (app, { pool, now }) => {
  // Everything the page needs to draw today's board, and nothing about the answer.
  app.get("/api/puzzles/today", async () => {
    const date = puzzleDateFor(now());
    await ensurePuzzle(pool, date);
    return {
      date,
      clues: CLUES.map(({ key, label, kind }) => ({ key, label, kind })),
    };
  });

  app.post<{ Params: { date: string }; Body: { characterId: string } }>(
    "/api/puzzles/:date/guesses",
    { schema: guessSchema },
    async (request, reply) => {
      const { date } = request.params;
      // Only today's puzzle takes guesses. The date is part of the URL so a
      // player who loaded the page before midnight gets a clear error rather
      // than having their guess checked against a different answer.
      if (date !== puzzleDateFor(now())) {
        return reply.code(400).send({ error: "That puzzle isn't open for guesses. Reload for today's." });
      }

      const guess = await findCharacter(pool, request.body.characterId);
      if (!guess) {
        return reply.code(400).send({ error: "Unknown character." });
      }

      const answer = await findCharacter(pool, await ensurePuzzle(pool, date));
      if (!answer) {
        throw new Error(`Puzzle ${date} points at a missing character`);
      }

      // The guess's own values are safe to send back: the player chose it.
      // Only the comparison is derived from the answer.
      return { guess, ...compareGuess(guess, answer) };
    },
  );
};
