import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchCharacters,
  fetchMe,
  fetchMyGuesses,
  fetchMyStats,
  fetchPuzzle,
  logOut,
  submitGuess,
  type Character,
  type CharacterSummary,
  type GuessResult,
  type PlayerStats,
  type Puzzle,
  type User,
} from "./api";
import { AuthPanel } from "./AuthPanel";
import { Board } from "./Board";
import { GuessInput } from "./GuessInput";
import { HealthBar } from "./HealthBar";
import { Leaderboard } from "./Leaderboard";
import { Modal } from "./Modal";
import { ResultCard } from "./ResultCard";
import { puzzleNumber } from "./share";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; puzzle: Puzzle; characters: CharacterSummary[] };

// Before guests were saved on the server, a guest's guesses for the day were
// kept in this browser. Anything still stored there is handed to the server
// once, oldest first, so nobody loses a round across the update; the server
// re-checks each guess and refuses repeats. Storage can be unavailable
// (private windows, blocked site data), so every access is wrapped.
const legacyKeys = (date: string) => [`dragonpunchedle:guesses:${date}`, `dragonpunchedle:answer:${date}`];

async function moveLegacyGuessesToServer(date: string) {
  let saved: GuessResult[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(legacyKeys(date)[0]!) ?? "[]") as GuessResult[];
  } catch {
    return;
  }
  for (const local of [...saved].reverse()) {
    await submitGuess(date, local.guess.id).catch(() => undefined);
  }
  try {
    for (const key of legacyKeys(date)) localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

// After a Discord or Google sign-in the server sends the player back to the
// game, adding ?login_error=… if it didn't work out.
const LOGIN_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was started in another tab. Please try again.",
  failed: "Couldn't sign you in. Please try again.",
};

/** Reads the error once and removes it from the address, so a refresh or a
 *  shared link doesn't show it again. */
function takeLoginError(): string | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("login_error");
  if (code === null) return undefined;
  url.searchParams.delete("login_error");
  window.history.replaceState(null, "", url);
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.failed;
}

// Read once when the page loads, not on every render.
const initialLoginError = takeLoginError();

