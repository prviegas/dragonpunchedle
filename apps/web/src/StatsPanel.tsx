import type { PlayerStats } from "./api";

export function StatsPanel({ stats }: { stats: PlayerStats }) {
  const winRate = stats.played > 0 ? Math.round((stats.solved / stats.played) * 100) : 0;
  const items = [
    { label: "Played", value: stats.played },
    { label: "Solved", value: `${winRate}%` },
    { label: "Current streak", value: stats.currentStreak },
    { label: "Best streak", value: stats.maxStreak },
    { label: "Avg. guesses", value: stats.averageGuesses ?? "–" },
  ];

  return (
    <dl className="stats">
      {items.map(({ label, value }) => (
        // A label (dt) has to come before its value (dd) in the markup;
        // the CSS shows the number on top.
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
