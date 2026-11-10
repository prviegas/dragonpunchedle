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

export const submitGuess = (date: string, characterId: string) =>
  request<GuessResult>(`/api/puzzles/${date}/guesses`, postJson({ characterId }));

/** A logged-in player's guesses for today, newest first. */
export const fetchMyGuesses = () => request<GuessResult[]>("/api/puzzles/today/guesses");

export const fetchMe = () => request<{ user: User | null }>("/api/auth/me");

export const logIn = (username: string, password: string) =>
  request<{ user: User }>("/api/auth/login", postJson({ username, password }));

export const signUp = (username: string, password: string) =>
  request<{ user: User }>("/api/auth/register", postJson({ username, password }));

export const logOut = () => request<void>("/api/auth/logout", { method: "POST" });
