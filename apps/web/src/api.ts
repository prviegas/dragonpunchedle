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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Something went wrong. Please try again.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const fetchPuzzle = () => request<Puzzle>("/api/puzzles/today");

export const fetchCharacters = () => request<CharacterSummary[]>("/api/characters");

export const submitGuess = (date: string, characterId: string) =>
  request<GuessResult>(`/api/puzzles/${date}/guesses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId }),
  });
