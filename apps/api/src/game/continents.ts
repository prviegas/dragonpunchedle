export type Continent = "Africa" | "Asia" | "Europe" | "North America" | "Oceania" | "South America";

// Countries a fighting game character could plausibly come from. Fictional
// places (e.g. "Outworld") are deliberately missing: they belong to no
// continent, so they never count as close. Once the roster exists, a test
// will check that every real country in it is listed here.
const CONTINENT_BY_COUNTRY: Readonly<Record<string, Continent>> = {
  // Africa
  Egypt: "Africa",
  Ghana: "Africa",
  Kenya: "Africa",
  Morocco: "Africa",
  Nigeria: "Africa",
  "South Africa": "Africa",
  // Asia (including the Middle East)
  China: "Asia",
  "Hong Kong": "Asia",
  India: "Asia",
  Indonesia: "Asia",
  Iran: "Asia",
  Israel: "Asia",
  Japan: "Asia",
  Mongolia: "Asia",
  Nepal: "Asia",
  Philippines: "Asia",
  "Saudi Arabia": "Asia",
  "South Korea": "Asia",
  Taiwan: "Asia",
  Thailand: "Asia",
  // A region of China rather than a country, listed because a game names it
  // (Killer Instinct says Jago is from Tibet), like Hong Kong above.
  Tibet: "Asia",
  Turkey: "Asia",
  Vietnam: "Asia",
  // Europe
  Austria: "Europe",
  Belgium: "Europe",
  Denmark: "Europe",
  Finland: "Europe",
  France: "Europe",
  Germany: "Europe",
  Greece: "Europe",
  Hungary: "Europe",
  Ireland: "Europe",
  Italy: "Europe",
  Monaco: "Europe",
  Netherlands: "Europe",
  Norway: "Europe",
  Poland: "Europe",
  Portugal: "Europe",
  Romania: "Europe",
  Russia: "Europe",
  Spain: "Europe",
  Sweden: "Europe",
  Switzerland: "Europe",
  Ukraine: "Europe",
  "United Kingdom": "Europe",
  // North America (including Central America and the Caribbean)
  Canada: "North America",
  Cuba: "North America",
  Jamaica: "North America",
  Mexico: "North America",
  "United States": "North America",
  // Oceania
  Australia: "Oceania",
  "New Zealand": "Oceania",
  // South America
  Argentina: "South America",
  Brazil: "South America",
  Chile: "South America",
  Colombia: "South America",
  Peru: "South America",
  Venezuela: "South America",
};

// Places from the games' own worlds. Listing them explicitly means a typo in a
// real country name still fails validation instead of passing as "fictional".
export const FICTIONAL_PLACES: ReadonlySet<string> = new Set([
  // Mortal Kombat
  "Edenia",
  "Netherrealm",
  "Outworld",
  // Guilty Gear
  "Illyria",
  "Zepp",
  // League of Legends (2XKO)
  "Bandle City",
  "Bilgewater",
  "Demacia",
  "Freljord",
  "Ionia",
  "Noxus",
  "Piltover",
  "Shadow Isles",
  "Zaun",
]);

export function continentOf(country: string): Continent | undefined {
  return CONTINENT_BY_COUNTRY[country];
}
