import type { DomainEvent } from "../../kernel";
import { DomainEventBus } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const FOCUS_SESSION_MODULE_ID = "module.focus-session";
export const FOCUS_SESSION_SCHEMA_VERSION = 1;

export type FocusSessionPhase =
  | "idle"
  | "waiting-for-dialogue"
  | "focusing"
  | "break";

export interface FocusSessionState {
  readonly schemaVersion: typeof FOCUS_SESSION_SCHEMA_VERSION;
  readonly revision: number;
  readonly phase: FocusSessionPhase;
  readonly requestedAtUtcMs: number | null;
  readonly phaseStartedAtUtcMs: number | null;
  readonly phaseEndsAtUtcMs: number | null;
  readonly completedFocusCount: number;
  readonly processedOperationIds: readonly string[];
}

export interface FocusSessionReadModel {
  readonly revision: number;
  readonly phase: FocusSessionPhase;
  readonly requestedAtUtcMs: number | null;
  readonly phaseStartedAtUtcMs: number | null;
  readonly phaseEndsAtUtcMs: number | null;
  readonly remainingMs: number | null;
  readonly completedFocusCount: number;
  readonly focusDurationMs: number;
  readonly breakDurationMs: number;
  readonly effects: {
    readonly active: boolean;
    readonly customerArrivalIntervalRateBasisPoints: number;
    readonly incomeBonusRateBasisPoints: number;
  };
}

export interface FocusSessionConfig {
  readonly focusDurationMs: number;
  readonly breakDurationMs: number;
  readonly customerArrivalIntervalRateBasisPoints: number;
  readonly incomeBonusRateBasisPoints: number;
}

export type FocusSessionRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "SESSION_ALREADY_ACTIVE"
  | "SESSION_NOT_ACTIVE"
  | "BREAK_NOT_ACTIVE";

export type FocusSessionOperationResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly state: FocusSessionState;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly code: FocusSessionRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 2_048;

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function safeAdd(startUtcMs: number, durationMs: number): number {
  const result = startUtcMs + durationMs;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Focus session time exceeds the safe integer range.");
  }
  return result;
}

