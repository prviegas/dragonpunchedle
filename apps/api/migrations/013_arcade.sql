-- Arcade Ladder: endless rounds against random fighters, one floor each, until
-- a floor is lost. Kept apart from the daily game: arcade guesses never touch
-- the daily chart, leaderboards or streaks.
CREATE TABLE arcade_runs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        bigint REFERENCES users (id) ON DELETE CASCADE,
  guest_id       text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when a floor is lost (or a new run replaces this one).
  ended_at       timestamptz,
  floors_cleared integer NOT NULL DEFAULT 0,
  CONSTRAINT arcade_runs_one_player CHECK ((user_id IS NULL) <> (guest_id IS NULL))
);

-- At most one run in progress per player.
CREATE UNIQUE INDEX arcade_runs_active_user ON arcade_runs (user_id) WHERE ended_at IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX arcade_runs_active_guest ON arcade_runs (guest_id) WHERE ended_at IS NULL AND guest_id IS NOT NULL;
-- The ladder leaderboard: accounts' best runs.
CREATE INDEX arcade_runs_best ON arcade_runs (floors_cleared DESC) WHERE user_id IS NOT NULL;

CREATE TABLE arcade_floors (
  run_id       bigint NOT NULL REFERENCES arcade_runs (id) ON DELETE CASCADE,
  floor        integer NOT NULL CHECK (floor >= 1),
  -- The opponent. Secret until the floor is cleared or lost.
  character_id text NOT NULL REFERENCES characters (id),
  -- The guesses on this floor, in order.
  guesses      text[] NOT NULL DEFAULT '{}',
  solved       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, floor)
);
