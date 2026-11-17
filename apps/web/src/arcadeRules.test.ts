import { describe, expect, it } from "vitest";
import type { ArcadeCleared } from "./api";
import { buildTowerShare, floorDanger, floorOmen } from "./arcadeRules";

const floor = (n: number, guesses: number): ArcadeCleared => ({
  floor: n,
  guesses,
  character: { id: `c${n}`, name: `C${n}`, franchise: "Test", portrait: undefined },
});

describe("floorDanger", () => {
  it("gets more menacing the higher the floor", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 14, 15, 19, 20, 29, 30, 99].map(floorDanger)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    ]);
  });

  it("has a line for every level", () => {
    expect(floorOmen(1)).toBe("The climb begins.");
    expect(floorOmen(40)).toBe("Endless.");
  });
});

describe("buildTowerShare", () => {
  it("shows the floor reached and a square per floor", () => {
    const run = [floor(1, 2), floor(2, 3), floor(3, 1), floor(4, 7), floor(5, 4)];
    expect(buildTowerShare(6, run, true, "https://x")).toBe(
      ["Dragonpunchedle 🗼 Tower of Endless Struggle: floor 6", "🟩🟩🟩🟧🟨💀", "https://x"].join("\n"),
    );
  });

  it("stays short for a run lost on floor 1", () => {
    expect(buildTowerShare(1, [], true, "https://x")).toBe(
      ["Dragonpunchedle 🗼 Tower of Endless Struggle: floor 1", "💀", "https://x"].join("\n"),
    );
  });
});
