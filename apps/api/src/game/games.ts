import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";

// The fighting games a character can be counted in, in apps/api/data/games/*.json.
// A character lists the games they're playable in, and "games appeared in" is
// worked out from that list, so the number can always be checked and a ruling
// (say, "Rising is a version of Granblue Fantasy Versus") is one edit here.
// The rule itself is written next to gamesAppearedIn in clues.ts.
const GAMES_DIR = new URL("../../data/games/", import.meta.url);

const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase-words-with-dashes");

// Why a game is listed but never counted, so the decision is on record.
export const EXCLUSIONS = ["handheld", "mobile", "port", "not-fighting"] as const;

const gameSchema = z
  .strictObject({
    id: idSchema,
    title: z.string().min(1),
    year: z.number().int().min(1980).max(2100),
    // An update, re-release or remaster: counts once, together with the game it's a version of.
    versionOf: idSchema.optional(),
    excluded: z.enum(EXCLUSIONS).optional(),
    note: z.string().optional(),
  })
  .refine((game) => !(game.versionOf && game.excluded), "a game is either a version or excluded, not both");

export type Game = z.infer<typeof gameSchema>;
export type GameCatalog = ReadonlyMap<string, Game>;

export async function loadGames(dir: URL = GAMES_DIR): Promise<GameCatalog> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const catalog = new Map<string, Game>();

  for (const file of files) {
    const raw: unknown = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    const parsed = z.array(gameSchema).safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid games file ${file}:\n${z.prettifyError(parsed.error)}`);
    }
    for (const game of parsed.data) {
      if (catalog.has(game.id)) throw new Error(`Duplicate game id: ${game.id}`);
      catalog.set(game.id, game);
    }
  }

  // Versions point at a counted base game, one level deep: Rev 2 is a version
  // of Xrd, never "a version of Revelator, which is a version of Xrd".
  for (const game of catalog.values()) {
    if (!game.versionOf) continue;
    const base = catalog.get(game.versionOf);
    if (!base) throw new Error(`${game.id} is a version of unknown game ${game.versionOf}`);
    if (base.versionOf) throw new Error(`${game.id}: point versionOf at ${base.versionOf}, the base game`);
    if (base.excluded) throw new Error(`${game.id} is a version of ${base.id}, which is excluded`);
  }
  return catalog;
}

/** How many distinct games a list adds up to (versions count once with their base game),
 *  and the year of the earliest one. Throws on an unknown or excluded game. */
export function countGames(ids: readonly string[], catalog: GameCatalog): { count: number; firstYear: number } {
  const bases = new Set<string>();
  let firstYear = Infinity;
  for (const id of ids) {
    const game = catalog.get(id);
    if (!game) throw new Error(`unknown game ${id}: add it to data/games`);
    if (game.excluded) throw new Error(`${id} doesn't count (${game.excluded}): remove it from the list`);
    bases.add(game.versionOf ?? game.id);
    firstYear = Math.min(firstYear, game.year);
  }
  return { count: bases.size, firstYear };
}
