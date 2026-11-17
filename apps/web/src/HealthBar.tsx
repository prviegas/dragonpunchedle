/**
 * The guesses left, drawn as a fighting game's health bar: one segment per
 * guess, emptying from the right as guesses are used. Green while most are
 * left, yellow past the middle, red for the last three.
 *
 * `total` (optional) keeps a longer bar: segments beyond `max` are destroyed,
 * guesses the Tower has taken away for good, and the count reads against the
 * total (9/10).
 */
export function HealthBar({
  player,
  used,
  max,
  total = max,
}: {
  player: string;
  used: number;
  max: number;
  total?: number;
}) {
  const left = Math.max(max - used, 0);
  const level = left <= 3 ? "low" : left <= max / 2 + 1 ? "mid" : "high";
  const destroyed = Math.max(total - max, 0);

  return (
    <div className={`hud is-${level}`}>
      <span className="hud-player">{player}</span>
      {/* One picture with one description, rather than ten unlabeled boxes. */}
      <div
        className="health"
        role="img"
        aria-label={`${left} of ${max} guesses left${destroyed ? `, ${destroyed} lost to the tower` : ""}`}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={
              i >= max
                ? `health-cell is-destroyed wreck-${(i % 3) + 1}`
                : i < left
                  ? "health-cell is-full"
                  : "health-cell"
            }
          />
        ))}
      </div>
      <span className="hud-count" aria-hidden="true">
        {left}
        <small>/{total}</small>
      </span>
    </div>
  );
}
