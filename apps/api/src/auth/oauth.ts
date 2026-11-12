import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Provider } from "../db/users.js";

// "Sign in with Discord / Google" uses OAuth 2.0's authorization code flow:
//
//   1. /start sends the player to Discord or Google with our client id, the
//      address to come back to, and a random `state` (kept in a cookie).
//   2. They approve there, and the provider sends them back to /callback with
//      a one-time `code` and the same `state`.
//   3. The server checks the state, then trades the code (plus our client
//      secret) for an access token, server to server.
//   4. With that token it asks for the player's id and name, once. The token
//      is never stored: we only need to know who they are, not act for them.
//
// We ask for the narrowest scopes, which carry no email address: Discord's
// `identify` and Google's `openid profile`. Less personal data to hold.

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ExternalProfile {
  /** The provider's permanent id for this person. Names change; this doesn't. */
  id: string;
  /** Their display name there, the starting point for a username here. */
  name: string;
}

interface ProviderSpec {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  /**
   * PKCE: the start step sends a hash of a random secret, and the code only
   * works together with that secret. Someone who intercepts the code can't
   * use it. Google supports it; for Discord the state check and our client
   * secret protect the exchange.
   */
  pkce: boolean;
  /** Extra parameters for the provider's sign-in page. */
  authorizeParams?: Record<string, string>;
  /** The provider's answer is outside data: checked with zod, never trusted. */
  readProfile: (json: unknown) => ExternalProfile;
}

const discordUser = z.object({ id: z.string().min(1), username: z.string(), global_name: z.string().nullish() });
const googleUser = z.object({ sub: z.string().min(1), name: z.string().nullish(), given_name: z.string().nullish() });

export const PROVIDERS: Record<Provider, ProviderSpec> = {
  discord: {
    label: "Discord",
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    scope: "identify",
    pkce: false,
    // Skip Discord's approval screen for players who already approved us once.
    authorizeParams: { prompt: "none" },
    readProfile: (json) => {
      const user = discordUser.parse(json);
      // username is the unique handle (e.g. "ryu_main"), the best fit for ours.
      return { id: user.id, name: user.username || user.global_name || "" };
    },
  },
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
    pkce: true,
    // Let people with several Google accounts pick one, instead of reusing whichever is signed in.
    authorizeParams: { prompt: "select_account" },
    readProfile: (json) => {
      const user = googleUser.parse(json);
      return { id: user.sub, name: user.given_name || user.name || "" };
    },
  },
};

export const isProvider = (value: string): value is Provider => Object.hasOwn(PROVIDERS, value);

const randomToken = () => randomBytes(32).toString("base64url");
const sha256Base64Url = (value: string) => createHash("sha256").update(value).digest("base64url");

/** The redirect address registered with each provider. Must match exactly. */
export const callbackUrl = (publicUrl: string, provider: Provider) =>
  `${publicUrl.replace(/\/$/, "")}/api/auth/${provider}/callback`;

/** Step 1: where to send the player, and the secrets to remember until they return. */
export function beginSignIn(provider: Provider, credentials: ProviderCredentials, publicUrl: string) {
  const spec = PROVIDERS[provider];
  const state = randomToken();
  const verifier = spec.pkce ? randomToken() : undefined;

  const url = new URL(spec.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: credentials.clientId,
    redirect_uri: callbackUrl(publicUrl, provider),
    scope: spec.scope,
    state,
    ...(verifier && { code_challenge: sha256Base64Url(verifier), code_challenge_method: "S256" }),
    ...spec.authorizeParams,
  }).toString();

  return { url: url.toString(), state, verifier };
}

/** Steps 3 and 4: trade the one-time code for a token, then ask who this is. */
export async function finishSignIn(
  provider: Provider,
  credentials: ProviderCredentials,
  publicUrl: string,
  code: string,
  verifier: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalProfile> {
  const spec = PROVIDERS[provider];

  const tokenResponse = await fetchImpl(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(publicUrl, provider),
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      ...(verifier && { code_verifier: verifier }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`${spec.label} refused the sign-in code (HTTP ${tokenResponse.status})`);
  const { access_token: accessToken } = z.object({ access_token: z.string().min(1) }).parse(await tokenResponse.json());

  const profileResponse = await fetchImpl(spec.profileUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new Error(`${spec.label} didn't return the profile (HTTP ${profileResponse.status})`);
  return spec.readProfile(await profileResponse.json());
}

const USERNAME_MAX = 20;

/**
 * Usernames to try, in order, for a first-time sign-in: the provider name made
 * to fit our rule (3-20 letters, numbers, _ or -), then the same with a few
 * random digits if it's taken.
 */
export function usernameCandidates(name: string, random: () => number = Math.random): string[] {
  let base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // "Chun-Lì" -> "Chun-Li": drop accents, keep the letters
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, USERNAME_MAX);
  if (base.length < 3) base = "player";

  const withDigits = () => {
    const digits = String(Math.floor(random() * 10_000)).padStart(4, "0");
    return `${base.slice(0, USERNAME_MAX - digits.length)}${digits}`;
  };
  return [base, withDigits(), withDigits(), withDigits(), withDigits(), withDigits()];
}
