import { describe, expect, it } from "vitest";
import type { TodayResults } from "./api";
import { percentBeaten, percentSolved } from "./results";

// Ten players: 1 solved in 1, 2 in 2, 3 in 3, 2 in 5, and 2 ran out.
const day: TodayResults = {
  players: 10,
  solvedIn: [1, 2, 3, 0, 2, 0, 0, 0, 0, 0],
  lost: 2,
  you: null,
};

describe("percentBeaten", () => {
  it("counts players who needed more guesses or ran out, out of everyone else", () => {
    // A solve in 3 (the viewer is one of the three): beats the two in 5 and the
    // two who ran out = 4 of the 9 others.
    expect(percentBeaten(day, 3)).toBe(44);
  });

  it("doesn't count ties as beaten", () => {
    // The fastest solve, but the only one: everyone else is slower.
    expect(percentBeaten(day, 1)).toBe(100);
  });

  it("says 0 for a loss", () => {
    expect(percentBeaten(day, "lost")).toBe(0);
  });

  it("says nothing when nobody else has finished", () => {
    expect(percentBeaten({ players: 1, solvedIn: [1, 0, 0], lost: 0, you: 1 }, 1)).toBeNull();
  });
});

describe("percentSolved", () => {
  it("is the share of finished players who solved it", () => {
    expect(percentSolved(day)).toBe(80);
    expect(percentSolved({ players: 0, solvedIn: [], lost: 0, you: null })).toBe(0);
  });
});
