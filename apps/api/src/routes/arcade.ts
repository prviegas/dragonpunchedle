import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type pg from "pg";
import { ensureGuestId, readGuestId } from "../auth/guests.js";
import {
  ARCADE_GUESSES,
  arcadeGuess,
  arcadeLeaderboard,
  bestFloor,
  latestRun,
  startRun,
  type ArcadeRun,
} from "../db/arcade.js";
import { findCharacter } from "../db/characters.js";
import type { Player } from "../db/guesses.js";
import { publicClues } from "../game/clues.js";
import { compareGuess } from "../game/compare.js";

interface ArcadeRouteOptions {
  pool: pg.Pool;
  secureCookies: boolean;
  guessRateLimitPerMinute: number;
}

const guessSchema = {
  body: {
    type: "object",
    required: ["characterId"],
    additionalProperties: false,
    properties: { characterId: { type: "string", minLength: 1, maxLength: 100 } },
  },
} as const;

type GuessRequest = { Body: { characterId: string } };

export const arcadeRoutes: FastifyPluginAsync<ArcadeRouteOptions> = async (
  app,
  { pool, secureCookies, guessRateLimitPerMinute },
) => {
  await app.register(rateLimit, { global: false });

  function existingPlayer(request: FastifyRequest): Player | undefined {
    if (request.user) return { userId: request.user.id };
    const guestId = readGuestId(request);
    return guestId ? { guestId } : undefined;
  }

  /**
   * What the page needs to draw a run. The current opponent stays secret:
   * only beaten floors show who they were, and the lost floor once it's over.
   */
  async function runView(run: ArcadeRun) {
    const cleared = [];
    for (const floor of run.floors.filter((f) => f.solved)) {
      const character = await findCharacter(pool, floor.characterId);
      if (character) {
        cleared.push({
          floor: floor.floor,
          guesses: floor.guesses.length,
          character: { id: character.id, name: character.name, franchise: character.franchise, portrait: character.portrait },
        });
      }
    }
    const current = run.floors.at(-1);
    const playing = current && !current.solved ? current : undefined;
    const guesses = [];
    let answer;
    if (playing) {
      const opponent = await findCharacter(pool, playing.characterId);
      if (!opponent) throw new Error(`Arcade floor points at a missing character`);
      for (const id of playing.guesses) {
        const guess = await findCharacter(pool, id);
        if (guess) guesses.push({ guess, ...compareGuess(guess, opponent) });
      }
      if (run.over) answer = opponent;
    }
    return {
      floorsCleared: run.floorsCleared,
      over: run.over,
      floor: playing?.floor ?? run.floorsCleared + 1,
      cleared,
      guesses: guesses.reverse(), // newest first, as on the daily board
      ...(answer && { answer }),
    };
  }

  async function state(player: Player | undefined) {
    const run = player ? await latestRun(pool, player) : undefined;
    return {
      maxGuesses: ARCADE_GUESSES,
      clues: publicClues(),
      best: player ? await bestFloor(pool, player) : 0,
      run: run ? await runView(run) : null,
    };
  }

  // The player's run: in progress, or the last one finished. Null if never played.
  app.get("/api/arcade", async (request) => state(existingPlayer(request)));

  // A new run from floor 1. Any run still in progress ends.
  app.post("/api/arcade/start", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const player: Player = request.user
      ? { userId: request.user.id }
      : { guestId: ensureGuestId(request, reply, secureCookies) };
    await startRun(pool, player);
    return state(player);
  });

  app.post<GuessRequest>(
    "/api/arcade/guess",
    { schema: guessSchema, config: { rateLimit: { max: guessRateLimitPerMinute, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const player = existingPlayer(request);
      const guess = await findCharacter(pool, request.body.characterId);
      if (!guess) return reply.code(400).send({ error: "Unknown character." });
      if (!player) return reply.code(409).send({ error: "Start a run first." });

      const saved = await arcadeGuess(pool, player, guess.id);
      if (!saved.saved) {
        const message = { "no-run": "Start a run first.", duplicate: "You already guessed that character." }[saved.reason];
        return reply.code(409).send({ error: message });
      }
      const opponent = await findCharacter(pool, saved.answerId);
      if (!opponent) throw new Error("Arcade floor points at a missing character");
      const result = compareGuess(guess, opponent);
      const lost = saved.runOver && !saved.solved;
      return {
        guess,
        ...result,
        floor: saved.floor,
        guessNumber: saved.guessNumber,
        runOver: saved.runOver,
        // Who it was: on a lost floor only. A cleared floor's fighter is the guess itself.
        ...(lost && { answer: opponent }),
      };
    },
  );

  app.get("/api/arcade/leaderboard", async (request) => arcadeLeaderboard(pool, request.user?.id ?? null));
};
