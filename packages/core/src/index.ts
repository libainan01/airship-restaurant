import type {
  AcceptedCommandResult,
  CommandResult,
  GameCommand,
  GameSnapshot,
  GameplaySnapshot,
  NarrativeSnapshot,
  OfflineEarningsSummary,
  RejectedCommandResult,
} from "@airship-restaurant/contracts";
import type { GameClock } from "./game-time";
import type {
  M2SimulationActionResult,
  M2SimulationAdvanceResult,
} from "./m2-simulation";
import type {
  NarrativeActionResult,
  NarrativeAdvanceResult,
  NarrativeGameplayFacts,
} from "./narrative-system";


export * from "./cooking-system";
export * from "./game-time";
export * from "./inventory-system";
export * from "./logistics-system";
export * from "./m2-simulation";
export * from "./narrative-system";
export * from "./random-source";
export * from "./restaurant-system";

const COMMAND_HISTORY_LIMIT = 512;

export interface RuntimeState {
  readonly revision: number;
  readonly phase: "booting" | "ready";
  readonly runtimeStartedAtUtcMs: number;
  readonly quietMode: boolean;
}

export type RuntimeSnapshotListener = (snapshot: GameSnapshot) => void;

export interface RuntimeSimulation {
  getSnapshot(): GameplaySnapshot;
  advanceTo(observedUtcMs: number): M2SimulationAdvanceResult;
  selectRecipe(
    operationId: string,
    recipeId: string,
  ): M2SimulationActionResult;
  setAutoRepeat(
    operationId: string,
    enabled: boolean,
  ): M2SimulationActionResult;
}

export interface RuntimeNarrative {
  getSnapshot(): NarrativeSnapshot;
  observeOnline(
    before: NarrativeGameplayFacts,
    after: NarrativeGameplayFacts,
    atUtcMs: number,
  ): NarrativeAdvanceResult;
  markViewed(eventId: string, atUtcMs: number): NarrativeActionResult;
  complete(eventId: string, atUtcMs: number): NarrativeActionResult;
}

function narrativeFacts(snapshot: GameplaySnapshot): NarrativeGameplayFacts {
  return { soldByDish: snapshot.restaurant.soldByDish };
}

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
  readonly #clock: GameClock;
  readonly #offlineEarnings: OfflineEarningsSummary | null;
  readonly #simulation: RuntimeSimulation | null;
  readonly #narrative: RuntimeNarrative | null;
  readonly #listeners = new Set<RuntimeSnapshotListener>();
  readonly #processedCommandIds = new Set<string>();
  readonly #commandHistory: string[] = [];

  constructor(
    clock: GameClock,
    simulation: RuntimeSimulation | null = null,
    offlineEarnings: OfflineEarningsSummary | null = null,
    narrative: RuntimeNarrative | null = null,
  ) {
    this.#clock = clock;
    this.#offlineEarnings = offlineEarnings;
    this.#simulation = simulation;
    this.#narrative = narrative;
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
      gameplay: this.#simulation?.getSnapshot() ?? null,
      narrative: this.#narrative?.getSnapshot() ?? null,
      offlineEarnings: this.#offlineEarnings,
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

  tick(): GameSnapshot {
    if (this.#simulation === null) {
      return this.getSnapshot();
    }

    const before = this.#simulation.getSnapshot();
    const result = this.#simulation.advanceTo(this.#clock.nowUtcMs());
    const narrativeResult = this.#narrative?.observeOnline(
      narrativeFacts(before),
      narrativeFacts(result.snapshot),
      result.snapshot.currentUtcMs,
    );
    if (!result.changed && narrativeResult?.changed !== true) {
      return this.getSnapshot();
    }

    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
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
      case "gameplay.select-recipe": {
        if (this.#simulation === null) {
          return this.#reject(
            command.id,
            "GAMEPLAY_REJECTED",
            "The gameplay simulation is unavailable.",
          );
        }
        const result = this.#simulation.selectRecipe(
          command.id,
          command.payload.recipeId,
        );
        if (!result.accepted) {
          return this.#reject(
            command.id,
            "GAMEPLAY_REJECTED",
            result.message,
          );
        }
        if (result.changed) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
          };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
      case "gameplay.set-auto-repeat": {
        if (this.#simulation === null) {
          return this.#reject(
            command.id,
            "GAMEPLAY_REJECTED",
            "The gameplay simulation is unavailable.",
          );
        }
        const result = this.#simulation.setAutoRepeat(
          command.id,
          command.payload.enabled,
        );
        if (!result.accepted) {
          return this.#reject(
            command.id,
            "GAMEPLAY_REJECTED",
            result.message,
          );
        }
        if (result.changed) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
          };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
      case "narrative.mark-viewed":
      case "narrative.complete": {
        if (this.#narrative === null) {
          return this.#reject(
            command.id,
            "NARRATIVE_REJECTED",
            "The narrative system is unavailable.",
          );
        }
        const result =
          command.type === "narrative.mark-viewed"
            ? this.#narrative.markViewed(
                command.payload.eventId,
                this.#clock.nowUtcMs(),
              )
            : this.#narrative.complete(
                command.payload.eventId,
                this.#clock.nowUtcMs(),
              );
        if (!result.accepted) {
          return this.#reject(
            command.id,
            "NARRATIVE_REJECTED",
            result.message,
          );
        }
        if (result.changed) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
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
