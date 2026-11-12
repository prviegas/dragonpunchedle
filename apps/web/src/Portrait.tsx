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
      <div className="portrait" aria-hidden="true">
        <div className="portrait-frame">
          <div className="portrait-art portrait--empty">{initials}</div>
        </div>
      </div>
    );
  }

  return (
    <figure className="portrait">
      {/* The frame is a separate layer: the card's angled cut would otherwise clip its own border. */}
      <div className="portrait-frame">
        <img
          className="portrait-art"
          src={portrait.url}
          alt={character.name}
          width={240}
          height={320}
          onError={() => setFailed(true)}
        />
      </div>
      <figcaption>{portrait.credit}</figcaption>
    </figure>
  );
}
