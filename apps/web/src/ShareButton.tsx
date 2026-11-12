import { useEffect, useState } from "react";
import type { GuessResult } from "./api";
import { buildShareText } from "./share";

type Feedback = "idle" | "copied" | "failed";

interface ShareButtonProps {
  date: string;
  guesses: readonly GuessResult[];
  maxGuesses: number;
}

export function ShareButton({ date, guesses, maxGuesses }: ShareButtonProps) {
  const [feedback, setFeedback] = useState<Feedback>("idle");

  useEffect(() => {
    if (feedback === "idle") return;
    const timer = setTimeout(() => setFeedback("idle"), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function share() {
    const text = buildShareText(date, guesses, maxGuesses, window.location.origin);

    // On phones, open the system share sheet (WhatsApp, Discord, ...).
    // On computers, copying is what people expect.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        // Closing the share sheet isn't a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setFeedback("copied");
    } catch {
      setFeedback("failed");
    }
  }

  return (
    <div className="share">
      <button type="button" className="button" onClick={share}>
        Share result
      </button>
      {/* Announced by screen readers when it changes. */}
      <span className="share-feedback" role="status">
        {feedback === "copied" && "Copied! Paste it anywhere."}
        {feedback === "failed" && "Couldn't copy. Your browser blocked the clipboard."}
      </span>
    </div>
  );
}
