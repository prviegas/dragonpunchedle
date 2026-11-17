import type { ClueStatus, GuessResult } from "./api";

/** Puzzle #1 is launch day: the first day after the pre-release reset. */
export const LAUNCH_DATE = "2026-11-13";

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
export interface ShareBrag {
  /** The day's first logged-in solve. */
  firstSolve?: boolean;
  /** Percent of today's other players this result beat; null or 0 adds no line. */
  beaten?: number | null;
}

export function buildShareText(
  date: string,
  guesses: readonly GuessResult[],
  maxGuesses: number,
  url: string,
  brag: ShareBrag = {},
): string {
  const solved = guesses.some((g) => g.solved);
  const score = `${solved ? guesses.length : "X"}/${maxGuesses}`;
  const title = `Dragonpunchedle #${puzzleNumber(date)} ${score}${solved && brag.firstSolve ? " 🥇 First solve" : ""}`;
  const rows = [...guesses].reverse().map((g) => g.clues.map((clue) => SQUARES[clue.status]).join(""));
  // Only a real brag: a solve that beat at least someone.
  const beaten = solved && brag.beaten ? [`Better than ${brag.beaten}% of today's players`] : [];
  return [title, ...rows, ...beaten, url].join("\n");
}
