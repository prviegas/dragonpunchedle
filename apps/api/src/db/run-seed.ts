// Command-line entry point: `npm run db:seed`.
import "../env.js";
import { loadRoster, toCharacter } from "../game/roster.js";
import { createPool } from "./pool.js";
import { seedCharacters } from "./seed.js";

const roster = await loadRoster();
const pool = createPool();
try {
  await seedCharacters(pool, roster.map(toCharacter));
  const toCheck = roster.filter((entry) => entry.check && entry.check.length > 0).length;
  console.log(`Seeded ${roster.length} characters. ${toCheck} still have values marked "check".`);
} finally {
  await pool.end();
}
