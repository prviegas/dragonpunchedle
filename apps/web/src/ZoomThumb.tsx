import { useState } from "react";
import { createPortal } from "react-dom";

// A small character picture that shows a bigger one while the pointer is on
// it. The big one is drawn on the page itself (a portal), not inside the
// row: the board scrolls sideways on phones and would cut it off.

const BIG = { width: 180, height: 240 };
const GAP = 10;

interface ZoomThumbProps {
  src: string;
  name: string;
  className: string;
  width: number;
  height: number;
}

export function ZoomThumb({ src, name, className, width, height }: ZoomThumbProps) {
  const [at, setAt] = useState<{ left: number; top: number }>();

  function show(target: HTMLElement) {
    const box = target.getBoundingClientRect();
    // To the right of the picture, or to its left when there's no room; kept on screen.
    const right = box.right + GAP;
    const left = right + BIG.width <= window.innerWidth - GAP ? right : Math.max(GAP, box.left - GAP - BIG.width);
    const top = Math.min(Math.max(GAP, box.top + box.height / 2 - BIG.height / 2), window.innerHeight - BIG.height - GAP - 24);
    setAt({ left, top });
  }

  return (
    <>
      <img
        className={className}
        src={src}
        alt=""
        width={width}
        height={height}
        loading="lazy"
        onPointerEnter={(event) => show(event.currentTarget)}
        onPointerLeave={() => setAt(undefined)}
      />
      {at &&
        createPortal(
          <figure className="thumb-zoom" style={{ left: at.left, top: at.top }} aria-hidden="true">
            <img src={src} alt="" width={BIG.width} height={BIG.height} />
            <figcaption>{name}</figcaption>
          </figure>,
          document.body,
        )}
    </>
  );
}
