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
import {
  buildTowerShare,
  floorDanger,
  floorOmen,
  TOWER_NAME,
} from "./arcadeRules";
import { Board } from "./Board";
import { GuessInput } from "./GuessInput";
import { HealthBar } from "./HealthBar";

/** How long the K.O. stamp holds before the next opponent steps in. */
const KO_MS = 1400;

interface ArcadeProps {
  characters: readonly CharacterSummary[];
  playerName: string | null;
  onLogIn: () => void;
}

/**
 * Tower of Endless Struggle: endless rounds against random fighters, one floor each,
 * until a floor is lost. Separate from the daily round in every way.
 */
export function Arcade({ characters, playerName, onLogIn }: ArcadeProps) {
  const [state, setState] = useState<ArcadeState>();
  const [error, setError] = useState<string>();
  const [freshId, setFreshId] = useState<string>();
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
    fetchArcade().then(show, () =>
      setError("Couldn't load the tower. Please try again."),
    );
  }, [playerName]);

  const run = state?.run;
  const playing = run && !run.over;
  const guessedIds = useMemo(
    () => new Set(run?.guesses.map((g) => g.guess.id) ?? []),
    [run],
  );

  async function start() {
    setError(undefined);
    try {
      const next = await startArcade();
      show(next);
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
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Couldn't give up. Please try again.",
      );
    }
  }

  // Which floor a pick was made on. A pick made while the K.O. plays, or typed
  // ahead before the winning guess came back, was meant for the floor that
  // just ended: it's dropped, never carried onto the next opponent.
  const floorRound = useRef(0);

  function guess(characterId: string) {
    if (koRef.current) return;
    const round = floorRound.current;
    queue.current = queue.current.then(() =>
      round === floorRound.current ? sendGuess(characterId) : undefined,
    );
  }

  async function sendGuess(characterId: string) {
    const current = stateRef.current;
    if (!current?.run || current.run.over || koRef.current) return;
    setError(undefined);
    try {
      const {
        answer,
        floor: _floor,
        guessNumber: _n,
        runOver,
        ...result
      } = await submitArcadeGuess(characterId);
      setFreshId(result.guess.id);
      const run = { ...current.run, guesses: [result, ...current.run.guesses] };

      if (result.solved) {
        floorRound.current++; // anything picked from here on was for the floor that just ended
        // K.O.: the beaten fighter joins the ladder, then the next one steps in.
        const cleared = [
          ...run.cleared,
          {
            floor: run.floor,
            guesses: run.guesses.length,
            character: result.guess,
          },
        ];
        // The floor title stays put under the stamp; it climbs when the next fighter is loaded.
        show({
          ...current,
          run: { ...run, cleared, floorsCleared: cleared.length },
        });
        setKo(result.guess.name);
        await new Promise((resolve) => setTimeout(resolve, KO_MS));
        setKo(undefined);
        const next = await fetchArcade();
        show(next);
        setFreshId(undefined);
        if (!next.run || next.run.over) setLeaderboardVersion((v) => v + 1);
      } else if (runOver) {
        show({
          ...current,
          best: Math.max(current.best, run.floor),
          run: { ...run, over: true, answer },
        });
        setLeaderboardVersion((v) => v + 1);
      } else {
        show({ ...current, run });
      }
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Couldn't send that guess. Please try again.",
      );
    }
  }

  if (!state) {
    return <p className="status">{error ?? "Loading the arcade…"}</p>;
  }

  // How menacing the floor title and panel look: they darken toward blood red as the tower climbs.
  const danger = run ? floorDanger(run.floor) : 1;

  return (
    <section className="arcade" aria-labelledby="arcade-title">
      <p className="history-nav">
        <a href="#">← Back to today's round</a>
      </p>

      <div className="arcade-layout">
        <div className={`arcade-stage danger-${danger}${ko ? " is-hit" : ""}`}>
          <header className="arcade-head">
            {run ? (
              <FloorTitle floor={run.floor} />
            ) : (
              <h2 id="arcade-title" className="arcade-title">
                {TOWER_NAME}
              </h2>
            )}
          </header>

          {!run ? (
            <Intro
              best={state.best}
              maxGuesses={state.maxGuesses}
              onStart={start}
            />
          ) : run.over ? (
            <GameOver
              floorReached={run.floor}
              best={state.best}
              share={buildTowerShare(
                run.floor,
                run.cleared,
                run.answer !== undefined,
                `${window.location.origin}/#tower`,
              )}
              loggedIn={playerName !== null}
              onLogIn={onLogIn}
              onAgain={start}
            />
          ) : (
            <div className="arcade-play">
              <HealthBar
                player={playerName ?? "Guest"}
                used={run.guesses.length}
                max={state.maxGuesses}
              />
              <GuessInput
                characters={characters}
                excludedIds={guessedIds}
                busy={ko !== undefined}
                onGuess={guess}
              />
              <div className="arcade-under">
                <GiveUp onGiveUp={giveUp} disabled={ko !== undefined} />
              </div>
            </div>
          )}

          {error && (
            <p className="status status--error" role="alert">
              {error}
            </p>
          )}

          {/* The K.O. stamp. Screen readers get the words. */}
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
          <Board
            clues={state.clues}
            guesses={run.guesses}
            freshId={freshId}
            answer={run.over ? run.answer : undefined}
          />
        </div>
      )}

      <ArcadeLeaderboard version={leaderboardVersion} />
    </section>
  );
}

/**
 * "FLOOR 9" and its omen line. When the floor changes, the old title scrolls
 * up and out while the new one rises in from below, as if climbing the tower.
 * Its look comes from the floor's danger level (see floorDanger).
 */
