import { useEffect, useMemo, useRef, useState } from "react";
import { FirstSolveBadge } from "./FirstSolveBadge";
import {
  ApiError,
  fetchHistory,
  fetchPastDay,
  revealPastDay,
  submitGuess,
  type CharacterSummary,
  type PastDay,
  type PastRound,
} from "./api";
import { Board } from "./Board";
import { GuessInput } from "./GuessInput";
import { HealthBar } from "./HealthBar";
import { Portrait } from "./Portrait";
import { ResultsChart } from "./ResultsChart";
import { percentSolved } from "./results";
import { LAUNCH_DATE, puzzleNumber } from "./share";

/** Where each view lives in the address, so the browser's back button works. */
export const HISTORY_HASH = "#past";
export const dayHash = (date: string) => `${HISTORY_HASH}/${date}`;

type Outcome =
  | { kind: "solved"; guesses: number }
  | { kind: "lost" }
  | { kind: "revealed" }
  | { kind: "unfinished"; guesses: number }
  | { kind: "skipped" };

function outcomeOf(round: { guesses: number; solved: boolean; revealed: boolean }, maxGuesses: number): Outcome {
  if (round.solved) return { kind: "solved", guesses: round.guesses };
  if (round.guesses >= maxGuesses) return { kind: "lost" };
  if (round.revealed) return { kind: "revealed" };
  if (round.guesses > 0) return { kind: "unfinished", guesses: round.guesses };
  return { kind: "skipped" };
}

function outcomeText(outcome: Outcome): string {
  switch (outcome.kind) {
    case "solved":
      return outcome.guesses === 1 ? "Perfect" : `Solved in ${outcome.guesses}`;
    case "lost":
      return "K.O.";
    case "revealed":
      return "Answer shown";
    case "unfinished":
      return `Continue · ${outcome.guesses} used`;
    case "skipped":
      return "Play";
  }
}

/**
 * When the round was finished: on its own day (it counts), or later (it
 * doesn't). Showing the answer always happens later. A round still open has
 * no tag yet.
 */
function whenPlayed(
  round: { guesses: number; solved: boolean; late: boolean; revealed: boolean },
  maxGuesses: number,
): "on-day" | "later" | undefined {
  if (round.solved || round.guesses >= maxGuesses) return round.late ? "later" : "on-day";
  return round.revealed ? "later" : undefined;
}

const WHEN_TEXT = { "on-day": "On the day", later: "Played later" } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

export function formatDay(date: string, style: "long" | "short" = "long"): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
    timeZone: "UTC",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    ...(style === "long" && { year: "numeric" }),
  });
}

interface HistoryProps {
  /** Set: one day. Otherwise the list of every finished round. */
  date?: string;
  characters: readonly CharacterSummary[];
  playerName: string | null;
  onLogIn: () => void;
}

