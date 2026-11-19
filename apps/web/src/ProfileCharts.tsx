import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { PlayerProfile, RoundComparison, Standing } from "./api";
import { formatDay } from "./History";
import { LAUNCH_DATE, puzzleNumber } from "./share";

// The profile's comparisons. One colour language, the same as the results
// chart: you in pink (--you), everyone in cyan (--accent). The chart has a
// legend, a hover tooltip, and a hidden table with the same numbers for
// screen readers.

/** Draw at the real width rather than stretching a fixed drawing, so text stays readable on phones. */
function useWidth(fallback = 600) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  return [box, width] as const;
}

// ---- How you compare: four tiles ----

/** Who the player is compared with: "players", "logged-in players" (streaks) or "Tower climbers". */
function StandingLine({ standing, empty, group = "player" }: { standing: Standing | null; empty: string; group?: string }) {
  if (!standing) return <p className="pc-tile-note">{empty}</p>;
  return (
    <>
      <span className="pc-meter" aria-hidden="true">
        <span style={{ width: `${standing.betterThan}%` }} />
      </span>
      <p className="pc-tile-note">
        Better than <strong>{standing.betterThan}%</strong> of {standing.of.toLocaleString("en")} {standing.of === 1 ? group : `${group}s`}
      </p>
    </>
  );
}

function Tile({ label, value, everyone, children }: { label: string; value: ReactNode; everyone?: ReactNode; children: ReactNode }) {
  return (
    <div className="pc-tile">
      <p className="pc-tile-label">{label}</p>
      <p className="pc-tile-value">{value}</p>
      {everyone !== undefined && <p className="pc-tile-everyone">Everyone: {everyone}</p>}
      {children}
    </div>
  );
}

export function CompareTiles({ profile }: { profile: PlayerProfile }) {
  const { everyone, standing } = profile.compare;
  const solved = profile.solvedIn.reduce((a, b) => a + b, 0);
  const finished = solved + profile.lost;
  // No standing: this player hasn't finished a round on its day yet, or nobody else has.
  const enough = finished > 0 ? "Nobody else to compare with yet" : "Finish a round on its day to compare";
  return (
    <div className="pc-tiles">
      <Tile label="Average guesses" value={profile.stats.averageGuesses ?? "–"} everyone={everyone.averageGuesses ?? "–"}>
        <StandingLine standing={standing.averageGuesses} empty={enough} />
      </Tile>
      <Tile
        label="Solve rate"
        value={finished > 0 ? `${Math.round((solved / finished) * 100)}%` : "–"}
        everyone={everyone.solveRate === null ? "–" : `${everyone.solveRate}%`}
      >
        <StandingLine standing={standing.solveRate} empty={enough} />
      </Tile>
      <Tile label="Best streak" value={profile.stats.maxStreak}>
        <StandingLine standing={standing.maxStreak} empty={enough} group="logged-in player" />
      </Tile>
      <Tile label="Tower best floor" value={profile.tower.bestFloor || "–"}>
        <StandingLine standing={standing.towerFloor} empty="Climb the Tower to compare" group="Tower climber" />
      </Tile>
    </div>
  );
}

// ---- Round by round: your guesses against each day's average ----

const LINE = { height: 220, top: 14, bottom: 28, left: 34, right: 12 };

function resultText(round: RoundComparison, max: number): string {
  if (round.you === null) return "You: didn't finish on the day";
  if (round.you === "lost") return `You: K.O. (all ${max} guesses)`;
  return `You: ${round.you} ${round.you === 1 ? "guess" : "guesses"}`;
}

