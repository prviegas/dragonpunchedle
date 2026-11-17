import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  fetchArcade,
  fetchArcadeLeaderboard,
  giveUpArcade,
  startArcade,
  submitArcadeGuess,
  type ArcadeLadderEntry,
  type ArcadeState,
  type CharacterSummary,
} from "./api";
import { buildArcadeShare, comboOf, nextRank, rankFor } from "./arcadeRules";
import { Board } from "./Board";
import { GuessInput } from "./GuessInput";
import { HealthBar } from "./HealthBar";

/** How long the K.O. stamp holds before the next opponent steps in. */
const KO_MS = 1400;
/** How long "FLOOR 3 · FIGHT!" stays up at the start of a floor. */
const SPLASH_MS = 1100;

interface ArcadeProps {
  characters: readonly CharacterSummary[];
  playerName: string | null;
  onLogIn: () => void;
}

/**
 * Arcade Ladder: endless rounds against random fighters, one floor each,
 * until a floor is lost. Separate from the daily round in every way.
 */
export function Arcade({ characters, playerName, onLogIn }: ArcadeProps) {
  const [state, setState] = useState<ArcadeState>();
  const [error, setError] = useState<string>();
  const [freshId, setFreshId] = useState<string>();
  // The floor-start announcement, keyed so the same text can play again.
  const [splash, setSplash] = useState<{ floor: number; key: number }>();
  // The K.O. stamp over the board, with who just went down.
  const [ko, setKoState] = useState<string>();
  // Also as a ref: queued guesses check it after renders they started before.
  const koRef = useRef<string>(undefined);
  const setKo = (who: string | undefined) => {
    koRef.current = who;
    setKoState(who);
  };
  const [leaderboardVersion, setLeaderboardVersion] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stateRef = useRef<ArcadeState>(undefined);
  const show = (next: ArcadeState) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    fetchArcade().then(show, () => setError("Couldn't load the arcade. Please try again."));
  }, [playerName]);

  // Clear the announcement and the stamp after their moment.
  useEffect(() => {
    if (!splash) return;
    const timer = setTimeout(() => setSplash(undefined), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [splash]);

  const run = state?.run;
  const playing = run && !run.over;
  const guessedIds = useMemo(() => new Set(run?.guesses.map((g) => g.guess.id) ?? []), [run]);

  async function start() {
    setError(undefined);
    try {
      const next = await startArcade();
      show(next);
      setSplash({ floor: 1, key: Date.now() });
    } catch {
      setError("Couldn't start a run. Please try again.");
    }
  }

  // Give up: the run ends on this floor, like losing it, and goes to Game Over.
  async function giveUp() {
    setError(undefined);
    try {
      floorRound.current++; // anything still queued was for this floor
      show(await giveUpArcade());
      setLeaderboardVersion((v) => v + 1);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't give up. Please try again.");
    }
  }

  // Which floor a pick was made on. A pick made while the K.O. plays, or typed
  // ahead before the winning guess came back, was meant for the floor that
  // just ended: it's dropped, never carried onto the next opponent.
  const floorRound = useRef(0);

  function guess(characterId: string) {
    if (koRef.current) return;
    const round = floorRound.current;
    queue.current = queue.current.then(() => (round === floorRound.current ? sendGuess(characterId) : undefined));
  }

  async function sendGuess(characterId: string) {
    const current = stateRef.current;
    if (!current?.run || current.run.over || koRef.current) return;
    setError(undefined);
    try {
      const { answer, floor: _floor, guessNumber: _n, runOver, ...result } = await submitArcadeGuess(characterId);
      setFreshId(result.guess.id);
      const run = { ...current.run, guesses: [result, ...current.run.guesses] };

      if (result.solved) {
        floorRound.current++; // anything picked from here on was for the floor that just ended
        // K.O.: the beaten fighter joins the ladder, then the next one steps in.
        const cleared = [
          ...run.cleared,
          { floor: run.floor, guesses: run.guesses.length, character: result.guess },
        ];
        // The ladder moves up at once; the board keeps the winning row under the stamp.
        show({ ...current, run: { ...run, cleared, floorsCleared: cleared.length, floor: run.floor + 1 } });
        setKo(result.guess.name);
        await new Promise((resolve) => setTimeout(resolve, KO_MS));
        setKo(undefined);
        const next = await fetchArcade();
        show(next);
        setFreshId(undefined);
        if (next.run && !next.run.over) setSplash({ floor: next.run.floor, key: Date.now() });
        else setLeaderboardVersion((v) => v + 1);
      } else if (runOver) {
        show({ ...current, best: Math.max(current.best, run.floorsCleared), run: { ...run, over: true, answer } });
        setLeaderboardVersion((v) => v + 1);
      } else {
        show({ ...current, run });
      }
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't send that guess. Please try again.");
    }
  }

  if (!state) {
    return <p className="status">{error ?? "Loading the arcade…"}</p>;
  }

  const combo = run ? comboOf(run.cleared) : 0;
  const rank = rankFor(run?.floorsCleared ?? 0);
  const upcoming = run ? nextRank(run.floorsCleared) : null;

  return (
    <section className="arcade" aria-labelledby="arcade-title">
      <p className="history-nav">
        <a href="#">← Back to today's round</a>
      </p>

      <div className="arcade-layout">
        <div className={ko ? "arcade-stage is-hit" : "arcade-stage"}>
          <header className="arcade-head">
            <h2 id="arcade-title" className="arcade-title">
              {playing ? (
                <>
                  Floor{" "}
                  <span className="arcade-floor" key={run.floor}>
                    {run.floor}
                  </span>
                </>
              ) : (
                "Arcade"
              )}
            </h2>
            {playing && (
              <p className="arcade-meta">
                <span className="arcade-rank">{rank}</span>
                {combo >= 2 && (
                  <span className="combo" key={combo}>
                    {combo} hit combo
                  </span>
                )}
              </p>
            )}
          </header>

          {!run ? (
            <Intro best={state.best} maxGuesses={state.maxGuesses} onStart={start} />
          ) : run.over ? (
            <GameOver
              floorsCleared={run.floorsCleared}
              best={state.best}
              share={buildArcadeShare(run.cleared, run.answer !== undefined, `${window.location.origin}/#arcade`)}
              loggedIn={playerName !== null}
              onLogIn={onLogIn}
              onAgain={start}
            />
          ) : (
            <div className="arcade-play">
              <HealthBar player={playerName ?? "Guest"} used={run.guesses.length} max={state.maxGuesses} />
              <GuessInput characters={characters} excludedIds={guessedIds} busy={ko !== undefined} onGuess={guess} />
              <div className="arcade-under">
                <p className="arcade-next">
                  {upcoming
                    ? `${upcoming.floorsLeft} more ${upcoming.floorsLeft === 1 ? "floor" : "floors"} to ${upcoming.name}`
                    : "Top title reached"}
                </p>
                <GiveUp onGiveUp={giveUp} disabled={ko !== undefined} />
              </div>
            </div>
          )}

          {error && (
            <p className="status status--error" role="alert">
              {error}
            </p>
          )}

          {/* The moments: the floor announcement and the K.O. stamp. Screen readers get the words. */}
          {splash && (
            <div className="arcade-splash" key={splash.key} role="status">
              <span className="arcade-splash-floor">Floor {splash.floor}</span>
              <span className="arcade-splash-fight">Fight!</span>
            </div>
          )}
          {ko && (
            <div className="arcade-ko" role="status">
              <span className="arcade-ko-stamp">K.O.</span>
              <span className="arcade-ko-who">{ko} is down</span>
            </div>
          )}
        </div>

        {run && <Ladder run={run} />}
      </div>

      {/* Full page width, like the daily board: inside the panel its 9 columns would overflow. */}
      {run && (run.guesses.length > 0 || run.over) && (
        <div className="arcade-board">
          <Board clues={state.clues} guesses={run.guesses} freshId={freshId} answer={run.over ? run.answer : undefined} />
        </div>
      )}

      <ArcadeLeaderboard version={leaderboardVersion} />
    </section>
  );
}

/** A quiet "Give up" that asks once, so a stray click can't throw a run away. */
function GiveUp({ onGiveUp, disabled }: { onGiveUp: () => void; disabled: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="link link--quiet arcade-giveup" onClick={() => setAsking(true)} disabled={disabled}>
        Give up
      </button>
    );
  }
  return (
    <span className="arcade-giveup">
      End this run?{" "}
      <button type="button" className="link" onClick={onGiveUp}>
        Yes, give up
      </button>{" "}
      <button type="button" className="link link--quiet" onClick={() => setAsking(false)}>
        Keep fighting
      </button>
    </span>
  );
}

