export const RESTAURANT_APPLICATION_RUNTIME_MODULE_ID = "module.restaurant-application-runtime";
export const RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION = 1;

export interface RestaurantApplicationProcessContext {
  readonly operationId: string;
  readonly previousUtcMs: number;
  readonly targetUtcMs: number;
  readonly cycle: number;
  readonly round: number;
}

export interface RestaurantApplicationProcessResult {
  readonly changed: boolean;
  readonly nextTransitionUtcMs: number | null;
}

export interface RestaurantApplicationProcess {
  readonly id: string;
  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult;
}

export interface RestaurantApplicationProcessSnapshot {
  readonly id: string;
  readonly nextTransitionUtcMs: number | null;
}

export interface RestaurantApplicationRuntimeSnapshot {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextTransitionUtcMs: number | null;
  readonly processes: readonly RestaurantApplicationProcessSnapshot[];
}

export interface RestaurantApplicationRuntimeState {
  readonly schemaVersion: typeof RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION;
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly cycle: number;
  readonly processes: readonly RestaurantApplicationProcessSnapshot[];
}

export interface RestaurantApplicationAdvanceResult {
  readonly changed: boolean;
  readonly businessChanged: boolean;
  readonly clockRollbackDetected: boolean;
  readonly convergenceRounds: number;
  readonly snapshot: RestaurantApplicationRuntimeSnapshot;
}

export interface RestaurantApplicationRuntimeOptions {
  readonly startUtcMs: number;
  readonly processes: readonly RestaurantApplicationProcess[];
  readonly maximumConvergenceRounds?: number;
  readonly initialState?: RestaurantApplicationRuntimeState;
}

const DEFAULT_MAXIMUM_CONVERGENCE_ROUNDS = 16;
const MAXIMUM_PROCESS_COUNT = 128;
const MAXIMUM_PROCESS_ID_LENGTH = 128;
const MAXIMUM_CONVERGENCE_ROUNDS = 64;

function isValidUtcMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRestaurantApplicationRuntimeState(
  value: unknown,
): value is RestaurantApplicationRuntimeState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION ||
    typeof value.revision !== "number" ||
    !isValidUtcMs(value.revision) ||
    typeof value.currentUtcMs !== "number" ||
    !isValidUtcMs(value.currentUtcMs) ||
    typeof value.cycle !== "number" ||
    !isValidUtcMs(value.cycle) ||
    !Array.isArray(value.processes) ||
    value.processes.length < 1 ||
    value.processes.length > MAXIMUM_PROCESS_COUNT
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const candidate of value.processes) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      candidate.id.length > MAXIMUM_PROCESS_ID_LENGTH ||
      ids.has(candidate.id) ||
      (candidate.nextTransitionUtcMs !== null &&
        (typeof candidate.nextTransitionUtcMs !== "number" ||
          !isValidUtcMs(candidate.nextTransitionUtcMs) ||
          candidate.nextTransitionUtcMs < value.currentUtcMs))
    ) {
      return false;
    }
    ids.add(candidate.id);
  }
  return true;
}

function validateProcessResult(
  processId: string,
  result: RestaurantApplicationProcessResult,
): void {
  if (
    typeof result.changed !== "boolean" ||
    (result.nextTransitionUtcMs !== null &&
      !isValidUtcMs(result.nextTransitionUtcMs))
  ) {
    throw new Error(
      `Restaurant application process returned an invalid result: ${processId}`,
    );
  }
}

/**
 * Deterministic host for production restaurant process coordinators.
 *
 * The runtime owns only coordination time, ordering and convergence metadata.
 * Orders, inventory, tasks, characters, finance and all other business facts
 * remain in their domain modules.
 */
export class RestaurantApplicationRuntime {
  readonly #processes: readonly RestaurantApplicationProcess[];
  readonly #maximumConvergenceRounds: number;
  readonly #nextTransitions = new Map<string, number | null>();
  #revision = 0;
  #currentUtcMs: number;
  #cycle = 0;

