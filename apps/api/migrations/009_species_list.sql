-- Species becomes a list, like archetypes: a half-vampire like Blade is
-- {Human, Vampire}. Same list = the same species (green); sharing one = close
-- (yellow). Every existing value becomes a one-item list; the roster sync on
-- start then fills in the two halves of the former "Hybrid" characters.
ALTER TABLE characters ALTER COLUMN species TYPE text[] USING ARRAY[species];
ALTER TABLE characters ADD CONSTRAINT characters_species_not_empty CHECK (cardinality(species) > 0);
