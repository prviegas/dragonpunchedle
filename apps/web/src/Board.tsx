import type { Character, ClueInfo, ClueResult, ClueStatus, GuessResult } from "./api";

const STATUS_TEXT: Record<ClueStatus, string> = {
  correct: "correct",
  partial: "close",
  wrong: "not it",
  unknown: "no data",
};

function valueText(character: Character, key: string): string {
  const value = (character as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "?";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function Tile({ clue, result, character, delay }: { clue: ClueInfo; result: ClueResult; character: Character; delay?: number }) {
  const text = valueText(character, clue.key);
  const arrow = result.direction === "higher" ? "▲" : result.direction === "lower" ? "▼" : "";
  // Colour alone isn't enough (colour blindness, screen readers), so every tile
  // also says its status in words.
  const label = `${clue.label}: ${text}, ${STATUS_TEXT[result.status]}${
    result.direction ? `, the answer is ${result.direction}` : ""
  }`;

  return (
    <td
      className={`tile tile--${result.status}`}
      aria-label={label}
      title={label}
      // Tiles of a new guess flip over one after another, left to right.
      style={delay === undefined ? undefined : { animationDelay: `${delay}ms` }}
    >
      {/* The arrow points the way to the answer: above the value for higher, below for lower. */}
      {result.direction === "higher" && (
        <span className="tile-arrow" aria-hidden="true">
          {arrow}
        </span>
      )}
      <span className="tile-value">{text}</span>
      {result.direction === "lower" && (
        <span className="tile-arrow" aria-hidden="true">
          {arrow}
        </span>
      )}
    </td>
  );
}

/** A small face for the guess's row: the portrait if there is one, initials if not. */
function Thumb({ character }: { character: Character }) {
  if (character.portrait) {
    return <img className="thumb" src={character.portrait.url} alt="" width={36} height={48} loading="lazy" />;
  }
  const initials = character.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
  return (
    <span className="thumb thumb--empty" aria-hidden="true">
      {initials}
    </span>
  );
}

interface BoardProps {
  clues: ClueInfo[];
  guesses: GuessResult[];
  /** The guess just made: its tiles flip in. Earlier ones appear as they are. */
  freshId?: string;
  /** Opens "How to play". With it, column names are buttons that open it. */
  onHelp?: () => void;
  /** After a lost round, the day's character, shown above every guess. A win
   *  doesn't need it: the winning row already is the answer, and stands out. */
  answer?: Character;
}

export function Board({ clues, guesses, freshId, answer, onHelp }: BoardProps) {
  if (guesses.length === 0) return null;

  return (
    // The wrapper scrolls sideways on narrow screens, so the page itself never does.
    <div className="board-scroll">
      <table className="board">
        <thead>
          <tr>
            <th scope="col">Fighter</th>
            {clues.map((clue) => {
              // Columns that can turn yellow get a small "?" mark: hovering (or
              // focusing) shows when, and clicking opens "How to play", which
              // also works on touch screens, where there's no hover. Columns
              // that are only ever right or wrong stay plain.
              if (!clue.close) {
                return (
                  <th scope="col" key={clue.key}>
                    <span>{clue.label}</span>
                  </th>
                );
              }
              const tip = `Yellow: ${clue.close}`;
              // The mark hangs off the last word (see .column-mark).
              const words = clue.label.split(" ");
              const last = words.pop();
              const content = (
                <>
                  {words.length > 0 && `${words.join(" ")} `}
                  <span className="column-last">
                    {last}
                    <span className="column-mark" aria-hidden="true">
                      ?
                    </span>
                  </span>
                </>
              );
              return (
                <th scope="col" key={clue.key}>
                  {onHelp ? (
                    <button type="button" className="column-name" data-tip={tip} aria-label={`${clue.label}. ${tip}`} onClick={onHelp}>
                      {content}
                    </button>
                  ) : (
                    <span className="column-name" data-tip={tip} tabIndex={0} aria-label={`${clue.label}. ${tip}`}>
                      {content}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {answer && (
            <tr className="answer-row">
              <th scope="row" className="guess-name is-answer">
                <span className="guess-cell">
                  <Thumb character={answer} />
                  <span className="guess-text">
                    <span className="answer-label">Answer</span>
                    <span className="guess-title">{answer.name}</span>
                    <span className="guess-franchise">{answer.franchise}</span>
                  </span>
                </span>
              </th>
              {clues.map((clue) => {
                const text = valueText(answer, clue.key);
                return (
                  <td key={clue.key} className="tile tile--answer" aria-label={`${clue.label}: ${text}`} title={`${clue.label}: ${text}`}>
                    <span className="tile-value">{text}</span>
                  </td>
                );
              })}
            </tr>
          )}
          {guesses.map(({ guess, clues: results, solved }) => {
            const fresh = guess.id === freshId;
            return (
              <tr key={guess.id} className={[fresh && "is-fresh", solved && "is-winner"].filter(Boolean).join(" ") || undefined}>
                <th scope="row" className={solved ? "guess-name is-solved" : "guess-name"}>
                  <span className="guess-cell">
                    <Thumb character={guess} />
                    <span className="guess-text">
                      {solved && <span className="winner-label">Got it</span>}
                      <span className="guess-title">{guess.name}</span>
                      <span className="guess-franchise">{guess.franchise}</span>
                    </span>
                  </span>
                </th>
                {clues.map((clue, i) => {
                  const result = results.find((r) => r.key === clue.key);
                  return result ? (
                    <Tile
                      key={clue.key}
                      clue={clue}
                      result={result}
                      character={guess}
                      delay={fresh ? i * 110 : undefined}
                    />
                  ) : (
                    <td key={clue.key} />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
