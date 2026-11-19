import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import type { Character } from "./clues.js";
import { continentOf, FICTIONAL_PLACES } from "./continents.js";
import { countGames, loadGames, type GameCatalog } from "./games.js";

// The roster lives in apps/api/data/roster/*.json, one file per franchise.
// Everything is validated here before it can reach the database, so a typo
// like "USA" instead of "United States" fails loudly instead of quietly
// breaking the same-continent hint.
const ROSTER_DIR = new URL("../../data/roster/", import.meta.url);

// Fixed vocabularies: a small, shared set of words is what makes partial
// matches meaningful across franchises.
export const ARCHETYPES = [
  "all-rounder",
  "rushdown",
  "zoner",
  "grappler",
  "footsies",
  "stance",
  "setplay",
  "puppet",
] as const;

export const SPECIES = [
  "Human",
  "Cyborg",
  "Robot",
  "Animal",
  "Deity",
  "Demon",
  "Undead",
  "Edenian",
  "Tarkatan",
  "Saurian",
  "Gear",
  "Vampire",
  "Monster",
  "Alien",
  // Granblue Fantasy peoples
  "Erune",
  "Draph",
  "Harvin",
  "Primal",
  // Dragon Ball peoples
  "Saiyan",
  "Namekian",
  // League of Legends peoples
  "Vastaya",
  "Yordle",
  // Marvel
  "Mutant",
  "Symbiote",
  // DC
  "Atlantean",
  // Hunter x Hunter
  "Chimera Ant",
  // JoJo's Bizarre Adventure
  "Pillar Man",
] as const;

export const GENDERS = ["Male", "Female", "Other"] as const;

const rosterEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase-words-with-dashes"),
  name: z.string().min(1),
  franchise: z.string().min(1),
  developer: z.string().min(1),
  debutYear: z.number().int().min(1980).max(2100),
  archetypes: z.array(z.enum(ARCHETYPES)).min(1),
  // One, or two for a half-and-half (Blade: Human + Vampire). No "Hybrid":
  // list both halves, so each can match on its own.
  species: z
    .array(z.enum(SPECIES))
    .min(1)
    .refine((list) => new Set(list).size === list.length, "species listed twice"),
  gender: z.enum(GENDERS),
  homeCountry: z
    .string()
    .nullable()
    .refine(
      (place) => place === null || continentOf(place) !== undefined || FICTIONAL_PLACES.has(place),
      "unknown place: add it to continents.ts (real country) or FICTIONAL_PLACES",
    ),
  // The games they're playable in (ids from data/games). gamesAppearedIn is worked
  // out from this list, so the number can always be checked.
  games: z
    .array(z.string())
    .min(1)
    .refine((list) => new Set(list).size === list.length, "game listed twice"),
  // Review helpers, never stored: which values still need a human check, and why.
  check: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export type RosterEntry = z.infer<typeof rosterEntrySchema> & { gamesAppearedIn: number };

export async function loadRoster(dir: URL = ROSTER_DIR, games?: GameCatalog): Promise<RosterEntry[]> {
  const catalog = games ?? (await loadGames());
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const roster: RosterEntry[] = [];

  for (const file of files) {
    const raw: unknown = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    const parsed = z.array(rosterEntrySchema).safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid roster file ${file}:\n${z.prettifyError(parsed.error)}`);
    }
    for (const entry of parsed.data) {
      roster.push(withCountedGames(entry, entry.games, catalog, file));
    }
  }

  assertUnique(roster, (entry) => entry.id, "id");
  assertUnique(roster, (entry) => `${entry.franchise} / ${entry.name}`, "franchise + name");
  return roster;
}

function withCountedGames<T extends { id: string; debutYear: number }>(
  entry: T,
  games: readonly string[],
  catalog: GameCatalog,
  file: string,
): T & { gamesAppearedIn: number } {
  let counted: ReturnType<typeof countGames>;
  try {
    counted = countGames(games, catalog);
  } catch (error) {
    throw new Error(`Invalid roster file ${file}: ${entry.id}: ${(error as Error).message}`);
  }
  // The debut is the first counted game, or later for a character added after launch.
  if (entry.debutYear < counted.firstYear) {
    throw new Error(
      `Invalid roster file ${file}: ${entry.id}: debutYear ${entry.debutYear} is before their first listed game (${counted.firstYear})`,
    );
  }
  return { ...entry, gamesAppearedIn: counted.count };
}

export function toCharacter({ check: _check, note: _note, games: _games, ...character }: RosterEntry): Character {
  return character;
}

function assertUnique(roster: RosterEntry[], keyOf: (entry: RosterEntry) => string, label: string) {
  const seen = new Set<string>();
  for (const entry of roster) {
    const key = keyOf(entry);
    if (seen.has(key)) throw new Error(`Duplicate ${label} in roster: ${key}`);
    seen.add(key);
  }
}
