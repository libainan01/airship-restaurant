export interface GameClock {
  nowUtcMs(): number;
}

export interface RuntimeState {
  readonly revision: number;
  readonly phase: "booting" | "ready";
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    revision: 0,
    phase: "booting",
  };
}