export function History({ date, characters, playerName, onLogIn }: HistoryProps) {
  return (
    <section className="history" aria-labelledby="history-title">
      <p className="history-nav">
        {date ? <a href={HISTORY_HASH}>← All past rounds</a> : <a href="#">← Back to today's round</a>}
      </p>
      {date ? (
        <PastDayView date={date} characters={characters} playerName={playerName} />
      ) : (
        <RoundList loggedIn={playerName !== null} onLogIn={onLogIn} />
      )}
    </section>
  );
}

function RoundList({ loggedIn, onLogIn }: { loggedIn: boolean; onLogIn: () => void }) {
  const [data, setData] = useState<{ maxGuesses: number; rounds: PastRound[] }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetchHistory().then(
      (result) => current && setData(result),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [loggedIn]);

  // Days before launch were the test run, wiped before release.
  const rounds = data?.rounds.filter((round) => round.date >= LAUNCH_DATE);
  const onDay = rounds?.filter((round) => round.guesses > 0 && !round.late) ?? [];

  return (
    <>
      <div className="history-head">
        <h2 id="history-title" className="history-title">
          Past rounds
        </h2>
        {rounds && rounds.length > 0 && (
          <p className="history-summary">
            Solved on the day: {onDay.filter((round) => round.solved).length} of {rounds.length}
          </p>
        )}
      </div>

      <p className="history-note">
        Missed a day? Play it here. Rounds played later stay in your history but don't count toward that day's
        results or your streak.
        {!loggedIn && (
          <>
            {" "}
            As a guest, your rounds are kept in this browser for 30 days.{" "}
            <button type="button" className="link" onClick={onLogIn}>
              Log in
            </button>{" "}
            to keep them for good.
          </>
        )}
      </p>

      {failed ? (
        <p className="status">Couldn't load past rounds.</p>
      ) : !rounds || !data ? (
        <p className="status">Loading…</p>
      ) : rounds.length === 0 ? (
        <p className="status">No finished rounds yet. Come back tomorrow to see today's answer.</p>
      ) : (
        <ol className="rounds">
          {rounds.map((round) => {
            const outcome = outcomeOf(round, data.maxGuesses);
            const when = whenPlayed(round, data.maxGuesses);
            const { answer } = round;
            return (
              <li key={round.date}>
                <a className="round-link" href={dayHash(round.date)}>
                  {answer?.portraitUrl ? (
                    <img className="thumb" src={answer.portraitUrl} alt="" width={36} height={48} loading="lazy" />
                  ) : (
                    <span className="thumb thumb--empty" aria-hidden="true">
                      {answer ? initials(answer.name) : "?"}
                    </span>
                  )}
                  <span className="round-link-text">
                    <span className="round-link-when">
                      Round {puzzleNumber(round.date)} · {formatDay(round.date, "short")}
                    </span>
                    {answer ? (
                      <>
                        <span className="guess-title">{answer.name}</span>
                        <span className="guess-franchise">{answer.franchise}</span>
                      </>
                    ) : (
                      <span className="guess-title is-hidden">Hidden until you finish</span>
                    )}
                  </span>
                  <span className="round-link-result">
                    {round.firstSolve && <FirstSolveBadge />}
                    <span className={`outcome outcome--${outcome.kind}`}>{outcomeText(outcome)}</span>
                    {when && <span className={`when when--${when}`}>{WHEN_TEXT[when]}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function PastDayView({
  date,
  characters,
  playerName,
}: {
  date: string;
  characters: readonly CharacterSummary[];
  playerName: string | null;
}) {
  const [day, setDayState] = useState<PastDay>();
  const [error, setError] = useState<string>();
  const [guessError, setGuessError] = useState<string>();
  const [freshId, setFreshId] = useState<string>();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmReveal, setConfirmReveal] = useState(false);
  // The latest day, for queued guesses that started before the last render.
  const dayRef = useRef<PastDay>(undefined);
  const setDay = (next: PastDay | undefined) => {
    dayRef.current = next;
    setDayState(next);
  };
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let current = true;
    setDay(undefined);
    setError(undefined);
    setConfirmReveal(false);
    fetchPastDay(date).then(
      (result) => current && setDay(result),
      (failure: unknown) =>
        current && setError(failure instanceof ApiError ? failure.message : "Couldn't load that round."),
    );
    return () => {
      current = false;
    };
  }, [date]);

  const guessedIds = useMemo(
    () => new Set([...(day?.guesses.map((g) => g.guess.id) ?? []), ...pendingIds]),
    [day, pendingIds],
  );

  const heading = (
    <h2 id="history-title" className="history-title">
      Round {puzzleNumber(date)} <span className="history-date">{formatDay(date)}</span>
    </h2>
  );

  if (error || !day) {
    return (
      <>
        {heading}
        <p className="status">{error ?? "Loading…"}</p>
      </>
    );
  }

  // Same type-ahead queue as today's round: picks wait their turn, never dropped.
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
    const current = dayRef.current;
    if (!current || current.answer || current.guesses.length >= current.maxGuesses) return;
    try {
      const { answer: revealed, guessNumber: _number, ...result } = await submitGuess(date, characterId);
      setFreshId(result.guess.id);
      if (result.solved || revealed) {
        // The round just ended: fetch it whole, with the answer and the day's results.
        setDay(await fetchPastDay(date));
      } else {
        setDay({ ...current, late: true, guesses: [result, ...current.guesses] });
      }
    } catch (failure) {
      setGuessError(failure instanceof ApiError ? failure.message : "Couldn't send that guess. Please try again.");
    }
  }

  async function reveal() {
    try {
      setDay(await revealPastDay(date));
    } catch (failure) {
      setGuessError(failure instanceof ApiError ? failure.message : "Couldn't show the answer. Please try again.");
    }
  }

  const { answer, results, guesses, maxGuesses } = day;
  const solved = guesses.some((g) => g.solved);
  const outcome = outcomeOf({ guesses: guesses.length, solved, revealed: day.revealed }, maxGuesses);
  const when = whenPlayed({ guesses: guesses.length, solved, late: day.late, revealed: day.revealed }, maxGuesses);
  const startedOnDay = guesses.length > 0 && !day.late;

  if (!answer) {
    // Still open for this player: play it.
    return (
      <>
        {heading}
        <section className="arena" aria-label="Make a guess">
          <p className="late-note">
            {startedOnDay ? "You started this round on the day. " : ""}
            Playing it now counts in your history, not in that day's results or your streak.
          </p>
          <HealthBar player={playerName ?? "Guest"} used={guesses.length} max={maxGuesses} />
          <GuessInput characters={characters} excludedIds={guessedIds} busy={pendingIds.size > 0} onGuess={guess} />
          {guessError && (
            <p className="status status--error" role="alert">
              {guessError}
            </p>
          )}
          <p className="reveal">
            {confirmReveal ? (
              <>
                This ends the round: no more guesses after seeing it.{" "}
                <button type="button" className="link" onClick={reveal}>
                  Show it
                </button>{" "}
                ·{" "}
                <button type="button" className="link" onClick={() => setConfirmReveal(false)}>
                  Keep playing
                </button>
              </>
            ) : (
              <button type="button" className="link link--quiet" onClick={() => setConfirmReveal(true)}>
                Give up and show the answer
              </button>
            )}
          </p>
        </section>
        <Board clues={day.clues} guesses={guesses} freshId={freshId} />
      </>
    );
  }

  const finished = outcome.kind === "solved" || outcome.kind === "lost";

  return (
    <>
      {heading}
      <div className={solved ? "result past-result" : "result past-result is-lost"}>
        <div className="result-body">
          <Portrait character={answer} />
          <div className="result-text">
            <p className="result-kicker">The fighter was</p>
            <p className="result-name">{answer.name}</p>
            <p className="result-meta">
              {answer.franchise} · since {answer.debutYear}
            </p>
            <p className="result-tags">
              <span className={`outcome outcome--${outcome.kind} outcome--large`}>{outcomeText(outcome)}</span>
              {day.firstSolve && <FirstSolveBadge large />}
              {when && <span className={`when when--${when}`}>{WHEN_TEXT[when]}</span>}
            </p>
          </div>
        </div>

        {finished && results ? (
          <ResultsChart maxGuesses={maxGuesses} mine={outcome.kind === "lost" ? "lost" : guesses.length} pastResults={results} />
        ) : (
          results && (
            <p className="result-cta">
              {results.players === 0
                ? "Nobody finished this round on the day."
                : `${results.players} ${results.players === 1 ? "player" : "players"} finished it on the day; ${percentSolved(results)}% solved it.`}
            </p>
          )
        )}
      </div>

      {/* A win already shows the answer in its own winning row. */}
      <Board clues={day.clues} guesses={guesses} freshId={freshId} answer={solved ? undefined : answer} />
    </>
  );
}
