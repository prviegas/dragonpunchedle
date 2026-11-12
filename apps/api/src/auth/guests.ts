import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

// Guests get an anonymous id in a cookie the first time they guess. It's 24
// random bytes and nothing else: no name, no email, nothing that says who
// they are. It only ties a browser's guesses together, so the server can keep
// a guest's board, enforce their 10-guess limit, and count them in the
// results chart.
export const GUEST_COOKIE = "dp_guest";
const GUEST_ID = /^[A-Za-z0-9_-]{32}$/;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The guest id from the cookie, if there is a well-formed one. */
export function readGuestId(request: FastifyRequest): string | undefined {
  const value = request.cookies[GUEST_COOKIE];
  return value && GUEST_ID.test(value) ? value : undefined;
}

/** The guest id, creating one (and its cookie) on a guest's first guess. */
export function ensureGuestId(request: FastifyRequest, reply: FastifyReply, secureCookies: boolean): string {
  const existing = readGuestId(request);
  if (existing) return existing;
  const id = randomBytes(24).toString("base64url");
  reply.setCookie(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return id;
}
