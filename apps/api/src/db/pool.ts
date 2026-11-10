import pg from "pg";

// By default, pg turns a DATE column into a JavaScript Date at local midnight,
// which shifts "2026-11-10" to the 9th for anyone west of UTC. A daily puzzle is
// keyed by its date, so keep dates as the plain "YYYY-MM-DD" text Postgres sends.
const DATE_TYPE_OID = 1082;
pg.types.setTypeParser(DATE_TYPE_OID, (value) => value);

// A pool keeps a few database connections open and lends them out per query,
// instead of paying for a new connection on every request.
export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.");
  }
  return new pg.Pool({ connectionString });
}
