-- Character portraits for the win screen. The art belongs to each game's
-- publisher, so it's kept here rather than in the public code repository,
-- and loaded with the portraits tool (src/portraits/cli.ts). A publisher's
-- takedown request is one DELETE, with no redeploy.
CREATE TABLE character_portraits (
  character_id text PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
  -- A 240x320 WebP card, about 15-25 KB. 274 of them fit easily in the database.
  image        bytea NOT NULL,
  content_type text NOT NULL CHECK (content_type = 'image/webp'),
  -- Shown under the portrait, e.g. "© Capcom".
  credit       text NOT NULL,
  -- SHA-256 of the image. Goes in the image's address, so a replaced
  -- portrait gets a new address and browsers fetch it fresh.
  hash         text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
