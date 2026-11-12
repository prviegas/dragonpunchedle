import type { TodayResults } from "./api";

/** A finished round: solved in that many guesses, or ran out. */
export type RoundResult = number | "lost";

/**
 * Today's results with the viewer in them. The server counts logged-in
 * players only, so a guest's own round is added here, for display: their bar
 * then shows them like everyone else's does.
 */
export function withViewer(results: TodayResults, mine: RoundResult, counted: boolean): TodayResults {
  if (counted) return results;
  const solvedIn = [...results.solvedIn];
  if (mine !== "lost") solvedIn[mine - 1] = (solvedIn[mine - 1] ?? 0) + 1;
  return {
    players: results.players + 1,
    solvedIn,
    lost: results.lost + (mine === "lost" ? 1 : 0),
    you: mine,
  };
}

/**
 * The share of the other players the viewer did better than: everyone who
 * needed more guesses or ran out. Ties don't count as beaten. `results` must
 * already include the viewer (see withViewer). null when nobody else finished.
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
