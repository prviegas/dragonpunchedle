// Local development only: adds 100 made-up guests' guesses (and their page
// views) over the last two weeks, so the dashboard and results chart have
// something to show. `npm run dev` runs it once before starting the server.
//
// Refuses to touch any database that isn't on this machine, so it can never
// write fake players into production, whatever the environment says.
import "../env.js";
import { randomBytes, randomInt } from "node:crypto";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";
import { ensurePuzzle, MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

const GUESSES = 100;
const DAYS = 14;
const WIN_RATE = 0.65;
const REFERRERS = [null, null, null, "reddit.com", "x.com", "discord.com", "youtube.com", "google.com"];
const TIMEZONES = ["America/Sao_Paulo", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Manila"];
const LANGUAGES = ["en-US", "en-US", "pt-BR", "en-GB", "es-MX", "ja-JP", "fr-FR"];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

function isLocal(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]", "db"].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" || !isLocal(process.env.DATABASE_URL)) {
    console.log("fake activity: skipped (not a local database)");
    return;
  }

  const pool = createPool();
  try {
    await migrate(pool);
    const { rows: characters } = await pool.query<{ id: string }>("SELECT id FROM characters");
    if (characters.length === 0) {
      console.log("fake activity: skipped (no characters yet; run npm run db:seed)");
      return;
    }

    const today = puzzleDateFor(new Date());
    const days: string[] = [];
    for (let back = DAYS - 1; back >= 0; back--) {
      const moment = new Date(`${today}T00:00:00Z`);
      moment.setUTCDate(moment.getUTCDate() - back);
      days.push(puzzleDateFor(moment));
    }
    const answers = new Map<string, string>();
    for (const day of days) answers.set(day, await ensurePuzzle(pool, day));

    let added = 0;
    let players = 0;
    while (added < GUESSES) {
      const day = pick(days);
      const answer = answers.get(day)!;
      const guestId = `fake-${randomBytes(8).toString("hex")}`;
      const won = Math.random() < WIN_RATE;
      // A winner needs 1-10 guesses, a loser uses all 10; never past the 100.
      const count = Math.min(won ? 1 + randomInt(MAX_GUESSES) : MAX_GUESSES, GUESSES - added);
      const solved = won;

      const wrong = new Set<string>();
      while (wrong.size < count - (solved ? 1 : 0)) {
        const id = pick(characters).id;
        if (id !== answer) wrong.add(id);
      }
      const picks = [...wrong, ...(solved ? [answer] : [])];

      // Played at a random time that day (earlier than now, for today).
      const dayStart = Date.parse(`${day}T00:00:00Z`);
      const latest = day === today ? Date.now() - dayStart - picks.length * 20_000 : 86_400_000 - picks.length * 20_000;
      const start = dayStart + randomInt(Math.max(1, latest));
      for (const [i, characterId] of picks.entries()) {
        await pool.query(
          "INSERT INTO guesses (guest_id, puzzle_date, character_id, created_at) VALUES ($1, $2, $3, $4)",
          [guestId, day, characterId, new Date(start + i * 20_000)],
        );
      }

      // One to three page views each, the first one carrying where they came from.
      for (let view = 0; view < 1 + randomInt(3); view++) {
        await pool.query(
          `INSERT INTO page_views (day, created_at, visitor, path, referrer, device, timezone, language)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            day,
            new Date(start),
            guestId,
            view === 0 ? "/" : pick(["/", "/#past", "/#past/day"]),
            view === 0 ? pick(REFERRERS) : null,
            Math.random() < 0.55 ? "mobile" : "desktop",
            pick(TIMEZONES),
            pick(LANGUAGES),
          ],
        );
      }

      added += picks.length;
      players++;
    }

    // Visitors who look around and leave without guessing, about one for every three players.
    for (let i = 0; i < Math.ceil(players / 3); i++) {
      const day = pick(days);
      await pool.query(
        `INSERT INTO page_views (day, created_at, visitor, path, referrer, device, timezone, language)
         VALUES ($1, $2, $3, '/', $4, $5, $6, $7)`,
        [day, new Date(`${day}T12:00:00Z`), `fake-${randomBytes(8).toString("hex")}`, pick(REFERRERS), Math.random() < 0.55 ? "mobile" : "desktop", pick(TIMEZONES), pick(LANGUAGES)],
      );
    }

    // Saved totals for these days would hide the new rows; the daily job writes them again.
    await pool.query("DELETE FROM daily_totals WHERE day = ANY($1::date[])", [days]);
    console.log(`fake activity: ${added} guesses from ${players} made-up guests over the last ${DAYS} days`);
  } finally {
    await pool.end();
  }
}

// Never stop the server from starting over this.
main().catch((error: unknown) => console.error("fake activity: failed", error));
