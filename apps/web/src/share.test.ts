import { describe, expect, it } from "vitest";
import type { ClueStatus, GuessResult } from "./api";
import { buildShareText, puzzleNumber } from "./share";

function guess(name: string, statuses: ClueStatus[], solved = false): GuessResult {
  return {
    guess: {
      id: name,
      name,
      franchise: "Test",
      developer: "Test",
      debutYear: 2000,
      archetypes: ["rushdown"],
      species: "Human",
      homeCountry: null,
      gamesAppearedIn: 1,
    },
    solved,
    clues: statuses.map((status, i) => ({ key: `clue${i}`, status })),
  };
}

describe("puzzleNumber", () => {
  it("counts days from launch, starting at 1", () => {
    expect(puzzleNumber("2026-11-13")).toBe(1);
    expect(puzzleNumber("2026-11-14")).toBe(2);
    expect(puzzleNumber("2027-11-13")).toBe(366);
  });
});

describe("buildShareText", () => {
  it("shows one row of squares per guess, oldest first, ending with the link", () => {
    const newestFirst = [
      guess("Answer", ["correct", "correct", "correct"], true),
      guess("Second", ["correct", "partial", "unknown"]),
      guess("First", ["wrong", "partial", "wrong"]),
    ];

    expect(buildShareText("2026-11-15", newestFirst, 10, "https://example.com")).toBe(
      ["Dragonpunchedle #3 3/10", "⬛🟨⬛", "🟩🟨⬜", "🟩🟩🟩", "https://example.com"].join("\n"),
    );
  });

  it("scores a first-try solve as 1/10", () => {
    const text = buildShareText("2026-11-13", [guess("Answer", ["correct"], true)], 10, "https://example.com");
    expect(text.split("\n")[0]).toBe("Dragonpunchedle #1 1/10");
  });

  it("scores running out of guesses as X/10", () => {
    const missed = Array.from({ length: 10 }, (_, i) => guess(`Miss ${i}`, ["wrong"]));
    const text = buildShareText("2026-11-13", missed, 10, "https://example.com");
    expect(text.split("\n")[0]).toBe("Dragonpunchedle #1 X/10");
  });

  it("never includes character names", () => {
    const text = buildShareText("2026-11-13", [guess("Ryu", ["correct"], true)], 10, "https://example.com");
    expect(text).not.toContain("Ryu");
  });
});
