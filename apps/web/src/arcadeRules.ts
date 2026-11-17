import type { ArcadeCleared } from "./api";

/** The mode's name everywhere it shows. */
export const TOWER_NAME = "Tower of Endless Struggle";

export const TOWER_HASH = "#tower";

export type Danger = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * How menacing a floor looks, from 1 (the bottom of the tower) to 7. The
 * floor title darkens toward blood red as the climb gets harder, like a
 * fighting game's tower mode.
 */
export function floorDanger(floor: number): Danger {
  if (floor >= 30) return 7;
  if (floor >= 20) return 6;
  if (floor >= 15) return 5;
  if (floor >= 10) return 4;
  if (floor >= 6) return 3;
  if (floor >= 3) return 2;
  return 1;
}

/** A line under the floor title that grows more ominous with it. */
const OMENS: Record<Danger, string> = {
  1: "The climb begins.",
  2: "It gets harder from here.",
  3: "Blood on the stairs.",
  4: "Few have come this far.",
  5: "There is no way down.",
  6: "The tower is watching.",
  7: "Endless.",
};

export function floorOmen(floor: number): string {
  return OMENS[floorDanger(floor)];
}

/** One square per floor: quick (3 or fewer), steady (up to 5), or scraped through; a skull for the floor that ended it. */
function floorSquare(guesses: number): string {
  return guesses <= 3 ? "🟩" : guesses <= 5 ? "🟨" : "🟧";
}

/** The share text: the floor reached, then a square per beaten floor and a skull for the last. */
export function buildTowerShare(floorReached: number, cleared: readonly ArcadeCleared[], lost: boolean, url: string): string {
  const squares = cleared.map((floor) => floorSquare(floor.guesses)).join("") + (lost ? "💀" : "");
  return [`Dragonpunchedle 🗼 ${TOWER_NAME}: floor ${floorReached}`, ...(squares ? [squares] : []), url].join("\n");
}
