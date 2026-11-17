import { describe, expect, it } from "vitest";
import type { ArcadeCleared } from "./api";
import { buildTowerShare, floorDanger } from "./arcadeRules";

const floor = (n: number, guesses: number): ArcadeCleared => ({
  floor: n,
  guesses,
  character: { id: `c${n}`, name: `C${n}`, franchise: "Test", portrait: undefined },
});

describe("floorDanger", () => {
  it("gets more menacing the higher the floor", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 14, 15, 40].map(floorDanger)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe("buildTowerShare", () => {
  it("shows the floor reached and a square per floor", () => {
    const run = [floor(1, 2), floor(2, 3), floor(3, 1), floor(4, 7), floor(5, 4)];
    expect(buildTowerShare(run, true, "https://x")).toBe(
      ["Dragonpunchedle 🗼 Tower of Endless Struggle: floor 5", "🟩🟩🟩🟧🟨💀", "https://x"].join("\n"),
    );
  });

  it("stays short for a run lost on floor 1", () => {
    expect(buildTowerShare([], true, "https://x")).toBe(
      ["Dragonpunchedle 🗼 Tower of Endless Struggle: floor 0", "💀", "https://x"].join("\n"),
    );
  });
});
