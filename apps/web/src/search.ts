import type { CharacterSummary } from "./api";

/** Lowercase, without accents or punctuation, so "grøh", "Grøh" and "groh" all match. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents split off by NFD
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Names matching what the player typed, best first:
 * 1. the name starts with it ("ky" → Ky Kiske)
 * 2. a later word starts with it ("bison" → M. Bison)
 * 3. it appears anywhere in the name
 * Characters already guessed are left out.
 */
export function matchCharacters(
  query: string,
  characters: readonly CharacterSummary[],
  excludedIds: ReadonlySet<string>,
  limit = 8,
): CharacterSummary[] {
  const q = normalize(query);
  if (!q) return [];

  const ranked: { character: CharacterSummary; rank: number }[] = [];
  for (const character of characters) {
    if (excludedIds.has(character.id)) continue;
    const name = normalize(character.name);
    const words = character.name.split(/[\s\-.']+/).map(normalize);

    const rank = name.startsWith(q) ? 0 : words.some((word) => word.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push({ character, rank });
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || a.character.name.localeCompare(b.character.name))
    .slice(0, limit)
    .map(({ character }) => character);
}
