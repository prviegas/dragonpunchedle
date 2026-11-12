/**
 * The guesses left, drawn as a fighting game's health bar: one segment per
 * guess, emptying from the right as guesses are used. It turns red when
 * three or fewer are left.
 */
export function HealthBar({ player, used, max }: { player: string; used: number; max: number }) {
  const left = Math.max(max - used, 0);
  const danger = left <= 3;

  return (
    <div className={danger ? "hud is-danger" : "hud"}>
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
