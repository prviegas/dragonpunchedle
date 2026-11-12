/**
 * The guesses left, drawn as a fighting game's health bar: one segment per
 * guess, emptying from the right as guesses are used. Green while most are
 * left, yellow past the middle, red for the last three.
 */
export function HealthBar({ player, used, max }: { player: string; used: number; max: number }) {
  const left = Math.max(max - used, 0);
  const level = left <= 3 ? "low" : left <= max / 2 + 1 ? "mid" : "high";

  return (
    <div className={`hud is-${level}`}>
      <span className="hud-player">{player}</span>
      {/* One picture with one description, rather than ten unlabeled boxes. */}
      <div className="health" role="img" aria-label={`${left} of ${max} guesses left`}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < left ? "health-cell is-full" : "health-cell"} />
        ))}
      </div>
      <span className="hud-count" aria-hidden="true">
        {left}
        <small>/{max}</small>
      </span>
    </div>
  );
}
