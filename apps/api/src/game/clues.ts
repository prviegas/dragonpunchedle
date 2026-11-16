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
  /** e.g. ["Human"], ["Robot"]; two for a half-and-half like Blade: ["Human", "Vampire"]. */
  species: readonly string[];
  /** "Male", "Female", or "Other" for the few the games describe as neither
   *  (e.g. Testament, non-binary in Guilty Gear Strive). The roster requires
   *  one for every character; null only for a row the sync hasn't reached yet. */
  gender: string | null;
  /** Can be a fictional place (e.g. "Outworld"); null when the games never say. */
  homeCountry: string | null;
  /** Fighting games in their own franchise where they're playable.
   *  Counts: spin-offs within the franchise (Street Fighter Alpha, Tekken Tag Tournament).
   *  Counts once: updated versions of the same game (Super Turbo, Ultra, Street Fighter III's
   *  2nd Impact and 3rd Strike).
   *  Doesn't count: crossovers, ports, remasters, mobile and non-fighting spin-offs,
   *  non-playable appearances.
   *  Exceptions, by choice: the Marvel vs. Capcom series (X-Men vs. Street Fighter
   *  through MvC Infinite) counts for both its Marvel and its Capcom characters, and
   *  Mortal Kombat vs. DC Universe for both its DC and its Mortal Kombat characters.
   *  Marvel and DC characters also count their other licensed fighters (e.g. Justice
   *  League Task Force). */
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
  /** When this column turns yellow, in the words the player reads in "How to
   *  play". null: it never does (right or wrong only). Kept next to the rule it
   *  describes so the two can't drift apart (a test checks the numbers match). */
  close: string | null;
  /** The same rule in a few words, for the hover tip on the column name. */
  closeShort?: string;
}

export const CLUES: readonly ClueDefinition[] = [
  { key: "franchise", label: "Franchise", kind: "exact", close: null },
  { key: "developer", label: "Developer", kind: "exact", close: null },
  { key: "debutYear", label: "Debut year", kind: "number", closeWithin: 3, close: "Within 3 years of the answer", closeShort: "±3 years" },
  { key: "archetypes", label: "Archetypes", kind: "set", close: "Shares at least one archetype, but not all", closeShort: "Some shared" },
  {
    key: "species",
    label: "Species",
    kind: "set",
    close: "Shares at least one species, but not all (e.g. half-vampire Blade and a vampire)",
    closeShort: "Some shared",
  },
  { key: "gender", label: "Gender", kind: "exact", close: null },
  {
    key: "homeCountry",
    label: "Home country",
    kind: "exact",
    groupOf: continentOf,
    close: "Same continent. Fictional places are never close",
    closeShort: "Same continent",
  },
  { key: "gamesAppearedIn", label: "Games appeared in", kind: "number", closeWithin: 2, close: "Within 2 games of the answer", closeShort: "±2 games" },
];

/** The clue list as the page gets it: what each column is and when it turns yellow. */
export function publicClues() {
  return CLUES.map(({ key, label, kind, close, closeShort }) => ({ key, label, kind, close, closeShort: closeShort ?? close }));
}
