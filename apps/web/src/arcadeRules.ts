import type { ArcadeCleared } from "./api";

/** The mode's name everywhere it shows. */
export const TOWER_NAME = "Tower of Endless Struggle";

export const TOWER_HASH = "#tower";

/**
 * How menacing a floor looks, from 1 (the bottom of the tower) to 5. The
 * floor title darkens toward blood red as the climb gets harder, like a
 * fighting game's tower mode.
 */
export function floorDanger(floor: number): 1 | 2 | 3 | 4 | 5 {
  if (floor >= 15) return 5;
  if (floor >= 10) return 4;
  if (floor >= 6) return 3;
  if (floor >= 3) return 2;
  return 1;
}

/** One square per floor: quick (3 or fewer), steady (up to 5), or scraped through; a skull for the floor that ended it. */
function floorSquare(guesses: number): string {
  return guesses <= 3 ? "🟩" : guesses <= 5 ? "🟨" : "🟧";
}

export function buildTowerShare(cleared: readonly ArcadeCleared[], lost: boolean, url: string): string {
  const squares = cleared.map((floor) => floorSquare(floor.guesses)).join("") + (lost ? "💀" : "");
  return [`Dragonpunchedle 🗼 ${TOWER_NAME}: floor ${cleared.length}`, ...(squares ? [squares] : []), url].join("\n");
}