function cloneState(state: FocusSessionState): FocusSessionState {
  return Object.freeze({
    ...state,
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export function isFocusSessionState(value: unknown): value is FocusSessionState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<FocusSessionState>;
  if (
    state.schemaVersion !== FOCUS_SESSION_SCHEMA_VERSION ||
    !nonNegativeInteger(state.revision) ||
    !nonNegativeInteger(state.completedFocusCount) ||
    !Array.isArray(state.processedOperationIds) ||
    state.processedOperationIds.some((id) => typeof id !== "string" || !validOperationId(id)) ||
    new Set(state.processedOperationIds).size !== state.processedOperationIds.length
  ) return false;
  if (
    state.phase !== "idle" &&
    state.phase !== "waiting-for-dialogue" &&
    state.phase !== "focusing" &&
    state.phase !== "break"
  ) return false;
  const validOptionalTime = (time: unknown): time is number | null =>
    time === null || nonNegativeInteger(time);
  if (
    !validOptionalTime(state.requestedAtUtcMs) ||
    !validOptionalTime(state.phaseStartedAtUtcMs) ||
    !validOptionalTime(state.phaseEndsAtUtcMs)
  ) return false;
  if (state.phase === "idle") {
    return state.requestedAtUtcMs === null && state.phaseStartedAtUtcMs === null && state.phaseEndsAtUtcMs === null;
  }
  if (state.phase === "waiting-for-dialogue") {
    return state.requestedAtUtcMs !== null && state.phaseStartedAtUtcMs === null && state.phaseEndsAtUtcMs === null;
  }
  return state.requestedAtUtcMs !== null &&
    state.phaseStartedAtUtcMs !== null &&
    state.phaseEndsAtUtcMs !== null &&
    state.phaseEndsAtUtcMs > state.phaseStartedAtUtcMs;
}

export class FocusSessionModule implements DomainModule {
  readonly moduleId = FOCUS_SESSION_MODULE_ID;
  readonly #config: FocusSessionConfig;
  readonly #eventBus: DomainEventBus;
  #state: FocusSessionState;

  constructor(
    config: FocusSessionConfig,
    initialState?: FocusSessionState,
    eventBus: DomainEventBus = new DomainEventBus(),
  ) {
    if (
      !positiveInteger(config.focusDurationMs) ||
      !positiveInteger(config.breakDurationMs) ||
      !positiveInteger(config.customerArrivalIntervalRateBasisPoints) ||
      config.customerArrivalIntervalRateBasisPoints > 10_000 ||
      !nonNegativeInteger(config.incomeBonusRateBasisPoints) ||
      config.incomeBonusRateBasisPoints > 10_000
    ) {
      throw new Error("Focus session configuration is invalid.");
    }
    this.#config = Object.freeze({ ...config });
    this.#eventBus = eventBus;
    const state = initialState ?? {
      schemaVersion: FOCUS_SESSION_SCHEMA_VERSION,
      revision: 0,
      phase: "idle",
      requestedAtUtcMs: null,
      phaseStartedAtUtcMs: null,
      phaseEndsAtUtcMs: null,
      completedFocusCount: 0,
      processedOperationIds: [],
    };
    if (!isFocusSessionState(state)) throw new Error("Focus session state is invalid.");
    this.#state = cloneState(state);
  }

  exportState(): FocusSessionState {
    return cloneState(this.#state);
  }

  createReadModel(atUtcMs: number): FocusSessionReadModel {
    if (!nonNegativeInteger(atUtcMs)) throw new RangeError("Focus read time is invalid.");
    return Object.freeze({
      revision: this.#state.revision,
      phase: this.#state.phase,
      requestedAtUtcMs: this.#state.requestedAtUtcMs,
      phaseStartedAtUtcMs: this.#state.phaseStartedAtUtcMs,
      phaseEndsAtUtcMs: this.#state.phaseEndsAtUtcMs,
      remainingMs: this.#state.phaseEndsAtUtcMs === null
        ? null
        : Math.max(0, this.#state.phaseEndsAtUtcMs - atUtcMs),
      completedFocusCount: this.#state.completedFocusCount,
      focusDurationMs: this.#config.focusDurationMs,
      breakDurationMs: this.#config.breakDurationMs,
      effects: Object.freeze({
        active: this.#state.phase === "focusing",
        customerArrivalIntervalRateBasisPoints: this.#state.phase === "focusing"
          ? this.#config.customerArrivalIntervalRateBasisPoints
          : 10_000,
        incomeBonusRateBasisPoints: this.#state.phase === "focusing"
          ? this.#config.incomeBonusRateBasisPoints
          : 0,
      }),
    });
  }

  requestStart(
    operationId: string,
    requestedAtUtcMs: number,
    foregroundDialogueActive: boolean,
  ): FocusSessionOperationResult {
    const issue = this.#validateOperation(operationId, requestedAtUtcMs);
    if (issue !== null) return issue;
    if (this.#state.phase !== "idle") {
      return this.#reject("SESSION_ALREADY_ACTIVE", "A focus session is already active.");
    }
    const events: DomainEvent[] = [this.#event(
      operationId,
      "focus-session.requested",
      requestedAtUtcMs,
      { delayedByDialogue: foregroundDialogueActive },
    )];
    if (foregroundDialogueActive) {
      this.#replace({
        phase: "waiting-for-dialogue",
        requestedAtUtcMs,
        phaseStartedAtUtcMs: null,
        phaseEndsAtUtcMs: null,
      }, operationId);
    } else {
      this.#replace({
        phase: "focusing",
        requestedAtUtcMs,
        phaseStartedAtUtcMs: requestedAtUtcMs,
        phaseEndsAtUtcMs: safeAdd(requestedAtUtcMs, this.#config.focusDurationMs),
      }, operationId);
      events.push(this.#event(operationId, "focus-session.started", requestedAtUtcMs, {
        endsAtUtcMs: this.#state.phaseEndsAtUtcMs,
      }));
    }
    return this.#accept(true, events);
  }

  advanceTo(
    operationId: string,
    observedAtUtcMs: number,
    foregroundDialogueActive: boolean,
  ): FocusSessionOperationResult {
    if (!validOperationId(operationId) || !nonNegativeInteger(observedAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Focus advance request is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject("DUPLICATE_OPERATION", "Focus operation was already processed.");
    }
    if (this.#state.phase === "idle") return this.#accept(false);
    const events: DomainEvent[] = [];
    let changed = false;
    if (this.#state.phase === "waiting-for-dialogue") {
      if (foregroundDialogueActive) return this.#accept(false);
      this.#replace({
        phase: "focusing",
        phaseStartedAtUtcMs: observedAtUtcMs,
        phaseEndsAtUtcMs: safeAdd(observedAtUtcMs, this.#config.focusDurationMs),
      }, operationId);
      events.push(this.#event(operationId, "focus-session.started", observedAtUtcMs, {
        endsAtUtcMs: this.#state.phaseEndsAtUtcMs,
      }));
      return this.#accept(true, events);
    }
    if (this.#state.phase === "focusing" && observedAtUtcMs >= this.#state.phaseEndsAtUtcMs!) {
      const completedAtUtcMs = this.#state.phaseEndsAtUtcMs!;
      const breakEndsAtUtcMs = safeAdd(completedAtUtcMs, this.#config.breakDurationMs);
      this.#replace({
        phase: "break",
        phaseStartedAtUtcMs: completedAtUtcMs,
        phaseEndsAtUtcMs: breakEndsAtUtcMs,
        completedFocusCount: this.#state.completedFocusCount + 1,
      }, operationId);
      changed = true;
      events.push(
        this.#event(operationId, "focus-session.completed", completedAtUtcMs, {
          completedFocusCount: this.#state.completedFocusCount,
        }),
        this.#event(operationId, "focus-session.break-started", completedAtUtcMs, {
          endsAtUtcMs: breakEndsAtUtcMs,
        }),
      );
    }
    if (this.#state.phase === "break" && observedAtUtcMs >= this.#state.phaseEndsAtUtcMs!) {
      const completedAtUtcMs = this.#state.phaseEndsAtUtcMs!;
      this.#replace({
        phase: "idle",
        requestedAtUtcMs: null,
        phaseStartedAtUtcMs: null,
        phaseEndsAtUtcMs: null,
      }, changed ? null : operationId);
      changed = true;
      events.push(this.#event(operationId, "focus-session.break-completed", completedAtUtcMs, {}));
    }
    return this.#accept(changed, events);
  }

  cancel(operationId: string, occurredAtUtcMs: number): FocusSessionOperationResult {
    const issue = this.#validateOperation(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    if (this.#state.phase === "idle") {
      return this.#reject("SESSION_NOT_ACTIVE", "There is no focus session to cancel.");
    }
    const previousPhase = this.#state.phase;
    this.#replace({
      phase: "idle",
      requestedAtUtcMs: null,
      phaseStartedAtUtcMs: null,
      phaseEndsAtUtcMs: null,
    }, operationId);
    return this.#accept(true, [this.#event(operationId, "focus-session.cancelled", occurredAtUtcMs, { previousPhase })]);
  }

  skipBreak(operationId: string, occurredAtUtcMs: number): FocusSessionOperationResult {
    const issue = this.#validateOperation(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    if (this.#state.phase !== "break") {
      return this.#reject("BREAK_NOT_ACTIVE", "The focus break is not active.");
    }
    this.#replace({
      phase: "idle",
      requestedAtUtcMs: null,
      phaseStartedAtUtcMs: null,
      phaseEndsAtUtcMs: null,
    }, operationId);
    return this.#accept(true, [this.#event(operationId, "focus-session.break-skipped", occurredAtUtcMs, {})]);
  }

  #validateOperation(operationId: string, occurredAtUtcMs: number): FocusSessionOperationResult | null {
    if (!validOperationId(operationId) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Focus session request is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject("DUPLICATE_OPERATION", "Focus operation was already processed.");
    }
    return null;
  }

  #replace(update: Partial<FocusSessionState>, operationId: string | null): void {
    this.#state = cloneState({
      ...this.#state,
      ...update,
      revision: this.#state.revision + 1,
      processedOperationIds: operationId === null
        ? this.#state.processedOperationIds
        : [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
    });
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}:${occurredAtUtcMs}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #accept(changed: boolean, events: readonly DomainEvent[] = []): FocusSessionOperationResult {
    this.#eventBus.publishAll(events);
    return Object.freeze({
      accepted: true,
      changed,
      state: this.exportState(),
      events: Object.freeze([...events]),
    });
  }

  #reject(code: FocusSessionRejectionCode, message: string): FocusSessionOperationResult {
    return Object.freeze({ accepted: false, changed: false, code, message, events: [] as const });
  }
}