import type { GameClock } from "@airship-restaurant/core";

export class ManualClock implements GameClock {
  #currentUtcMs: number;

  constructor(initialUtcMs: number) {
    this.#currentUtcMs = initialUtcMs;
  }

  nowUtcMs(): number {
    return this.#currentUtcMs;
  }

  advanceByMs(durationMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new RangeError("Clock duration must be a non-negative integer.");
    }

    this.#currentUtcMs += durationMs;
  }
}
