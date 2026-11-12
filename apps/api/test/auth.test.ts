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
    const cookie = await signUp("ken", "violet-kettle-999");
    const token = cookie.split("=")[1]!;
    const { rows } = await pool.query<{ password_hash: string; token_hash: string }>(
      `SELECT u.password_hash, s.token_hash FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE u.username = $1`,
      [`${PREFIX}ken`],
    );

    expect(rows[0]!.password_hash).not.toContain("violet-kettle-999");
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

  it("refuses easy-to-guess passwords at sign-up and says why", async () => {
    for (const password of ["password123", "Password1!", "qwertyuiop", "dragonpunchedle1"]) {
      const response = await post("/api/auth/register", { username: `${PREFIX}weak`, password });
      expect(response.statusCode, password).toBe(400);
      expect(response.json().error).toMatch(/too easy to guess/);
    }
  });

  it("refuses a password built from the username", async () => {
    const response = await post("/api/auth/register", { username: `${PREFIX}bison`, password: `${PREFIX}bison2024` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/username/);
  });

  it("still lets older accounts log in with a password that's weak by today's rule", async () => {
    // Made before the strength rule existed, so straight into the table.
    await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [
      `${PREFIX}oldtimer`,
      await hashPassword("password123"),
    ]);
    const response = await post("/api/auth/login", { username: `${PREFIX}oldtimer`, password: "password123" });
    expect(response.statusCode).toBe(200);
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
    const saved = response.json<{ guesses: { guess: { id: string }; solved: boolean }[] }>().guesses;

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

  describe("the 10-guess limit", () => {
    /** Ten-plus characters that aren't today's answer. */
    async function wrongIds(count: number) {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM characters WHERE id <> $1 ORDER BY id LIMIT $2", [
        answerId,
        count,
      ]);
      return rows.map((row) => row.id);
    }

    it("tells the page how many guesses a day allows", async () => {
      const response = await app.inject({ method: "GET", url: "/api/puzzles/today" });
      expect(response.json().maxGuesses).toBe(10);
    });

    it("numbers each guess, reveals the answer on a missed 10th, and refuses an 11th", async () => {
      const cookie = await signUp("cammy");
      const wrong = await wrongIds(11);
      const responses = [];
      for (const id of wrong.slice(0, 10)) {
        responses.push((await post(`/api/puzzles/${TODAY}/guesses`, { characterId: id }, cookie)).json());
      }

      expect(responses.map((r) => r.guessNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(responses.slice(0, 9).every((r) => r.answer === undefined)).toBe(true);
      expect(responses[9].answer.id).toBe(answerId);

      const eleventh = await post(`/api/puzzles/${TODAY}/guesses`, { characterId: wrong[10]! }, cookie);
      expect(eleventh.statusCode).toBe(409);
      expect(eleventh.json().error).toMatch(/out of guesses/);
      // Not even the right answer counts once the round is over.
      expect((await post(`/api/puzzles/${TODAY}/guesses`, { characterId: answerId }, cookie)).statusCode).toBe(409);
    });

    it("includes the answer with the saved board after a loss, so a reload still shows it", async () => {
      const cookie = await signUp("fei_long");
      for (const id of await wrongIds(10)) await post(`/api/puzzles/${TODAY}/guesses`, { characterId: id }, cookie);

      const board = (await app.inject({ method: "GET", url: "/api/puzzles/today/guesses", headers: { cookie } })).json();
      expect(board.guesses).toHaveLength(10);
      expect(board.answer.id).toBe(answerId);
    });

    it("keeps the answer hidden while guesses remain, and after a win", async () => {
      const cookie = await signUp("t_hawk");
      const [first] = await wrongIds(1);
      await post(`/api/puzzles/${TODAY}/guesses`, { characterId: first! }, cookie);
      const midGame = (await app.inject({ method: "GET", url: "/api/puzzles/today/guesses", headers: { cookie } })).json();
      expect(midGame.answer).toBeUndefined();

      const win = (await post(`/api/puzzles/${TODAY}/guesses`, { characterId: answerId }, cookie)).json();
      expect(win).toMatchObject({ solved: true, guessNumber: 2 });
      expect(win.answer).toBeUndefined(); // the guess already is the answer
    });

    it("never saves more than 10, even when 15 guesses arrive at once", async () => {
      const cookie = await signUp("dee_jay");
      const wrong = await wrongIds(15);
      const responses = await Promise.all(
        wrong.map((id) => post(`/api/puzzles/${TODAY}/guesses`, { characterId: id }, cookie)),
      );

      expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(10);
      expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(5);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM guesses g JOIN users u ON u.id = g.user_id WHERE u.username = $1",
        [`${PREFIX}dee_jay`],
      );
      expect(rows[0].n).toBe(10);
      // Each accepted guess got its own number, 1 to 10.
      const numbers = responses.filter((r) => r.statusCode === 200).map((r) => r.json().guessNumber);
      expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("counts a guest's guesses from what the page says, and reveals the answer on the 10th", async () => {
      const [id] = await wrongIds(1);
      const ninth = (await post(`/api/puzzles/${TODAY}/guesses`, { characterId: id!, previousGuesses: 8 })).json();
      const tenth = (await post(`/api/puzzles/${TODAY}/guesses`, { characterId: id!, previousGuesses: 9 })).json();
      const eleventh = await post(`/api/puzzles/${TODAY}/guesses`, { characterId: id!, previousGuesses: 10 });

      expect(ninth).toMatchObject({ guessNumber: 9 });
      expect(ninth.answer).toBeUndefined();
      expect(tenth.answer.id).toBe(answerId);
      expect(eleventh.statusCode).toBe(409);
    });
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
