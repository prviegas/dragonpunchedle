import type pg from "pg";
import type { Character } from "../game/clues.js";

// An "upsert": insert each character, or update it if its id already exists.
// That makes seeding repeatable: fix a value in the JSON, run it again, done.
// It never deletes, because past daily puzzles may still point at a character.
const UPSERT_CHARACTER = `
  INSERT INTO characters
    (id, name, franchise, developer, debut_year, archetypes, species, home_country, games_appeared_in)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    franchise = EXCLUDED.franchise,
    developer = EXCLUDED.developer,
    debut_year = EXCLUDED.debut_year,
    archetypes = EXCLUDED.archetypes,
    species = EXCLUDED.species,
    home_country = EXCLUDED.home_country,
    games_appeared_in = EXCLUDED.games_appeared_in
`;

export async function seedCharacters(pool: pg.Pool, characters: readonly Character[]): Promise<void> {
  const client = await pool.connect();
  try {
    // All or nothing: a failure halfway leaves the table as it was.
    await client.query("BEGIN");
    for (const c of characters) {
      // $1, $2... placeholders: values are sent separately from the SQL text,
      // so a name like "O'Brien" can never break or inject into the query.
      await client.query(UPSERT_CHARACTER, [
        c.id,
        c.name,
        c.franchise,
        c.developer,
        c.debutYear,
        c.archetypes,
        c.species,
        c.homeCountry,
        c.gamesAppearedIn,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
