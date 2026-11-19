// Typed wrappers around the API. These types mirror what apps/api returns.

export type ClueKind = "exact" | "set" | "number";
export type ClueStatus = "correct" | "partial" | "wrong" | "unknown";

export interface ClueInfo {
  key: string;
  label: string;
  kind: ClueKind;
  /** When this column turns yellow, in words; null when it never does. */
  close: string | null;
  /** The same in a few words, for the hover tip. */
  closeShort: string | null;
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
  species: string[];
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
  /** Present when this guess made the player the day's first logged-in solver. */
  firstSolve?: true;
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
  /** The site owner: sees the dashboard link. */
  admin?: boolean;
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

/** Saves and scores a guess, for an account or a guest (the server tells them
 *  apart by cookie, and counts each one's guesses itself). */
export const submitGuess = (date: string, characterId: string) =>
  request<GuessResponse>(`/api/puzzles/${date}/guesses`, postJson({ characterId }));

/** This player's guesses for today, account or guest, newest first, plus the answer if they ran out. */
export const fetchMyGuesses = () =>
  request<{ guesses: GuessResult[]; answer?: Character; firstSolve?: true }>("/api/puzzles/today/guesses");

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

export interface FirstSolveEntry {
  date: string;
  answer: { id: string; name: string; franchise: string; portraitUrl: string | null };
}

/** The logged-in player's own profile. Private: there's no way to ask for someone else's. */
export interface PlayerProfile {
  username: string;
  /** When the account was made (ISO). */
  memberSince: string;
  stats: PlayerStats;
  /** Rounds solved on their day: solvedIn[0] in 1 guess, solvedIn[1] in 2, and so on. */
  solvedIn: number[];
  /** Rounds lost on their day. */
  lost: number;
  /** Days this account was the first logged-in solver, newest first. */
  firstSolves: FirstSolveEntry[];
  tower: {
    runs: number;
    bestFloor: number;
    floorsCleared: number;
    /** The floor a climb ends on, on average. */
    averageFloor: number | null;
  };
  compare: Comparison;
}

/** The share of other players this one beats outright (0-100), out of how many. */
export interface Standing {
  /** 0-100: the share of other players beaten outright. */
  betterThan: number;
  /** How many other players were compared. */
  of: number;
  /** Other players doing strictly better (rank = ahead + 1). */
  ahead: number;
  /** Other players with exactly the same result. */
  tied: number;
}

export interface RoundComparison {
  date: string;
  /** Guesses taken, "lost", or null (not played or not finished on the day). */
  you: number | "lost" | null;
  /** Average guesses among the day's solvers. */
  everyoneAverage: number | null;
  players: number;
}

/** How the player compares with everyone. Totals only, never other players' names. */
export interface Comparison {
  everyone: {
    solvedIn: number[];
    lost: number;
    rounds: number;
    averageGuesses: number | null;
    /** 0-100. */
    solveRate: number | null;
  };
  /** Null until there's enough to compare. */
  standing: {
    averageGuesses: Standing | null;
    solveRate: Standing | null;
    maxStreak: Standing | null;
    towerFloor: Standing | null;
  };
  /** Recent rounds, oldest first. */
  rounds: RoundComparison[];
}

export const fetchMyProfile = () => request<PlayerProfile>("/api/me/profile");

export const fetchTodayLeaderboard = () => request<TodayEntry[]>("/api/leaderboards/today");

export const fetchStreakLeaderboard = () => request<StreakEntry[]>("/api/leaderboards/streaks");

/** dashboard: true when this viewer may open the dashboard (the owner, or anyone on a local dev server). */
export const fetchMe = () => request<{ user: User | null; dashboard?: boolean }>("/api/auth/me");

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
  /** Players who finished today's round (solved, or out of guesses), accounts and guests. */
  players: number;
  /** solvedIn[0]: players who solved it in 1 guess; solvedIn[1]: in 2; and so on. */
  solvedIn: number[];
  lost: number;
  /** The viewer's own finished result. */
  you: number | "lost" | null;
  /** `you` was finished after the day, so it isn't in the counts above. */
  youLate?: boolean;
}

export const fetchTodayResults = () => request<TodayResults>("/api/puzzles/today/results");

export interface PastRound {
  date: string;
  /** Only once the round is over for this player: solved, out of guesses, or "Show answer". */
  answer?: { id: string; name: string; franchise: string; portraitUrl: string | null };
  /** Guesses this player made that day; 0 if they didn't play. */
  guesses: number;
  solved: boolean;
  /** Some guesses came after the day. */
  late: boolean;
  /** The player chose "Show answer". */
  revealed: boolean;
  /** This account was the day's first logged-in solver. */
  firstSolve: boolean;
}

