import "./env.js";
import { buildApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { runDailyJob } from "./jobs/daily.js";
import { startScheduler } from "./jobs/scheduler.js";

const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 rather than localhost, so the server is reachable from outside a container.
const host = process.env.HOST ?? "0.0.0.0";
const JOB_INTERVAL_MS = 60 * 60 * 1000; // hourly

const pool = createPool();
const app = buildApp({
  logger: true,
  pool,
  // Production is served over HTTPS; local development is plain http://localhost.
  secureCookies: process.env.NODE_ENV === "production",
});

let stopScheduler = () => {};

// Stop the job and close the database pool when the server shuts down.
app.addHook("onClose", async () => {
  stopScheduler();
  await pool.end();
});

try {
  // Bring the schema up to date before taking traffic. The migration lock
  // makes this safe even if two copies start at the same time.
  const applied = await migrate(pool);
  if (applied.length > 0) app.log.info({ applied }, "applied migrations");

  await app.listen({ port, host });

  // Set DAILY_JOB=off when an external scheduler runs `npm run job:daily` instead.
  if (process.env.DAILY_JOB !== "off") {
    stopScheduler = startScheduler(
      async () => app.log.info(await runDailyJob(pool), "daily job finished"),
      JOB_INTERVAL_MS,
      (error) => app.log.error(error, "daily job failed"),
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Ctrl+C locally, or the host stopping the container: finish in-flight requests, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
