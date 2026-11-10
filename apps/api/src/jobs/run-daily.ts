// Command-line entry point: `npm run job:daily`. Useful to run the job by hand,
// or from an external scheduler (a host's cron) instead of the built-in one.
import "../env.js";
import { createPool } from "../db/pool.js";
import { runDailyJob } from "./daily.js";

const pool = createPool();
try {
  const result = await runDailyJob(pool);
  console.log(
    `Scheduled ${result.puzzlesCreated.length} new puzzle(s)` +
      (result.puzzlesCreated.length ? ` (${result.puzzlesCreated.join(", ")})` : "") +
      `, removed ${result.expiredSessionsRemoved} expired session(s).`,
  );
} finally {
  await pool.end();
}
