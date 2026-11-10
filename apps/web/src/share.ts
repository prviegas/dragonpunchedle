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

/** The text a player shares after solving. `guesses` is newest first, as on the board. */
export function buildShareText(date: string, guesses: readonly GuessResult[], url: string): string {
  const count = guesses.length;
  const rows = [...guesses].reverse().map((g) => g.clues.map((clue) => SQUARES[clue.status]).join(""));
  return [`Dragonpunchedle #${puzzleNumber(date)}: ${count} ${count === 1 ? "guess" : "guesses"}`, ...rows, url].join("\n");
}
