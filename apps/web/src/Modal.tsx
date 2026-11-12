import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal window, built on the browser's own <dialog>: while it's open, the
 * page behind can't be clicked or tabbed into, Esc closes it, and focus goes
 * back where it was afterwards. Clicking the dimmed backdrop closes it too.
 */
export function Modal({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={label}
      // Esc, or the close() above: tell the parent, so its state matches.
      onClose={onClose}
      // A click that lands on the <dialog> itself, not its content, is on the backdrop.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {open && children}
    </dialog>
  );
}
