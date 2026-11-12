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

export interface Portrait {
  /** Where the page loads it from. The hash in it changes when the image does. */
  url: string;
  /** Who owns the art, e.g. "© Capcom". */
  credit: string;
}

/** A character, plus its portrait when one has been loaded. */
export type CharacterWithPortrait = Character & { portrait?: Portrait };

export async function findCharacter(pool: pg.Pool, id: string): Promise<CharacterWithPortrait | undefined> {
  const { rows } = await pool.query<CharacterRow & { portrait_hash: string | null; portrait_credit: string | null }>(
    `SELECT c.*, p.hash AS portrait_hash, p.credit AS portrait_credit
     FROM characters c LEFT JOIN character_portraits p ON p.character_id = c.id
     WHERE c.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  const character: CharacterWithPortrait = toCharacter(row);
  if (row.portrait_hash && row.portrait_credit) {
    character.portrait = {
      url: `/api/portraits/${encodeURIComponent(row.id)}?v=${row.portrait_hash.slice(0, 12)}`,
      credit: row.portrait_credit,
    };
  }
  return character;
}

/** The image itself, for the portrait route. */
export async function findPortraitImage(
  pool: pg.Pool,
  characterId: string,
): Promise<{ image: Buffer; contentType: string; hash: string } | undefined> {
  const { rows } = await pool.query<{ image: Buffer; content_type: string; hash: string }>(
    "SELECT image, content_type, hash FROM character_portraits WHERE character_id = $1",
    [characterId],
  );
  return rows[0] && { image: rows[0].image, contentType: rows[0].content_type, hash: rows[0].hash };
}
