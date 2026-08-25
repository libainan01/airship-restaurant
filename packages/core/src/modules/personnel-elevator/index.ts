import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { isInstanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { Point2D } from "../scene-layout";

export const PERSONNEL_ELEVATOR_MODULE_ID = "module.personnel-elevator";
export const PERSONNEL_ELEVATOR_SCHEMA_VERSION = 1;

export type PersonnelElevatorPhase = "idle" | "moving-empty" | "boarding" | "moving-passenger" | "alighting";

export interface PersonnelElevatorStationDefinition {
  readonly id: string;
  readonly navigationAreaId: string;
  readonly waitingPoint: Point2D;
  readonly exitPoint: Point2D;
}

export interface PersonnelElevatorDefinition {
  readonly id: string;
  readonly stations: readonly [PersonnelElevatorStationDefinition, PersonnelElevatorStationDefinition];
  readonly travelDurationMs: number;
  readonly boardingDurationMs: number;
  readonly alightingDurationMs: number;
}

export interface PersonnelElevatorRequestState {
  readonly id: string;
  readonly characterId: InstanceId;
  readonly fromStationId: string;
  readonly toStationId: string;
  readonly requestedAtUtcMs: number;
}

export interface PersonnelElevatorState {
  readonly schemaVersion: typeof PERSONNEL_ELEVATOR_SCHEMA_VERSION;
  readonly revision: number;
  readonly elevatorId: string;
  readonly phase: PersonnelElevatorPhase;
  readonly cabinStationId: string | null;
  readonly motionFromStationId: string | null;
  readonly motionToStationId: string | null;
  readonly phaseStartedAtUtcMs: number;
  readonly phaseEndsAtUtcMs: number | null;
  readonly passengerCharacterId: InstanceId | null;
  readonly activeRequest: PersonnelElevatorRequestState | null;
  readonly queue: readonly PersonnelElevatorRequestState[];
  readonly lastAdvancedAtUtcMs: number;
  readonly processedOperationIds: readonly string[];
}

export interface PersonnelElevatorSnapshot extends PersonnelElevatorState {
  readonly phaseProgress: number;
}

export type CrossAreaMovementStep =
  | { readonly type: "walk-to-station"; readonly stationId: string; readonly navigationAreaId: string; readonly point: Point2D }
  | { readonly type: "wait-for-elevator"; readonly stationId: string }
  | { readonly type: "ride-elevator"; readonly fromStationId: string; readonly toStationId: string }
  | { readonly type: "walk-from-station"; readonly stationId: string; readonly navigationAreaId: string; readonly point: Point2D };

export interface CrossAreaMovementPlan {
  readonly fromNavigationAreaId: string;
  readonly toNavigationAreaId: string;
  readonly steps: readonly CrossAreaMovementStep[];
}

export type PersonnelElevatorRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_REQUEST"
  | "CHARACTER_ALREADY_WAITING_OR_RIDING"
  | "UNKNOWN_STATION"
  | "SAME_STATION"
  | "UNKNOWN_REQUEST"
  | "REQUEST_ALREADY_ACTIVE"
  | "CLOCK_ROLLBACK"
  | "ROUTE_UNAVAILABLE";

export type PersonnelElevatorOperationResult<TValue = undefined> =
  | { readonly accepted: true; readonly changed: true; readonly operationId: string; readonly value: TValue; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly operationId: string; readonly code: PersonnelElevatorRejectionCode; readonly message: string; readonly events: readonly [] };

const OPERATION_HISTORY_LIMIT = 2_048;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const finitePoint = (point: Point2D): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

function freezeStation(station: PersonnelElevatorStationDefinition): PersonnelElevatorStationDefinition {
  return Object.freeze({ ...station, waitingPoint: Object.freeze({ ...station.waitingPoint }), exitPoint: Object.freeze({ ...station.exitPoint }) });
}

function freezeRequest(request: PersonnelElevatorRequestState): PersonnelElevatorRequestState {
  return Object.freeze({ ...request });
}

function cloneState(state: PersonnelElevatorState): PersonnelElevatorState {
  return Object.freeze({
    ...state,
    activeRequest: state.activeRequest === null ? null : freezeRequest(state.activeRequest),
    queue: Object.freeze(state.queue.map(freezeRequest)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export class PersonnelElevatorModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = PERSONNEL_ELEVATOR_MODULE_ID;
  readonly transactionParticipantId = PERSONNEL_ELEVATOR_MODULE_ID;
  readonly #definition: PersonnelElevatorDefinition;
  readonly #stations = new Map<string, PersonnelElevatorStationDefinition>();
  #state: PersonnelElevatorState;
  #transactionActive = false;

  constructor(definition: PersonnelElevatorDefinition, initialState?: PersonnelElevatorState) {
    if (!validId(definition.id) || definition.stations.length !== 2 || !positiveInteger(definition.travelDurationMs) ||
      !positiveInteger(definition.boardingDurationMs) || !positiveInteger(definition.alightingDurationMs)) {
      throw new Error("Personnel elevator definition is invalid.");
    }
    for (const station of definition.stations) {
      if (!validId(station.id) || !validId(station.navigationAreaId) || !finitePoint(station.waitingPoint) ||
        !finitePoint(station.exitPoint) || this.#stations.has(station.id)) throw new Error(`Invalid personnel elevator station: ${station.id}`);
      this.#stations.set(station.id, freezeStation(station));
    }
    if (new Set(definition.stations.map((station) => station.navigationAreaId)).size !== 2) {
      throw new Error("Personnel elevator stations must connect two different navigation areas.");
    }
    this.#definition = Object.freeze({ ...definition, stations: Object.freeze(definition.stations.map(freezeStation)) as unknown as readonly [PersonnelElevatorStationDefinition, PersonnelElevatorStationDefinition] });
    this.#state = initialState === undefined
      ? cloneState({ schemaVersion: PERSONNEL_ELEVATOR_SCHEMA_VERSION, revision: 0, elevatorId: definition.id, phase: "idle",
          cabinStationId: definition.stations[0].id, motionFromStationId: null, motionToStationId: null, phaseStartedAtUtcMs: 0,
          phaseEndsAtUtcMs: null, passengerCharacterId: null, activeRequest: null, queue: [], lastAdvancedAtUtcMs: 0, processedOperationIds: [] })
      : cloneState(initialState);
    this.#validateState();
  }

  exportState(): PersonnelElevatorState { return cloneState(this.#state); }

  getSnapshot(nowUtcMs = this.#state.lastAdvancedAtUtcMs): PersonnelElevatorSnapshot {
    const duration = this.#state.phaseEndsAtUtcMs === null ? 0 : this.#state.phaseEndsAtUtcMs - this.#state.phaseStartedAtUtcMs;
    const phaseProgress = duration <= 0 ? (this.#state.phase === "idle" ? 0 : 1) :
      Math.max(0, Math.min(1, (nowUtcMs - this.#state.phaseStartedAtUtcMs) / duration));
    return Object.freeze({ ...cloneState(this.#state), phaseProgress });
  }

  createCrossAreaPlan(fromNavigationAreaId: string, toNavigationAreaId: string): CrossAreaMovementPlan {
    const from = this.#definition.stations.find((station) => station.navigationAreaId === fromNavigationAreaId);
    const to = this.#definition.stations.find((station) => station.navigationAreaId === toNavigationAreaId);
    if (from === undefined || to === undefined || from.id === to.id) throw new Error("Personnel elevator route is unavailable.");
    return Object.freeze({
      fromNavigationAreaId,
      toNavigationAreaId,
      steps: Object.freeze([
        Object.freeze({ type: "walk-to-station" as const, stationId: from.id, navigationAreaId: from.navigationAreaId, point: from.waitingPoint }),
        Object.freeze({ type: "wait-for-elevator" as const, stationId: from.id }),
        Object.freeze({ type: "ride-elevator" as const, fromStationId: from.id, toStationId: to.id }),
        Object.freeze({ type: "walk-from-station" as const, stationId: to.id, navigationAreaId: to.navigationAreaId, point: to.exitPoint }),
      ]),
    });
  }

  requestTransfer(operationId: string, request: PersonnelElevatorRequestState): PersonnelElevatorOperationResult<PersonnelElevatorRequestState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    if (!validId(request.id) || !isInstanceId(request.characterId) || !nonNegativeInteger(request.requestedAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Personnel elevator request is invalid.");
    }
    if (!this.#stations.has(request.fromStationId) || !this.#stations.has(request.toStationId)) return this.#reject(operationId, "UNKNOWN_STATION", "Personnel elevator station is unknown.");
    if (request.requestedAtUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject(operationId, "CLOCK_ROLLBACK", "Personnel elevator request cannot precede its current clock.");
    if (request.fromStationId === request.toStationId) return this.#reject(operationId, "SAME_STATION", "Personnel elevator transfer requires different stations.");
    if (this.#state.activeRequest?.id === request.id || this.#state.queue.some((item) => item.id === request.id)) return this.#reject(operationId, "DUPLICATE_REQUEST", `Personnel elevator request already exists: ${request.id}`);
    if (this.#state.passengerCharacterId === request.characterId || this.#state.activeRequest?.characterId === request.characterId ||
      this.#state.queue.some((item) => item.characterId === request.characterId)) {
      return this.#reject(operationId, "CHARACTER_ALREADY_WAITING_OR_RIDING", "Character already has an elevator request.");
    }
    const queued = freezeRequest(request);
    this.#replace({ queue: [...this.#state.queue, queued] });
    return this.#accept(operationId, queued, [this.#event(operationId, "personnel-elevator.requested", request.requestedAtUtcMs,
      { elevatorId: this.#definition.id, requestId: request.id, characterId: request.characterId, fromStationId: request.fromStationId, toStationId: request.toStationId })]);
  }

  cancelQueuedRequest(operationId: string, requestId: string, occurredAtUtcMs: number): PersonnelElevatorOperationResult<undefined> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const index = this.#state.queue.findIndex((item) => item.id === requestId);
    if (this.#state.activeRequest?.id === requestId) return this.#reject(operationId, "REQUEST_ALREADY_ACTIVE", "An active elevator request cannot be cancelled.");
    if (index < 0) return this.#reject(operationId, "UNKNOWN_REQUEST", `Unknown queued elevator request: ${requestId}`);
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Cancellation time is invalid.");
    this.#replace({ queue: this.#state.queue.filter((_, current) => current !== index) });
    return this.#accept(operationId, undefined, [this.#event(operationId, "personnel-elevator.request-cancelled", occurredAtUtcMs, { elevatorId: this.#definition.id, requestId })]);
  }

  advanceTo(operationId: string, nowUtcMs: number): PersonnelElevatorOperationResult<PersonnelElevatorSnapshot> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    if (!nonNegativeInteger(nowUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Personnel elevator clock is invalid.");
    if (nowUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject(operationId, "CLOCK_ROLLBACK", "Personnel elevator clock cannot move backwards.");
    let state = cloneState(this.#state);
    const events: DomainEvent[] = [];
    let eventSequence = 0;
    const emit = (type: string, occurredAtUtcMs: number, payload: unknown) => {
      events.push(this.#event(operationId, type, occurredAtUtcMs, payload, String(eventSequence++)));
    };
    for (let guard = 0; guard < 10_000; guard += 1) {
      if (state.phase === "idle") {
        const request = state.queue[0];
        if (request === undefined || request.requestedAtUtcMs > nowUtcMs) break;
        const remaining = state.queue.slice(1);
        const startAtUtcMs = Math.max(state.lastAdvancedAtUtcMs, request.requestedAtUtcMs);
        if (state.cabinStationId === request.fromStationId) {
          state = cloneState({ ...state, phase: "boarding", activeRequest: request, queue: remaining,
            phaseStartedAtUtcMs: startAtUtcMs, phaseEndsAtUtcMs: startAtUtcMs + this.#definition.boardingDurationMs });
          emit("personnel-elevator.boarding-started", state.phaseStartedAtUtcMs, { elevatorId: state.elevatorId, requestId: request.id, characterId: request.characterId, stationId: request.fromStationId });
        } else {
          state = cloneState({ ...state, phase: "moving-empty", activeRequest: request, queue: remaining, cabinStationId: null,
            motionFromStationId: state.cabinStationId, motionToStationId: request.fromStationId,
            phaseStartedAtUtcMs: startAtUtcMs, phaseEndsAtUtcMs: startAtUtcMs + this.#definition.travelDurationMs });
          emit("personnel-elevator.empty-trip-started", state.phaseStartedAtUtcMs, { elevatorId: state.elevatorId, requestId: request.id, toStationId: request.fromStationId });
        }
        continue;
      }
      const phaseEnd = state.phaseEndsAtUtcMs!;
      if (nowUtcMs < phaseEnd) break;
      const request = state.activeRequest!;
      if (state.phase === "moving-empty") {
        state = cloneState({ ...state, phase: "boarding", cabinStationId: request.fromStationId, motionFromStationId: null, motionToStationId: null,
          phaseStartedAtUtcMs: phaseEnd, phaseEndsAtUtcMs: phaseEnd + this.#definition.boardingDurationMs });
        emit("personnel-elevator.boarding-started", phaseEnd, { elevatorId: state.elevatorId, requestId: request.id, characterId: request.characterId, stationId: request.fromStationId });
      } else if (state.phase === "boarding") {
        state = cloneState({ ...state, phase: "moving-passenger", cabinStationId: null, motionFromStationId: request.fromStationId,
          motionToStationId: request.toStationId, passengerCharacterId: request.characterId,
          phaseStartedAtUtcMs: phaseEnd, phaseEndsAtUtcMs: phaseEnd + this.#definition.travelDurationMs });
        emit("personnel-elevator.passenger-trip-started", phaseEnd, { elevatorId: state.elevatorId, requestId: request.id, characterId: request.characterId,
          fromStationId: request.fromStationId, toStationId: request.toStationId });
      } else if (state.phase === "moving-passenger") {
        state = cloneState({ ...state, phase: "alighting", cabinStationId: request.toStationId, motionFromStationId: null, motionToStationId: null,
          phaseStartedAtUtcMs: phaseEnd, phaseEndsAtUtcMs: phaseEnd + this.#definition.alightingDurationMs });
        emit("personnel-elevator.alighting-started", phaseEnd, { elevatorId: state.elevatorId, requestId: request.id, characterId: request.characterId, stationId: request.toStationId });
      } else if (state.phase === "alighting") {
        const station = this.#stations.get(request.toStationId)!;
        state = cloneState({ ...state, phase: "idle", phaseStartedAtUtcMs: phaseEnd, phaseEndsAtUtcMs: null, passengerCharacterId: null,
          activeRequest: null, motionFromStationId: null, motionToStationId: null });
        emit("personnel-elevator.transfer-completed", phaseEnd, { elevatorId: state.elevatorId, requestId: request.id, characterId: request.characterId,
          stationId: station.id, navigationAreaId: station.navigationAreaId, exitPoint: station.exitPoint });
      }
      state = cloneState({ ...state, lastAdvancedAtUtcMs: phaseEnd });
    }
    state = cloneState({ ...state, lastAdvancedAtUtcMs: nowUtcMs });
    this.#state = cloneState({ ...state, revision: this.#state.revision + 1,
      processedOperationIds: this.#state.processedOperationIds });
    return this.#accept(operationId, this.getSnapshot(nowUtcMs), events);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Personnel elevator transaction is already active.");
    this.#transactionActive = true; const checkpoint = this.exportState();
    return { validateTransaction: () => this.#validateState(), commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = cloneState(checkpoint); this.#transactionActive = false; } };
  }

  #prepare(operationId: string): PersonnelElevatorOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Personnel elevator operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject(operationId, "DUPLICATE_OPERATION", "Personnel elevator operation was already processed.");
    this.#state = cloneState({ ...this.#state, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT) }); return null;
  }
  #replace(update: Partial<PersonnelElevatorState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #accept<TValue>(operationId: string, value: TValue, events: readonly DomainEvent[]): PersonnelElevatorOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value, events: Object.freeze([...events]) });
  }
  #reject(operationId: string, code: PersonnelElevatorRejectionCode, message: string): PersonnelElevatorOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown, discriminator = "0"): DomainEvent {
    return Object.freeze({ id: `${type}:${operationId}:${discriminator}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #validateState(): void {
    const state = this.#state;
    if (state.schemaVersion !== PERSONNEL_ELEVATOR_SCHEMA_VERSION || state.elevatorId !== this.#definition.id || !nonNegativeInteger(state.revision) ||
      !nonNegativeInteger(state.lastAdvancedAtUtcMs) || new Set(state.processedOperationIds).size !== state.processedOperationIds.length) throw new Error("Personnel elevator state metadata is invalid.");
    const requestIds = [state.activeRequest?.id, ...state.queue.map((item) => item.id)].filter((value): value is string => value !== undefined);
    const characters = [state.activeRequest?.characterId, ...state.queue.map((item) => item.characterId)].filter((value): value is InstanceId => value !== undefined);
    if (new Set(requestIds).size !== requestIds.length || new Set(characters).size !== characters.length || state.queue.some((request) => !this.#validRequest(request)) ||
      (state.activeRequest !== null && !this.#validRequest(state.activeRequest))) throw new Error("Personnel elevator requests are invalid.");
    if (state.phase === "idle" && (state.activeRequest !== null || state.passengerCharacterId !== null || state.phaseEndsAtUtcMs !== null || state.cabinStationId === null)) throw new Error("Idle personnel elevator state is invalid.");
    if ((state.phase === "boarding" || state.phase === "moving-empty") && (state.activeRequest === null || state.passengerCharacterId !== null)) throw new Error("Personnel elevator pickup state is invalid.");
    if ((state.phase === "moving-passenger" || state.phase === "alighting") && (state.activeRequest === null || state.passengerCharacterId !== state.activeRequest.characterId)) throw new Error("Personnel elevator passenger state is invalid.");
  }
  #validRequest(request: PersonnelElevatorRequestState): boolean {
    return validId(request.id) && isInstanceId(request.characterId) && this.#stations.has(request.fromStationId) && this.#stations.has(request.toStationId) &&
      request.fromStationId !== request.toStationId && nonNegativeInteger(request.requestedAtUtcMs);
  }
}
