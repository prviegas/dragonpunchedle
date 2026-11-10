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

function Tile({ clue, result, character }: { clue: ClueInfo; result: ClueResult; character: Character }) {
  const text = valueText(character, clue.key);
  const arrow = result.direction === "higher" ? "↑" : result.direction === "lower" ? "↓" : "";
  // Colour alone isn't enough (colour blindness, screen readers), so every tile
  // also says its status in words.
  const label = `${clue.label}: ${text}, ${STATUS_TEXT[result.status]}${
    result.direction ? `, the answer is ${result.direction}` : ""
  }`;

  return (
    <td className={`tile tile--${result.status}`} aria-label={label} title={label}>
      <span className="tile-value">{text}</span>
      {arrow && (
        <span className="tile-arrow" aria-hidden="true">
          {arrow}
        </span>
      )}
    </td>
  );
}

export function Board({ clues, guesses }: { clues: ClueInfo[]; guesses: GuessResult[] }) {
  if (guesses.length === 0) return null;

  return (
    // The wrapper scrolls sideways on narrow screens, so the page itself never does.
    <div className="board-scroll">
      <table className="board">
        <thead>
          <tr>
            <th scope="col">Character</th>
            {clues.map((clue) => (
              <th scope="col" key={clue.key}>
                {clue.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guesses.map(({ guess, clues: results, solved }) => (
            <tr key={guess.id}>
              <th scope="row" className={solved ? "guess-name is-solved" : "guess-name"}>
                <span>{guess.name}</span>
              </th>
              {clues.map((clue) => {
                const result = results.find((r) => r.key === clue.key);
                return result ? (
                  <Tile key={clue.key} clue={clue} result={result} character={guess} />
                ) : (
                  <td key={clue.key} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
