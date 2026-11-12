import { timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type pg from "pg";
import {
  beginSignIn,
  finishSignIn,
  isProvider,
  PROVIDERS,
  usernameCandidates,
  type ProviderCredentials,
} from "../auth/oauth.js";
import { checkPasswordStrength } from "../auth/password-strength.js";
import { hashForUnknownUser, hashPassword, verifyPassword } from "../auth/passwords.js";
import { deleteSession, SESSION_COOKIE, startSession } from "../auth/sessions.js";
import {
  createUser,
  createUserWithExternalLogin,
  findUserByExternalLogin,
  findUserForLogin,
  type Provider,
} from "../db/users.js";

export interface OAuthOptions {
  /** This site's public address, e.g. https://dragonpunchedle.onrender.com.
   *  Providers send players back to it, so it must match their settings. */
  publicUrl: string;
  /** Only providers listed here are offered. */
  providers: Partial<Record<Provider, ProviderCredentials>>;
  /** Tests pass a fake that plays Discord and Google. */
  fetch?: typeof fetch;
}

interface AuthRouteOptions {
  pool: pg.Pool;
  /** Cookies only sent over HTTPS. On in production, off for local http://. */
  secureCookies: boolean;
  /** Login and sign-up attempts allowed per IP address per minute. */
  rateLimitPerMinute: number;
  oauth?: OAuthOptions;
}

const credentialsSchema = {
  body: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", pattern: "^[A-Za-z0-9_-]{3,20}$" },
      // The upper bound stops someone making the server hash a huge string.
      password: { type: "string", minLength: 8, maxLength: 200 },
    },
  },
} as const;

type Credentials = { Body: { username: string; password: string } };

// Remembers the sign-in in progress between /start and /callback. Only sent
// to /api/auth paths, and gone after 10 minutes.
const OAUTH_COOKIE = "dp_oauth";
const OAUTH_COOKIE_PATH = "/api/auth";

type ProviderParams = { Params: { provider: string } };
type CallbackRequest = ProviderParams & {
  Querystring: { code?: string; state?: string; error?: string };
};

/** Equal strings, compared in constant time so timing reveals nothing. */
function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { pool, secureCookies, rateLimitPerMinute, oauth },
) => {
  // Limits only the routes below that opt in, so the game itself is unaffected.
  await app.register(rateLimit, { global: false });
  const limited = { rateLimit: { max: rateLimitPerMinute, timeWindow: "1 minute" } };

  app.post<Credentials>("/api/auth/register", { schema: credentialsSchema, config: limited }, async (request, reply) => {
    const { username, password } = request.body;
    // Only new passwords are judged. Logging in still accepts any password an
    // account already has, so tightening this rule never locks anyone out.
    const strength = checkPasswordStrength(password, username);
    if (!strength.ok) {
      return reply.code(400).send({ error: `That password is too easy to guess. ${strength.advice}` });
    }
    const user = await createUser(pool, username, await hashPassword(password));
    if (user === "taken") {
      return reply.code(409).send({ error: "That username is taken." });
    }
    await startSession(pool, reply, user.id, secureCookies);
    return reply.code(201).send({ user });
  });

  app.post<Credentials>("/api/auth/login", { schema: credentialsSchema, config: limited }, async (request, reply) => {
    const { username, password } = request.body;
    const found = await findUserForLogin(pool, username);
    // Accounts made through Discord or Google have no password: checking
    // against the dummy hash fails them, in the same time as a wrong password.
    const valid = await verifyPassword(password, found?.passwordHash ?? (await hashForUnknownUser()));
    if (!found || !valid) {
      // One message for both cases, so the login form can't be used to find out which usernames exist.
      return reply.code(401).send({ error: "Wrong username or password." });
    }
    const user = { id: found.id, username: found.username };
    await startSession(pool, reply, user.id, secureCookies);
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(pool, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (request) => ({ user: request.user }));

  // ---- Sign in with Discord / Google (see src/auth/oauth.ts) ----

  const configured = (provider: string) =>
    isProvider(provider) && oauth?.providers[provider] ? { provider, credentials: oauth.providers[provider] } : undefined;

  // The page asks which buttons to show, so a provider without keys is hidden.
  app.get("/api/auth/providers", async () => ({
    providers: (Object.keys(PROVIDERS) as Provider[])
      .filter((provider) => configured(provider))
      .map((provider) => ({ id: provider, label: PROVIDERS[provider].label })),
  }));

  // Back to the game, with a short code the page turns into a message.
  const backToGame = (reply: FastifyReply, error?: "cancelled" | "expired" | "failed") =>
    reply.redirect(error ? `/?login_error=${error}` : "/");

  app.get<ProviderParams>("/api/auth/:provider/start", { config: limited }, async (request, reply) => {
    const found = configured(request.params.provider);
    if (!found || !oauth) return reply.code(404).send({ error: "Not found." });

    const { url, state, verifier } = beginSignIn(found.provider, found.credentials, oauth.publicUrl);
    reply.setCookie(OAUTH_COOKIE, [found.provider, state, verifier ?? ""].join("."), {
      httpOnly: true,
      // Lax still sends it when the provider redirects back with a plain link
      // (a top-level GET), which is exactly the callback.
      sameSite: "lax",
      secure: secureCookies,
      path: OAUTH_COOKIE_PATH,
      maxAge: 10 * 60,
    });
    return reply.redirect(url);
  });

  app.get<CallbackRequest>("/api/auth/:provider/callback", { config: limited }, async (request, reply) => {
    const found = configured(request.params.provider);
    if (!found || !oauth) return reply.code(404).send({ error: "Not found." });

    const saved = request.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH }); // single use, whatever happens next
    const { code, state, error } = request.query;

    // They pressed "Cancel" on Discord or Google.
    if (error) return backToGame(reply, "cancelled");

    // The state must be the one this browser was given at /start. Without this
    // check, an attacker could send someone a callback link carrying the
    // attacker's own code, and sign them in to the attacker's account.
    const [savedProvider, savedState, savedVerifier] = saved?.split(".") ?? [];
    if (!code || !state || savedProvider !== found.provider || !savedState || !sameSecret(state, savedState)) {
      return backToGame(reply, "expired");
    }

    try {
      const profile = await finishSignIn(
        found.provider,
        found.credentials,
        oauth.publicUrl,
        code,
        savedVerifier || undefined,
        oauth.fetch,
      );
      const user =
        (await findUserByExternalLogin(pool, found.provider, profile.id)) ??
        (await createUserWithExternalLogin(pool, found.provider, profile.id, usernameCandidates(profile.name)));
      if (user === "no-free-name") return backToGame(reply, "failed");

      await startSession(pool, reply, user.id, secureCookies);
      return backToGame(reply);
    } catch (caught) {
      request.log.warn({ err: caught, provider: found.provider }, "external sign-in failed");
      return backToGame(reply, "failed");
    }
  });
};
