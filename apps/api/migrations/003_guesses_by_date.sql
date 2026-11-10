-- The daily leaderboard reads every guess for one date. The unique key on
-- (user_id, puzzle_date, character_id) can't help there because it starts with
-- user_id, so give date lookups their own index.
CREATE INDEX guesses_puzzle_date_idx ON guesses (puzzle_date);
