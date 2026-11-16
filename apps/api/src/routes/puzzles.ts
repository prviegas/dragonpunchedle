import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { findCharacter } from "../db/characters.js";
import { findPuzzleAnswerId } from "../db/history.js";
import rateLimit from "@fastify/rate-limit";
import { ensureGuestId, readGuestId } from "../auth/guests.js";
import { listGuessIds, saveGuess, type Player } from "../db/guesses.js";
import { publicClues } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";
import { ensurePuzzle, MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface PuzzleRouteOptions {
  pool: pg.Pool;
  /** The current time. Injected so tests can pretend it's any day. */
  now: () => Date;
  secureCookies: boolean;
  /** Guesses allowed per IP address per minute: plenty for a person, a brake on a script. */
  guessRateLimitPerMinute: number;
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
      // Sent by the page before guests were counted on the server. Accepted so a
      // tab left open across that update keeps working, and ignored.
      previousGuesses: { type: "integer", minimum: 0, maximum: 1000 },
    },
  },
} as const;

type GuessRequest = { Params: { date: string }; Body: { characterId: string; previousGuesses?: number } };

export const puzzleRoutes: FastifyPluginAsync<PuzzleRouteOptions> = async (
  app,
  { pool, now, secureCookies, guessRateLimitPerMinute },
) => {
  await app.register(rateLimit, { global: false });
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
      clues: publicClues(),
    };
  });

  // The player's guesses for today, newest first, scored again from the
  // stored character ids: an account's on any device, a guest's in their
  // browser. Includes the answer once they've run out without solving it.
  app.get("/api/puzzles/today/guesses", async (request) => {
    const guestId = readGuestId(request);
    const player: Player | undefined = request.user ? { userId: request.user.id } : guestId ? { guestId } : undefined;
    if (!player) return { guesses: [] }; // a guest who hasn't guessed yet
    const date = puzzleDateFor(now());
    const answer = await todaysAnswer(date);

    const results = [];
    for (const id of await listGuessIds(pool, player, date)) {
      const guess = await findCharacter(pool, id);
      if (guess) results.push({ guess, ...compareGuess(guess, answer) });
    }
    const lost = results.length >= MAX_GUESSES && !results.some((r) => r.solved);
    return { guesses: results.reverse(), ...(lost && { answer }) };
  });

  app.post<GuessRequest>(
    "/api/puzzles/:date/guesses",
    { schema: guessSchema, config: { rateLimit: { max: guessRateLimitPerMinute, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { date } = request.params;
      // Today's round, or any past day's (played late). The date is in the URL,
      // so a guess is always checked against the round the player is looking
      // at, even from a page loaded before midnight. Days ahead stay closed:
      // their answers are already picked.
      const today = puzzleDateFor(now());
      if (date > today) {
        return reply.code(400).send({ error: "That round hasn't started yet." });
      }
      const late = date < today;

      const guess = await findCharacter(pool, request.body.characterId);
      if (!guess) {
        return reply.code(400).send({ error: "Unknown character." });
      }
      let answer;
      if (late) {
        // A past day is looked up, never created: no round then, no round now.
        const answerId = await findPuzzleAnswerId(pool, date);
        answer = answerId && (await findCharacter(pool, answerId));
        if (!answer) return reply.code(404).send({ error: "There was no round that day." });
      } else {
        answer = await todaysAnswer(date);
      }

      // Every guess is saved, an account's or a guest's, and the database enforces the rules.
      const player: Player = request.user
        ? { userId: request.user.id }
        : { guestId: ensureGuestId(request, reply, secureCookies) };
      const saved = await saveGuess(pool, player, date, guess.id, MAX_GUESSES, late);
      if (!saved.saved) {
        const message = {
          solved: "You've already solved today's puzzle.",
          duplicate: "You already guessed that character.",
          "out-of-guesses": late
            ? "You're out of guesses for this round."
            : "You're out of guesses for today. A new character arrives tomorrow.",
          revealed: "You've already seen the answer for this round.",
        }[saved.reason];
        return reply.code(409).send({ error: message });
      }
      const { guessNumber } = saved;

      // The guess's own values are safe to send back: the player chose it.
      // The answer itself goes out only when this was the last guess and missed.
      const result = compareGuess(guess, answer);
      const lost = !result.solved && guessNumber >= MAX_GUESSES;
      return { guess, ...result, guessNumber, ...(lost && { answer }) };
    },
  );
};
