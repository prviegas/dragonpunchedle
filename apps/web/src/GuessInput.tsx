import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { CharacterSummary } from "./api";
import { matchCharacters } from "./search";

interface GuessInputProps {
  characters: readonly CharacterSummary[];
  excludedIds: ReadonlySet<string>;
  /** A guess is being checked. Only announced to screen readers: the input
   *  stays usable (disabling it would drop keyboard focus mid-typing), and
   *  picks made meanwhile are queued by the parent rather than ignored. */
  busy: boolean;
  onGuess: (characterId: string) => void;
}

// An autocomplete "combobox": the ARIA roles and aria-activedescendant let
// screen readers announce the highlighted suggestion while focus stays in the
// text field, and the arrow keys and Enter work without a mouse.
export function GuessInput({ characters, excludedIds, busy, onGuess }: GuessInputProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(
    () => matchCharacters(query, characters, excludedIds),
    [query, characters, excludedIds],
  );
  const showList = open && matches.length > 0;

  function pick(character: CharacterSummary) {
    onGuess(character.id);
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!showList) return setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      // Match against what's in the box right now, not the list from the last
      // render: a fast typist (or a paste followed by Enter) can press Enter
      // before React has re-rendered with the final text.
      const current = matchCharacters(event.currentTarget.value, characters, excludedIds);
      const choice = current[active] ?? current[0];
      if (choice) {
        event.preventDefault();
        pick(choice);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="guess-input">
      <input
        type="text"
        role="combobox"
        aria-label="Guess a character"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        placeholder="Choose your fighter…"
        aria-busy={busy}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {showList && (
        <ul className="guess-options" id={listId} role="listbox">
          {matches.map((character, index) => (
            <li
              key={character.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              // mousedown rather than click: it fires before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(character);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="option-name">{character.name}</span>
              <span className="option-franchise">{character.franchise}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
