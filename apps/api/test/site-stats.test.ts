import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/passwords.js";
import { SESSION_COOKIE, createSession } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedCharacters } from "../src/db/seed.js";
import { deviceOf, looksLikeBot, referrerHost } from "../src/db/site-stats.js";
import { loadRoster, toCharacter } from "../src/game/roster.js";
import { parseUserIds } from "../src/routes/site-stats.js";

describe("owner ids", () => {
  it("reads whole positive numbers and ignores anything else", () => {
    expect(parseUserIds("3")).toEqual([3]);
    expect(parseUserIds(" 3, 12 ,")).toEqual([3, 12]);
    expect(parseUserIds("Pedro, 0, -1, 2.5, 07")).toEqual([]);
    expect(parseUserIds(undefined)).toEqual([]);
  });
});

describe("visit helpers", () => {
  it("keeps only the other site's host name", () => {
    expect(referrerHost("https://www.reddit.com/r/Fighters/comments/1", "dragonpunchedle.onrender.com")).toBe("reddit.com");
    expect(referrerHost("https://dragonpunchedle.onrender.com/#past", "dragonpunchedle.onrender.com")).toBeNull();
    expect(referrerHost("not a url", "x.com")).toBeNull();
    expect(referrerHost(undefined, "x.com")).toBeNull();
    expect(referrerHost("http://[::1]:5180/", "[::1]:5180")).toBeNull();
  });

  it("tells phones from computers, and spots bots", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0")).toBe("desktop");
    expect(looksLikeBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(looksLikeBot("")).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0")).toBe(false);
  });
});

// A made-up day in 2099, so real rows are never touched.
const TODAY = "2099-03-15";
const PREFIX = "zz_site_";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0";

