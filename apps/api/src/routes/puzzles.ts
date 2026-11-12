import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { findCharacter } from "../db/characters.js";
import { listGuessIds, saveGuess } from "../db/guesses.js";
import { CLUES } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";
import { ensurePuzzle, MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

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
    properties: {
      characterId: { type: "string", minLength: 1, maxLength: 100 },
      // Guests only: how many guesses this browser has already made today. The
      // server keeps no guest state, so it has to take the page's word for it.
      // A guest who lies only spoils their own game: guests aren't on the
      // leaderboards. Logged-in players are counted from the database instead.
      previousGuesses: { type: "integer", minimum: 0, maximum: 1000 },
    },
  },
} as const;

type GuessRequest = { Params: { date: string }; Body: { characterId: string; previousGuesses?: number } };

export const puzzleRoutes: FastifyPluginAsync<PuzzleRouteOptions> = async (app, { pool, now }) => {
  async function todaysAnswer(date: string) {
    const answer = await findCharacter(pool, await ensurePuzzle(pool, date));
    if (!answer) throw new Error(`Puzzle ${date} points at a missing character`);
    return answer;
  }

  // Everything the page needs to draw today's board, and nothing about the answer.
  app.get("/api/puzzles/today", async () => {
    const date = puzzleDateFor(now());
    await ensurePuzzle(pool, date);
    return {
      date,
      maxGuesses: MAX_GUESSES,
      clues: CLUES.map(({ key, label, kind }) => ({ key, label, kind })),
    };
  });

  // A logged-in player's guesses for today, newest first, scored again from
  // the stored character ids. Lets the board follow them to another device.
  // Includes the answer once they've run out of guesses without solving it.
  app.get("/api/puzzles/today/guesses", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Log in to see your saved guesses." });
    }
    const date = puzzleDateFor(now());
    const answer = await todaysAnswer(date);

    const results = [];
    for (const id of await listGuessIds(pool, request.user.id, date)) {
      const guess = await findCharacter(pool, id);
      if (guess) results.push({ guess, ...compareGuess(guess, answer) });
    }
    const lost = results.length >= MAX_GUESSES && !results.some((r) => r.solved);
    return { guesses: results.reverse(), ...(lost && { answer }) };
  });

  app.post<GuessRequest>("/api/puzzles/:date/guesses", { schema: guessSchema }, async (request, reply) => {
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
    const answer = await todaysAnswer(date);

    let guessNumber: number;
    if (request.user) {
      // Logged-in guesses are saved, and the database enforces the rules.
      const saved = await saveGuess(pool, request.user.id, date, guess.id, MAX_GUESSES);
      if (!saved.saved) {
        const message = {
          solved: "You've already solved today's puzzle.",
          duplicate: "You already guessed that character.",
          "out-of-guesses": "You're out of guesses for today. A new character arrives tomorrow.",
        }[saved.reason];
        return reply.code(409).send({ error: message });
      }
      guessNumber = saved.guessNumber;
    } else {
      // Guests are checked and forgotten.
      const previous = request.body.previousGuesses ?? 0;
      if (previous >= MAX_GUESSES) {
        return reply.code(409).send({ error: "You're out of guesses for today. A new character arrives tomorrow." });
      }
      guessNumber = previous + 1;
    }

    // The guess's own values are safe to send back: the player chose it.
    // The answer itself goes out only when this was the last guess and missed.
    const result = compareGuess(guess, answer);
    const lost = !result.solved && guessNumber >= MAX_GUESSES;
    return { guess, ...result, guessNumber, ...(lost && { answer }) };
  });
};
