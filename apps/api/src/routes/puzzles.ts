import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { findCharacter } from "../db/characters.js";
import { hasSolved, listGuessIds, saveGuess } from "../db/guesses.js";
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

  // A logged-in player's guesses for today, newest first, scored again from
  // the stored character ids. Lets the board follow them to another device.
  app.get("/api/puzzles/today/guesses", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Log in to see your saved guesses." });
    }
    const date = puzzleDateFor(now());
    const answer = await findCharacter(pool, await ensurePuzzle(pool, date));
    if (!answer) throw new Error(`Puzzle ${date} points at a missing character`);

    const results = [];
    for (const id of await listGuessIds(pool, request.user.id, date)) {
      const guess = await findCharacter(pool, id);
      if (guess) results.push({ guess, ...compareGuess(guess, answer) });
    }
    return results.reverse();
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

      // Logged-in guesses are saved. Guests are checked and forgotten.
      if (request.user) {
        if (await hasSolved(pool, request.user.id, date)) {
          return reply.code(409).send({ error: "You've already solved today's puzzle." });
        }
        if (!(await saveGuess(pool, request.user.id, date, guess.id))) {
          return reply.code(409).send({ error: "You already guessed that character." });
        }
      }

      // The guess's own values are safe to send back: the player chose it.
      // Only the comparison is derived from the answer.
      return { guess, ...compareGuess(guess, answer) };
    },
  );
};