export function RoundsCompare({ profile, maxGuesses }: { profile: PlayerProfile; maxGuesses: number }) {
  const [box, width] = useWidth();
  const [hover, setHover] = useState<number>();
  // Days before launch were the test run.
  const rounds = profile.compare.rounds.filter((r) => r.date >= LAUNCH_DATE);
  if (rounds.length < 2) {
    return <p className="history-note">A few more rounds and your day-by-day chart shows up here.</p>;
  }

  const plotW = Math.max(width - LINE.left - LINE.right, 120);
  const plotH = LINE.height - LINE.top - LINE.bottom;
  const koRow = maxGuesses + 1; // K.O. sits one row above the last guess
  const xAt = (i: number) => LINE.left + (i / (rounds.length - 1)) * plotW;
  const yAt = (guesses: number) => LINE.top + ((koRow - guesses) / (koRow - 1)) * plotH;
  const yOf = (r: RoundComparison) => (r.you === null ? null : yAt(r.you === "lost" ? koRow : r.you));

  // Everyone's average as one line, broken where nobody solved.
  const everyone = rounds
    .map((r, i) => (r.everyoneAverage === null ? null : `${xAt(i).toFixed(1)},${yAt(r.everyoneAverage).toFixed(1)}`))
    .reduce<string[][]>(
      (runs, point) => {
        if (point === null) runs.push([]);
        else runs[runs.length - 1]!.push(point);
        return runs;
      },
      [[]],
    )
    .filter((run) => run.length > 1)
    .map((run) => `M${run.join(" L")}`)
    .join(" ");

  // Yours, joined only between rounds played back to back.
  const you = rounds
    .map((r, i) => {
      const y = yOf(r);
      const prev = i > 0 ? yOf(rounds[i - 1]!) : null;
      return y !== null && prev !== null ? `M${xAt(i - 1).toFixed(1)},${prev.toFixed(1)} L${xAt(i).toFixed(1)},${y.toFixed(1)}` : "";
    })
    .join(" ");

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const i = Math.round(((x - LINE.left) / plotW) * (rounds.length - 1));
    setHover(Math.min(Math.max(i, 0), rounds.length - 1));
  }

  const ticks = [1, Math.round(maxGuesses / 2), maxGuesses];
  const hovered = hover === undefined ? undefined : rounds[hover];

  return (
    <figure className="pc-chart">
      <ul className="pc-legend">
        <li>
          <span className="pc-key pc-key--you" aria-hidden="true" /> You
        </li>
        <li>
          <span className="pc-key pc-key--everyone" aria-hidden="true" /> Everyone (average)
        </li>
      </ul>
      <div className="pc-plot" ref={box}>
        <svg width={width} height={LINE.height} aria-hidden="true" onPointerMove={onPointerMove} onPointerLeave={() => setHover(undefined)}>
          {[...ticks, koRow].map((t) => (
            <g key={t}>
              <line className="pc-grid" x1={LINE.left} x2={LINE.left + plotW} y1={yAt(t)} y2={yAt(t)} />
              <text className="pc-tick" x={LINE.left - 6} y={yAt(t) + 4} textAnchor="end">
                {t === koRow ? "K.O." : t}
              </text>
            </g>
          ))}
          {[0, rounds.length - 1].map((i) => (
            <text key={i} className="pc-tick" x={xAt(i)} y={LINE.height - 8} textAnchor={i === 0 ? "start" : "end"}>
              {formatDay(rounds[i]!.date, "short")}
            </text>
          ))}
          {hover !== undefined && <line className="pc-crosshair" x1={xAt(hover)} x2={xAt(hover)} y1={LINE.top} y2={LINE.top + plotH} />}
          <path className="pc-line pc-line--everyone" d={everyone} />
          <path className="pc-line pc-line--you" d={you} />
          {rounds.map((r, i) => {
            const y = yOf(r);
            return y === null ? null : (
              <circle key={r.date} className="pc-dot" cx={xAt(i)} cy={y} r={i === hover ? 6 : 4.5} />
            );
          })}
        </svg>
        {hovered && (
          <div className="chart-tooltip pc-tooltip" style={{ left: Math.min(Math.max(xAt(hover!), 110), width - 110) }}>
            <strong>
              Round {puzzleNumber(hovered.date)} · {formatDay(hovered.date, "short")}
            </strong>
            <span>{resultText(hovered, maxGuesses)}</span>
            <span>
              Everyone: {hovered.everyoneAverage === null ? "nobody solved it" : `${hovered.everyoneAverage.toFixed(1)} on average`} (
              {hovered.players} {hovered.players === 1 ? "player" : "players"})
            </span>
          </div>
        )}
      </div>
      <figcaption className="pc-caption">Guesses per round, last {rounds.length} rounds. Lower is better.</figcaption>
      {/* A table ignores a 1px width, so the hiding goes on a wrapper. */}
      <div className="visually-hidden">
        <table>
          <caption>Your guesses each round and that day's average</caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">You</th>
              <th scope="col">Everyone (average)</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.date}>
                <th scope="row">
                  Round {puzzleNumber(r.date)}, {formatDay(r.date, "short")}
                </th>
                <td>{r.you === null ? "Not played" : r.you === "lost" ? "K.O." : r.you}</td>
                <td>{r.everyoneAverage ?? "Nobody solved it"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