  constructor(options: RestaurantApplicationRuntimeOptions) {
    if (!isValidUtcMs(options.startUtcMs)) {
      throw new RangeError("Restaurant application start time is invalid.");
    }
    if (
      options.processes.length === 0 ||
      options.processes.length > MAXIMUM_PROCESS_COUNT
    ) {
      throw new RangeError(
        `Restaurant application requires 1-${MAXIMUM_PROCESS_COUNT} processes.`,
      );
    }
    const maximumConvergenceRounds =
      options.maximumConvergenceRounds ??
      DEFAULT_MAXIMUM_CONVERGENCE_ROUNDS;
    if (
      !Number.isSafeInteger(maximumConvergenceRounds) ||
      maximumConvergenceRounds < 1 ||
      maximumConvergenceRounds > MAXIMUM_CONVERGENCE_ROUNDS
    ) {
      throw new RangeError(
        `maximumConvergenceRounds must be between 1 and ${MAXIMUM_CONVERGENCE_ROUNDS}.`,
      );
    }

    const processIds = new Set<string>();
    const processes = [...options.processes];
    for (const process of processes) {
      if (
        process.id.length === 0 ||
        process.id.length > MAXIMUM_PROCESS_ID_LENGTH ||
        processIds.has(process.id)
      ) {
        throw new Error(
          `Restaurant application process id is invalid or duplicated: ${process.id}`,
        );
      }
      processIds.add(process.id);
      this.#nextTransitions.set(process.id, null);
    }

    this.#processes = Object.freeze(
      processes.sort((left, right) => left.id.localeCompare(right.id)),
    );
    this.#maximumConvergenceRounds = maximumConvergenceRounds;
    if (options.initialState === undefined) {
      this.#currentUtcMs = options.startUtcMs;
    } else {
      if (!isRestaurantApplicationRuntimeState(options.initialState)) {
        throw new Error("Restaurant application restore state is invalid.");
      }
      const configuredIds = this.#processes.map((process) => process.id);
      const savedIds = options.initialState.processes
        .map((process) => process.id)
        .sort((left, right) => left.localeCompare(right));
      if (
        configuredIds.length !== savedIds.length ||
        configuredIds.some((id, index) => id !== savedIds[index])
      ) {
        throw new Error("Restaurant application restore process manifest does not match the configured processes.");
      }
      this.#revision = options.initialState.revision;
      this.#currentUtcMs = options.initialState.currentUtcMs;
      this.#cycle = options.initialState.cycle;
      for (const saved of options.initialState.processes) {
        this.#nextTransitions.set(saved.id, saved.nextTransitionUtcMs);
      }
    }
  }

  exportState(): RestaurantApplicationRuntimeState {
    const snapshot = this.getSnapshot();
    return Object.freeze({
      schemaVersion: RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION,
      revision: snapshot.revision,
      currentUtcMs: snapshot.currentUtcMs,
      cycle: this.#cycle,
      processes: snapshot.processes,
    });
  }
  getSnapshot(): RestaurantApplicationRuntimeSnapshot {
    const processes = Object.freeze(
      this.#processes.map((process) =>
        Object.freeze({
          id: process.id,
          nextTransitionUtcMs:
            this.#nextTransitions.get(process.id) ?? null,
        }),
      ),
    );
    const scheduledTransitions = processes
      .map((process) => process.nextTransitionUtcMs)
      .filter((value): value is number => value !== null);
    return Object.freeze({
      revision: this.#revision,
      currentUtcMs: this.#currentUtcMs,
      nextTransitionUtcMs:
        scheduledTransitions.length === 0
          ? null
          : Math.min(...scheduledTransitions),
      processes,
    });
  }

  advanceTo(targetUtcMs: number): RestaurantApplicationAdvanceResult {
    if (!isValidUtcMs(targetUtcMs)) {
      throw new RangeError("Restaurant application target time is invalid.");
    }
    if (targetUtcMs < this.#currentUtcMs) {
      return Object.freeze({
        changed: false,
        businessChanged: false,
        clockRollbackDetected: true,
        convergenceRounds: 0,
        snapshot: this.getSnapshot(),
      });
    }

    const previousUtcMs = this.#currentUtcMs;
    this.#cycle += 1;
    if (!Number.isSafeInteger(this.#cycle)) {
      throw new RangeError(
        "Restaurant application synchronization cycle exceeded the safe integer range.",
      );
    }

    let businessChanged = false;
    let convergenceRounds = 0;
    let converged = false;
    let lastChangedProcessIds: readonly string[] = Object.freeze([]);
    for (
      let round = 1;
      round <= this.#maximumConvergenceRounds;
      round += 1
    ) {
      convergenceRounds = round;
      let roundChanged = false;
      const changedProcessIds: string[] = [];
      for (const process of this.#processes) {
        const result = process.advance(
          Object.freeze({
            operationId:
              `restaurant-runtime:${this.#cycle}:${targetUtcMs}:${round}:${process.id}`,
            previousUtcMs,
            targetUtcMs,
            cycle: this.#cycle,
            round,
          }),
        );
        validateProcessResult(process.id, result);
        this.#nextTransitions.set(
          process.id,
          result.nextTransitionUtcMs,
        );
        if (result.changed) changedProcessIds.push(process.id);
        roundChanged ||= result.changed;
      }
      lastChangedProcessIds = Object.freeze(changedProcessIds);
      businessChanged ||= roundChanged;
      if (!roundChanged) {
        converged = true;
        break;
      }
    }

    if (!converged) {
      throw new Error(
        `Restaurant application processes did not converge within ${this.#maximumConvergenceRounds} rounds; still changing: ${lastChangedProcessIds.join(", ") || "unknown"}.`,
      );
    }

    const timeChanged = targetUtcMs !== this.#currentUtcMs;
    this.#currentUtcMs = targetUtcMs;
    if (businessChanged || timeChanged) {
      this.#revision += 1;
      if (!Number.isSafeInteger(this.#revision)) {
        throw new RangeError(
          "Restaurant application revision exceeded the safe integer range.",
        );
      }
    }

    return Object.freeze({
      changed: businessChanged || timeChanged,
      businessChanged,
      clockRollbackDetected: false,
      convergenceRounds,
      snapshot: this.getSnapshot(),
    });
  }
}
