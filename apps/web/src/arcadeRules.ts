import type { ArcadeCleared } from "./api";

export const ARCADE_HASH = "#arcade";

/** A quick floor: few enough guesses to keep a combo going. */
export const COMBO_GUESSES = 3;

const RANKS = [
  { from: 15, name: "Final Boss" },
  { from: 10, name: "Champion" },
  { from: 6, name: "Challenger" },
  { from: 3, name: "Contender" },
  { from: 0, name: "Rookie" },
] as const;

/** The title a run earns by floors cleared, like an arcade mode's ending. */
export function rankFor(floorsCleared: number): string {
  return RANKS.find((rank) => floorsCleared >= rank.from)!.name;
}

/** Floors still to clear before the next title, or null at the top. */
export function nextRank(floorsCleared: number): { name: string; floorsLeft: number } | null {
  const next = [...RANKS].reverse().find((rank) => rank.from > floorsCleared);
  return next ? { name: next.name, floorsLeft: next.from - floorsCleared } : null;
}

/**
 * The current combo: how many floors in a row, ending with the latest one,
 * were cleared in COMBO_GUESSES guesses or fewer.
 */
export function comboOf(cleared: readonly ArcadeCleared[]): number {
  let combo = 0;
  for (let i = cleared.length - 1; i >= 0 && cleared[i]!.guesses <= COMBO_GUESSES; i--) combo++;
  return combo;
}

/** One square per floor: quick, steady, or scraped through; a skull for the floor that ended it. */
function floorSquare(guesses: number): string {
  return guesses <= COMBO_GUESSES ? "🟩" : guesses <= 5 ? "🟨" : "🟧";
}

export function buildArcadeShare(cleared: readonly ArcadeCleared[], lost: boolean, url: string): string {
  const floors = cleared.length;
  const squares = cleared.map((floor) => floorSquare(floor.guesses)).join("") + (lost ? "💀" : "");
  const best = Math.max(0, ...runsOfCombo(cleared));
  return [
    `Dragonpunchedle Arcade 🕹️ Floor ${floors} · ${rankFor(floors)}`,
    ...(squares ? [squares] : []),
    ...(best >= 2 ? [`Best combo: ${best} hits`] : []),
    url,
  ].join("\n");
}

/** Every combo the run built, for the best one. */
function runsOfCombo(cleared: readonly ArcadeCleared[]): number[] {
  const runs = [0];
  for (const floor of cleared) {
    if (floor.guesses <= COMBO_GUESSES) runs[runs.length - 1]!++;
    else runs.push(0);
  }
  return runs;
}
