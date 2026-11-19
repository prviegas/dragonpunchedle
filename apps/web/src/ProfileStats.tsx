import type { PlayerProfile } from "./api";
import { TOWER_HASH, TOWER_NAME, floorDanger, floorOmen } from "./arcadeRules";
import { formatDay } from "./History";
import { LAUNCH_DATE } from "./share";

// The profile's headline numbers, each drawn its own way and in the game's own
// visual language: a flame for the streak, a ring for the solve rate, the
// health bar for guesses, a strip of recent days for rounds played, and the
// Tower's own floor title for the climb.

export function ProfileHero({ profile }: { profile: PlayerProfile }) {
  const { stats } = profile;
  const solved = profile.solvedIn.reduce((a, b) => a + b, 0);
  const finished = solved + profile.lost;
  return (
    <div className="ph">
      <Streak current={stats.currentStreak} best={stats.maxStreak} />
      <SolveRing solved={solved} finished={finished} />
      <GuessBar average={stats.averageGuesses} max={profile.solvedIn.length} />
      <RecentDays profile={profile} />
    </div>
  );
}

function Streak({ current, best }: { current: number; best: number }) {
  return (
    <div className={current > 0 ? "ph-card ph-streak is-lit" : "ph-card ph-streak"}>
      <span className="ph-flame" aria-hidden="true">
        🔥
      </span>
      <p className="ph-big">
        {current}
        <small>{current === 1 ? " day" : " days"}</small>
      </p>
      <p className="ph-label">Current streak</p>
      <p className="ph-sub">{best > current ? `Best: ${best} days` : best > 0 ? "Your best yet" : "Solve today's round to start one"}</p>
    </div>
  );
}

function SolveRing({ solved, finished }: { solved: number; finished: number }) {
  const rate = finished > 0 ? solved / finished : 0;
  const r = 30;
  const length = 2 * Math.PI * r;
  return (
    <div className="ph-card ph-ring-card">
      <svg className="ph-ring" viewBox="0 0 76 76" width={76} height={76} aria-hidden="true">
        <circle className="ph-ring-track" cx={38} cy={38} r={r} />
        {rate > 0 && (
          <circle
            className="ph-ring-fill"
            cx={38}
            cy={38}
            r={r}
            strokeDasharray={`${rate * length} ${length}`}
            transform="rotate(-90 38 38)"
          />
        )}
        <text className="ph-ring-text" x={38} y={44} textAnchor="middle">
          {finished > 0 ? `${Math.round(rate * 100)}%` : "–"}
        </text>
      </svg>
      <p className="ph-label">Solved</p>
      <p className="ph-sub">
        {solved} of {finished} {finished === 1 ? "round" : "rounds"}
      </p>
    </div>
  );
}

/** Average guesses on the health bar: each cell is a guess, the last one filled in part. */
function GuessBar({ average, max }: { average: number | null; max: number }) {
  return (
    <div className="ph-card">
      <p className="ph-big">{average ?? "–"}</p>
      <p className="ph-label">Guesses per solve</p>
      <span className="ph-health" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => {
          const fill = average === null ? 0 : Math.min(Math.max(average - i, 0), 1);
          return (
            <span key={i} className="ph-health-cell">
              <span style={{ width: `${fill * 100}%` }} />
            </span>
          );
        })}
      </span>
      <p className="ph-sub">out of {max}</p>
    </div>
  );
}

/** Rounds played, with the last few weeks as a strip: solved, K.O., or missed. */
function RecentDays({ profile }: { profile: PlayerProfile }) {
  const days = profile.compare.rounds.filter((r) => r.date >= LAUNCH_DATE);
  return (
    <div className="ph-card">
      <p className="ph-big">{profile.stats.played}</p>
      <p className="ph-label">Rounds played</p>
      <ol className="ph-days" aria-label="Recent rounds">
        {days.map((day) => {
          const kind = day.you === null ? "missed" : day.you === "lost" ? "lost" : "solved";
          const text = kind === "missed" ? "not played" : kind === "lost" ? "K.O." : `solved in ${day.you}`;
          return (
            <li key={day.date} className={`ph-day is-${kind}`} title={`${formatDay(day.date, "short")}: ${text}`}>
              <span className="visually-hidden">
                {formatDay(day.date, "short")}: {text}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ph-sub">Last {days.length} days</p>
    </div>
  );
}

/** The best climb, titled the way the Tower itself titles that floor. */
export function TowerCard({ tower }: { tower: PlayerProfile["tower"] }) {
  if (tower.runs === 0) {
    return (
      <p className="history-note">
        You haven't climbed the {TOWER_NAME} yet. <a href={TOWER_HASH}>Give it a try</a>.
      </p>
    );
  }
  const danger = floorDanger(tower.bestFloor);
  const omen = floorOmen(tower.bestFloor);
  return (
    <div className={`arcade-stage ph-tower danger-${danger}`}>
      <div className={`floor-block danger-${danger}`}>
        <p className="ph-label">Best climb</p>
        <p className={`arcade-title danger-${danger}`}>
          Floor <span className="arcade-floor">{tower.bestFloor}</span>
        </p>
        {omen && <p className="floor-omen">{omen}</p>}
      </div>
      <dl className="ph-tower-numbers">
        <div>
          <dt>Average floor</dt>
          <dd>{tower.averageFloor ?? "–"}</dd>
        </div>
        <div>
          <dt>Climbs</dt>
          <dd>{tower.runs}</dd>
        </div>
        <div>
          <dt>Floors beaten</dt>
          <dd>{tower.floorsCleared}</dd>
        </div>
      </dl>
    </div>
  );
}
