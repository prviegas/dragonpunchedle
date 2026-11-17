import type { Character, GuessResult, PlayerStats } from "./api";
import { Countdown } from "./Countdown";
import { FirstSolveBadge } from "./FirstSolveBadge";
import { Portrait } from "./Portrait";
import { ResultsChart } from "./ResultsChart";
import { ShareButton } from "./ShareButton";
import { StatsPanel } from "./StatsPanel";

interface ResultCardProps {
  outcome: "win" | "lost";
  /** The day's character: the winning guess, or the answer revealed on a K.O. */
  character: Character;
  date: string;
  guesses: GuessResult[];
  maxGuesses: number;
  loggedIn: boolean;
  stats?: PlayerStats;
  /** This account was the day's first logged-in solver. */
  firstSolve?: boolean;
  onLogIn: () => void;
}

/** The end of a round, like a fighting game's victory screen. */
export function ResultCard({ outcome, character, date, guesses, maxGuesses, loggedIn, stats, firstSolve = false, onLogIn }: ResultCardProps) {
  const won = outcome === "win";
  const banner = !won ? "K.O." : guesses.length === 1 ? "Perfect!" : "You win!";

  return (
    <section className={won ? "result" : "result is-lost"} aria-labelledby="result-banner">
      <h2 id="result-banner" className="result-banner">
        {banner}
      </h2>

      <div className="result-body">
        <Portrait character={character} />

        <div className="result-text">
          <p className="result-kicker">{won ? "Today's fighter" : "It was"}</p>
          <p className="result-name">{character.name}</p>
          <p className="result-meta">
            {character.franchise} · since {character.debutYear}
          </p>
          {!won && <p className="result-score">Out of guesses.</p>}
          {won && firstSolve && (
            <p className="result-tags">
              <FirstSolveBadge large />
            </p>
          )}
          <p className="result-next">
            <Countdown date={date} />
          </p>
          <ShareButton date={date} guesses={guesses} maxGuesses={maxGuesses} firstSolve={won && firstSolve} />
        </div>
      </div>

      <ResultsChart maxGuesses={maxGuesses} mine={won ? guesses.length : "lost"} />

      {loggedIn && stats ? (
        <StatsPanel stats={stats} />
      ) : (
        !loggedIn && (
          <p className="result-cta">
            <button type="button" className="link" onClick={onLogIn}>
              Log in or sign up
            </button>{" "}
            to keep a streak and appear on the leaderboards.
          </p>
        )
      )}
    </section>
  );
}
