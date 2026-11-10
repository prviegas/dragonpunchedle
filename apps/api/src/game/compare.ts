import { CLUES, type Character, type ClueDefinition, type ClueValue } from "./clues.js";

/** What the player sees on each clue tile:
 * - "correct": exact match (green)
 * - "partial": some archetypes shared, a number close to the answer, or a country
 *   on the same continent (yellow)
 * - "wrong": no match (grey)
 * - "unknown": one of the two characters has no official data, so no hint
 */
export type ClueStatus = "correct" | "partial" | "wrong" | "unknown";

export interface ClueResult {
  key: ClueDefinition["key"];
  status: ClueStatus;
  /** Number clues only, on a miss: is the answer higher or lower than the guess? */
  direction?: "higher" | "lower";
}

export interface GuessResult {
  solved: boolean;
  clues: ClueResult[];
}

export function compareClue(clue: ClueDefinition, guess: ClueValue, answer: ClueValue): ClueResult {
  if (guess === null || answer === null) {
    return { key: clue.key, status: "unknown" };
  }

  switch (clue.kind) {
    case "exact": {
      if (guess === answer) {
        return { key: clue.key, status: "correct" };
      }
      if (clue.groupOf && typeof guess === "string" && typeof answer === "string") {
        const group = clue.groupOf(guess);
        // Both must have a known group: two unmapped values aren't "close" to each other.
        if (group !== undefined && group === clue.groupOf(answer)) {
          return { key: clue.key, status: "partial" };
        }
      }
      return { key: clue.key, status: "wrong" };
    }

    case "set": {
      if (!Array.isArray(guess) || !Array.isArray(answer)) {
        throw new TypeError(`Clue "${clue.key}" expects lists of values`);
      }
      const answerSet = new Set<string>(answer);
      const shared = guess.filter((value: string) => answerSet.has(value)).length;
      // Same values in any order: ["zoner", "rushdown"] equals ["rushdown", "zoner"].
      if (shared === answerSet.size && new Set(guess).size === answerSet.size) {
        return { key: clue.key, status: "correct" };
      }
      return { key: clue.key, status: shared > 0 ? "partial" : "wrong" };
    }

    case "number": {
      if (typeof guess !== "number" || typeof answer !== "number") {
        throw new TypeError(`Clue "${clue.key}" expects numbers`);
      }
      if (guess === answer) {
        return { key: clue.key, status: "correct" };
      }
      const isClose = clue.closeWithin !== undefined && Math.abs(guess - answer) <= clue.closeWithin;
      return {
        key: clue.key,
        status: isClose ? "partial" : "wrong",
        direction: answer > guess ? "higher" : "lower",
      };
    }
  }
}

export function compareGuess(
  guess: Character,
  answer: Character,
  clues: readonly ClueDefinition[] = CLUES,
): GuessResult {
  // Solved is decided by identity, not by clues: two characters can share every clue.
  const solved = guess.id === answer.id;
  return {
    solved,
    // The right character is right on every clue, including ones with no data,
    // which would otherwise show as "unknown".
    clues: clues.map((clue) =>
      solved ? { key: clue.key, status: "correct" } : compareClue(clue, guess[clue.key], answer[clue.key]),
    ),
  };
}
