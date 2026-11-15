import { useEffect, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the round after `date` starts: midnight UTC, the same moment for every player. */
export function nextRoundAt(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) + DAY_MS;
}

/** "05:07:09" for a number of milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Time left until the next fighter, ticking every second. Once it reaches
 * zero, it offers to load the new round (the page doesn't swap the board out
 * from under someone halfway through reading it).
 *
 * It counts on this device's clock. A clock that's a little off only moves
 * the moment the button shows up; the server decides which day it really is.
 */
export function Countdown({ date, compact = false }: { date: string; compact?: boolean }) {
  const target = nextRoundAt(date);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (now >= target) return;
    // Tick on the second boundary, so the display changes when the second does.
    const timer = window.setTimeout(() => setNow(Date.now()), 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(timer);
  }, [now, target]);

  if (now >= target) {
    return (
      <span className={compact ? "countdown countdown--compact" : "countdown"}>
        New round ready.{" "}
        <button type="button" className="link" onClick={() => window.location.reload()}>
          Play it
        </button>
      </span>
    );
  }

  const left = formatCountdown(target - now);
  return (
    <span className={compact ? "countdown countdown--compact" : "countdown"}>
      {compact ? "Next in " : "Next fighter in "}
      {/* role=timer is never announced on its own, so screen readers aren't read a number every second. */}
      <time className="countdown-time" role="timer" dateTime={new Date(target).toISOString()}>
        {left}
      </time>
    </span>
  );
}
