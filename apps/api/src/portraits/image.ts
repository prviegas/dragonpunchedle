import { createHash } from "node:crypto";
import sharp from "sharp";

// Portraits are stored as tall 3:4 cards, like a fighting game's character
// select screen.
export const PORTRAIT_WIDTH = 240;
export const PORTRAIT_HEIGHT = 320;

/**
 * Turns any image into the stored format: a 240x320 WebP. The picture fills
 * the card and is cropped from the top down, which keeps faces and upper
 * bodies; for full-body art that means the legs are what gets cut.
 */
export async function toPortrait(input: Buffer): Promise<{ image: Buffer; hash: string }> {
  const image = await sharp(input)
    .rotate() // respect the camera orientation some JPEGs carry
    .trim({ threshold: 10 }) // drop plain borders around the character first
    .resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT, { fit: "cover", position: "top" })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer();
  return { image, hash: createHash("sha256").update(image).digest("hex") };
}
