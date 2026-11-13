// Turns the brand sources into the PNGs that link previews and phones need
// (social sites don't accept SVG previews). Run: npm run brand -w apps/web
//
// The link preview is an HTML page (og-image.html) using the site's own
// fonts, screenshotted at 1200x630 with a headless browser, so it matches
// the site exactly. Needs Playwright's Chromium once: npx playwright install chromium
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(path("./og-image.html")).href);
await page.evaluate(() => document.fonts.ready);
const screenshot = await page.screenshot();
await browser.close();

// A palette PNG keeps the preview small (about 40 KB) with no visible loss.
await sharp(screenshot).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path("../public/og-image.png"));

// Phones want a square PNG with no transparency for the home-screen icon.
await sharp(path("../public/favicon.svg"), { density: 600 })
  .resize(180, 180)
  .flatten({ background: "#141927" })
  .png()
  .toFile(path("../public/apple-touch-icon.png"));

console.log("Wrote public/og-image.png and public/apple-touch-icon.png");
