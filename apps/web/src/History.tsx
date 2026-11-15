import { useEffect, useState } from "react";
import { ApiError, fetchHistory, fetchPastDay, type PastDay, type PastRound } from "./api";
import { Board } from "./Board";
import { Portrait } from "./Portrait";
import { ResultsChart } from "./ResultsChart";
import { percentSolved } from "./results";
import { LAUNCH_DATE, puzzleNumber } from "./share";

/** Where each view lives in the address, so the browser's back button works. */
export const HISTORY_HASH = "#past";
export const dayHash = (date: string) => `${HISTORY_HASH}/${date}`;

type Outcome = { kind: "solved"; guesses: number } | { kind: "lost" } | { kind: "unfinished"; guesses: number } | { kind: "skipped" };

function outcomeOf(guesses: number, solved: boolean, maxGuesses: number): Outcome {
  if (solved) return { kind: "solved", guesses };
  if (guesses >= maxGuesses) return { kind: "lost" };
  if (guesses > 0) return { kind: "unfinished", guesses };
  return { kind: "skipped" };
}

function outcomeText(outcome: Outcome): string {
  switch (outcome.kind) {
    case "solved":
      return outcome.guesses === 1 ? "Perfect" : `Solved in ${outcome.guesses}`;
    case "lost":
      return "K.O.";
    case "unfinished":
      return `Gave up after ${outcome.guesses}`;
    case "skipped":
      return "Didn't play";
  }
}

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

/** `date` set: one day in full. Otherwise the list of every finished round. */
export function History({ date, loggedIn, onLogIn }: { date?: string; loggedIn: boolean; onLogIn: () => void }) {
  return (
    <section className="history" aria-labelledby="history-title">
      <p className="history-nav">
        {date ? <a href={HISTORY_HASH}>← All past rounds</a> : <a href="#">← Back to today's round</a>}
      </p>
      {date ? <PastDayView date={date} /> : <RoundList loggedIn={loggedIn} onLogIn={onLogIn} />}
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
  const played = rounds?.filter((round) => round.guesses > 0).length ?? 0;
  const solved = rounds?.filter((round) => round.solved).length ?? 0;

  return (
    <>
      <div className="history-head">
        <h2 id="history-title" className="history-title">
          Past rounds
        </h2>
        {rounds && rounds.length > 0 && (
          <p className="history-summary">
            Solved {solved} of {rounds.length}
            {played < rounds.length && ` · missed ${rounds.length - played}`}
          </p>
        )}
      </div>

      {!loggedIn && (
        <p className="history-note">
          As a guest, your past rounds are kept in this browser for 30 days.{" "}
          <button type="button" className="link" onClick={onLogIn}>
            Log in
          </button>{" "}
          to keep them for good.
        </p>
      )}

      {failed ? (
        <p className="status">Couldn't load past rounds.</p>
      ) : !rounds || !data ? (
        <p className="status">Loading…</p>
      ) : rounds.length === 0 ? (
        <p className="status">No finished rounds yet. Come back tomorrow to see today's answer.</p>
      ) : (
        <ol className="rounds">
          {rounds.map((round) => {
            const outcome = outcomeOf(round.guesses, round.solved, data.maxGuesses);
            return (
              <li key={round.date}>
                <a className="round-link" href={dayHash(round.date)}>
                  {round.answer.portraitUrl ? (
                    <img className="thumb" src={round.answer.portraitUrl} alt="" width={36} height={48} loading="lazy" />
                  ) : (
                    <span className="thumb thumb--empty" aria-hidden="true">
                      {initials(round.answer.name)}
                    </span>
                  )}
                  <span className="round-link-text">
                    <span className="round-link-when">
                      Round {puzzleNumber(round.date)} · {formatDay(round.date, "short")}
                    </span>
                    <span className="guess-title">{round.answer.name}</span>
                    <span className="guess-franchise">{round.answer.franchise}</span>
                  </span>
                  <span className={`outcome outcome--${outcome.kind}`}>{outcomeText(outcome)}</span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function PastDayView({ date }: { date: string }) {
  const [day, setDay] = useState<PastDay>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setDay(undefined);
    setError(undefined);
    fetchPastDay(date).then(
      (result) => current && setDay(result),
      (failure: unknown) =>
        current && setError(failure instanceof ApiError ? failure.message : "Couldn't load that round."),
    );
    return () => {
      current = false;
    };
  }, [date]);

  const heading = (
    <h2 id="history-title" className="history-title">
      Round {puzzleNumber(date)} <span className="history-date">{formatDay(date)}</span>
    </h2>
  );

  if (error) {
    return (
      <>
        {heading}
        <p className="status">{error}</p>
      </>
    );
  }
  if (!day) {
    return (
      <>
        {heading}
        <p className="status">Loading…</p>
      </>
    );
  }

  const { answer, guesses, results, maxGuesses } = day;
  const solved = guesses.some((g) => g.solved);
  const outcome = outcomeOf(guesses.length, solved, maxGuesses);
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
            <p className={`outcome outcome--${outcome.kind} outcome--large`}>{outcomeText(outcome)}</p>
          </div>
        </div>

        {finished ? (
          <ResultsChart maxGuesses={maxGuesses} mine={outcome.kind === "lost" ? "lost" : guesses.length} pastResults={results} />
        ) : (
          <p className="result-cta">
            {results.players === 0
              ? "Nobody finished this round."
              : `${results.players} ${results.players === 1 ? "player" : "players"} finished it; ${percentSolved(results)}% solved it.`}
          </p>
        )}
      </div>

      {/* A win already shows the answer in its own winning row. */}
      <Board clues={day.clues} guesses={guesses} answer={solved ? undefined : answer} />
    </>
  );
}
