import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchCharacters,
  fetchPuzzle,
  submitGuess,
  type CharacterSummary,
  type GuessResult,
  type Puzzle,
} from "./api";
import { Board } from "./Board";
import { GuessInput } from "./GuessInput";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; puzzle: Puzzle; characters: CharacterSummary[] };

// Today's guesses are kept in this browser so a refresh doesn't lose them.
// Storage can be unavailable (private windows, blocked site data), so every
// access is wrapped and the game still works without it.
const storageKey = (date: string) => `dragonpunchedle:guesses:${date}`;

function loadGuesses(date: string): GuessResult[] {
  try {
    const saved = localStorage.getItem(storageKey(date));
    return saved ? (JSON.parse(saved) as GuessResult[]) : [];
  } catch {
    return [];
  }
}

function saveGuesses(date: string, guesses: GuessResult[]) {
  try {
    localStorage.setItem(storageKey(date), JSON.stringify(guesses));
  } catch {
    // Not saved; the game carries on.
  }
}

export function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [guesses, setGuesses] = useState<GuessResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [guessError, setGuessError] = useState<string>();

  useEffect(() => {
    Promise.all([fetchPuzzle(), fetchCharacters()])
      .then(([puzzle, characters]) => {
        setGuesses(loadGuesses(puzzle.date));
        setLoad({ state: "ready", puzzle, characters });
      })
      .catch((error: unknown) =>
        setLoad({
          state: "error",
          message: error instanceof ApiError ? error.message : "Couldn't reach the server. Please try again.",
        }),
      );
  }, []);

  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.guess.id)), [guesses]);
  const winner = guesses.find((g) => g.solved);

  if (load.state === "loading") {
    return <Shell><p className="status">Loading today's puzzle…</p></Shell>;
  }
  if (load.state === "error") {
    return <Shell><p className="status status--error" role="alert">{load.message}</p></Shell>;
  }

  const { puzzle, characters } = load;

  async function guess(characterId: string) {
    setSubmitting(true);
    setGuessError(undefined);
    try {
      const result = await submitGuess(puzzle.date, characterId);
      const next = [result, ...guesses]; // newest guess on top
      setGuesses(next);
      saveGuesses(puzzle.date, next);
    } catch (error) {
      setGuessError(error instanceof ApiError ? error.message : "Couldn't send that guess. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell date={puzzle.date}>
      {winner ? (
        <section className="win" aria-live="polite">
          <p className="win-title">Hard read!</p>
          <p>
            It was <strong>{winner.guess.name}</strong> ({winner.guess.franchise}), in {guesses.length}{" "}
            {guesses.length === 1 ? "guess" : "guesses"}. A new character arrives tomorrow.
          </p>
        </section>
      ) : (
        <>
          <GuessInput characters={characters} excludedIds={guessedIds} busy={submitting} onGuess={guess} />
          {guessError && <p className="status status--error" role="alert">{guessError}</p>}
          {guesses.length === 0 && <Legend />}
        </>
      )}
      <Board clues={puzzle.clues} guesses={guesses} />
    </Shell>
  );
}

function Shell({ date, children }: { date?: string; children: ReactNode }) {
  return (
    <main className="page">
      <header className="masthead">
        <h1 className="logo">Dragonpunchedle</h1>
        <p className="tagline">
          Guess today's fighting game character.
          {date && <span className="date"> {formatDate(date)}</span>}
        </p>
      </header>
      {children}
    </main>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="How to read the tiles">
      <li><span className="swatch tile--correct" /> Correct</li>
      <li><span className="swatch tile--partial" /> Close: shared archetype, same continent, or a near number</li>
      <li><span className="swatch tile--wrong" /> Not it</li>
      <li><span className="swatch-arrow" aria-hidden="true">↑↓</span> The answer is higher or lower</li>
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
