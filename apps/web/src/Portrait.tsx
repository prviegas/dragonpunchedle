import { useState } from "react";
import type { Character } from "./api";

/**
 * The character's official art with its credit line, or, when there's none
 * (not loaded yet, or taken down), a plain card with their initials. The
 * game never depends on an image being there.
 */
export function Portrait({ character }: { character: Character }) {
  const [failed, setFailed] = useState(false);
  const { portrait } = character;

  if (!portrait || failed) {
    const initials = character.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("");
    return (
      <div className="portrait portrait--empty" aria-hidden="true">
        {initials}
      </div>
    );
  }

  return (
    <figure className="portrait">
      <img src={portrait.url} alt={character.name} width={256} height={256} onError={() => setFailed(true)} />
      <figcaption>{portrait.credit}</figcaption>
    </figure>
  );
}