describe.skipIf(!process.env.DATABASE_URL)("site stats", () => {
  const pool = createPool();
  // Filled in once the owner's account exists; the app reads the same list.
  const adminIds: number[] = [];
  const app = buildApp({ pool, now: () => new Date(`${TODAY}T12:00:00Z`), adminUserIds: adminIds });
  const cookies: Record<string, string> = {};

  const visit = (body: object, options: { ip?: string; userAgent?: string; as?: string } = {}) =>
    app.inject({
      method: "POST",
      url: "/api/visit",
      remoteAddress: options.ip ?? "203.0.113.1",
      headers: { "user-agent": options.userAgent ?? BROWSER, host: "dragonpunchedle.onrender.com" },
      cookies: options.as ? { [SESSION_COOKIE]: cookies[options.as]! } : {},
      payload: body,
    });

  beforeAll(async () => {
    await migrate(pool);
    await seedCharacters(pool, (await loadRoster()).map(toCharacter));
    await cleanUp();
    await pool.query("INSERT INTO daily_puzzles (puzzle_date, character_id) VALUES ($1, 'street-fighter-ryu')", [TODAY]);
    const hash = await hashPassword("not-used-here");
    for (const name of ["owner", "player"]) {
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
        [PREFIX + name, hash],
      );
      cookies[name] = (await createSession(pool, Number(rows[0]!.id))).token;
      if (name === "owner") adminIds.push(Number(rows[0]!.id));
    }
    // One player solved today's round in two guesses.
    const playerId = (await pool.query("SELECT id FROM users WHERE username = $1", [PREFIX + "player"])).rows[0].id;
    for (const characterId of ["street-fighter-ken", "street-fighter-ryu"]) {
      await pool.query("INSERT INTO guesses (user_id, puzzle_date, character_id) VALUES ($1, $2, $3)", [playerId, TODAY, characterId]);
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    await pool.query("DELETE FROM page_views WHERE day = $1", [TODAY]);
    await pool.query("DELETE FROM visitor_salts WHERE day = $1", [TODAY]);
    await pool.query("DELETE FROM users WHERE username LIKE $1", [PREFIX + "%"]);
    await pool.query("DELETE FROM guesses WHERE puzzle_date = $1", [TODAY]);
    await pool.query("DELETE FROM daily_puzzles WHERE puzzle_date = $1", [TODAY]);
  }

  it("counts real visits, once per visitor per day, without the owner or bots", async () => {
    const page = { path: "/", referrer: "https://www.reddit.com/r/Fighters", timezone: "America/Sao_Paulo", language: "pt-BR" };
    expect((await visit(page)).statusCode).toBe(204);
    expect((await visit({ path: "/#past" })).statusCode).toBe(204); // same visitor, second page
    expect((await visit({ path: "/" }, { ip: "198.51.100.7" })).statusCode).toBe(204);
    await visit({ path: "/" }, { userAgent: "Googlebot/2.1" });
    await visit({ path: "/" }, { as: "owner" });

    const { rows } = await pool.query("SELECT count(*)::int AS views, count(DISTINCT visitor)::int AS visitors FROM page_views WHERE day = $1", [TODAY]);
    expect(rows[0]).toEqual({ views: 3, visitors: 2 });
  });

  it("rejects fields it doesn't know", async () => {
    expect((await visit({ path: "/", ip: "1.2.3.4" })).statusCode).toBe(400);
  });

  it("shows the dashboard to the owner only", async () => {
    const get = (as?: string) =>
      app.inject({ method: "GET", url: "/api/admin/dashboard", cookies: as ? { [SESSION_COOKIE]: cookies[as]! } : {} });

    expect((await get()).statusCode).toBe(404);
    expect((await get("player")).statusCode).toBe(404);

    const response = await get("owner");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.days).toHaveLength(30);
    expect(body.days.at(-1)).toMatchObject({ day: TODAY, views: 3, visitors: 2, players: 1, finished: 1, won: 1 });
    expect(body.referrers).toContainEqual({ label: "reddit.com", count: 1 });
    expect(body.rounds[0]).toMatchObject({ day: TODAY, answer: "Ryu", players: 1, won: 1, averageGuesses: 2 });
    expect(body.firstGuesses).toContainEqual({ label: "Ken", count: 1 });
  });

  it("opens the dashboard to anyone in local open mode", async () => {
    const open = buildApp({ pool, now: () => new Date(`${TODAY}T12:00:00Z`), dashboardOpen: true });
    try {
      expect((await open.inject({ method: "GET", url: "/api/admin/dashboard" })).statusCode).toBe(200);
      expect((await open.inject({ method: "GET", url: "/api/auth/me" })).json()).toEqual({ user: null, dashboard: true });
    } finally {
      await open.close();
    }
    // Off by default: a guest gets no dashboard flag.
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json()).toEqual({ user: null });
  });

  it("tells the page who the owner is", async () => {
    const me = (as: string) => app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: cookies[as]! } });
    expect((await me("owner")).json().user.admin).toBe(true);
    expect((await me("player")).json().user.admin).toBeUndefined();
  });

  it("follows the owner's account, not its name", async () => {
    // The owner renames; someone else signs up with the old name.
    await pool.query("UPDATE users SET username = $1 WHERE username = $2", [PREFIX + "renamed", PREFIX + "owner"]);
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id",
      [PREFIX + "owner"],
    );
    cookies.squatter = (await createSession(pool, Number(rows[0]!.id))).token;

    const dashboardAs = (as: string) =>
      app.inject({ method: "GET", url: "/api/admin/dashboard", cookies: { [SESSION_COOKIE]: cookies[as]! } });
    expect((await dashboardAs("owner")).statusCode).toBe(200);
    expect((await dashboardAs("squatter")).statusCode).toBe(404);
  });

  it("resets counting for the owner only, without deleting anything", async () => {
    // The mark is shared by the whole database: put back whatever was there.
    const before = (await pool.query("SELECT value FROM site_settings WHERE key = 'stats_since'")).rows[0]?.value;
    try {
      const reset = (as?: string) =>
        app.inject({ method: "POST", url: "/api/admin/stats/reset", cookies: as ? { [SESSION_COOKIE]: cookies[as]! } : {} });
      expect((await reset()).statusCode).toBe(404);
      expect((await reset("player")).statusCode).toBe(404);

      const viewsBefore = (await pool.query("SELECT count(*)::int AS n FROM page_views WHERE day = $1", [TODAY])).rows[0].n;
      const response = await reset("owner");
      expect(response.statusCode).toBe(200);
      expect(response.json().since).toBeTruthy();

      const board = async () =>
        (await app.inject({ method: "GET", url: "/api/admin/dashboard", cookies: { [SESSION_COOKIE]: cookies.owner! } })).json();
      // Everything so far happened before the reset: the counts start again at zero...
      let body = await board();
      expect(body.since).toBe(response.json().since);
      expect(body.days.at(-1)).toMatchObject({ views: 0, visitors: 0, players: 0 });
      expect(body.firstGuesses).toEqual([]);
      // ...but no row was deleted, and new activity counts.
      expect((await pool.query("SELECT count(*)::int AS n FROM page_views WHERE day = $1", [TODAY])).rows[0].n).toBe(viewsBefore);
      await new Promise((resolve) => setTimeout(resolve, 5)); // a visit after the reset, not in the same millisecond
      await visit({ path: "/" }, { ip: "192.0.2.50" });
      body = await board();
      expect(body.days.at(-1)).toMatchObject({ views: 1, visitors: 1 });
    } finally {
      if (before === undefined) await pool.query("DELETE FROM site_settings WHERE key = 'stats_since'");
      else await pool.query("UPDATE site_settings SET value = $1 WHERE key = 'stats_since'", [before]);
    }
  });
});
