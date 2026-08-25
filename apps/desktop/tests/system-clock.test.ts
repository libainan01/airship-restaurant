import { describe, expect, it } from "vitest";
import { calculateResumedGameUtcMs, SystemClock } from "../src/main/system-clock";

describe("SystemClock", () => {
  it("adds only wall time elapsed after the last save when restoring", () => {
    expect(calculateResumedGameUtcMs(1_250, 20_250, 21_250)).toBe(2_250);
    expect(calculateResumedGameUtcMs(1_250, 20_250, 19_000)).toBe(1_250);
  });

  it("freezes game time while paused and does not catch up after resume", () => {
    let wallUtcMs = 10_000;
    const clock = new SystemClock(1_000, () => wallUtcMs);

    wallUtcMs = 10_250;
    expect(clock.nowUtcMs()).toBe(1_250);
    expect(clock.pause()).toBe(true);

    wallUtcMs = 20_250;
    expect(clock.nowUtcMs()).toBe(1_250);
    expect(clock.resume()).toBe(true);
    expect(clock.nowUtcMs()).toBe(1_250);

    wallUtcMs = 20_750;
    expect(clock.nowUtcMs()).toBe(1_750);
  });

  it("keeps wall time available for save timestamps while game time is paused", () => {
    let wallUtcMs = 5_000;
    const clock = new SystemClock(2_000, () => wallUtcMs);
    clock.pause();
    wallUtcMs = 8_000;

    expect(clock.nowUtcMs()).toBe(2_000);
    expect(clock.wallNowUtcMs()).toBe(8_000);
    expect(clock.isPaused()).toBe(true);
  });
});