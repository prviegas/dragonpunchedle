import type { TodayResults } from "./api";

/** A finished round: solved in that many guesses, or ran out. */
export type RoundResult = number | "lost";

/**
 * The share of the other players the viewer did better than: everyone who
 * needed more guesses or ran out. Ties don't count as beaten. `results` must
 * include the viewer, as the server's counts do. null when nobody else finished.
 */
export function percentBeaten(results: TodayResults, mine: RoundResult): number | null {
  const others = results.players - 1;
  if (others <= 0) return null;
  if (mine === "lost") return 0;
  const slower = results.solvedIn.slice(mine).reduce((sum, count) => sum + count, 0);
  return Math.round(((slower + results.lost) / others) * 100);
}

/** The share of all finished players who solved it. */
export function percentSolved(results: TodayResults): number {
  if (results.players === 0) return 0;
  return Math.round(((results.players - results.lost) / results.players) * 100);
}
