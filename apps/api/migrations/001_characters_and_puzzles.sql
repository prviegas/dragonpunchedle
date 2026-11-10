-- The roster: one row per character, one column per clue.
CREATE TABLE characters (
  -- A readable slug such as 'street-fighter-ryu', so ids are stable across reseeds.
  id                text PRIMARY KEY,
  name              text NOT NULL,
  franchise         text NOT NULL,
  developer         text NOT NULL,
  debut_year        smallint NOT NULL CHECK (debut_year BETWEEN 1980 AND 2100),
  -- A Postgres array: a character can have several archetypes.
  archetypes        text[] NOT NULL CHECK (cardinality(archetypes) > 0),
  species           text NOT NULL,
  -- NULL when the games never say where the character is from.
  home_country      text,
  games_appeared_in smallint NOT NULL CHECK (games_appeared_in > 0),
  -- Two franchises can share a name (e.g. a "Kenji"), but one franchise can't list a character twice.
  UNIQUE (franchise, name)
);

-- One answer per day, picked ahead of time by the scheduled job.
CREATE TABLE daily_puzzles (
  puzzle_date  date PRIMARY KEY,
  character_id text NOT NULL REFERENCES characters (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
