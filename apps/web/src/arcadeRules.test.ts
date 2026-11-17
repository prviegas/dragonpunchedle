import { describe, expect, it } from "vitest";
import type { ArcadeCleared } from "./api";
import { buildArcadeShare, comboOf, nextRank, rankFor } from "./arcadeRules";

const floor = (n: number, guesses: number): ArcadeCleared => ({
  floor: n,
  guesses,
  character: { id: `c${n}`, name: `C${n}`, franchise: "Test", portrait: undefined },
});

describe("arcade ranks", () => {
  it("names a run by floors cleared", () => {
    expect(rankFor(0)).toBe("Rookie");
    expect(rankFor(3)).toBe("Contender");
    expect(rankFor(9)).toBe("Challenger");
    expect(rankFor(10)).toBe("Champion");
    expect(rankFor(40)).toBe("Final Boss");
  });

  it("says how far the next title is", () => {
    expect(nextRank(1)).toEqual({ name: "Contender", floorsLeft: 2 });
    expect(nextRank(14)).toEqual({ name: "Final Boss", floorsLeft: 1 });
    expect(nextRank(15)).toBeNull();
  });
});

describe("combo", () => {
  it("counts quick floors in a row, ending with the latest", () => {
    expect(comboOf([])).toBe(0);
    expect(comboOf([floor(1, 2), floor(2, 3)])).toBe(2);
    expect(comboOf([floor(1, 2), floor(2, 6), floor(3, 1)])).toBe(1);
    expect(comboOf([floor(1, 2), floor(2, 6)])).toBe(0);
  });
});

describe("buildArcadeShare", () => {
  it("shows the floor, the title, a square per floor and the best combo", () => {
    const run = [floor(1, 2), floor(2, 3), floor(3, 1), floor(4, 7), floor(5, 4)];
    expect(buildArcadeShare(run, true, "https://x")).toBe(
      ["Dragonpunchedle Arcade 🕹️ Floor 5 · Contender", "🟩🟩🟩🟧🟨💀", "Best combo: 3 hits", "https://x"].join("\n"),
    );
  });

  it("stays short for a run lost on floor 1", () => {
    expect(buildArcadeShare([], true, "https://x")).toBe(["Dragonpunchedle Arcade 🕹️ Floor 0 · Rookie", "💀", "https://x"].join("\n"));
  });
});
