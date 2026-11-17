import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { fetchTodayResults, type TodayResults } from "./api";
import { percentBeaten, percentSolved, type RoundResult } from "./results";

interface ResultsChartProps {
  maxGuesses: number;
  /** The viewer's finished round. */
  mine: RoundResult;
  /** A past day's numbers, already loaded: the chart then shows them instead of today's. */
  pastResults?: TodayResults;
}

const HEIGHT = 190;
const PAD = { top: 18, right: 14, bottom: 30, left: 14 };

/**
 * A smoothed curve of how everyone did today, from 1 guess to K.O., with a
 * marker where the viewer landed. Each finished round adds a small bump
 * (a Gaussian kernel) at its number of guesses; summed, they make the curve.
 * Exact counts are one hover away, and in a table for screen readers.
 */
function curvePoints(counts: number[], steps = 120): number[] {
  const bandwidth = 0.75;
  const xs = counts.length;
  const values = Array.from({ length: steps + 1 }, (_, i) => {
    const x = 1 + (i / steps) * (xs - 1);
    return counts.reduce((sum, count, k) => sum + count * Math.exp(-0.5 * ((x - (k + 1)) / bandwidth) ** 2), 0);
  });
  const peak = Math.max(...values);
  return peak > 0 ? values.map((v) => v / peak) : values;
}

