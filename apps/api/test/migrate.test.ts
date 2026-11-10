import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";

// Needs a running database (npm run db:up). Skipped when DATABASE_URL isn't set.
describe.skipIf(!process.env.DATABASE_URL)("migrations", () => {
  const pool = createPool();

  afterAll(() => pool.end());

  it("creates the tables and is safe to run again", async () => {
    await migrate(pool);
    // A second run must apply nothing new.
    expect(await migrate(pool)).toEqual([]);

    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(["characters", "daily_puzzles", "schema_migrations"]),
    );
  });

  it("rejects a character with no archetypes", async () => {
    await expect(
      pool.query(
        `INSERT INTO characters (id, name, franchise, developer, debut_year, archetypes, species, games_appeared_in)
         VALUES ('test-nobody', 'Nobody', 'Test', 'Test', 2000, '{}', 'Human', 1)`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
