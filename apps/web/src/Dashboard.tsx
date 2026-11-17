import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchDashboard,
  resetCounting,
  type CountRow,
  type Dashboard as DashboardData,
  type DayNumbers,
} from "./api";
import { formatDay } from "./History";

export const DASHBOARD_HASH = "#dashboard";

/** The owner's view of the site: visits, players and rounds. Only the owner's account can load it. */
export function Dashboard({ canReset }: { canReset: boolean }) {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();
  // Bumped after a reset, to load the numbers again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetchDashboard().then(setData, (e: unknown) =>
      setError(
        e instanceof ApiError && e.status === 404
          ? "This page is for the site owner."
          : "Couldn't load the dashboard.",
      ),
    );
  }, [version]);

  if (error) return <p className="status status--error">{error}</p>;
  if (!data) return <p className="status">Loading the dashboard…</p>;

  const today = data.days.at(-1)!;
  const yesterday = data.days.at(-2);
  const sum = (key: keyof Omit<DayNumbers, "day">) =>
    data.days.reduce((total, day) => total + day[key], 0);
  const percent = (part: number, whole: number) =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
  // Visits are only counted since the dashboard went live, so compare players
  // with visitors on those days only.
  const tracked = data.days.filter((d) => d.views > 0);
  const trackedShare = percent(
    tracked.reduce((total, d) => total + d.players, 0),
    tracked.reduce((total, d) => total + d.visitors, 0),
  );

  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <p className="history-nav">
        <a href="#">← Back to today's round</a>
      </p>
      <h2 id="dashboard-title" className="history-title">
        Dashboard
      </h2>
      <p className="dashboard-note">
        Times in UTC. Your own visits aren't counted. Visitors are counted once
        per day, without cookies.
      </p>
      <CountingSince since={data.since} canReset={canReset} onReset={() => setVersion((v) => v + 1)} />

      <h3 className="dashboard-sub">Today so far</h3>
      <div className="stat-tiles">
        <Tile
          label="Visitors"
          value={today.visitors}
          before={yesterday?.visitors}
        />
        <Tile
          label="Played today's round"
          value={today.players}
          before={yesterday?.players}
        />
        <Tile
          label="Finished"
          value={today.finished}
          before={yesterday?.finished}
          detail={`${percent(today.won, today.finished)} won`}
        />
        <Tile
          label="Past rounds played"
          value={today.latePlayers}
          before={yesterday?.latePlayers}
        />
        <Tile
          label="New accounts"
          value={today.signups}
          before={yesterday?.signups}
        />
      </div>

      <h3 className="dashboard-sub">Last 30 days</h3>
      <div className="stat-tiles">
        <Tile
          label="Visitors"
          value={sum("visitors")}
          detail={`${sum("views")} page views`}
        />
        <Tile
          label="Rounds played"
          value={sum("players")}
          detail={
            tracked.length > 0
              ? `${trackedShare} of visitors played`
              : undefined
          }
        />
        <Tile
          label="Won"
          value={sum("won")}
          detail={`${percent(sum("won"), sum("finished"))} of finished`}
        />
        <Tile
          label="Accounts"
          value={data.accounts.total}
          detail={`${data.accounts.google} with Google · ${data.accounts.newThisWeek} this week`}
        />
      </div>

      <div className="dashboard-charts">
        <BarChart
          title="Visitors per day"
          days={data.days}
          pick={(d) => d.visitors}
          unit="visitors"
        />
        <BarChart
          title="Players per day"
          days={data.days}
          pick={(d) => d.players}
          unit="players"
        />
        <BarChart
          title="New accounts per day"
          days={data.days}
          pick={(d) => d.signups}
          unit="accounts"
        />
      </div>

      <TowerSection tower={data.tower} days={data.days} />

      <details className="dashboard-table-toggle">
        <summary>Show the 30 days as a table</summary>
        <div className="table-scroll">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Visitors</th>
                <th scope="col">Views</th>
                <th scope="col">Played</th>
                <th scope="col">Finished</th>
                <th scope="col">Won</th>
                <th scope="col">Past rounds</th>
                <th scope="col">Accounts</th>
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row">{formatDay(d.day, "short")}</th>
                  <td>{d.visitors}</td>
                  <td>{d.views}</td>
                  <td>{d.players}</td>
                  <td>{d.finished}</td>
                  <td>{d.won}</td>
                  <td>{d.latePlayers}</td>
                  <td>{d.signups}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <h3 className="dashboard-sub">Recent rounds</h3>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Answer</th>
              <th scope="col">Played</th>
              <th scope="col">Solved</th>
              <th scope="col">Avg. guesses</th>
            </tr>
          </thead>
          <tbody>
            {data.rounds.map((round) => (
              <tr key={round.day}>
                <th scope="row">{formatDay(round.day, "short")}</th>
                <td>
                  {round.day === data.today ? (
                    <Spoiler
                      answer={round.answer}
                      franchise={round.franchise}
                    />
                  ) : (
                    <>
                      {round.answer}{" "}
                      <span className="dashboard-dim">{round.franchise}</span>
                    </>
                  )}
                </td>
                <td>{round.players}</td>
                <td>{percent(round.won, round.finished)}</td>
                <td>{round.averageGuesses ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-lists">
        <CountList
          title="Where visitors come from"
          rows={data.referrers}
          empty="No links from other sites yet."
        />
        <CountList
          title="Favourite first guesses"
          rows={data.firstGuesses}
          empty="No guesses yet."
        />
        <CountList
          title="Time zones"
          rows={data.timezones}
          empty="No visits yet."
        />
        <CountList
          title="Languages"
          rows={data.languages}
          empty="No visits yet."
        />
        <CountList title="Devices" rows={data.devices} empty="No visits yet." />
        <CountList title="Pages" rows={data.pages} empty="No visits yet." />
      </div>
    </section>
  );
}

/**
 * Since when the numbers count, and the owner's Reset counting button. Two
 * clicks, so a stray one can't restart the count. Nothing is deleted: the
 * numbers before the reset are simply left out.
 */
function CountingSince({ since, canReset, onReset }: { since: string | null; canReset: boolean; onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const when = since
    ? new Date(since).toLocaleString("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC"
    : null;

  async function reset() {
    setBusy(true);
    setFailed(false);
    try {
      await resetCounting();
      setConfirming(false);
      onReset();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="dashboard-note counting-since">
      {when ? <>Counting since <strong>{when}</strong>.</> : "Counting everything so far."}{" "}
      {canReset &&
        (confirming ? (
          <>
            Start counting again from now?{" "}
            <button type="button" className="link" onClick={reset} disabled={busy}>
              Yes, reset
            </button>{" "}
            <button type="button" className="link link--quiet" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setConfirming(true)}>
            Reset counting
          </button>
        ))}
      {failed && <span className="status--error"> Couldn't reset. Please try again.</span>}
    </p>
  );
}

/** Today's answer stays hidden until asked for, so the owner can still play. */
function Spoiler({ answer, franchise }: { answer: string; franchise: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <>
      {answer} <span className="dashboard-dim">{franchise}</span>
    </>
  ) : (
    <button type="button" className="link" onClick={() => setShown(true)}>
      Show today's answer
    </button>
  );
}

function Tile({
  label,
  value,
  before,
  detail,
}: {
  label: string;
  value: number;
  before?: number;
  detail?: string;
}) {
  const change = before === undefined ? undefined : value - before;
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value">{value.toLocaleString("en")}</span>
      {change !== undefined && (
        <span className="stat-tile-detail">
          {change === 0
            ? "Same as yesterday"
            : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)} vs yesterday (${before})`}
        </span>
      )}
      {detail && <span className="stat-tile-detail">{detail}</span>}
    </div>
  );
}

const CHART = { height: 150, top: 14, bottom: 22, left: 30, right: 6 };

/** The element's width in CSS pixels, kept up to date as the layout changes. */
function useWidth<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry!.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** One measure over 30 days. One series, so no legend: the title names it. */
/** The Tower of Endless Struggle: how many climb, and how high they get. */
function TowerSection({ tower, days }: { tower: DashboardData["tower"]; days: DayNumbers[] }) {
  const runsOn = new Map(tower.runsByDay.map((row) => [row.day, row.runs]));
  // One column per floor from 1 to the highest, empty floors included, so the shape reads true.
  const highest = Math.max(1, ...tower.floorsReached.map((row) => row.floor));
  const endedOn = new Map(tower.floorsReached.map((row) => [row.floor, row.runs]));
  const floors = Array.from({ length: highest }, (_, i) => ({ label: `Floor ${i + 1}`, value: endedOn.get(i + 1) ?? 0 }));

  return (
    <>
      <h3 className="dashboard-sub">Tower of Endless Struggle</h3>
      <div className="stat-tiles">
        <Tile label="Climbs" value={tower.runs} detail={`${tower.players} players`} />
        <Tile label="Highest floor" value={tower.highestFloor} />
        <Tile label="Average floor reached" value={tower.averageFloor ?? 0} />
      </div>
      <div className="dashboard-charts">
        <ColumnChart
          title="Floors reached"
          points={floors}
          unit="climbs ended here"
          axisLabel={(i) => String(i + 1)}
        />
        <BarChart title="Tower climbs per day" days={days} pick={(d) => runsOn.get(d.day) ?? 0} unit="climbs" />
      </div>
    </>
  );
}

/**
 * A column per point (here, per floor): same look as the daily bar charts,
 * one series so no legend, the value of a column on hover.
 */
function ColumnChart({
  title,
  points,
  unit,
  axisLabel,
}: {
  title: string;
  points: { label: string; value: number }[];
  unit: string;
  axisLabel: (index: number) => string;
}) {
  const [hover, setHover] = useState<number>();
  const [boxRef, measured] = useWidth<HTMLDivElement>();
  const W = measured || 300;
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values);
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const slot = (W - CHART.left - CHART.right) / Math.max(1, points.length);
  const barWidth = Math.max(2, slot - 2);
  const y = (v: number) => CHART.top + plotHeight - (v / max) * plotHeight;
  const hovered = hover === undefined ? undefined : points[hover];
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <figure className="bar-chart">
      <figcaption className="bar-chart-title">
        {title}
        <span className="bar-chart-readout" aria-live="polite">
          {hovered ? `${hovered.label}: ${hovered.value} ${unit}` : `Total ${values.reduce((a, b) => a + b, 0)}`}
        </span>
      </figcaption>
      <div ref={boxRef}>
        <svg
          width={W}
          height={CHART.height}
          viewBox={`0 0 ${W} ${CHART.height}`}
          role="img"
          aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`}
          onMouseLeave={() => setHover(undefined)}
        >
          {[0, max].map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={CHART.left} x2={W - CHART.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis" x={CHART.left - 6} y={y(tick) + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          {values.map((value, i) => {
            const x = CHART.left + i * slot + 1;
            const top = y(value);
            return (
              <g key={points[i]!.label}>
                {value > 0 && (
                  <path
                    className={i === hover ? "chart-bar is-hover" : "chart-bar"}
                    d={roundedTop(x, top, barWidth, CHART.top + plotHeight - top)}
                  />
                )}
                <rect
                  x={CHART.left + i * slot}
                  y={CHART.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          {ticks.map((i) => (
            <text
              key={i}
              className="chart-axis"
              x={i === 0 ? CHART.left : i === points.length - 1 ? W - CHART.right : CHART.left + i * slot + slot / 2}
              y={CHART.height - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            >
              {axisLabel(i)}
            </text>
          ))}
        </svg>
      </div>
    </figure>
  );
}

function BarChart({
  title,
  days,
  pick,
  unit,
}: {
  title: string;
  days: DayNumbers[];
  pick: (d: DayNumbers) => number;
  unit: string;
}) {
  const [hover, setHover] = useState<number>();
  const [boxRef, measured] = useWidth<HTMLDivElement>();
  const W = measured || 300;
  const values = days.map(pick);
  const max = Math.max(1, ...values);
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const slot = (W - CHART.left - CHART.right) / days.length;
  const barWidth = Math.max(2, slot - 2); // 2px gap between bars
  const y = (v: number) => CHART.top + plotHeight - (v / max) * plotHeight;
  const hovered =
    hover === undefined
      ? undefined
      : { day: days[hover]!.day, value: values[hover]! };

  return (
    <figure className="bar-chart">
      <figcaption className="bar-chart-title">
        {title}
        <span className="bar-chart-readout" aria-live="polite">
          {hovered
            ? `${formatDay(hovered.day, "short")}: ${hovered.value} ${unit}`
            : `Total ${values.reduce((a, b) => a + b, 0)}`}
        </span>
      </figcaption>
      <div ref={boxRef}>
        <svg
          width={W}
          height={CHART.height}
          viewBox={`0 0 ${W} ${CHART.height}`}
          role="img"
          aria-label={`${title}, last 30 days. The table below has every value.`}
          onMouseLeave={() => setHover(undefined)}
        >
          {[0, max].map((tick) => (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={CHART.left}
                x2={W - CHART.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="chart-axis"
                x={CHART.left - 6}
                y={y(tick) + 4}
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          ))}
          {values.map((value, i) => {
            const x = CHART.left + i * slot + 1;
            const top = y(value);
            const height = CHART.top + plotHeight - top;
            return (
              <g key={days[i]!.day}>
                {value > 0 && (
                  <path
                    className={i === hover ? "chart-bar is-hover" : "chart-bar"}
                    d={roundedTop(x, top, barWidth, height)}
                  />
                )}
                {/* Hit target: the whole column, much bigger than a thin bar. */}
                <rect
                  x={CHART.left + i * slot}
                  y={CHART.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          {[0, Math.floor(days.length / 2), days.length - 1].map((i) => (
            <text
              key={i}
              className="chart-axis"
              x={i === 0 ? CHART.left : i === days.length - 1 ? W - CHART.right : CHART.left + i * slot + slot / 2}
              y={CHART.height - 6}
              textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
            >
              {formatDay(days[i]!.day, "short")}
            </text>
          ))}
        </svg>
      </div>
    </figure>
  );
}

/** A bar with 4px rounded corners on top and a square base on the axis. */
function roundedTop(
  x: number,
  top: number,
  width: number,
  height: number,
): string {
  const r = Math.min(4, width / 2, height);
  const bottom = top + height;
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
}

function CountList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: CountRow[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="count-list">
      <h3 className="dashboard-sub">{title}</h3>
      {rows.length === 0 ? (
        <p className="dashboard-dim">{empty}</p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li key={row.label}>
              <span className="count-label">{row.label}</span>
              <span
                className="count-bar"
                style={{ width: `${(row.count / max) * 100}%` }}
                aria-hidden="true"
              />
              <span className="count-value">{row.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
