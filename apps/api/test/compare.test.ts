import { describe, expect, it } from "vitest";
import { CLUES, type Character, type ClueDefinition } from "../src/game/clues.js";
import { compareClue, compareGuess } from "../src/game/compare.js";

// Made-up characters, so the tests don't depend on the real roster.
function character(overrides: Partial<Character>): Character {
  return {
    id: "test",
    name: "Test",
    franchise: "Alpha",
    developer: "Studio",
    debutYear: 2000,
    archetypes: ["rushdown"],
    species: "Human",
    gender: "Male",
    homeCountry: "Japan",
    gamesAppearedIn: 5,
    ...overrides,
  };
}

const franchise: ClueDefinition = { key: "franchise", label: "Franchise", kind: "exact" };
const archetypes: ClueDefinition = { key: "archetypes", label: "Archetypes", kind: "set" };
const games: ClueDefinition = { key: "gamesAppearedIn", label: "Games appeared in", kind: "number", closeWithin: 2 };

describe("exact clues", () => {
  it("is correct only when the values are the same", () => {
    expect(compareClue(franchise, "Alpha", "Alpha").status).toBe("correct");
    expect(compareClue(franchise, "Alpha", "Beta").status).toBe("wrong");
  });
});

describe("exact clues with groups (home country)", () => {
  const homeCountry = CLUES.find((clue) => clue.key === "homeCountry")!;

  it("is partial for a different country on the same continent", () => {
    expect(compareClue(homeCountry, "Japan", "South Korea").status).toBe("partial");
  });

  it("is wrong across continents", () => {
    expect(compareClue(homeCountry, "Japan", "Brazil").status).toBe("wrong");
  });

  it("never treats fictional places as close", () => {
    expect(compareClue(homeCountry, "Outworld", "Japan").status).toBe("wrong");
    expect(compareClue(homeCountry, "Outworld", "Edenia").status).toBe("wrong");
    expect(compareClue(homeCountry, "Outworld", "Outworld").status).toBe("correct");
  });
});

describe("set clues", () => {
  it("ignores order", () => {
    expect(compareClue(archetypes, ["zoner", "rushdown"], ["rushdown", "zoner"]).status).toBe("correct");
  });

  it("is partial when only some values are shared", () => {
    expect(compareClue(archetypes, ["rushdown"], ["rushdown", "zoner"]).status).toBe("partial");
    expect(compareClue(archetypes, ["rushdown", "grappler"], ["rushdown"]).status).toBe("partial");
  });

  it("is wrong when nothing is shared", () => {
    expect(compareClue(archetypes, ["grappler"], ["zoner"]).status).toBe("wrong");
  });
});

describe("number clues", () => {
  it("is correct on an exact match, with no direction", () => {
    expect(compareClue(games, 5, 5)).toEqual({ key: "gamesAppearedIn", status: "correct" });
  });

  it("points higher or lower on a miss", () => {
    expect(compareClue(games, 2, 9)).toEqual({ key: "gamesAppearedIn", status: "wrong", direction: "higher" });
    expect(compareClue(games, 9, 2)).toEqual({ key: "gamesAppearedIn", status: "wrong", direction: "lower" });
  });

  it("is partial within the close range, including its edge", () => {
    expect(compareClue(games, 3, 5)).toEqual({ key: "gamesAppearedIn", status: "partial", direction: "higher" });
    expect(compareClue(games, 2, 5).status).toBe("wrong");
  });
});

describe("missing data", () => {
  it("gives no hint when either character has no value", () => {
    expect(compareClue(franchise, null, "Alpha").status).toBe("unknown");
    expect(compareClue(games, 5, null).status).toBe("unknown");
  });
});

describe("compareGuess", () => {
  it("is solved only when the guess is the answer itself", () => {
    const answer = character({ id: "a" });
    const lookalike = character({ id: "b" });

    expect(compareGuess(answer, answer).solved).toBe(true);
    expect(compareGuess(lookalike, answer).solved).toBe(false);
  });

  it("marks every clue correct for the answer itself, even ones with no data", () => {
    const answer = character({ id: "a", homeCountry: null });
    const result = compareGuess(answer, answer);

    expect(result.clues.every((clue) => clue.status === "correct")).toBe(true);
  });

  it("still says unknown when a different character also has no data", () => {
    const result = compareGuess(character({ id: "b", homeCountry: null }), character({ id: "a", homeCountry: null }));

    expect(result.clues.find((clue) => clue.key === "homeCountry")?.status).toBe("unknown");
  });

  it("compares gender exactly, and shows no hint when it isn't known", () => {
    const answer = character({ id: "a", gender: "Female" });
    const genderOf = (guess: Character) => compareGuess(guess, answer).clues.find((c) => c.key === "gender")?.status;

    expect(genderOf(character({ id: "b", gender: "Female" }))).toBe("correct");
    expect(genderOf(character({ id: "c", gender: "Male" }))).toBe("wrong");
    expect(genderOf(character({ id: "d", gender: null }))).toBe("unknown");
  });

  it("returns one result per clue, in the order the clues are listed", () => {
    const result = compareGuess(character({ id: "a" }), character({ id: "b", debutYear: 2010 }));

    expect(result.clues.map((clue) => clue.key)).toEqual([
      "franchise",
      "developer",
      "debutYear",
      "archetypes",
      "species",
      "gender",
      "homeCountry",
      "gamesAppearedIn",
    ]);
    expect(result.clues[2]).toEqual({ key: "debutYear", status: "wrong", direction: "higher" });
  });
});
