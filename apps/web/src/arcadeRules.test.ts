import { describe, expect, it } from "vitest";
import type { ArcadeCleared } from "./api";
import { bestComboOf, buildArcadeShare, comboHeat, comboOf } from "./arcadeRules";

const floor = (n: number, guesses: number): ArcadeCleared => ({
  floor: n,
  guesses,
  character: { id: `c${n}`, name: `C${n}`, franchise: "Test", portrait: undefined },
});

describe("combo", () => {
  it("counts quick floors in a row, ending with the latest", () => {
    expect(comboOf([])).toBe(0);
    expect(comboOf([floor(1, 2), floor(2, 3)])).toBe(2);
    expect(comboOf([floor(1, 2), floor(2, 6), floor(3, 1)])).toBe(1);
    expect(comboOf([floor(1, 2), floor(2, 6)])).toBe(0);
  });

  it("remembers the run's best combo", () => {
    expect(bestComboOf([floor(1, 2), floor(2, 1), floor(3, 3), floor(4, 7), floor(5, 2)])).toBe(3);
    expect(bestComboOf([floor(1, 6)])).toBe(0);
  });

  it("burns hotter as it grows", () => {
    expect([2, 3, 4, 5, 7, 8, 20].map(comboHeat)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("buildArcadeShare", () => {
  it("shows the floor, a square per floor and the best combo", () => {
    const run = [floor(1, 2), floor(2, 3), floor(3, 1), floor(4, 7), floor(5, 4)];
    expect(buildArcadeShare(run, true, "https://x")).toBe(
      ["Dragonpunchedle Arcade 🕹️ Floor 5", "🟩🟩🟩🟧🟨💀", "Best combo: 3 hits", "https://x"].join("\n"),
    );
  });

  it("stays short for a run lost on floor 1", () => {
    expect(buildArcadeShare([], true, "https://x")).toBe(["Dragonpunchedle Arcade 🕹️ Floor 0", "💀", "https://x"].join("\n"));
  });
});
