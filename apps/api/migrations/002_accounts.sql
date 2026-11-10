CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL,
  -- Never the password itself: a salted scrypt hash (see src/auth/passwords.ts).
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- "Ryu" and "ryu" are the same account name: uniqueness ignores case,
-- while the name keeps the capitalisation the player chose.
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

CREATE TABLE sessions (
  -- A SHA-256 of the session token. The token itself lives only in the
  -- player's cookie, so a leaked copy of this table can't be used to log in.
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Guesses of logged-in players, so their board follows them across devices
-- and streaks can be worked out later.
CREATE TABLE guesses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  puzzle_date  date NOT NULL REFERENCES daily_puzzles (puzzle_date),
  character_id text NOT NULL REFERENCES characters (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Guessing the same character twice on the same day is pointless.
  UNIQUE (user_id, puzzle_date, character_id)
);
