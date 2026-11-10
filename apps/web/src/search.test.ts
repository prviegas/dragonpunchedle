import { describe, expect, it } from "vitest";
import type { CharacterSummary } from "./api";
import { matchCharacters } from "./search";

const roster: CharacterSummary[] = [
  { id: "ky", name: "Ky Kiske", franchise: "Guilty Gear" },
  { id: "kyo", name: "Kyo Kusanagi", franchise: "The King of Fighters" },
  { id: "bison", name: "M. Bison", franchise: "Street Fighter" },
  { id: "groh", name: "Grøh", franchise: "Soulcalibur" },
  { id: "jack", name: "Jack-O'", franchise: "Guilty Gear" },
  { id: "nakoruru", name: "Nakoruru", franchise: "Samurai Shodown" },
];

const names = (query: string, excluded: string[] = []) =>
  matchCharacters(query, roster, new Set(excluded)).map((c) => c.name);

describe("matchCharacters", () => {
  it("returns nothing for an empty query", () => {
    expect(names("")).toEqual([]);
    expect(names("  ")).toEqual([]);
  });

  it("puts names that start with the query first", () => {
    expect(names("ky")).toEqual(["Ky Kiske", "Kyo Kusanagi"]);
  });

  it("matches the start of a later word", () => {
    expect(names("bison")).toEqual(["M. Bison"]);
  });

  it("ranks a match inside a word last", () => {
    expect(names("ru")).toEqual(["Nakoruru"]);
    expect(names("k")).toEqual(["Ky Kiske", "Kyo Kusanagi", "Jack-O'", "Nakoruru"]);
  });

  it("ignores case, accents and punctuation", () => {
    expect(names("GROH")).toEqual(["Grøh"]);
    expect(names("jacko")).toEqual(["Jack-O'"]);
    expect(names("m.bi")).toEqual(["M. Bison"]);
  });

  it("leaves out characters already guessed", () => {
    expect(names("ky", ["ky"])).toEqual(["Kyo Kusanagi"]);
  });

  it("stops at the limit", () => {
    expect(matchCharacters("k", roster, new Set(), 2)).toHaveLength(2);
  });
});
