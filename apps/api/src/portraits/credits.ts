// Who owns each franchise's character art, shown under every portrait.
// The rights holder, which isn't always the developer: Iron Galaxy makes
// Killer Instinct, but Microsoft owns it; Dragon Ball's characters belong to
// their creators and Toei, whoever makes the game.
export const CREDITS: Readonly<Record<string, string>> = {
  "2XKO": "© Riot Games",
  BlazBlue: "© Arc System Works",
  Darkstalkers: "© Capcom",
  "Dead or Alive": "© Koei Tecmo Games",
  "Dragon Ball FighterZ": "© Bird Studio/Shueisha, Toei Animation; game © Bandai Namco",
  "Fatal Fury": "© SNK",
  "Granblue Fantasy Versus": "© Cygames",
  "Guilty Gear": "© Arc System Works",
  "Killer Instinct": "© Microsoft",
  "Mortal Kombat": "© Warner Bros. Games",
  "Samurai Shodown": "© SNK",
  Soulcalibur: "© Bandai Namco",
  "Street Fighter": "© Capcom",
  Tekken: "© Bandai Namco",
  "The King of Fighters": "© SNK",
  "Under Night In-Birth": "© French-Bread, Arc System Works",
  "Virtua Fighter": "© Sega",
};

export function creditFor(franchise: string): string {
  const credit = CREDITS[franchise];
  // Refusing beats guessing: an image with the wrong owner's name on it is worse than none.
  if (!credit) throw new Error(`No credit known for the franchise "${franchise}". Add it to src/portraits/credits.ts.`);
  return credit;
}
