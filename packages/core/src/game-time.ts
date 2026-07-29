export interface GameClock {
  nowUtcMs(): number;
}

export interface TimeAdvance {
  readonly fromUtcMs: number;
  readonly observedUtcMs: number;
  readonly effectiveUtcMs: number;
  readonly elapsedMs: number;
  readonly clockRollbackDetected: boolean;
}

function assertUtcMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function calculateTimeAdvance(
  lastObservedUtcMs: number,
  observedUtcMs: number,
): TimeAdvance {
  assertUtcMs(lastObservedUtcMs, "Last observed UTC time");
  assertUtcMs(observedUtcMs, "Observed UTC time");

  const clockRollbackDetected = observedUtcMs < lastObservedUtcMs;
  const effectiveUtcMs = clockRollbackDetected
    ? lastObservedUtcMs
    : observedUtcMs;

  return Object.freeze({
    fromUtcMs: lastObservedUtcMs,
    observedUtcMs,
    effectiveUtcMs,
    elapsedMs: effectiveUtcMs - lastObservedUtcMs,
    clockRollbackDetected,
  });
}

export class GameTimeTracker {
  readonly #clock: GameClock;
  #lastObservedUtcMs: number;

  constructor(clock: GameClock, lastObservedUtcMs: number) {
    assertUtcMs(lastObservedUtcMs, "Last observed UTC time");
    this.#clock = clock;
    this.#lastObservedUtcMs = lastObservedUtcMs;
  }

  getLastObservedUtcMs(): number {
    return this.#lastObservedUtcMs;
  }

  observeNow(): TimeAdvance {
    return this.observe(this.#clock.nowUtcMs());
  }

  observe(observedUtcMs: number): TimeAdvance {
    const advance = calculateTimeAdvance(
      this.#lastObservedUtcMs,
      observedUtcMs,
    );
    this.#lastObservedUtcMs = advance.effectiveUtcMs;
    return advance;
  }
}
