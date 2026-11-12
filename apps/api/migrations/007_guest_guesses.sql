-- Guests' guesses are kept too, under an anonymous random id from a cookie
-- (no name, no email). That lets the results chart count everyone, and lets
-- the server enforce the 10-guess limit for guests as well.
-- Each guess belongs to exactly one player: an account or a guest.
ALTER TABLE guesses ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE guesses ADD COLUMN guest_id text;
ALTER TABLE guesses
  ADD CONSTRAINT guesses_one_player CHECK ((user_id IS NULL) <> (guest_id IS NULL));

-- The same "no character twice a day" rule as for accounts.
CREATE UNIQUE INDEX guesses_guest_day_character_key
  ON guesses (guest_id, puzzle_date, character_id)
  WHERE guest_id IS NOT NULL;
