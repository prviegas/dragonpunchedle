import "../src/env.js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { findCharacter } from "../src/db/characters.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { removePortraits, savePortrait } from "../src/db/portraits.js";
import { creditFor } from "../src/portraits/credits.js";
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, toPortrait } from "../src/portraits/image.js";

/** A plain test picture: a tall orange rectangle, like full-body character art. */
const tallPicture = () =>
  sharp({ create: { width: 400, height: 900, channels: 3, background: { r: 240, g: 88, b: 63 } } })
    .png()
    .toBuffer();

describe("portrait images", () => {
  it("turns any picture into a 240x320 WebP card", async () => {
    const { image, hash } = await toPortrait(await tallPicture());
    const meta = await sharp(image).metadata();

    expect(meta).toMatchObject({ format: "webp", width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("credits the rights holder, and refuses a franchise it doesn't know", () => {
    expect(creditFor("Street Fighter")).toBe("© Capcom");
    expect(creditFor("Killer Instinct")).toBe("© Microsoft"); // owner, not developer
    expect(() => creditFor("Made Up Fighters")).toThrow(/No credit known/);
  });
});

// A character made up for this test, so real portraits are never touched.
const TEST_ID = "zz-test-portrait-fighter";
const TEST_FRANCHISE = "zz Test Franchise";

describe.skipIf(!process.env.DATABASE_URL)("portraits in the database", () => {
  const pool = createPool();
  const app = buildApp({ pool });

  beforeAll(async () => {
    await migrate(pool);
    await pool.query("DELETE FROM characters WHERE id = $1", [TEST_ID]);
    await pool.query(
      `INSERT INTO characters (id, name, franchise, developer, debut_year, archetypes, species, home_country, games_appeared_in)
       VALUES ($1, 'Test Fighter', $2, 'Test Studio', 2000, '{rushdown}', 'Human', NULL, 1)`,
      [TEST_ID, TEST_FRANCHISE],
    );
  });

  afterAll(async () => {
    // Deleting the character deletes its portrait too (ON DELETE CASCADE).
    await pool.query("DELETE FROM characters WHERE id = $1", [TEST_ID]);
    await app.close();
    await pool.end();
  });

  it("has no portrait until one is saved", async () => {
    expect((await findCharacter(pool, TEST_ID))?.portrait).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/api/portraits/${TEST_ID}` })).statusCode).toBe(404);
  });

  it("serves a saved portrait with its credit, a versioned address and a one-day cache", async () => {
    const { image, hash } = await toPortrait(await tallPicture());
    await savePortrait(pool, TEST_ID, image, hash, "© Test Studio");

    const character = await findCharacter(pool, TEST_ID);
    expect(character?.portrait).toEqual({
      url: `/api/portraits/${TEST_ID}?v=${hash.slice(0, 12)}`,
      credit: "© Test Studio",
    });

    const response = await app.inject({ method: "GET", url: character!.portrait!.url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.headers["cache-control"]).toBe("public, max-age=86400");
    expect(response.rawPayload.equals(image)).toBe(true);

    // A browser that already has it gets a tiny "not modified" answer.
    const again = await app.inject({
      method: "GET",
      url: `/api/portraits/${TEST_ID}`,
      headers: { "if-none-match": String(response.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it("takes down a whole franchise in one call", async () => {
    const { image, hash } = await toPortrait(await tallPicture());
    await savePortrait(pool, TEST_ID, image, hash, "© Test Studio");

    expect(await removePortraits(pool, { franchise: TEST_FRANCHISE.toUpperCase() })).toBe(1);
    expect((await findCharacter(pool, TEST_ID))?.portrait).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/api/portraits/${TEST_ID}` })).statusCode).toBe(404);
  });
});
