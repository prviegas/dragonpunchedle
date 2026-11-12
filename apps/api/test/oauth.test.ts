import "../src/env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { usernameCandidates } from "../src/auth/oauth.js";
import { SESSION_COOKIE } from "../src/auth/sessions.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";

describe("usernames from Discord or Google names", () => {
  const fixed = () => 0.1234; // "1234"

  it("keeps a name that already fits", () => {
    expect(usernameCandidates("ryu_main", fixed)[0]).toBe("ryu_main");
  });

  it("drops accents, turns spaces into _ and removes other characters", () => {
    expect(usernameCandidates("Chun-Lì  Fan!", fixed)[0]).toBe("Chun-Li_Fan");
  });

  it("cuts long names to 20 characters, and leaves room for the digits", () => {
    const [first, second] = usernameCandidates("a_really_long_display_name", fixed);
    expect(first).toBe("a_really_long_displa");
    expect(second).toBe("a_really_long_di1234");
  });

  it("falls back to 'player' when almost nothing is left", () => {
    expect(usernameCandidates("李", fixed)[0]).toBe("player");
  });
});

// Every test account starts with this, so the names fakes return must too.
const PREFIX = "zz_test_";
const PUBLIC_URL = "http://localhost:5180";

/** Plays Discord and Google: answers the token and profile requests. */
function fakeProviders() {
  const people = new Map<string, unknown>(); // code -> profile JSON
  const calls: { url: string; body?: string }[] = [];
  let failToken = false;

  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body?.toString() });
    if (url.endsWith("/token")) {
      const code = new URLSearchParams(init?.body?.toString()).get("code")!;
      if (failToken || !people.has(code)) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: `token-for-${code}`, token_type: "Bearer" });
    }
    const code = new Headers(init?.headers).get("authorization")?.replace("Bearer token-for-", "") ?? "";
    return Response.json(people.get(code));
  }) as typeof fetch;

  return {
    fetch: fetchFake,
    calls,
    /** The code the provider would hand back for this person. */
    personWithCode(code: string, profile: unknown) {
      people.set(code, profile);
    },
    failNextToken() {
      failToken = true;
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)("sign in with Discord or Google", () => {
  const pool = createPool();
  let fake = fakeProviders();
  const app = buildApp({
    pool,
    authRateLimitPerMinute: 1000,
    oauth: {
      publicUrl: PUBLIC_URL,
      providers: {
        discord: { clientId: "discord-id", clientSecret: "discord-secret" },
        google: { clientId: "google-id", clientSecret: "google-secret" },
      },
      // Each test gets a fresh fake; this indirection lets the app see it.
      fetch: ((...args: Parameters<typeof fetch>) => fake.fetch(...args)) as typeof fetch,
    },
  });

  beforeAll(async () => {
    await migrate(pool);
    await cleanUp();
  });

  beforeEach(() => {
    fake = fakeProviders();
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    await pool.end();
  });

  async function cleanUp() {
    // Deleting the users also deletes their external logins and sessions.
    await pool.query("DELETE FROM users WHERE username LIKE $1", [`${PREFIX}%`]);
  }

  /** Runs /start, then comes back to /callback the way the provider would. */
  async function signInWith(provider: "discord" | "google", code: string, tamper?: { state?: string; noCookie?: boolean }) {
    const start = await app.inject({ method: "GET", url: `/api/auth/${provider}/start` });
    const authorizeUrl = new URL(start.headers.location as string);
    const oauthCookie = start.cookies.find((c) => c.name === "dp_oauth")!;
    const state = tamper?.state ?? authorizeUrl.searchParams.get("state")!;

    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/${provider}/callback?code=${code}&state=${state}`,
      headers: tamper?.noCookie ? {} : { cookie: `dp_oauth=${oauthCookie.value}` },
    });
    const session = callback.cookies.find((c) => c.name === SESSION_COOKIE);
    return { start, authorizeUrl, callback, cookie: session && `${SESSION_COOKIE}=${session.value}` };
  }

  async function me(cookie: string) {
    return (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).json().user;
  }

  it("lists the providers that have keys", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/providers" });
    expect(response.json()).toEqual({
      providers: [
        { id: "discord", label: "Discord" },
        { id: "google", label: "Google" },
      ],
    });
  });

  it("sends the player to Google with a state, PKCE and our callback address", async () => {
    const { start, authorizeUrl } = await signInWith("google", "unused");
    const params = authorizeUrl.searchParams;

    expect(start.statusCode).toBe(302);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(params.get("client_id")).toBe("google-id");
    expect(params.get("redirect_uri")).toBe(`${PUBLIC_URL}/api/auth/google/callback`);
    expect(params.get("scope")).toBe("openid profile"); // no email
    expect(params.get("state")).toHaveLength(43);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(start.cookies.find((c) => c.name === "dp_oauth")).toMatchObject({ httpOnly: true, path: "/api/auth" });
  });

  it("creates an account on the first Discord sign-in and logs the player in", async () => {
    fake.personWithCode("code-1", { id: "111", username: `${PREFIX}ryu`, global_name: "Ryu" });
    const { callback, cookie } = await signInWith("discord", "code-1");

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    expect(await me(cookie!)).toMatchObject({ username: `${PREFIX}ryu` });
    // The client secret went to Discord's token endpoint, server to server.
    expect(fake.calls[0]!.url).toBe("https://discord.com/api/oauth2/token");
    expect(fake.calls[0]!.body).toContain("client_secret=discord-secret");
  });

  it("finds the same account on the next sign-in, even after a name change", async () => {
    fake.personWithCode("code-a", { id: "222", username: `${PREFIX}ken` });
    const first = await me((await signInWith("discord", "code-a")).cookie!);

    fake.personWithCode("code-b", { id: "222", username: `${PREFIX}ken_masters` });
    const second = await me((await signInWith("discord", "code-b")).cookie!);

    expect(second).toEqual(first);
  });

  it("adds digits when the name is already taken", async () => {
    fake.personWithCode("code-x", { sub: "g-1", given_name: `${PREFIX}guile` });
    fake.personWithCode("code-y", { sub: "g-2", given_name: `${PREFIX}guile` });
    const first = await me((await signInWith("google", "code-x")).cookie!);
    const second = await me((await signInWith("google", "code-y")).cookie!);

    expect(first.username).toBe(`${PREFIX}guile`);
    expect(second.username).toMatch(new RegExp(`^${PREFIX}guile\\d{4}$`));
  });

  it("refuses a callback whose state doesn't match, without asking the provider", async () => {
    fake.personWithCode("code-2", { id: "333", username: `${PREFIX}sagat` });
    const { callback, cookie } = await signInWith("discord", "code-2", { state: "forged-state" });

    expect(callback.headers.location).toBe("/?login_error=expired");
    expect(cookie).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a callback from a browser that never started a sign-in", async () => {
    fake.personWithCode("code-3", { id: "444", username: `${PREFIX}vega` });
    const { callback, cookie } = await signInWith("discord", "code-3", { noCookie: true });

    expect(callback.headers.location).toBe("/?login_error=expired");
    expect(cookie).toBeUndefined();
  });

  it("goes back to the game quietly when the player cancels", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/discord/callback?error=access_denied" });
    expect(response.headers.location).toBe("/?login_error=cancelled");
  });

  it("reports a failure when the provider refuses the code", async () => {
    fake.personWithCode("code-4", { id: "555", username: `${PREFIX}balrog` });
    fake.failNextToken();
    const { callback, cookie } = await signInWith("discord", "code-4");

    expect(callback.headers.location).toBe("/?login_error=failed");
    expect(cookie).toBeUndefined();
  });

  it("doesn't let anyone log in with a password to an account made through Discord", async () => {
    fake.personWithCode("code-5", { id: "666", username: `${PREFIX}dhalsim` });
    await signInWith("discord", "code-5");

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: `${PREFIX}dhalsim`, password: "anything-at-all" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("hides providers without keys", async () => {
    const plain = buildApp({ pool });
    expect((await plain.inject({ method: "GET", url: "/api/auth/providers" })).json()).toEqual({ providers: [] });
    expect((await plain.inject({ method: "GET", url: "/api/auth/discord/start" })).statusCode).toBe(404);
    await plain.close();
  });
});
