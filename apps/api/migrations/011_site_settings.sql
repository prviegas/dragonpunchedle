-- Small owner settings, one row per key. First use: "stats_since", the moment
-- the dashboard starts counting from (its Reset counting button). Resetting
-- only moves this mark; no visits, guesses or accounts are deleted.
CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
