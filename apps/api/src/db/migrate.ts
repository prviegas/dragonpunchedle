import { readdir, readFile } from "node:fs/promises";
import type pg from "pg";

// Migrations are plain .sql files in apps/api/migrations, applied in filename
// order (001_, 002_, ...). Each one runs once: its name is recorded in the
// schema_migrations table, so running this again only applies new files.
const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

// Any fixed number works; it just has to be the same for every instance.
const MIGRATION_LOCK_ID = 727_001;

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    // If two copies of the app start at once (e.g. during a deploy), this lock
    // makes the second one wait instead of applying the same migration twice.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.name));

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
    const newlyApplied: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      // One transaction per file: if any statement fails, none of it sticks,
      // and the file isn't marked as applied.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      newlyApplied.push(file);
    }

    return newlyApplied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
