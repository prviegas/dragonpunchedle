import { useEffect, useState } from "react";
import { fetchTodayResults, type GuessResult } from "./api";
import { percentBeaten } from "./results";
import { buildShareText } from "./share";

type Feedback = "idle" | "copied" | "failed";

interface ShareButtonProps {
  date: string;
  guesses: readonly GuessResult[];
  maxGuesses: number;
  firstSolve?: boolean;
}

export function ShareButton({ date, guesses, maxGuesses, firstSolve = false }: ShareButtonProps) {
  const [feedback, setFeedback] = useState<Feedback>("idle");
  // "Better than X%": loaded before the click, because a phone's share sheet
  // only opens straight from a tap, not after waiting on the network.
  const [beaten, setBeaten] = useState<number | null>(null);
  const solvedIn = guesses.some((g) => g.solved) ? guesses.length : undefined;
  useEffect(() => {
    if (solvedIn === undefined) return;
    let current = true;
    fetchTodayResults().then(
      (results) => current && setBeaten(percentBeaten(results, solvedIn)),
      () => undefined, // the share works without it
    );
    return () => {
      current = false;
    };
  }, [solvedIn]);

  useEffect(() => {
    if (feedback === "idle") return;
    const timer = setTimeout(() => setFeedback("idle"), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function share() {
    const text = buildShareText(date, guesses, maxGuesses, window.location.origin, { firstSolve, beaten });

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
