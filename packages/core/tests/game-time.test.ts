import { describe, expect, it } from "vitest";
import {
  GameTimeTracker,
  calculateTimeAdvance,
} from "../src";

describe("calculateTimeAdvance", () => {
  it("returns a deterministic forward advance", () => {
    expect(calculateTimeAdvance(1_000, 4_500)).toEqual({
      fromUtcMs: 1_000,
      observedUtcMs: 4_500,
      effectiveUtcMs: 4_500,
      elapsedMs: 3_500,
      clockRollbackDetected: false,
    });
  });

  it("clamps a system clock rollback without undoing progress", () => {
    expect(calculateTimeAdvance(5_000, 2_000)).toEqual({
      fromUtcMs: 5_000,
      observedUtcMs: 2_000,
      effectiveUtcMs: 5_000,
      elapsedMs: 0,
      clockRollbackDetected: true,
    });
  });

  it("supports very long offline durations without an artificial cap", () => {
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1_000;
    expect(calculateTimeAdvance(1_000, 1_000 + tenYearsMs).elapsedMs)
      .toBe(tenYearsMs);
  });

  it("rejects unsafe timestamps", () => {
    expect(() => calculateTimeAdvance(-1, 1_000)).toThrow(RangeError);
    expect(() =>
      calculateTimeAdvance(1_000, Number.MAX_SAFE_INTEGER + 1),
    ).toThrow(RangeError);
  });
});

describe("GameTimeTracker", () => {
  it("observes an injected clock and preserves the highest UTC value", () => {
    let now = 2_000;
    const tracker = new GameTimeTracker(
      { nowUtcMs: () => now },
      1_000,
    );

    expect(tracker.observeNow().elapsedMs).toBe(1_000);
    now = 1_500;
    expect(tracker.observeNow()).toMatchObject({
      elapsedMs: 0,
      clockRollbackDetected: true,
      effectiveUtcMs: 2_000,
    });
    now = 2_750;
    expect(tracker.observeNow().elapsedMs).toBe(750);
    expect(tracker.getLastObservedUtcMs()).toBe(2_750);
  });
});
