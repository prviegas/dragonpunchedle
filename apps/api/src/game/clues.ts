// The clues a guess is compared on. Adding a clue means adding a field to
// CharacterClues, one entry to CLUES, and the data for every character:
// the comparison logic in compare.ts doesn't change.

import { continentOf } from "./continents.js";

/** How a clue is compared:
 * - "exact": one value, either it matches or it doesn't (franchise, country)
 * - "set": several values, where some overlap counts as partial (archetypes)
 * - "number": compared by size, so a miss says whether to go higher or lower
 */
export type ClueKind = "exact" | "set" | "number";

/** A clue's value for one character. `null` means there's no official data. */
export type ClueValue = string | number | readonly string[] | null;

export interface CharacterClues {
  /** The fighting game series the character belongs to, e.g. "2XKO" for League of Legends characters. */
  franchise: string;
  /** The studio behind that series, e.g. "Capcom", "Arc System Works". */
  developer: string;
  /** Year of the character's first playable appearance in any fighting game. */
  debutYear: number;
  archetypes: readonly string[];
  /** e.g. "Human", "Robot", "Demon". */
  species: string;
  /** Can be a fictional place (e.g. "Outworld"); null when the games never say. */
  homeCountry: string | null;
  /** Fighting games in their own franchise where they're playable.
   *  Counts: spin-offs within the franchise (Street Fighter Alpha, Tekken Tag Tournament).
   *  Counts once: updated versions of the same game (Super Turbo, Ultra, Street Fighter III's
   *  2nd Impact and 3rd Strike).
   *  Doesn't count: crossovers, ports, remasters, mobile and non-fighting spin-offs,
   *  non-playable appearances. */
  gamesAppearedIn: number;
}

export interface Character extends CharacterClues {
  id: string;
  name: string;
}

export interface ClueDefinition {
  key: keyof CharacterClues;
  label: string;
  kind: ClueKind;
  /** Number clues only: a miss at most this far off is shown as close. */
  closeWithin?: number;
  /** Exact clues only: two different values in the same group count as partial
   *  (e.g. two countries on the same continent). Undefined = no group. */
  groupOf?: (value: string) => string | undefined;
}

export const CLUES: readonly ClueDefinition[] = [
  { key: "franchise", label: "Franchise", kind: "exact" },
  { key: "developer", label: "Developer", kind: "exact" },
  { key: "debutYear", label: "Debut year", kind: "number", closeWithin: 3 },
  { key: "archetypes", label: "Archetypes", kind: "set" },
  { key: "species", label: "Species", kind: "exact" },
  { key: "homeCountry", label: "Home country", kind: "exact", groupOf: continentOf },
  { key: "gamesAppearedIn", label: "Games appeared in", kind: "number", closeWithin: 2 },
];
