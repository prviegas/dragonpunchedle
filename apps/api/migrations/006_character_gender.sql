-- A new clue: gender. Nullable here because existing rows get their value
-- from the roster sync that runs right after migrations (src/db/seed.ts);
-- the roster's own validation is what requires every character to have one.
ALTER TABLE characters
  ADD COLUMN gender text CHECK (gender IN ('Male', 'Female', 'Other'));
