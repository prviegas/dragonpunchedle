// Command-line entry point: `npm run db:migrate`.
import "../env.js";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}
