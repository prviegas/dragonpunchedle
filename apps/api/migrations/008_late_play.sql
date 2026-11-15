-- Past rounds can be played after their day. Such a guess is "late": it shows
-- in the player's history, but never in that day's results chart, the
-- leaderboards or streaks, since by then the answer may be common knowledge.
-- Set by the server from its own clock when the guess is saved.
ALTER TABLE guesses ADD COLUMN late boolean NOT NULL DEFAULT false;

-- "Show answer" on a past round the player hasn't finished. It ends that round
-- for them: no guesses after seeing the answer.
CREATE TABLE round_reveals (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint REFERENCES users (id) ON DELETE CASCADE,
  guest_id    text,
  puzzle_date date NOT NULL REFERENCES daily_puzzles (puzzle_date),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT round_reveals_one_player CHECK ((user_id IS NULL) <> (guest_id IS NULL))
);

CREATE UNIQUE INDEX round_reveals_user_day_key ON round_reveals (user_id, puzzle_date) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX round_reveals_guest_day_key ON round_reveals (guest_id, puzzle_date) WHERE guest_id IS NOT NULL;
