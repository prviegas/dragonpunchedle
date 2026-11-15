import { describe, expect, it } from "vitest";
import { formatCountdown, nextRoundAt } from "./Countdown";

describe("countdown", () => {
  it("points at the next midnight UTC after the round's day", () => {
    expect(new Date(nextRoundAt("2026-11-14")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(new Date(nextRoundAt("2026-12-31")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("shows hours, minutes and seconds, rounding a part-second up", () => {
    expect(formatCountdown((5 * 3600 + 7 * 60 + 9) * 1000)).toBe("05:07:09");
    expect(formatCountdown(500)).toBe("00:00:01");
    expect(formatCountdown(-1000)).toBe("00:00:00");
  });
});