function Intro({ best, maxGuesses, onStart }: { best: number; maxGuesses: number; onStart: () => void }) {
  return (
    <div className="arcade-intro">
      <p className="arcade-pitch">
        Climb the ladder. Every floor is a random fighter and {maxGuesses} guesses. Win and the next one steps in; lose
        one and the run is over.
      </p>
      <ul className="arcade-rules">
        <li>Solve in 3 or fewer to build a combo.</li>
        <li>Titles from Rookie to Final Boss.</li>
        <li>Doesn't touch your daily streak.</li>
      </ul>
      <button type="button" className="button arcade-start" onClick={onStart}>
        Insert coin
      </button>
      {best > 0 && <p className="arcade-best">Your best: floor {best}</p>}
    </div>
  );
}

function GameOver({
  floorsCleared,
  best,
  share,
  loggedIn,
  onLogIn,
  onAgain,
}: {
  floorsCleared: number;
  best: number;
  share: string;
  loggedIn: boolean;
  onLogIn: () => void;
  onAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const newBest = floorsCleared > 0 && floorsCleared >= best;

  async function copy() {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ text: share });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Nothing to copy to: the button just does nothing.
    }
  }

  return (
    <div className="arcade-over">
      <p className="arcade-over-title">Game over</p>
      <p className="arcade-over-score">
        <span className="arcade-over-floors">{floorsCleared}</span>
        <span>
          {floorsCleared === 1 ? "floor" : "floors"} cleared · <strong>{rankFor(floorsCleared)}</strong>
        </span>
      </p>
      {newBest ? <p className="arcade-best is-new">New best!</p> : <p className="arcade-best">Your best: floor {best}</p>}
      <div className="arcade-over-actions">
        <button type="button" className="button" onClick={onAgain}>
          Continue? Play again
        </button>
        <button type="button" className="button button--ghost" onClick={copy}>
          {copied ? "Copied!" : "Share run"}
        </button>
      </div>
      {!loggedIn && (
        <p className="arcade-cta">
          <button type="button" className="link" onClick={onLogIn}>
            Log in
          </button>{" "}
          to put your runs on the ladder board.
        </p>
      )}
    </div>
  );
}

