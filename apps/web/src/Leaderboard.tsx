import { useEffect, useState } from "react";
import { fetchStreakLeaderboard, fetchTodayLeaderboard, type StreakEntry, type TodayEntry } from "./api";

type Tab = "today" | "streaks";

/** `version` changes whenever the standings may have moved (a solve, a login),
 *  which makes the board fetch again. */
export function Leaderboard({ version }: { version: number }) {
  const [tab, setTab] = useState<Tab>("today");
  const [today, setToday] = useState<TodayEntry[]>();
  const [streaks, setStreaks] = useState<StreakEntry[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true; // ignore answers that arrive after a newer request started
    setFailed(false);
    Promise.all([fetchTodayLeaderboard(), fetchStreakLeaderboard()])
      .then(([todayRows, streakRows]) => {
        if (!current) return;
        setToday(todayRows);
        setStreaks(streakRows);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [version]);

  const rows =
    tab === "today"
      ? today?.map((e) => ({ ...e, value: `${e.guesses} ${e.guesses === 1 ? "guess" : "guesses"}` }))
      : streaks?.map((e) => ({ ...e, value: `${e.streak} ${e.streak === 1 ? "day" : "days"}` }));

  return (
    <section className="leaderboard" aria-labelledby="leaderboard-title">
      <div className="leaderboard-head">
        <h2 id="leaderboard-title">Leaderboard</h2>
        <div className="tabs" role="group" aria-label="Leaderboard type">
          {(["today", "streaks"] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={tab === name ? "tab is-active" : "tab"}
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
            >
              {name === "today" ? "Today" : "Streaks"}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p className="status">Couldn't load the leaderboard.</p>
      ) : !rows ? (
        <p className="status">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="status">
          {tab === "today" ? "Nobody has solved today's puzzle yet. Be the first!" : "No streaks running yet."}
        </p>
      ) : (
        <ol className="ranking">
          {rows.map((row) => (
            <li key={row.username} className={row.you ? "is-you" : undefined}>
              <span className="rank">{row.rank}</span>
              <span className="player">
                {row.username}
                {row.you && <span className="you-tag"> (you)</span>}
              </span>
              <span className="score">{row.value}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
