// Typed wrappers around the API. These types mirror what apps/api returns.

export type ClueKind = "exact" | "set" | "number";
export type ClueStatus = "correct" | "partial" | "wrong" | "unknown";

export interface ClueInfo {
  key: string;
  label: string;
  kind: ClueKind;
}

export interface Puzzle {
  date: string;
  /** Guesses per day. Running out ends the round and reveals the answer. */
  maxGuesses: number;
  clues: ClueInfo[];
}

export interface CharacterSummary {
  id: string;
  name: string;
  franchise: string;
}

export interface Character extends CharacterSummary {
  developer: string;
  debutYear: number;
  archetypes: string[];
  species: string;
  homeCountry: string | null;
  gamesAppearedIn: number;
  /** Official art, when one has been loaded for this character. */
  portrait?: { url: string; credit: string };
}

export interface ClueResult {
  key: string;
  status: ClueStatus;
  direction?: "higher" | "lower";
}

export interface GuessResult {
  guess: Character;
  solved: boolean;
  clues: ClueResult[];
}

/** What the server sends back for a new guess. */
export interface GuessResponse extends GuessResult {
  /** 1 for the first guess of the day, up to maxGuesses. */
  guessNumber: number;
  /** Present only when this was the last guess and it missed. */
  answer?: Character;
}

/** An error the API explained, with a message that's fine to show the player. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface User {
  id: number;
  username: string;
}

// Requests go to the same site that served the page, so the browser attaches
// the session cookie automatically; no token handling is needed here.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    if (response.status === 429) {
      message = "Too many attempts. Please wait a minute and try again.";
    } else if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      message = body.error;
    }
    throw new ApiError(message, response.status);
  }
  return body as T;
}

const postJson = (body: object): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchPuzzle = () => request<Puzzle>("/api/puzzles/today");

export const fetchCharacters = () => request<CharacterSummary[]>("/api/characters");

/** previousGuesses matters only for guests: the server counts a logged-in
 *  player's guesses itself, but keeps nothing about guests. */
export const submitGuess = (date: string, characterId: string, previousGuesses: number) =>
  request<GuessResponse>(`/api/puzzles/${date}/guesses`, postJson({ characterId, previousGuesses }));

/** A logged-in player's guesses for today, newest first, plus the answer if they ran out. */
export const fetchMyGuesses = () =>
  request<{ guesses: GuessResult[]; answer?: Character }>("/api/puzzles/today/guesses");

export interface PlayerStats {
  played: number;
  solved: number;
  averageGuesses: number | null;
  currentStreak: number;
  maxStreak: number;
  solvedToday: boolean;
}

export interface TodayEntry {
  rank: number;
  username: string;
  guesses: number;
  solvedAt: string;
  you: boolean;
}

export interface StreakEntry {
  rank: number;
  username: string;
  streak: number;
  you: boolean;
}

export const fetchMyStats = () => request<PlayerStats>("/api/me/stats");

export const fetchTodayLeaderboard = () => request<TodayEntry[]>("/api/leaderboards/today");

export const fetchStreakLeaderboard = () => request<StreakEntry[]>("/api/leaderboards/streaks");

export const fetchMe = () => request<{ user: User | null }>("/api/auth/me");

export const logIn = (username: string, password: string) =>
  request<{ user: User }>("/api/auth/login", postJson({ username, password }));

export const signUp = (username: string, password: string) =>
  request<{ user: User }>("/api/auth/register", postJson({ username, password }));

export const logOut = () => request<void>("/api/auth/logout", { method: "POST" });

export interface LoginProvider {
  id: "discord" | "google";
  label: string;
}

/** Discord / Google, if the server has keys for them. */
export const fetchLoginProviders = () => request<{ providers: LoginProvider[] }>("/api/auth/providers");

/** Where "Continue with …" sends the browser. It's a whole-page visit, not a
 *  fetch: the player has to see the provider's own sign-in page. */
export const providerStartUrl = (id: LoginProvider["id"]) => `/api/auth/${id}/start`;

export interface TodayResults {
  /** Players who finished today's round (solved, or out of guesses). Guests aren't counted. */
  players: number;
  /** solvedIn[0]: players who solved it in 1 guess; solvedIn[1]: in 2; and so on. */
  solvedIn: number[];
  lost: number;
  /** The viewer's own finished result, when logged in. */
  you: number | "lost" | null;
}

export const fetchTodayResults = () => request<TodayResults>("/api/puzzles/today/results");
