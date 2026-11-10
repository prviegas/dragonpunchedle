import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

describe("roster data", () => {
  // loadRoster throws on any invalid entry, so loading it is the main check:
  // unknown archetype or species, a misspelled country, duplicate ids...
  it("is valid", async () => {
    const roster = await loadRoster();
    expect(roster.length).toBeGreaterThan(0);
  });

  it("keeps review notes out of the game data", async () => {
    const [first] = await loadRoster();
    expect(toCharacter(first!)).not.toHaveProperty("check");
    expect(toCharacter(first!)).not.toHaveProperty("note");
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
