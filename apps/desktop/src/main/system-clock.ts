import type { GameClock } from "@airship-restaurant/core";

export function calculateResumedGameUtcMs(
  savedGameUtcMs: number,
  savedWallUtcMs: number,
  currentWallUtcMs: number,
): number {
  const resumed = savedGameUtcMs + Math.max(0, currentWallUtcMs - savedWallUtcMs);
  if (!Number.isSafeInteger(resumed) || resumed < 0) {
    throw new RangeError("Resumed game time is invalid.");
  }
  return resumed;
}
export class SystemClock implements GameClock {
  readonly #wallNowUtcMs: () => number;
  #gameUtcMs: number;
  #lastWallUtcMs: number;
  #paused = false;

  constructor(
    initialGameUtcMs?: number,
    wallNowUtcMs: () => number = Date.now,
  ) {
    this.#wallNowUtcMs = wallNowUtcMs;
    this.#lastWallUtcMs = wallNowUtcMs();
    this.#gameUtcMs = initialGameUtcMs ?? this.#lastWallUtcMs;
  }

  nowUtcMs(): number {
    this.#synchronize();
    return this.#gameUtcMs;
  }

  wallNowUtcMs(): number {
    return this.#wallNowUtcMs();
  }

  isPaused(): boolean {
    return this.#paused;
  }

  pause(): boolean {
    if (this.#paused) return false;
    this.#synchronize();
    this.#paused = true;
    return true;
  }

  resume(): boolean {
    if (!this.#paused) return false;
    this.#lastWallUtcMs = this.#wallNowUtcMs();
    this.#paused = false;
    return true;
  }

  #synchronize(): void {
    const wallUtcMs = this.#wallNowUtcMs();
    if (!this.#paused) {
      this.#gameUtcMs += wallUtcMs - this.#lastWallUtcMs;
    }
    this.#lastWallUtcMs = wallUtcMs;
  }
}