/** Finished days, newest first, with the answer and how this player did. */
export const fetchHistory = () => request<{ maxGuesses: number; rounds: PastRound[] }>("/api/history");

export interface PastDay {
  date: string;
  maxGuesses: number;
  clues: ClueInfo[];
  /** This player's guesses that day, newest first. */
  guesses: GuessResult[];
  revealed: boolean;
  late: boolean;
  /** This account was the day's first logged-in solver. */
  firstSolve: boolean;
  /** Only once the round is over for this player. */
  answer?: Character;
  results?: TodayResults;
}

/** One finished day in full: the answer, this player's board, and how everyone did. */
export const fetchPastDay = (date: string) => request<PastDay>(`/api/history/${encodeURIComponent(date)}`);

/** "Show answer" on a past round: ends it for this player and returns it with the answer. */
export const revealPastDay = (date: string) =>
  request<PastDay>(`/api/history/${encodeURIComponent(date)}/reveal`, { method: "POST" });

/**
 * Reports a page view for the owner's dashboard. Fire and forget: a failure
 * here must never get in the way of the game. keepalive lets it finish even
 * when the player is already leaving the page.
 */
export function sendVisit(path: string, referrer?: string) {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Old browsers: leave it out.
  }
  const body = { path, timezone, language: navigator.language, ...(referrer && { referrer }) };
  fetch("/api/visit", { ...postJson(body), keepalive: true }).catch(() => undefined);
}

export interface DayNumbers {
  day: string;
  views: number;
  visitors: number;
  players: number;
  finished: number;
  won: number;
  signups: number;
  latePlayers: number;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface Dashboard {
  today: string;
  /** Counting since this moment (ISO), or null when it was never reset. */
  since: string | null;
  days: DayNumbers[];
  accounts: { total: number; google: number; newThisWeek: number };
  rounds: {
    day: string;
    answer: string;
    franchise: string;
    players: number;
    won: number;
    finished: number;
    averageGuesses: number | null;
  }[];
  referrers: CountRow[];
  devices: CountRow[];
  timezones: CountRow[];
  languages: CountRow[];
  pages: CountRow[];
  firstGuesses: CountRow[];
  tower: {
    runs: number;
    players: number;
    highestFloor: number;
    averageFloor: number | null;
    /** Finished climbs per floor they ended on, lowest floor first. */
    floorsReached: { floor: number; runs: number }[];
    runsByDay: { day: string; runs: number }[];
  };
}

export const fetchDashboard = () => request<Dashboard>("/api/admin/dashboard");

/** Owner only: the dashboard counts from now on. Deletes nothing. */
export const resetCounting = () => request<{ since: string }>("/api/admin/stats/reset", { method: "POST" });

// ---- Arcade Ladder ----

export interface ArcadeCleared {
  floor: number;
  guesses: number;
  character: { id: string; name: string; franchise: string; portrait?: Character["portrait"] };
}

export interface ArcadeRunView {
  floorsCleared: number;
  over: boolean;
  /** The floor being played, or the one that was lost. */
  floor: number;
  /** Beaten floors, oldest first. */
  cleared: ArcadeCleared[];
  /** Guesses on the current floor, newest first. */
  guesses: GuessResult[];
  /** Who the lost floor's fighter was: only once the run is over. */
  answer?: Character;
}

export interface ArcadeState {
  maxGuesses: number;
  clues: ClueInfo[];
  /** The player's highest floor ever. */
  best: number;
  run: ArcadeRunView | null;
}

export interface ArcadeGuessResponse extends GuessResult {
  floor: number;
  guessNumber: number;
  runOver: boolean;
  answer?: Character;
}

export const fetchArcade = () => request<ArcadeState>("/api/arcade");
export const startArcade = () => request<ArcadeState>("/api/arcade/start", { method: "POST" });
/** Ends the run on the current floor, like losing it. */
export const giveUpArcade = () => request<ArcadeState>("/api/arcade/give-up", { method: "POST" });
export const submitArcadeGuess = (characterId: string) =>
  request<ArcadeGuessResponse>("/api/arcade/guess", postJson({ characterId }));

export interface ArcadeLadderEntry {
  rank: number;
  username: string;
  floor: number;
  you: boolean;
}
export const fetchArcadeLeaderboard = () =>
  request<{ top: ArcadeLadderEntry[]; you?: ArcadeLadderEntry }>("/api/arcade/leaderboard");
