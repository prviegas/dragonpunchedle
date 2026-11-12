-- Sign in with Discord or Google. Those accounts have no password of their
-- own, so the column becomes optional. Password login treats a missing hash
-- as "no password matches" (see findUserForLogin).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Which outside account belongs to which player. The provider's user id is
-- the stable key: names on Discord or Google can change, ids never do.
CREATE TABLE external_logins (
  provider         text NOT NULL CHECK (provider IN ('discord', 'google')),
  provider_user_id text NOT NULL,
  user_id          bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id),
  -- At most one Discord and one Google account per player.
  UNIQUE (user_id, provider)
);