function FloorTitle({ floor }: { floor: number }) {
  const [leaving, setLeaving] = useState<number>();
  const shown = useRef(floor);
  useEffect(() => {
    if (floor === shown.current) return;
    setLeaving(shown.current);
    shown.current = floor;
    const timer = setTimeout(() => setLeaving(undefined), 700);
    return () => clearTimeout(timer);
  }, [floor]);

  // The current floor's title is the page heading; the one scrolling away isn't.
  const block = (n: number, extra: string, heading: boolean) => {
    const Title = heading ? "h2" : "p";
    return (
      <div className={`floor-block danger-${floorDanger(n)} ${extra}`}>
        <Title
          id={heading ? "arcade-title" : undefined}
          className={`arcade-title danger-${floorDanger(n)}`}
        >
          Floor <span className="arcade-floor">{n}</span>
        </Title>
        <span className="floor-flourish" aria-hidden="true" />
        <p className="floor-omen">{floorOmen(n)}</p>
      </div>
    );
  };

  return (
    <div className="floor-roll">
      {leaving !== undefined && (
        <div aria-hidden="true">{block(leaving, "floor-roll-out", false)}</div>
      )}
      <div key={floor}>
        {block(floor, leaving !== undefined ? "floor-roll-in" : "", true)}
      </div>
    </div>
  );
}

/** A quiet "Give up" that asks once, so a stray click can't throw a run away. */
function GiveUp({
  onGiveUp,
  disabled,
}: {
  onGiveUp: () => void;
  disabled: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className="link link--quiet arcade-giveup"
        onClick={() => setAsking(true)}
        disabled={disabled}
      >
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
      <button
        type="button"
        className="link link--quiet"
        onClick={() => setAsking(false)}
      >
        Keep fighting
      </button>
    </span>
  );
}

function Intro({
  best,
  maxGuesses,
  onStart,
}: {
  best: number;
  maxGuesses: number;
  onStart: () => void;
}) {
  return (
    <div className="arcade-intro">
      <p className="arcade-pitch">
        Climb the tower. Every floor is a random fighter and {maxGuesses}{" "}
        guesses. Win and the next one steps in; lose one and the climb is over.
      </p>
      <ul className="arcade-rules">
        <li>It only gets harder to look at.</li>
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
  floorReached,
  best,
  share,
  loggedIn,
  onLogIn,
  onAgain,
}: {
  floorReached: number;
  best: number;
  share: string;
  loggedIn: boolean;
  onLogIn: () => void;
  onAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const newBest = floorReached > 1 && floorReached >= best;

  async function copy() {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ text: share });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
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
        <span>Floor reached</span>
        <span className="arcade-over-floors">{floorReached}</span>
      </p>
      {newBest ? (
        <p className="arcade-best is-new">New best!</p>
      ) : (
        <p className="arcade-best">Your best: floor {best}</p>
      )}
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
          to put your climbs on the highest floors board.
        </p>
      )}
    </div>
  );
}

/** The tower: the next opponents locked above, the current one lit, the beaten ones below. */
function Ladder({ run: given }: { run: NonNullable<ArcadeState["run"]> }) {
  const beatenNow = given.cleared.some((floor) => floor.floor === given.floor);
  const run = beatenNow ? { ...given, floor: given.floor + 1 } : given;
  const beaten = [...run.cleared].reverse().slice(0, 8);
  const hidden = run.cleared.length - beaten.length;
  return (
    <aside className="ladder" aria-label="Ladder">
      <ol className="ladder-floors">
        {!run.over &&
          [2, 1].map((ahead) => (
            <li
              key={`ahead-${ahead}`}
              className="ladder-floor is-locked"
              aria-hidden="true"
            >
              <span className="ladder-number">{run.floor + ahead}</span>
              <span className="ladder-slot">?</span>
            </li>
          ))}
        <li
          className={
            run.over ? "ladder-floor is-lost" : "ladder-floor is-current"
          }
        >
          <span className="ladder-number">{run.floor}</span>
          {run.over && run.answer ? (
            <>
              <LadderThumb
                name={run.answer.name}
                url={run.answer.portrait?.url}
              />
              <span className="ladder-name">{run.answer.name}</span>
            </>
          ) : (
            <>
              <span className="ladder-slot">?</span>
              <span className="ladder-name">
                {run.over ? "" : "Now fighting"}
              </span>
            </>
          )}
        </li>
        {beaten.map((floor) => (
          <li key={floor.floor} className="ladder-floor is-beaten">
            <span className="ladder-number">{floor.floor}</span>
            <LadderThumb
              name={floor.character.name}
              url={floor.character.portrait?.url}
            />
            <span className="ladder-name">{floor.character.name}</span>
            <span
              className="ladder-guesses"
              title={`${floor.guesses} ${floor.guesses === 1 ? "guess" : "guesses"}`}
            >
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
    <img
      className="ladder-thumb"
      src={url}
      alt=""
      width={30}
      height={40}
      loading="lazy"
    />
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
  const [board, setBoard] = useState<{
    top: ArcadeLadderEntry[];
    you?: ArcadeLadderEntry;
  }>();
  useEffect(() => {
    fetchArcadeLeaderboard().then(setBoard, () => undefined);
  }, [version]);
  if (!board) return null;
  const rows = [...board.top, ...(board.you ? [board.you] : [])];
  return (
    <section
      className="leaderboard arcade-leaderboard"
      aria-labelledby="arcade-board-title"
    >
      <div className="leaderboard-head">
        <h2 id="arcade-board-title">Highest floors</h2>
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
              <span className="score">Floor {row.floor}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
