import type { ArcadeCleared } from "./api";

export const ARCADE_HASH = "#arcade";

/** A quick floor: few enough guesses to keep a combo going. */
export const COMBO_GUESSES = 3;

/**
 * The current combo: how many floors in a row, ending with the latest one,
 * were cleared in COMBO_GUESSES guesses or fewer.
 */
export function comboOf(cleared: readonly ArcadeCleared[]): number {
  let combo = 0;
  for (let i = cleared.length - 1; i >= 0 && cleared[i]!.guesses <= COMBO_GUESSES; i--) combo++;
  return combo;
}

/** The longest combo a run built. */
export function bestComboOf(cleared: readonly ArcadeCleared[]): number {
  let best = 0;
  let run = 0;
  for (const floor of cleared) {
    run = floor.guesses <= COMBO_GUESSES ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** How hot the combo counter burns: 1 at 2 hits, up to 4 at 8 hits and beyond. */
export function comboHeat(combo: number): 1 | 2 | 3 | 4 {
  if (combo >= 8) return 4;
  if (combo >= 5) return 3;
  if (combo >= 3) return 2;
  return 1;
}

/** One square per floor: quick, steady, or scraped through; a skull for the floor that ended it. */
function floorSquare(guesses: number): string {
  return guesses <= COMBO_GUESSES ? "🟩" : guesses <= 5 ? "🟨" : "🟧";
}

export function buildArcadeShare(cleared: readonly ArcadeCleared[], lost: boolean, url: string): string {
  const squares = cleared.map((floor) => floorSquare(floor.guesses)).join("") + (lost ? "💀" : "");
  const best = bestComboOf(cleared);
  return [
    `Dragonpunchedle Arcade 🕹️ Floor ${cleared.length}`,
    ...(squares ? [squares] : []),
    ...(best >= 2 ? [`Best combo: ${best} hits`] : []),
    url,
  ].join("\n");
}
