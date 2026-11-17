import type { ClueInfo } from "./api";

/**
 * The rules, short. Most players know this kind of game already, so it lives
 * behind a "How to play" button rather than greeting everyone. The per-column
 * yellow rules come from the server, the same definitions it scores with.
 */
interface HowToPlayProps {
  clues: ClueInfo[];
  maxGuesses: number;
  /** Start with "When each column turns yellow" open: the player asked about exactly that. */
  showCloseRules?: boolean;
  onClose: () => void;
}

export function HowToPlay({ clues, maxGuesses, showCloseRules = false, onClose }: HowToPlayProps) {
  return (
    <div className="panel how-to">
      <div className="panel-head">
        <h2 className="panel-title">How to play</h2>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <p>
        Guess today's fighting game character in {maxGuesses} tries. Each guess shows how its details compare to the
        answer's.
      </p>

      <ul className="legend legend--panel">
        <li>
          <span className="swatch tile--correct" /> <strong>Green:</strong> the same as the answer
        </li>
        <li>
          <span className="swatch tile--partial" /> <strong>Yellow:</strong> close (see each column below)
        </li>
        <li>
          <span className="swatch tile--wrong" /> <strong>Grey:</strong> not it
        </li>
        <li>
          <span className="swatch tile--unknown" /> <strong>?</strong> no data for one of the two, so no hint
        </li>
        <li>
          <span className="swatch-arrow" aria-hidden="true">
            ▲▼
          </span>{" "}
          On numbers: the answer is higher or lower
        </li>
      </ul>

      <details className="how-to-more" open={showCloseRules}>
        <summary className="how-to-sub">
          <span className="swatch tile--partial" aria-hidden="true" />
          When each column turns yellow
        </summary>
        <dl className="close-rules">
          {clues.map((clue) => (
            <div key={clue.key} className="close-rule">
              <dt>{clue.label}</dt>
              <dd className={clue.close ? undefined : "is-never"}>{clue.close ?? "Never: right or wrong"}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="how-to-foot">
        A new fighter every day at midnight UTC. Missed one? Play it from <a href="#past" onClick={onClose}>Past rounds</a>.
      </p>
    </div>
  );
}