export function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [user, setUser] = useState<User | null>(null);
  // A failed Discord/Google sign-in reopens the login panel with the reason.
  const [showAuth, setShowAuth] = useState(initialLoginError !== undefined);
  const [guesses, setGuesses] = useState<GuessResult[]>([]);
  // Guesses picked but not yet answered by the server, in the order picked.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The latest guesses, readable from queued work that started before the
  // last render (state captured in a closure would be out of date there).
  const guessesRef = useRef<GuessResult[]>([]);
  const showGuesses = (next: GuessResult[]) => {
    guessesRef.current = next;
    setGuesses(next);
  };
  // Set when the player runs out of guesses: the character they were after.
  const [answer, setAnswer] = useState<Character>();
  const answerRef = useRef<Character>(undefined);
  const revealAnswer = (revealed: Character | undefined) => {
    answerRef.current = revealed;
    setAnswer(revealed);
  };
  const [guessError, setGuessError] = useState<string>();
  // The guess just made, whose tiles flip in on the board.
  const [freshId, setFreshId] = useState<string>();
  const [stats, setStats] = useState<PlayerStats>();
  // Bumped whenever the leaderboard may have changed, so it fetches again.
  const [standingsVersion, setStandingsVersion] = useState(0);
  const refreshStandings = () => setStandingsVersion((v) => v + 1);

  useEffect(() => {
    Promise.all([fetchPuzzle(), fetchCharacters(), fetchMe()])
      .then(async ([puzzle, characters, { user: me }]) => {
        setUser(me);
        await moveLegacyGuessesToServer(puzzle.date);
        // Guests and accounts alike: the server keeps the board.
        const [mine, myStats] = await Promise.all([fetchMyGuesses(), me ? fetchMyStats() : undefined]);
        showGuesses(mine.guesses);
        revealAnswer(mine.answer);
        setStats(myStats);
        setLoad({ state: "ready", puzzle, characters });
      })
      .catch((error: unknown) =>
        setLoad({
          state: "error",
          message: error instanceof ApiError ? error.message : "Couldn't reach the server. Please try again.",
        }),
      );
  }, []);

  // Already guessed or waiting in the queue: either way, don't suggest it again.
  const guessedIds = useMemo(
    () => new Set([...guesses.map((g) => g.guess.id), ...pendingIds]),
    [guesses, pendingIds],
  );
  const winner = guesses.find((g) => g.solved);

  if (load.state === "loading") {
    return <Shell><p className="status">Loading today's puzzle…</p></Shell>;
  }
  if (load.state === "error") {
    return <Shell><p className="status status--error" role="alert">{load.message}</p></Shell>;
  }

  const { puzzle, characters } = load;

  // Players type ahead: a pick made while an earlier guess is still being
  // checked joins a queue and is sent as soon as the one before it finishes,
  // so guesses are never dropped and always arrive in the order they were made.
  function guess(characterId: string) {
    setGuessError(undefined);
    setPendingIds((ids) => new Set([...ids, characterId]));
    queue.current = queue.current
      .then(() => sendGuess(characterId))
      .finally(() =>
        setPendingIds((ids) => {
          const rest = new Set(ids);
          rest.delete(characterId);
          return rest;
        }),
      );
  }

  async function sendGuess(characterId: string) {
    // A queued guess behind the last one (a win, or the final miss) has nothing left to do.
    const done = guessesRef.current.some((g) => g.solved) || answerRef.current !== undefined;
    if (done || guessesRef.current.length >= puzzle.maxGuesses) return;
    try {
      const { answer: revealed, guessNumber: _number, ...result } = await submitGuess(puzzle.date, characterId);
      const next = [result, ...guessesRef.current]; // newest guess on top
      setFreshId(result.guess.id);
      showGuesses(next);
      if (revealed) revealAnswer(revealed);
      if (user) {
        // Not awaited: the next queued guess shouldn't wait for the stats.
        fetchMyStats().then(setStats, () => undefined);
      }
      if (result.solved) refreshStandings();
    } catch (error) {
      setGuessError(error instanceof ApiError ? error.message : "Couldn't send that guess. Please try again.");
    }
  }

  async function signedIn(me: User) {
    setUser(me);
    setShowAuth(false);
    // Logging in moved this browser's guest guesses for today into the account.
    const [mine, myStats] = await Promise.all([fetchMyGuesses(), fetchMyStats()]);
    showGuesses(mine.guesses);
    revealAnswer(mine.answer);
    setStats(myStats);
    refreshStandings();
  }

  async function signOut() {
    await logOut().catch(() => undefined);
    setUser(null);
    setStats(undefined);
    showGuesses([]);
    revealAnswer(undefined);
    refreshStandings();
  }

  const account = user ? (
    <div className="account">
      <span className="account-name">{user.username}</span>
      {stats && stats.currentStreak > 0 && (
        <span className="streak" title={`${stats.currentStreak}-day streak`}>
          {stats.currentStreak}
          <span className="visually-hidden">-day streak</span>
        </span>
      )}
      <button type="button" className="link" onClick={signOut}>
        Log out
      </button>
    </div>
  ) : (
    <div className="account">
      <button type="button" className="button button--small" onClick={() => setShowAuth(true)}>
        Log in
      </button>
    </div>
  );

  const roundOver = winner ?? answer;

  return (
    <Shell date={puzzle.date} account={account}>
      <Modal open={showAuth && !user} onClose={() => setShowAuth(false)} label="Log in or sign up">
        <AuthPanel initialError={initialLoginError} onSignedIn={signedIn} onClose={() => setShowAuth(false)} />
      </Modal>

      {roundOver ? (
        <ResultCard
          outcome={winner ? "win" : "lost"}
          character={winner ? winner.guess : answer!}
          date={puzzle.date}
          guesses={guesses}
          maxGuesses={puzzle.maxGuesses}
          loggedIn={user !== null}
          stats={stats}
          onLogIn={() => setShowAuth(true)}
        />
      ) : (
        <section className="arena" aria-label="Make a guess">
          <HealthBar player={user ? user.username : "Guest"} used={guesses.length} max={puzzle.maxGuesses} />
          <GuessInput characters={characters} excludedIds={guessedIds} busy={pendingIds.size > 0} onGuess={guess} />
          {guessError && (
            <p className="status status--error" role="alert">
              {guessError}
            </p>
          )}
          {guesses.length === 0 && <Legend />}
        </section>
      )}

      <Board clues={puzzle.clues} guesses={guesses} freshId={freshId} />
      <Leaderboard version={standingsVersion} />
    </Shell>
  );
}

function Shell({ date, account, children }: { date?: string; account?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="topbar">
        <h1 className="logo">
          Dragon<span className="logo-punch">punched</span>le
        </h1>
        {account}
      </header>
      {date && (
        <p className="round">
          <span className="round-number">Round {puzzleNumber(date)}</span>
          <span className="round-date">{formatDate(date)}</span>
          <span className="round-tagline">Guess today's fighting game character</span>
        </p>
      )}
      <main>{children}</main>
      <footer className="footer">
        <p>Unofficial fan game. Characters and art belong to their owners.</p>
        <p>
          <a href="/privacy.html">Privacy</a> · <a href="/privacy.html#credits">Credits</a>
        </p>
      </footer>
    </div>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="How to read the tiles">
      <li>
        <span className="swatch tile--correct" /> Correct
      </li>
      <li>
        <span className="swatch tile--partial" /> Close: shared archetype, same continent, or a near number
      </li>
      <li>
        <span className="swatch tile--wrong" /> Not it
      </li>
      <li>
        <span className="swatch-arrow" aria-hidden="true">
          ▲▼
        </span>{" "}
        The answer is higher or lower
      </li>
    </ul>
  );
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
