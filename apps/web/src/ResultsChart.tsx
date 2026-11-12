import { useEffect, useState } from "react";
import { fetchTodayResults, type TodayResults } from "./api";
import { percentBeaten, percentSolved, withViewer, type RoundResult } from "./results";

interface ResultsChartProps {
  maxGuesses: number;
  /** The viewer's finished round. */
  mine: RoundResult;
  /** Logged in, so the server already counts this round. */
  counted: boolean;
}

/**
 * How everyone did today: one bar per number of guesses, plus K.O. for
 * running out, with the viewer's bar picked out. It's a real table, so
 * screen readers get the numbers as a table; the bars are drawn on top.
 */
export function ResultsChart({ maxGuesses, mine, counted }: ResultsChartProps) {
  const [fetched, setFetched] = useState<TodayResults>();
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<number>();

  useEffect(() => {
    let current = true;
    fetchTodayResults().then(
      (data) => current && setFetched(data),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [mine]);

  if (failed) return null; // the chart is a bonus; the round is still over and shareable
  if (!fetched) return <p className="status chart-loading">Loading today's results…</p>;

  const results = withViewer(fetched, mine, counted);
  const rows = [
    ...results.solvedIn.slice(0, maxGuesses).map((count, i) => ({ key: String(i + 1), label: String(i + 1), count })),
    { key: "lost", label: "K.O.", count: results.lost },
  ];
  const yours = mine === "lost" ? "lost" : String(mine);
  const biggest = Math.max(...rows.map((row) => row.count), 1);
  const beaten = percentBeaten(results, mine);

  const headline =
    mine === "lost"
      ? results.players > 1
        ? `${percentSolved(results)}% of players solved it.`
        : "Nobody else has finished yet."
      : beaten === null
        ? "You're the first to finish today!"
        : beaten === 100
          ? "You beat everyone today!"
          : `You beat ${beaten}% of players today.`;

  return (
    <section className="chart" aria-labelledby="chart-title">
      <h3 id="chart-title" className="chart-title">
        Today's results
        <span className="chart-players">
          {results.players} {results.players === 1 ? "player" : "players"}
        </span>
      </h3>
      <p className="chart-headline">{headline}</p>

      <table className="chart-table">
        <caption className="visually-hidden">Players by number of guesses today</caption>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Guesses</th>
            <th scope="col">Players</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isYou = row.key === yours;
            const share = results.players > 0 ? Math.round((row.count / results.players) * 100) : 0;
            const description = `${row.key === "lost" ? "Ran out of guesses" : `Solved in ${row.label}`}: ${row.count} ${
              row.count === 1 ? "player" : "players"
            } (${share}%)${isYou ? ", including you" : ""}`;
            return (
              <tr
                key={row.key}
                className={isYou ? "chart-row is-you" : "chart-row"}
                // The whole row is the hover target, much bigger than a thin bar.
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(undefined)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(undefined)}
                tabIndex={0}
                aria-label={description}
              >
                <th scope="row" className="chart-label">
                  {row.label}
                </th>
                <td>
                  <div className="chart-cell">
                  <span className="chart-bar" style={{ width: `${(row.count / biggest) * 100}%` }} />
                  <span className="chart-value">
                    {row.count}
                    {isYou && <span className="chart-you">You</span>}
                  </span>
                  {hovered === index && (
                    <span className="chart-tooltip" role="presentation">
                      {description}
                    </span>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!counted && <p className="chart-note">Guests are shown here but not counted. Log in to count.</p>}
    </section>
  );
}
