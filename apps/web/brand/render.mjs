// Turns the SVG sources into the PNGs that link previews and phones need
// (social sites don't accept SVG previews). Run: npm run brand -w apps/web
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

await sharp(await readFile(path("./og-image.svg")))
  .png()
  .toFile(path("../public/og-image.png"));

await sharp(await readFile(path("../public/favicon.svg")), { density: 300 })
  .resize(180, 180)
  .png()
  .toFile(path("../public/apple-touch-icon.png"));

console.log("Wrote public/og-image.png and public/apple-touch-icon.png");
