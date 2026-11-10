import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt is a password hashing function built into Node. It's deliberately
// slow and memory-hungry, so someone who steals the hashes can only try a few
// guesses per second per machine instead of billions. A random salt per user
// means two people with the same password get different hashes.
//
// Stored format: scrypt$N$r$p$salt$hash, so the cost settings travel with each
// hash and can be raised later without breaking existing accounts.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
// N=2^15 with r=8 needs 32 MiB, exactly Node's default limit, so allow a bit more.
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, params: typeof PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  // A normal === comparison stops at the first differing byte, and that timing
  // difference can leak information. timingSafeEqual always takes the same time.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/** A real hash nobody's password matches. Checking against it when a username
 *  doesn't exist makes "no such user" take as long as "wrong password", so
 *  response times don't reveal which usernames are registered. */
export function hashForUnknownUser(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64"));
  return dummyHash;
}
