-- The owner's dashboard: page views and frozen daily totals.

-- One row per page view. No cookie and no IP address: `visitor` is a hash of
-- the address, the browser and a random salt that exists for one day only.
-- The same person counts once per day, but two days can't be linked, and once
-- the salt is deleted the hash can't be turned back into an address.
CREATE TABLE page_views (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day        date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  visitor    text NOT NULL,
  path       text NOT NULL,
  -- Only the other site's host name ("reddit.com"), never the full address.
  referrer   text,
  device     text NOT NULL CHECK (device IN ('mobile', 'desktop')),
  -- From the browser: a rough "where" (America/Sao_Paulo) and language (pt-BR).
  timezone   text,
  language   text
);

CREATE INDEX page_views_day_idx ON page_views (day);

CREATE TABLE visitor_salts (
  day  date PRIMARY KEY,
  salt text NOT NULL
);

-- A finished day's numbers, written once by the daily job. Guests' guesses are
-- deleted after 30 days and page views after 90, so without this the history
-- on the dashboard would quietly shrink.
CREATE TABLE daily_totals (
  day         date PRIMARY KEY,
  views       integer NOT NULL,
  visitors    integer NOT NULL,
  players     integer NOT NULL,
  finished    integer NOT NULL,
  won         integer NOT NULL,
  signups     integer NOT NULL,
  late_players integer NOT NULL
);
