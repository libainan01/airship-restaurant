import type {
  AcceptedCommandResult,
  CommandResult,
  GameCommand,
  GameSnapshot,
  RejectedCommandResult,
} from "@airship-restaurant/contracts";

const COMMAND_HISTORY_LIMIT = 512;

export interface GameClock {
  nowUtcMs(): number;
}

export interface RuntimeState {
  readonly revision: number;
  readonly phase: "booting" | "ready";
  readonly runtimeStartedAtUtcMs: number;
  readonly quietMode: boolean;
}

export type RuntimeSnapshotListener = (snapshot: GameSnapshot) => void;

export function createInitialRuntimeState(
  runtimeStartedAtUtcMs: number,
): RuntimeState {
  return {
    revision: 0,
    phase: "booting",
    runtimeStartedAtUtcMs,
    quietMode: false,
  };
}

export class GameRuntime {
  #state: RuntimeState;
  readonly #listeners = new Set<RuntimeSnapshotListener>();
  readonly #processedCommandIds = new Set<string>();
  readonly #commandHistory: string[] = [];

  constructor(clock: GameClock) {
    this.#state = createInitialRuntimeState(clock.nowUtcMs());
  }

  getSnapshot(): GameSnapshot {
    return Object.freeze({
      revision: this.#state.revision,
      phase: this.#state.phase,
      runtimeStartedAtUtcMs: this.#state.runtimeStartedAtUtcMs,
      settings: Object.freeze({
        quietMode: this.#state.quietMode,
      }),
    });
  }

  markReady(): GameSnapshot {
    if (this.#state.phase === "ready") {
      return this.getSnapshot();
    }

    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
      phase: "ready",
    };

    return this.#publishSnapshot();
  }

  dispatch(command: GameCommand): CommandResult {
    if (this.#processedCommandIds.has(command.id)) {
      return this.#reject(
        command.id,
        "DUPLICATE_COMMAND",
        "The command id has already been processed.",
      );
    }

    if (this.#state.phase !== "ready") {
      return this.#reject(
        command.id,
        "RUNTIME_NOT_READY",
        "The game runtime is not ready.",
      );
    }

    this.#rememberCommand(command.id);

    switch (command.type) {
      case "settings.set-quiet-mode": {
        if (this.#state.quietMode !== command.payload.enabled) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
            quietMode: command.payload.enabled,
          };
          this.#publishSnapshot();
        }

        return this.#accept(command.id);
      }
    }
  }

  subscribe(listener: RuntimeSnapshotListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #rememberCommand(commandId: string): void {
    this.#processedCommandIds.add(commandId);
    this.#commandHistory.push(commandId);

    if (this.#commandHistory.length <= COMMAND_HISTORY_LIMIT) {
      return;
    }

    const oldestCommandId = this.#commandHistory.shift();

    if (oldestCommandId !== undefined) {
      this.#processedCommandIds.delete(oldestCommandId);
    }
  }

  #publishSnapshot(): GameSnapshot {
    const snapshot = this.getSnapshot();

    for (const listener of this.#listeners) {
      listener(snapshot);
    }

    return snapshot;
  }

  #accept(commandId: string): AcceptedCommandResult {
    return {
      accepted: true,
      commandId,
      snapshot: this.getSnapshot(),
    };
  }

  #reject(
    commandId: string,
    code: RejectedCommandResult["code"],
    message: string,
  ): RejectedCommandResult {
    return {
      accepted: false,
      commandId,
      code,
      message,
      snapshot: this.getSnapshot(),
    };
  }
}
