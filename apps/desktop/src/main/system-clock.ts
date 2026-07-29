import type { GameClock } from "@airship-restaurant/core";

export class SystemClock implements GameClock {
  nowUtcMs(): number {
    return Date.now();
  }
}
