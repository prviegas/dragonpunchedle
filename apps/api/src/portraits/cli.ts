// The portraits tool. Runs on a developer's machine, never on the server.
//
//   npm run portraits -- status            which characters still need a portrait
//   npm run portraits -- fetch             download the images listed in portraits/sources.json
//   npm run portraits -- import            resize everything in portraits/originals/ and store it
//   npm run portraits -- remove --franchise "Street Fighter"     (a takedown: one command)
//   npm run portraits -- remove --id street-fighter-ryu
//
// Add --prod to work on the live database instead of the local one. Its
// address is read from apps/api/.env.production, a file that only exists on
// your machine (git ignores it).
//
// Files live in apps/api/portraits/, which git also ignores: the art belongs
// to the publishers and stays out of the public repository.
//   portraits/sources.json      { "street-fighter-ryu": "https://…/ryu.png", … }
//   portraits/originals/        street-fighter-ryu.png, … (downloaded or saved by hand)
//   portraits/STATUS.md         written by `status`: a checklist of every character

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { findCharacter } from "../db/characters.js";
import { createPool } from "../db/pool.js";
import { portraitStatus, removePortraits, savePortrait } from "../db/portraits.js";
import { creditFor } from "./credits.js";
import { toPortrait } from "./image.js";

const ROOT = new URL("../../portraits/", import.meta.url);
const ORIGINALS = new URL("originals/", ROOT);
const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    prod: { type: "boolean", default: false },
    franchise: { type: "string" },
    id: { type: "string" },
  },
});
const command = positionals[0];

// Pick the database. --prod reads .env.production explicitly and nothing
// else, so a stray local setting can never send production data elsewhere,
// or local test images to production.
function databaseUrl(): string {
  const file = values.prod ? ".env.production" : ".env";
  const path = new URL(`../../${file}`, import.meta.url);
  const fromFile = existsSync(path) ? parseEnv(readFileSync(path, "utf8")).DATABASE_URL : undefined;
  const url = values.prod ? fromFile : (process.env.DATABASE_URL ?? fromFile);
  if (!url) throw new Error(`No DATABASE_URL found in apps/api/${file}.`);
  return url;
}

const url = databaseUrl();
// Say where we're writing, without the password.
console.log(`Database: ${new URL(url).host}${values.prod ? "  (PRODUCTION)" : ""}\n`);
const pool = createPool(url);

try {
  switch (command) {
    case "status":
      await status();
      break;
    case "fetch":
      await fetchSources();
      break;
    case "import":
      await importOriginals();
      break;
    case "remove":
      await remove();
      break;
    default:
      console.log("Commands: status, fetch, import, remove (--franchise NAME | --id ID). Add --prod for the live site.");
      process.exitCode = 1;
  }
} finally {
  await pool.end();
}

async function status() {
  const rows = await portraitStatus(pool);
  const byFranchise = new Map<string, typeof rows>();
  for (const row of rows) byFranchise.set(row.franchise, [...(byFranchise.get(row.franchise) ?? []), row]);
  const lines = ["# Portrait checklist", "", "Save each image in portraits/originals/ named after the id, e.g. `street-fighter-ryu.png`.", ""];
  for (const [franchise, characters] of byFranchise) {
    const done = characters.filter((c) => c.hasPortrait).length;
    console.log(`${franchise.padEnd(26)} ${String(done).padStart(3)} / ${characters.length}`);
    lines.push(`## ${franchise} (${done}/${characters.length})`, "");
    for (const c of characters) lines.push(`- [${c.hasPortrait ? "x" : " "}] ${c.name}: \`${c.id}\``);
    lines.push("");
  }
  const total = rows.filter((r) => r.hasPortrait).length;
  console.log(`\n${total} of ${rows.length} characters have a portrait.`);
  await mkdir(ROOT, { recursive: true });
  await writeFile(new URL("STATUS.md", ROOT), lines.join("\n"));
  console.log("Checklist written to apps/api/portraits/STATUS.md");
}

async function fetchSources() {
  const sourcesFile = new URL("sources.json", ROOT);
  if (!existsSync(sourcesFile)) throw new Error("Create apps/api/portraits/sources.json first: { \"character-id\": \"https://…\" }");
  const sources = JSON.parse(await readFile(sourcesFile, "utf8")) as Record<string, string>;
  await mkdir(ORIGINALS, { recursive: true });
  const existing = new Set((await readdir(ORIGINALS)).map((file) => file.replace(/\.[^.]+$/, "")));

  for (const [id, source] of Object.entries(sources)) {
    if (existing.has(id)) continue; // already downloaded; delete the file to fetch again
    try {
      const response = await fetch(source, { headers: { "user-agent": "dragonpunchedle-portraits/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      const extension = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : type.includes("avif") ? ".avif" : ".jpg";
      await writeFile(new URL(id + extension, ORIGINALS), Buffer.from(await response.arrayBuffer()));
      console.log(`fetched  ${id}`);
    } catch (error) {
      console.log(`FAILED   ${id}: ${(error as Error).message}`);
    }
  }
}

async function importOriginals() {
  if (!existsSync(ORIGINALS)) throw new Error("Nothing to import: apps/api/portraits/originals/ doesn't exist yet.");
  let saved = 0;
  for (const file of (await readdir(ORIGINALS)).sort()) {
    const extension = extname(file).toLowerCase();
    if (!IMAGE_TYPES.has(extension)) continue;
    const id = file.slice(0, -extension.length);
    if (values.id && id !== values.id) continue;

    const character = await findCharacter(pool, id);
    if (!character) {
      console.log(`SKIPPED  ${file}: no character has the id "${id}"`);
      continue;
    }
    if (values.franchise && character.franchise.toLowerCase() !== values.franchise.toLowerCase()) continue;

    const { image, hash } = await toPortrait(await readFile(new URL(file, ORIGINALS)));
    await savePortrait(pool, id, image, hash, creditFor(character.franchise));
    console.log(`saved    ${id}  (${Math.round(image.length / 1024)} KB)`);
    saved++;
  }
  console.log(`\n${saved} portrait${saved === 1 ? "" : "s"} saved.`);
}

async function remove() {
  if (!values.franchise && !values.id) throw new Error("Say what to remove: --franchise \"Street Fighter\" or --id street-fighter-ryu");
  const removed = await removePortraits(
    pool,
    values.franchise ? { franchise: values.franchise } : { characterId: values.id! },
  );
  console.log(`Removed ${removed} portrait${removed === 1 ? "" : "s"}. The site stops showing them right away.`);
}
