import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { SESSION_COOKIE } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { ensurePuzzle } from "../src/game/puzzles.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";

describe("password hashing", () => {
  it("accepts the right password and rejects others", async () => {
    const stored = await hashPassword("hadouken-123");

    expect(stored).not.toContain("hadouken-123");
    expect(await verifyPassword("hadouken-123", stored)).toBe(true);
    expect(await verifyPassword("hadouken-124", stored)).toBe(false);
  });

  it("salts each hash, so the same password hashes differently", async () => {
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

// Test accounts all start with this prefix and are deleted afterwards.
const PREFIX = "zz_test_";
// A day of its own, so this file never shares a puzzle with api.test.ts.
const TODAY = "2099-03-01";

describe.skipIf(!process.env.DATABASE_URL)("accounts", () => {
  const pool = createPool();
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T12:00:00Z`), authRateLimitPerMinute: 1000 });
  let answerId: string;
  let otherId: string;

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
    answerId = await ensurePuzzle(pool, TODAY);
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM characters WHERE id <> $1 LIMIT 1", [answerId]);
    otherId = rows[0]!.id;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    // Users first: deleting them also deletes their sessions and guesses.
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = $1", [TODAY]);
  }

  function post(url: string, payload: object, cookie?: string) {
    return app.inject({ method: "POST", url, payload, headers: cookie ? { cookie } : {} });
  }

  /** Signs up a fresh account and returns its session cookie. */
  async function signUp(name: string, password = "a-long-password") {
    const response = await post("/api/auth/register", { username: PREFIX + name, password });
    expect(response.statusCode).toBe(201);
    const session = response.cookies.find((c) => c.name === SESSION_COOKIE)!;
    return `${SESSION_COOKIE}=${session.value}`;
  }

  async function me(cookie?: string) {
    const response = await app.inject({ method: "GET", url: "/api/auth/me", headers: cookie ? { cookie } : {} });
    return response.json().user;
  }

  it("signs up, sets a secure session cookie and knows who you are", async () => {
    const response = await post("/api/auth/register", { username: `${PREFIX}ryu`, password: "a-long-password" });
    const session = response.cookies.find((c) => c.name === SESSION_COOKIE);

    expect(response.statusCode).toBe(201);
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(await me(`${SESSION_COOKIE}=${session!.value}`)).toMatchObject({ username: `${PREFIX}ryu` });
  });

  it("stores neither the password nor the session token in plain text", async () => {
    const cookie = await signUp("ken", "shoryuken-999");
    const token = cookie.split("=")[1]!;
    const { rows } = await pool.query<{ password_hash: string; token_hash: string }>(
      `SELECT u.password_hash, s.token_hash FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE u.username = $1`,
      [`${PREFIX}ken`],
    );

    expect(rows[0]!.password_hash).not.toContain("shoryuken-999");
    expect(rows[0]!.token_hash).not.toBe(token);
  });

  it("treats usernames as the same regardless of capitals", async () => {
    await signUp("Chun");
    const response = await post("/api/auth/register", { username: `${PREFIX}CHUN`, password: "a-long-password" });
    expect(response.statusCode).toBe(409);
  });

  it("gives the same answer for a wrong password and an unknown user", async () => {
    await signUp("guile", "sonic-boom-1");
    const wrongPassword = await post("/api/auth/login", { username: `${PREFIX}guile`, password: "sonic-boom-2" });
    const unknownUser = await post("/api/auth/login", { username: `${PREFIX}nobody`, password: "sonic-boom-1" });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
  });

  it("logs in with any capitalisation of the username", async () => {
    await signUp("Sagat", "tiger-uppercut");
    const response = await post("/api/auth/login", { username: `${PREFIX}sagat`, password: "tiger-uppercut" });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe(`${PREFIX}Sagat`);
  });

  it("rejects usernames and passwords outside the rules", async () => {
    expect((await post("/api/auth/register", { username: "ab", password: "a-long-password" })).statusCode).toBe(400);
    expect((await post("/api/auth/register", { username: "has space", password: "a-long-password" })).statusCode).toBe(400);
    expect((await post("/api/auth/register", { username: `${PREFIX}short`, password: "short" })).statusCode).toBe(400);
  });

  it("ends the session on logout, even if the old cookie is replayed", async () => {
    const cookie = await signUp("blanka");
    const response = await post("/api/auth/logout", {}, cookie);

    expect(response.statusCode).toBe(204);
    expect(await me(cookie)).toBeNull();
  });

  it("treats a made-up session cookie as a guest", async () => {
    expect(await me(`${SESSION_COOKIE}=forged-token`)).toBeNull();
  });

  it("saves a logged-in player's guesses and returns them newest first", async () => {
    const cookie = await signUp("dhalsim");
    await post(`/api/puzzles/${TODAY}/guesses`, { characterId: otherId }, cookie);
    await post(`/api/puzzles/${TODAY}/guesses`, { characterId: answerId }, cookie);

    const response = await app.inject({ method: "GET", url: "/api/puzzles/today/guesses", headers: { cookie } });
    const saved = response.json<{ guess: { id: string }; solved: boolean }[]>();

    expect(saved.map((g) => g.guess.id)).toEqual([answerId, otherId]);
    expect(saved[0]!.solved).toBe(true);
  });

  it("refuses a repeated guess and any guess after solving", async () => {
    const cookie = await signUp("zangief");
    await post(`/api/puzzles/${TODAY}/guesses`, { characterId: otherId }, cookie);

    expect((await post(`/api/puzzles/${TODAY}/guesses`, { characterId: otherId }, cookie)).statusCode).toBe(409);
    await post(`/api/puzzles/${TODAY}/guesses`, { characterId: answerId }, cookie);
    expect((await post(`/api/puzzles/${TODAY}/guesses`, { characterId: answerId }, cookie)).statusCode).toBe(409);
  });

  it("asks guests to log in for saved guesses", async () => {
    const response = await app.inject({ method: "GET", url: "/api/puzzles/today/guesses" });
    expect(response.statusCode).toBe(401);
  });

  it("slows down repeated login attempts", async () => {
    const strict = buildApp({ pool, authRateLimitPerMinute: 3 });
    try {
      const attempt = () =>
        strict.inject({ method: "POST", url: "/api/auth/login", payload: { username: `${PREFIX}x`, password: "whatever-1" } });
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await attempt()).statusCode);

      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await strict.close();
    }
  });
});
