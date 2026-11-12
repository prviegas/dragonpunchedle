import type pg from "pg";

/** Adds or replaces one character's portrait. */
export async function savePortrait(
  pool: pg.Pool,
  characterId: string,
  image: Buffer,
  hash: string,
  credit: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO character_portraits (character_id, image, content_type, credit, hash)
     VALUES ($1, $2, 'image/webp', $3, $4)
     ON CONFLICT (character_id) DO UPDATE
       SET image = EXCLUDED.image, credit = EXCLUDED.credit, hash = EXCLUDED.hash, updated_at = now()`,
    [characterId, image, credit, hash],
  );
}

/** Removes portraits, for a takedown request: every one in a franchise, or one character. Returns how many. */
export async function removePortraits(
  pool: pg.Pool,
  which: { franchise: string } | { characterId: string },
): Promise<number> {
  const { rowCount } =
    "franchise" in which
      ? await pool.query(
          `DELETE FROM character_portraits p USING characters c
           WHERE c.id = p.character_id AND lower(c.franchise) = lower($1)`,
          [which.franchise],
        )
      : await pool.query("DELETE FROM character_portraits WHERE character_id = $1", [which.characterId]);
  return rowCount ?? 0;
}

/** Every character, and whether it has a portrait yet. */
export async function portraitStatus(
  pool: pg.Pool,
): Promise<{ id: string; name: string; franchise: string; hasPortrait: boolean }[]> {
  const { rows } = await pool.query<{ id: string; name: string; franchise: string; has_portrait: boolean }>(
    `SELECT c.id, c.name, c.franchise, p.character_id IS NOT NULL AS has_portrait
     FROM characters c LEFT JOIN character_portraits p ON p.character_id = c.id
     ORDER BY c.franchise, c.name`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, franchise: row.franchise, hasPortrait: row.has_portrait }));
}
