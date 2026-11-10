import type pg from "pg";
import type { Character } from "../game/clues.js";

// The only place that knows how a characters row maps to a Character, so the
// snake_case column names never leak into the rest of the code.
interface CharacterRow {
  id: string;
  name: string;
  franchise: string;
  developer: string;
  debut_year: number;
  archetypes: string[];
  species: string;
  home_country: string | null;
  games_appeared_in: number;
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    franchise: row.franchise,
    developer: row.developer,
    debutYear: row.debut_year,
    archetypes: row.archetypes,
    species: row.species,
    homeCountry: row.home_country,
    gamesAppearedIn: row.games_appeared_in,
  };
}

export interface CharacterSummary {
  id: string;
  name: string;
  franchise: string;
}

/** Just enough for the guess box: no clue values, so the list gives nothing away. */
export async function listCharacterSummaries(pool: pg.Pool): Promise<CharacterSummary[]> {
  const { rows } = await pool.query<CharacterSummary>(
    "SELECT id, name, franchise FROM characters ORDER BY name, franchise",
  );
  return rows;
}

export async function findCharacter(pool: pg.Pool, id: string): Promise<Character | undefined> {
  const { rows } = await pool.query<CharacterRow>("SELECT * FROM characters WHERE id = $1", [id]);
  return rows[0] ? toCharacter(rows[0]) : undefined;
}
