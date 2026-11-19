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
  /** Year of the character's first playable appearance in a game that gamesAppearedIn
   *  counts, so the two clues never point at different games. Can be later than that
   *  game's release for a character added afterwards (DLC, an update). */
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
  /** Every fighting game where they're playable, from any series: their own games,
   *  crossovers (Marvel vs. Capcom, Smash Bros., Capcom vs. SNK) and guest spots
   *  (Akuma in Tekken 7, Baiken in Samurai Shodown). Worked out from each character's
   *  list in the roster, against the games in data/games.
   *  Counts once with an earlier game, as a version of it, when a release either:
   *    - keeps that game's own name and adds an edition word (Super Turbo, Ultra SF4,
   *      Xrd Rev 2, Granblue Fantasy Versus: Rising, Persona 4 Arena Ultimax); the series
   *      name alone doesn't count (Mortal Kombat: Deception is a new game), or
   *    - was released as an upgrade, expansion, arcade version or remaster of it
   *      (Melty Blood: Act Cadenza, JoJo's All-Star Battle R).
   *  A new number is always a new game (Under Night In-Birth II). Otherwise a new name is
   *  a new game (each BlazBlue, Melty Blood: Actress Again). A character who only appears in
   *  a version still gets that game counted once.
   *  Doesn't count: ports, mobile and handheld-only games (Guilty Gear Petit, Soulcalibur:
   *  Broken Destiny), games that aren't fighting games, non-playable appearances (bosses
   *  you can't pick, assists, cameos). */
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
  { key: "gamesAppearedIn", label: "Games appeared in", kind: "number", closeWithin: 3, close: "Within 3 games of the answer", closeShort: "±3 games" },
];

/** The clue list as the page gets it: what each column is and when it turns yellow. */
export function publicClues() {
  return CLUES.map(({ key, label, kind, close, closeShort }) => ({ key, label, kind, close, closeShort: closeShort ?? close }));
}
