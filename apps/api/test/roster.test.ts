import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { countGames, loadGames, type Game, type GameCatalog } from "../src/game/games.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

describe("roster data", () => {
  // loadRoster throws on any invalid entry, so loading it is the main check:
  // unknown archetype or species, a misspelled country, duplicate ids...
  it("is valid", async () => {
    const roster = await loadRoster();
    expect(roster.length).toBeGreaterThan(0);
  });

  it("spells each developer one way, so the Developer clue can match across series", async () => {
    // "French Bread" and "French-Bread" would never show green against each other.
    const byKey = new Map<string, Set<string>>();
    for (const { developer } of await loadRoster()) {
      const key = developer.toLowerCase().replace(/[^a-z0-9]/g, "");
      byKey.set(key, (byKey.get(key) ?? new Set()).add(developer));
    }
    const clashes = [...byKey.values()].filter((spellings) => spellings.size > 1).map((s) => [...s]);
    expect(clashes).toEqual([]);
  });

  it("keeps review notes and game lists out of the game data", async () => {
    const roster = await loadRoster();
    const listed = roster.find((entry) => entry.games)!;
    expect(toCharacter(roster[0]!)).not.toHaveProperty("check");
    expect(toCharacter(roster[0]!)).not.toHaveProperty("note");
    expect(toCharacter(listed)).not.toHaveProperty("games");
  });

  it("works out games appeared in from each character's list", async () => {
    const counts = new Map((await loadRoster()).map((entry) => [entry.id, entry.gamesAppearedIn]));
    // GG, X, XX, Isuka, Xrd, Strive.
    expect(counts.get("guilty-gear-sol-badguy")).toBe(6);
    // The same six, plus her guest spot in Samurai Shodown (2019).
    expect(counts.get("guilty-gear-baiken")).toBe(7);
    // Listed by Rev 2, which counts once as Xrd.
    expect(counts.get("guilty-gear-jam-kuradoberi")).toBe(5);
  });
});

describe("game lists", () => {
  const catalog: GameCatalog = new Map<string, Game>([
    ["xrd", { id: "xrd", title: "Xrd -SIGN-", year: 2014 }],
    ["rev", { id: "rev", title: "Xrd -REVELATOR-", year: 2015, versionOf: "xrd" }],
    ["strive", { id: "strive", title: "Strive", year: 2021 }],
    ["petit", { id: "petit", title: "Petit", year: 2001, excluded: "handheld" }],
  ]);

  it("counts a version once, together with its base game", () => {
    expect(countGames(["xrd", "rev", "strive"], catalog)).toEqual({ count: 2, firstYear: 2014 });
  });

  it("refuses unknown and excluded games", () => {
    expect(() => countGames(["xrd", "nope"], catalog)).toThrow(/unknown game nope/);
    expect(() => countGames(["petit"], catalog)).toThrow(/doesn't count \(handheld\)/);
  });

  it("loads the real catalog", async () => {
    expect((await loadGames()).get("guilty-gear-xrd-rev-2")?.versionOf).toBe("guilty-gear-xrd-sign");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("seeding", () => {
  const pool = createPool();

  afterAll(() => pool.end());

  it("loads every character and can run again without duplicating", async () => {
    await migrate(pool);
    const characters = (await loadRoster()).map(toCharacter);

    await seedCharacters(pool, characters);
    await seedCharacters(pool, characters);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) FROM characters WHERE id = ANY($1)",
      [characters.map((c) => c.id)],
    );
    expect(Number(rows[0]!.count)).toBe(characters.length);
  });
});
