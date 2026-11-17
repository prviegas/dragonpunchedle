/**
 * The day's first logged-in solve. Shown on the result card, in Past rounds,
 * and in the share text, so the player can brag about it anywhere.
 */
export function FirstSolveBadge({ large = false }: { large?: boolean }) {
  return (
    <span
      className={large ? "outcome outcome--first outcome--large" : "outcome outcome--first"}
      title="The first logged-in player to solve this round on the day"
    >
      <span aria-hidden="true">🥇 </span>First solve
    </span>
  );
}
