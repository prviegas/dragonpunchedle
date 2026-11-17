// Local development only: adds 100 made-up players over the last two weeks,
// so the dashboard, the results chart and the Tower's board have something to
// show. Each one plays a daily round, visits a few pages and climbs the Tower
// once. `npm run dev` runs it once before starting the server.
//
// Refuses to touch any database that isn't on this machine, so it can never
// write fake players into production, whatever the environment says.
import "../env.js";
import { randomBytes, randomInt } from "node:crypto";
import type pg from "pg";
import { ARCADE_GUESSES } from "./arcade.js";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";
import { ensurePuzzle, MAX_GUESSES, puzzleDateFor } from "../game/puzzles.js";

const PLAYERS = 100;
const DAYS = 14;
const WIN_RATE = 0.65;
/** Chance of clearing each Tower floor: most climbs end early, a few go deep. */
const TOWER_CLEAR_RATE = 0.74;
const REFERRERS = [null, null, null, "reddit.com", "x.com", "discord.com", "youtube.com", "google.com"];
const TIMEZONES = ["America/Sao_Paulo", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Manila"];
const LANGUAGES = ["en-US", "en-US", "pt-BR", "en-GB", "es-MX", "ja-JP", "fr-FR"];
const PAGES = ["/", "/#past", "/#past/day", "/#tower"];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

function isLocal(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]", "db"].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

/** Some characters, all different, none of them `not`. */
function randomIds(characters: readonly { id: string }[], count: number, not?: string): string[] {
  const ids = new Set<string>();
  while (ids.size < count) {
    const id = pick(characters).id;
    if (id !== not) ids.add(id);
  }
  return [...ids];
}

/** One Tower climb: floors cleared one after another, until one is lost. */
async function fakeClimb(pool: pg.Pool, characters: readonly { id: string }[], guestId: string, start: number) {
  let reached = 1;
  while (reached < 80 && Math.random() < TOWER_CLEAR_RATE) reached++;

  const opponents = randomIds(characters, reached);
  const ended = new Date(Math.min(start + reached * 90_000, Date.now()));
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO arcade_runs (guest_id, started_at, ended_at, floors_cleared) VALUES ($1, $2, $3, $4) RETURNING id`,
    [guestId, new Date(start), ended, reached - 1],
  );
  const runId = rows[0]!.id;
  for (const [i, opponent] of opponents.entries()) {
    const last = i === opponents.length - 1;
    // Cleared floors: solved in 1 to 8 guesses, quick ones more often. The last floor: 8 misses.
    const guesses = last
      ? randomIds(characters, ARCADE_GUESSES, opponent)
      : [...randomIds(characters, Math.min(randomInt(1, 5) + randomInt(0, 4), ARCADE_GUESSES) - 1, opponent), opponent];
    await pool.query(
      "INSERT INTO arcade_floors (run_id, floor, character_id, guesses, solved) VALUES ($1, $2, $3, $4, $5)",
      [runId, i + 1, opponent, guesses, !last],
    );
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

    let guessCount = 0;
    for (let player = 0; player < PLAYERS; player++) {
      const day = pick(days);
      const answer = answers.get(day)!;
      const guestId = `fake-${randomBytes(8).toString("hex")}`;

      // The daily round: a winner needs 1-10 guesses, a loser uses all 10.
      const solved = Math.random() < WIN_RATE;
      const count = solved ? 1 + randomInt(MAX_GUESSES) : MAX_GUESSES;
      const picks = [...randomIds(characters, count - (solved ? 1 : 0), answer), ...(solved ? [answer] : [])];

      // Played at a random time that day (earlier than now, for today).
      const dayStart = Date.parse(`${day}T00:00:00Z`);
      const room = day === today ? Date.now() - dayStart - 3_600_000 : 86_400_000 - 3_600_000;
      const start = dayStart + randomInt(Math.max(1, room));
      for (const [i, characterId] of picks.entries()) {
        await pool.query(
          "INSERT INTO guesses (guest_id, puzzle_date, character_id, created_at) VALUES ($1, $2, $3, $4)",
          [guestId, day, characterId, new Date(start + i * 20_000)],
        );
      }
      guessCount += picks.length;

      // Then a Tower climb.
      await fakeClimb(pool, characters, guestId, start + picks.length * 20_000);

      // One to three page views, the first one carrying where they came from.
      for (let view = 0; view < 1 + randomInt(3); view++) {
        await pool.query(
          `INSERT INTO page_views (day, created_at, visitor, path, referrer, device, timezone, language)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            day,
            new Date(start),
            guestId,
            view === 0 ? "/" : pick(PAGES),
            view === 0 ? pick(REFERRERS) : null,
            Math.random() < 0.55 ? "mobile" : "desktop",
            pick(TIMEZONES),
            pick(LANGUAGES),
          ],
        );
      }
    }

    // Visitors who look around and leave without playing, about one for every three players.
    for (let i = 0; i < Math.ceil(PLAYERS / 3); i++) {
      const day = pick(days);
      await pool.query(
        `INSERT INTO page_views (day, created_at, visitor, path, referrer, device, timezone, language)
         VALUES ($1, $2, $3, '/', $4, $5, $6, $7)`,
        [day, new Date(`${day}T12:00:00Z`), `fake-${randomBytes(8).toString("hex")}`, pick(REFERRERS), Math.random() < 0.55 ? "mobile" : "desktop", pick(TIMEZONES), pick(LANGUAGES)],
      );
    }

    // Saved totals for these days would hide the new rows; the daily job writes them again.
    await pool.query("DELETE FROM daily_totals WHERE day = ANY($1::date[])", [days]);
    console.log(`fake activity: ${PLAYERS} made-up players (${guessCount} daily guesses, ${PLAYERS} Tower climbs) over the last ${DAYS} days`);
  } finally {
    await pool.end();
  }
}

// Never stop the server from starting over this.
main().catch((error: unknown) => console.error("fake activity: failed", error));