/** The tower: the next opponents locked above, the current one lit, the beaten ones below. */
function Ladder({ run }: { run: NonNullable<ArcadeState["run"]> }) {
  const beaten = [...run.cleared].reverse().slice(0, 8);
  const hidden = run.cleared.length - beaten.length;
  return (
    <aside className="ladder" aria-label="Ladder">
      <ol className="ladder-floors">
        {!run.over &&
          [2, 1].map((ahead) => (
            <li key={`ahead-${ahead}`} className="ladder-floor is-locked" aria-hidden="true">
              <span className="ladder-number">{run.floor + ahead}</span>
              <span className="ladder-slot">?</span>
            </li>
          ))}
        <li className={run.over ? "ladder-floor is-lost" : "ladder-floor is-current"}>
          <span className="ladder-number">{run.floor}</span>
          {run.over && run.answer ? (
            <>
              <LadderThumb name={run.answer.name} url={run.answer.portrait?.url} />
              <span className="ladder-name">{run.answer.name}</span>
            </>
          ) : (
            <>
              <span className="ladder-slot">?</span>
              <span className="ladder-name">{run.over ? "" : "Now fighting"}</span>
            </>
          )}
        </li>
        {beaten.map((floor) => (
          <li key={floor.floor} className="ladder-floor is-beaten">
            <span className="ladder-number">{floor.floor}</span>
            <LadderThumb name={floor.character.name} url={floor.character.portrait?.url} />
            <span className="ladder-name">{floor.character.name}</span>
            <span className="ladder-guesses" title={`${floor.guesses} ${floor.guesses === 1 ? "guess" : "guesses"}`}>
              {floor.guesses}
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="ladder-more">+{hidden} more below</li>}
      </ol>
    </aside>
  );
}

function LadderThumb({ name, url }: { name: string; url?: string }) {
  return url ? (
    <img className="ladder-thumb" src={url} alt="" width={30} height={40} loading="lazy" />
  ) : (
    <span className="ladder-thumb ladder-thumb--empty" aria-hidden="true">
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")}
    </span>
  );
}

function ArcadeLeaderboard({ version }: { version: number }) {
  const [board, setBoard] = useState<{ top: ArcadeLadderEntry[]; you?: ArcadeLadderEntry }>();
  useEffect(() => {
    fetchArcadeLeaderboard().then(setBoard, () => undefined);
  }, [version]);
  if (!board) return null;
  const rows = [...board.top, ...(board.you ? [board.you] : [])];
  return (
    <section className="leaderboard arcade-leaderboard" aria-labelledby="arcade-board-title">
      <div className="leaderboard-head">
        <h2 id="arcade-board-title">Ladder board</h2>
      </div>
      {rows.length === 0 ? (
        <p className="status">Nobody has cleared a floor yet. Be the first!</p>
      ) : (
        <ol className="ranking">
          {rows.map((row) => (
            <li key={row.username} className={row.you ? "is-you" : undefined}>
              <span className="rank">{row.rank}</span>
              <span className="player">
                {row.username}
                {row.you && <span className="you-tag"> (you)</span>}
              </span>
              <span className="score">
                Floor {row.floor} · {rankFor(row.floor)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
