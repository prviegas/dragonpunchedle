import type { ClueStatus, GuessResult } from "./api";

/** Puzzle #1 is the first day the game was live. */
export const LAUNCH_DATE = "2026-11-10";

// One square per clue tile. No names or values, so sharing never spoils the answer.
const SQUARES: Record<ClueStatus, string> = {
  correct: "🟩",
  partial: "🟨",
  wrong: "⬛",
  unknown: "⬜",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function puzzleNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${LAUNCH_DATE}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * The text a player shares when the round is over. `guesses` is newest first,
 * as on the board. The score reads like Wordle's: "4/10" for a solve in four,
 * "X/10" for running out.
 */
export function buildShareText(
  date: string,
  guesses: readonly GuessResult[],
  maxGuesses: number,
  url: string,
): string {
  const solved = guesses.some((g) => g.solved);
  const score = `${solved ? guesses.length : "X"}/${maxGuesses}`;
  const rows = [...guesses].reverse().map((g) => g.clues.map((clue) => SQUARES[clue.status]).join(""));
  return [`Dragonpunchedle #${puzzleNumber(date)} ${score}`, ...rows, url].join("\n");
}
