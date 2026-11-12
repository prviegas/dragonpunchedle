import { describe, expect, it } from "vitest";
import type { TodayResults } from "./api";
import { percentBeaten, percentSolved, withViewer } from "./results";

// Ten players: 1 solved in 1, 2 in 2, 3 in 3, 2 in 5, and 2 ran out.
const day: TodayResults = {
  players: 10,
  solvedIn: [1, 2, 3, 0, 2, 0, 0, 0, 0, 0],
  lost: 2,
  you: null,
};

describe("withViewer", () => {
  it("leaves a logged-in player's results alone: the server already counted them", () => {
    expect(withViewer(day, 3, true)).toBe(day);
  });

  it("adds a guest's solve to their bar", () => {
    const shown = withViewer(day, 4, false);
    expect(shown).toMatchObject({ players: 11, lost: 2, you: 4 });
    expect(shown.solvedIn[3]).toBe(1);
  });

  it("adds a guest's loss to the K.O. bar", () => {
    expect(withViewer(day, "lost", false)).toMatchObject({ players: 11, lost: 3, you: "lost" });
  });
});

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