export function ResultsChart({ maxGuesses, mine, pastResults }: ResultsChartProps) {
  const [fetchedToday, setFetched] = useState<TodayResults>();
  const fetched = pastResults ?? fetchedToday;
  // How the text names the day: "today's players", or "that day's players".
  const day = pastResults ? "that day" : "today";
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number>();
  const [width, setWidth] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  // Ids for the hatch pattern and its clip, unique per chart on the page.
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    if (pastResults) return;
    let current = true;
    fetchTodayResults().then(
      (data) => current && setFetched(data),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [mine, pastResults]);

  // Draw in real pixels rather than stretching a fixed drawing, so labels stay
  // readable on a phone.
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [fetched]);

  if (failed) return null; // the chart is a bonus; the round is still over and shareable
  if (!fetched) return <p className="status chart-loading">Loading today's results…</p>;

  // The server counts every finished round, the viewer's included.
  const results = fetched;
  // One position per outcome: 1..maxGuesses solved, then K.O.
  const counts = [...results.solvedIn.slice(0, maxGuesses), results.lost];
  const labels = [...counts.slice(0, -1).map((_, i) => String(i + 1)), "K.O."];
  const youIndex = mine === "lost" ? counts.length - 1 : mine - 1;

  const plotWidth = Math.max(width - PAD.left - PAD.right, 100);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const xAt = (index: number) => PAD.left + (index / (counts.length - 1)) * plotWidth;
  const yAt = (value: number) => PAD.top + (1 - value) * plotHeight;

  const curve = curvePoints(counts);
  const steps = curve.length - 1;
  const line = curve.map((v, i) => `${i === 0 ? "M" : "L"}${xAt((i / steps) * (counts.length - 1)).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(counts.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;
  const youY = yAt(curve[Math.round((youIndex / (counts.length - 1)) * steps)] ?? 0);

  const beaten = percentBeaten(results, mine);
  // Everyone to the right of the marker took more guesses, or ran out: the
  // players the viewer beat. That part of the curve is hatched.
  const showBeaten = mine !== "lost" && beaten !== null && beaten > 0;
  // A perfect round (first guess) paints it green instead of pink.
  const perfect = mine === 1;
  const caption = results.youLate
    ? results.players === 0
      ? "Nobody finished it on the day"
      : mine === "lost"
        ? `${percentSolved(results)}% of ${day}'s players solved it`
        : `Would have beaten ${beaten}% of ${day}'s players`
    : mine === "lost"
      ? results.players > 1
        ? `${percentSolved(results)}% of ${day}'s players solved it`
        : pastResults ? "Nobody else finished that day" : "Nobody else has finished yet"
      : beaten === null
        ? `First to finish ${day}`
        : `Better than ${beaten}% of ${day}'s players`;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const index = Math.round(((x - PAD.left) / plotWidth) * (counts.length - 1));
    setHover(Math.min(Math.max(index, 0), counts.length - 1));
  }

  const describe = (index: number) => {
    const count = counts[index] ?? 0;
    const share = results.players > 0 ? Math.round((count / results.players) * 100) : 0;
    const what = index === counts.length - 1 ? "Ran out of guesses" : `Solved in ${labels[index]}`;
    return `${what}: ${count} ${count === 1 ? "player" : "players"} (${share}%)`;
  };

  return (
    <section className="chart" aria-labelledby="chart-title">
      <div className="chart-head">
        <p className="chart-score" id="chart-title">
          {mine === "lost" ? "K.O." : mine}
          {mine !== "lost" && <small>/{maxGuesses}</small>}
        </p>
        <p className="chart-players">
          {results.players} {results.players === 1 ? "player" : "players"} {day}
        </p>
      </div>

      <div className="chart-plot" ref={box}>
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden="true"
          className={perfect ? "chart-svg is-perfect" : "chart-svg"}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(undefined)}
        >
          {showBeaten && (
            <defs>
              {/* A wash that fades toward the axis, with fine diagonal lines over it. */}
              <linearGradient id={`beaten-fade-${uid}`} x1={0} y1={0} x2={0} y2={1}>
                <stop offset="0%" className="chart-beaten-stop" stopOpacity={0.42} />
                <stop offset="100%" className="chart-beaten-stop" stopOpacity={0.06} />
              </linearGradient>
              <pattern id={`beaten-${uid}`} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
                <line className="chart-beaten-hatch" x1={0} y1={0} x2={0} y2={5} />
              </pattern>
              <clipPath id={`beaten-clip-${uid}`}>
                <rect x={xAt(youIndex)} y={0} width={Math.max(0, PAD.left + plotWidth - xAt(youIndex))} height={HEIGHT} />
              </clipPath>
            </defs>
          )}
          <path className="chart-area" d={area} />
          <path className="chart-line" d={line} />
          {showBeaten && (
            <g clipPath={`url(#beaten-clip-${uid})`}>
              <path d={area} fill={`url(#beaten-fade-${uid})`} />
              <path d={area} fill={`url(#beaten-${uid})`} />
              <path className="chart-beaten-edge" d={line} />
            </g>
          )}
          <line className="chart-axis" x1={PAD.left} x2={PAD.left + plotWidth} y1={yAt(0)} y2={yAt(0)} />

          {labels.map((label, i) => (
            <text
              key={label}
              className={i === youIndex ? "chart-tick is-you" : "chart-tick"}
              x={xAt(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
            >
              {i === youIndex ? "YOU" : label}
            </text>
          ))}

          {hover !== undefined && hover !== youIndex && (
            <line className="chart-guide" x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={yAt(0)} />
          )}
          <line className="chart-you-line" x1={xAt(youIndex)} x2={xAt(youIndex)} y1={youY} y2={yAt(0)} />
          <circle className="chart-you-dot" cx={xAt(youIndex)} cy={youY} r={5} />
        </svg>

        {hover !== undefined && (
          <p
            className="chart-tooltip"
            style={{ left: Math.min(Math.max(xAt(hover), 90), width - 90) }}
          >
            {describe(hover)}
          </p>
        )}
      </div>

      <p className="chart-caption">
        {showBeaten && <span className={perfect ? "beaten-swatch is-perfect" : "beaten-swatch"} aria-hidden="true" />}
        {caption}
      </p>

      {/* The same numbers as a table, for screen readers. */}
      <table className="visually-hidden">
        <caption>{pastResults ? "That day's" : "Today's"} players by number of guesses</caption>
        <thead>
          <tr>
            <th scope="col">Result</th>
            <th scope="col">Players</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label}>
              <th scope="row">
                {i === counts.length - 1 ? "Ran out of guesses" : `${label} ${label === "1" ? "guess" : "guesses"}`}
                {i === youIndex ? " (you)" : ""}
              </th>
              <td>{counts[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
