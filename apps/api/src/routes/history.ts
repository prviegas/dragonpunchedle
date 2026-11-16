import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type pg from "pg";
import { ensureGuestId, readGuestId } from "../auth/guests.js";
import { findCharacter } from "../db/characters.js";
import { hasRevealed, listGuessIds, playedLate, revealRound, type Player } from "../db/guesses.js";
import { findPuzzleAnswerId, listPastRounds } from "../db/history.js";
import { scoreDistribution } from "../db/stats.js";
import { publicClues } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";
import { MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

interface HistoryRouteOptions {
  pool: pg.Pool;
  now: () => Date;
  secureCookies: boolean;
}

const dateSchema = {
  params: {
    type: "object",
    required: ["date"],
    properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
  },
} as const;

type DateRequest = { Params: { date: string } };

/**
 * Past rounds. Each finished day can still be played, late: those guesses go
 * into the player's history but never into the day's chart, leaderboards or
 * streaks. So a past round's answer stays hidden from a player until they
 * finish it (solve it, or use all their guesses) or choose "Show answer".
 *
 * Today never appears here, and neither do the days the job has picked ahead.
 */
export const historyRoutes: FastifyPluginAsync<HistoryRouteOptions> = async (app, { pool, now, secureCookies }) => {
  function playerOf(request: FastifyRequest): Player | undefined {
    if (request.user) return { userId: request.user.id };
    const guestId = readGuestId(request);
    return guestId ? { guestId } : undefined;
  }

  app.get("/api/history", async (request) => {
    const rounds = await listPastRounds(pool, playerOf(request), puzzleDateFor(now()));
    return {
      maxGuesses: MAX_GUESSES,
      rounds: rounds.map(({ answer, ...round }) => {
        const over = round.solved || round.revealed || round.guesses >= MAX_GUESSES;
        return { ...round, ...(over && { answer }) };
      }),
    };
  });

  /** One past day for this player, or a reason it can't be shown. */
  async function pastDay(player: Player | undefined, date: string) {
    if (date >= puzzleDateFor(now())) return { error: "That round isn't over yet." } as const;
    const answerId = await findPuzzleAnswerId(pool, date);
    const answer = answerId && (await findCharacter(pool, answerId));
    if (!answer) return { error: "There was no round that day." } as const;

    const guesses = [];
    for (const id of player ? await listGuessIds(pool, player, date) : []) {
      const guess = await findCharacter(pool, id);
      if (guess) guesses.push({ guess, ...compareGuess(guess, answer) });
    }
    const solved = guesses.some((g) => g.solved);
    const revealed = player ? await hasRevealed(pool, player, date) : false;
    const over = solved || revealed || guesses.length >= MAX_GUESSES;

    return {
      date,
      maxGuesses: MAX_GUESSES,
      clues: publicClues(),
      guesses: guesses.reverse(), // newest first, as on today's board
      revealed,
      /** Some guesses came after the day. */
      late: player ? await playedLate(pool, player, date) : false,
      // Until the round is over for this player, nothing gives the answer away.
      ...(over && { answer, results: await scoreDistribution(pool, date, player ?? null, MAX_GUESSES) }),
    };
  }

  app.get<DateRequest>("/api/history/:date", { schema: dateSchema }, async (request, reply) => {
    const day = await pastDay(playerOf(request), request.params.date);
    return "error" in day ? reply.code(404).send(day) : day;
  });

  // "Show answer": ends the round for this player and returns it, answer included.
  app.post<DateRequest>("/api/history/:date/reveal", { schema: dateSchema }, async (request, reply) => {
    const { date } = request.params;
    const before = await pastDay(playerOf(request), date);
    if ("error" in before) return reply.code(404).send(before);
    if ("answer" in before) return before; // already over: nothing to record

    const player: Player = request.user
      ? { userId: request.user.id }
      : { guestId: ensureGuestId(request, reply, secureCookies) };
    await revealRound(pool, player, date);
    return pastDay(player, date);
  });
};
