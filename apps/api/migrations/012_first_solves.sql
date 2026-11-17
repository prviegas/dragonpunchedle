-- The first logged-in player to solve each day's round, on the day. Written
-- the moment that solve is saved (see saveGuess), never worked out later:
-- a guest's solve that moves into an account on login keeps its earlier
-- time, and must not take the badge from someone who was logged in.
CREATE TABLE first_solves (
  puzzle_date date PRIMARY KEY REFERENCES daily_puzzles (puzzle_date) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  solved_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX first_solves_user_id_idx ON first_solves (user_id);
