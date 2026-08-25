import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, instanceId, isInstanceId, TransactionScope } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { InventoryModule } from "../inventory";
import type { LogisticsDemandModule, LogisticsUnitClaimState } from "../logistics-demand";
import { createStableTaskKey, type TaskRequest, type TaskSourceSnapshot } from "../task";

export const FREIGHT_ELEVATOR_MODULE_ID = "module.freight-elevator";
export const FREIGHT_ELEVATOR_SCHEMA_VERSION = 1;
export const DEFAULT_FREIGHT_ELEVATOR_COUNT = 4;

export type FreightElevatorPhase = "idle" | "moving-empty" | "moving-loaded";

export interface FreightElevatorDefinition {
  readonly id: string;
  readonly transitLocationId: string;
  readonly initialStationId: string;
  readonly speedUnitsPerSecond: number;
  readonly maxDurability: number;
  readonly durabilityLossPerTrip: number;
}

export interface FreightElevatorGroupDefinition {
  readonly id: string;
  readonly stationIds: readonly [string, string];
  readonly routeLengthUnits: number;
  readonly elevators: readonly FreightElevatorDefinition[];
}

export interface FreightElevatorRepairState {
  readonly taskId: string;
  readonly characterId: InstanceId;
  readonly repairUnitsPerSecond: number;
  readonly startedAtUtcMs: number;
  readonly endsAtUtcMs: number;
}

export interface FreightElevatorInstanceState {
  readonly id: string;
  readonly transitLocationId: string;
  readonly phase: FreightElevatorPhase;
  readonly dockedStationId: string | null;
  readonly motionFromStationId: string | null;
  readonly motionToStationId: string | null;
  readonly motionStartedAtUtcMs: number | null;
  readonly motionEndsAtUtcMs: number | null;
  readonly motionPathLengthUnits: number | null;
  readonly motionSpeedUnitsPerSecond: number | null;
  readonly activeClaimId: string | null;
  readonly cargoInstanceId: InstanceId | null;
  readonly speedUnitsPerSecond: number;
  readonly durability: number;
  readonly maxDurability: number;
  readonly durabilityLossPerTrip: number;
  readonly repairNeededAtUtcMs: number | null;
  readonly repair: FreightElevatorRepairState | null;
}

export interface FreightElevatorState {
  readonly schemaVersion: typeof FREIGHT_ELEVATOR_SCHEMA_VERSION;
  readonly revision: number;
  readonly groupId: string;
  readonly stationIds: readonly [string, string];
  readonly routeLengthUnits: number;
  readonly editingStartedAtUtcMs: number | null;
  readonly elevators: readonly FreightElevatorInstanceState[];
  readonly nextClaimSequence: number;
  readonly lastAdvancedAtUtcMs: number;
  readonly processedOperationIds: readonly string[];
}

export interface FreightElevatorSnapshot extends FreightElevatorState {
  readonly elevatorProgress: Readonly<Record<string, number>>;
}

export interface FreightElevatorRepairTaskSource {
  readonly taskId: string;
  readonly elevatorId: string;
  readonly stationId: string;
  readonly missingDurability: number;
  readonly createdAtUtcMs: number;
}

export type FreightElevatorRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_ELEVATOR"
  | "CLOCK_ROLLBACK"
  | "EDIT_MODE_ACTIVE"
  | "EDIT_MODE_INACTIVE"
  | "ELEVATOR_BUSY"
  | "REPAIR_NOT_NEEDED"
  | "DEPENDENCY_REJECTED";

export type FreightElevatorResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: FreightElevatorRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 4_096;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 240;
const integer = (value: number, minimum = 0): boolean => Number.isSafeInteger(value) && value >= minimum;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const cloneRepair = (value: FreightElevatorRepairState | null): FreightElevatorRepairState | null => value === null ? null : Object.freeze({ ...value });
const cloneElevator = (value: FreightElevatorInstanceState): FreightElevatorInstanceState => Object.freeze({ ...value, repair: cloneRepair(value.repair) });
function cloneState(value: FreightElevatorState): FreightElevatorState {
  return Object.freeze({
    ...value,
    stationIds: Object.freeze([...value.stationIds]) as unknown as readonly [string, string],
    elevators: Object.freeze(value.elevators.map(cloneElevator)),
    processedOperationIds: Object.freeze([...value.processedOperationIds]),
  });
}

export class FreightElevatorModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = FREIGHT_ELEVATOR_MODULE_ID;
  readonly transactionParticipantId = FREIGHT_ELEVATOR_MODULE_ID;
  readonly #inventory: InventoryModule;
  readonly #logistics: LogisticsDemandModule;
  readonly #transaction: TransactionScope;
  #state: FreightElevatorState;
  #transactionActive = false;

  constructor(options: {
    readonly definition: FreightElevatorGroupDefinition;
    readonly inventory: InventoryModule;
    readonly logistics: LogisticsDemandModule;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: FreightElevatorState;
  }) {
    const { definition } = options;
    if (!valid(definition.id) || definition.stationIds.length !== 2 || !valid(definition.stationIds[0]) || !valid(definition.stationIds[1]) ||
      definition.stationIds[0] === definition.stationIds[1] || !positive(definition.routeLengthUnits) || definition.elevators.length === 0 ||
      new Set(definition.elevators.map((entry) => entry.id)).size !== definition.elevators.length ||
      new Set(definition.elevators.map((entry) => entry.transitLocationId)).size !== definition.elevators.length) {
      throw new Error("Freight elevator group definition is invalid.");
    }
    for (const elevator of definition.elevators) {
      if (!valid(elevator.id) || !valid(elevator.transitLocationId) || !definition.stationIds.includes(elevator.initialStationId) ||
        !positive(elevator.speedUnitsPerSecond) || !integer(elevator.maxDurability, 1) || !integer(elevator.durabilityLossPerTrip, 1) ||
        elevator.durabilityLossPerTrip > elevator.maxDurability) throw new Error(`Freight elevator definition is invalid: ${elevator.id}`);
      if (options.inventory.getLocationSnapshot(elevator.transitLocationId) === null) throw new Error(`Freight elevator transit inventory location is missing: ${elevator.transitLocationId}`);
    }
    for (const stationId of definition.stationIds) if (options.inventory.getLocationSnapshot(stationId) === null) throw new Error(`Freight elevator station inventory location is missing: ${stationId}`);
    this.#inventory = options.inventory;
    this.#logistics = options.logistics;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: 1,
          revision: 0,
          groupId: definition.id,
          stationIds: definition.stationIds,
          routeLengthUnits: definition.routeLengthUnits,
          editingStartedAtUtcMs: null,
          elevators: definition.elevators.map((entry) => cloneElevator({
            id: entry.id,
            transitLocationId: entry.transitLocationId,
            phase: "idle",
            dockedStationId: entry.initialStationId,
            motionFromStationId: null,
            motionToStationId: null,
            motionStartedAtUtcMs: null,
            motionEndsAtUtcMs: null,
            motionPathLengthUnits: null,
            motionSpeedUnitsPerSecond: null,
            activeClaimId: null,
            cargoInstanceId: null,
            speedUnitsPerSecond: entry.speedUnitsPerSecond,
            durability: entry.maxDurability,
            maxDurability: entry.maxDurability,
            durabilityLossPerTrip: entry.durabilityLossPerTrip,
            repairNeededAtUtcMs: null,
            repair: null,
          })),
          nextClaimSequence: 1,
          lastAdvancedAtUtcMs: 0,
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    const expectedElevators = new Map(definition.elevators.map((entry) => [entry.id, entry.transitLocationId]));
    if (this.#state.groupId !== definition.id || this.#state.stationIds[0] !== definition.stationIds[0] || this.#state.stationIds[1] !== definition.stationIds[1] || this.#state.elevators.length !== definition.elevators.length || this.#state.elevators.some((entry) => expectedElevators.get(entry.id) !== entry.transitLocationId)) throw new Error("Freight elevator saved state does not match its definition.");
    this.#validate();
  }

  exportState(): FreightElevatorState { return cloneState(this.#state); }

  getElevator(elevatorId: string): FreightElevatorInstanceState | null {
    const value = this.#state.elevators.find((entry) => entry.id === elevatorId);
    return value === undefined ? null : cloneElevator(value);
  }

  getSnapshot(nowUtcMs = this.#state.lastAdvancedAtUtcMs): FreightElevatorSnapshot {
    const elevatorProgress: Record<string, number> = {};
    for (const elevator of this.#state.elevators) {
      if (elevator.motionStartedAtUtcMs === null || elevator.motionEndsAtUtcMs === null) elevatorProgress[elevator.id] = 0;
      else elevatorProgress[elevator.id] = Math.max(0, Math.min(1, (nowUtcMs - elevator.motionStartedAtUtcMs) / (elevator.motionEndsAtUtcMs - elevator.motionStartedAtUtcMs)));
    }
    return Object.freeze({ ...cloneState(this.#state), elevatorProgress: Object.freeze(elevatorProgress) });
  }

  createRepairTaskSources(): readonly FreightElevatorRepairTaskSource[] {
    return Object.freeze(this.#state.elevators
      .filter((entry) => entry.phase === "idle" && entry.activeClaimId === null && entry.repair === null && entry.durability < entry.maxDurability)
      .map((entry) => Object.freeze({
        taskId: this.#repairTaskId(entry),
        elevatorId: entry.id,
        stationId: entry.dockedStationId!,
        missingDurability: entry.maxDurability - entry.durability,
        createdAtUtcMs: entry.repairNeededAtUtcMs!,
      })));
  }

  createTaskSourceSnapshot(): TaskSourceSnapshot {
    const waitingTasks = this.#state.elevators
      .filter((entry) => entry.phase === "idle" && entry.activeClaimId === null && entry.repair === null && entry.durability < entry.maxDurability)
      .map((entry) => this.#repairTaskRequest(entry));
    const activeTasks = this.#state.elevators
      .filter((entry) => entry.repair !== null)
      .map((entry) => Object.freeze({
        request: this.#repairTaskRequest(entry),
        assignedCharacterId: entry.repair!.characterId,
        claimedAtUtcMs: entry.repair!.startedAtUtcMs,
      }));
    return Object.freeze({
      sourceId: `source.freight-elevator.${this.#state.groupId}`,
      sourceRevision: this.#state.revision,
      waitingTasks: Object.freeze(waitingTasks),
      activeTasks: Object.freeze(activeTasks),
    });
  }
  advanceTo(operationId: string, nowUtcMs: number): FreightElevatorResult<FreightElevatorSnapshot> {
    const issue = this.#operationIssue(operationId);
    if (issue !== null) return issue;
    if (!integer(nowUtcMs)) return this.#reject("INVALID_REQUEST", "Freight elevator clock is invalid.");
    if (nowUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject("CLOCK_ROLLBACK", "Freight elevator clock cannot move backwards.");
    if (this.#state.editingStartedAtUtcMs !== null) return this.#reject("EDIT_MODE_ACTIVE", "Freight elevator movement is frozen in edit mode.");

    const logisticsRevisionBefore = this.#logistics.exportState().revision;
    let elevators = this.#state.elevators.map(cloneElevator);
    const readyAtUtcMs = elevators.map(() => this.#state.lastAdvancedAtUtcMs);
    let nextClaimSequence = this.#state.nextClaimSequence;
    const events: DomainEvent[] = [];
    let eventSequence = 0;
    const emit = (type: string, time: number, payload: unknown) => events.push(this.#event(operationId, type, time, payload, String(eventSequence++)));

    for (let guard = 0; guard < 10_000; guard += 1) {
      let transitioned = false;
      for (let index = 0; index < elevators.length; index += 1) {
        let elevator = elevators[index]!;
        if (elevator.repair !== null && elevator.repair.endsAtUtcMs <= nowUtcMs) {
          const completedAt = elevator.repair.endsAtUtcMs;
          elevator = cloneElevator({ ...elevator, durability: elevator.maxDurability, repairNeededAtUtcMs: null, repair: null });
          readyAtUtcMs[index] = completedAt;
          elevators[index] = elevator;
          emit("freight-elevator.repair-completed", completedAt, { elevatorId: elevator.id, durability: elevator.maxDurability });
          transitioned = true;
        }
        if (elevator.phase !== "idle" && elevator.motionEndsAtUtcMs! <= nowUtcMs) {
          const arrivedAt = elevator.motionEndsAtUtcMs!;
          const arrived = this.#deductTripDurability(elevator, arrivedAt);
          readyAtUtcMs[index] = arrivedAt;
          if (elevator.phase === "moving-empty") {
            const claim = this.#requiredClaim(elevator.activeClaimId!);
            const cargoInstanceId = this.#loadClaim(claim, elevator, arrivedAt);
            elevator = this.#startLoadedTrip({ ...arrived, dockedStationId: claim.sourceLocationId, cargoInstanceId }, claim, arrivedAt);
            elevators[index] = elevator;
            emit("freight-elevator.cargo-loaded", arrivedAt, { elevatorId: elevator.id, claimId: claim.id, cargoInstanceId, stationId: claim.sourceLocationId });
            emit("freight-elevator.loaded-trip-started", arrivedAt, this.#tripPayload(elevator));
            if (arrived.durability === 0 && elevator.durabilityLossPerTrip > 0) emit("freight-elevator.durability-depleted", arrivedAt, { elevatorId: elevator.id, activeClaimId: claim.id });
          } else {
            const claim = this.#requiredClaim(elevator.activeClaimId!);
            this.#unloadClaim(claim, elevator, arrivedAt);
            elevator = this.#clearTrip({ ...arrived, dockedStationId: claim.targetLocationId });
            elevators[index] = elevator;
            emit("freight-elevator.cargo-delivered", arrivedAt, { elevatorId: elevator.id, claimId: claim.id, groupId: claim.groupId, itemId: claim.itemId, stationId: claim.targetLocationId });
            if (elevator.durability === 0) emit("freight-elevator.durability-depleted", arrivedAt, { elevatorId: elevator.id, activeClaimId: null });
          }
          transitioned = true;
          continue;
        }
        if (elevator.phase === "idle" && elevator.repair === null && elevator.durability > 0) {
          const routeCandidates = this.#logistics.listCandidates(nowUtcMs).filter((entry) => this.#state.stationIds.includes(entry.sourceLocationId) && this.#state.stationIds.includes(entry.targetLocationId));
          if (routeCandidates.length === 0) continue;
          const dispatchAt = Math.max(readyAtUtcMs[index]!, Math.min(...routeCandidates.map((entry) => entry.createdAtUtcMs)));
          if (dispatchAt > nowUtcMs) continue;
          const claimId = `claim.freight.${this.#state.groupId}.${nextClaimSequence}`;
          const claimed = this.#logistics.claimNextUnit(`freight-dispatch:${claimId}`, claimId, dispatchAt, routeCandidates.map((entry) => entry.id));
          if (!claimed.accepted) continue;
          nextClaimSequence += 1;
          const claim = claimed.value;
          if (!this.#state.stationIds.includes(claim.sourceLocationId) || !this.#state.stationIds.includes(claim.targetLocationId)) throw new Error("Freight claim does not belong to this elevator route.");
          if (elevator.dockedStationId === claim.sourceLocationId) {
            const cargoInstanceId = this.#loadClaim(claim, elevator, dispatchAt);
            elevator = this.#startLoadedTrip({ ...elevator, activeClaimId: claim.id, cargoInstanceId }, claim, dispatchAt);
            emit("freight-elevator.cargo-loaded", dispatchAt, { elevatorId: elevator.id, claimId: claim.id, cargoInstanceId, stationId: claim.sourceLocationId });
            emit("freight-elevator.loaded-trip-started", dispatchAt, this.#tripPayload(elevator));
          } else {
            elevator = this.#startTrip({ ...elevator, activeClaimId: claim.id }, "moving-empty", elevator.dockedStationId!, claim.sourceLocationId, dispatchAt);
            emit("freight-elevator.empty-trip-started", dispatchAt, this.#tripPayload(elevator));
          }
          elevators[index] = elevator;
          transitioned = true;
        }
      }
      if (!transitioned) break;
    }

    const logisticsChanged = this.#logistics.exportState().revision !== logisticsRevisionBefore;
    if (events.length === 0 && nextClaimSequence === this.#state.nextClaimSequence && nowUtcMs === this.#state.lastAdvancedAtUtcMs) {
      return Object.freeze({
        accepted: true,
        changed: logisticsChanged,
        value: this.getSnapshot(nowUtcMs),
        committedEventIds: Object.freeze([]),
      });
    }
    return this.#run(operationId, nowUtcMs, events, () => {
      this.#replace({ elevators, nextClaimSequence, lastAdvancedAtUtcMs: nowUtcMs });
      return this.getSnapshot(nowUtcMs);
    });
  }

  startRepair(operationId: string, request: { readonly elevatorId: string; readonly taskId: string; readonly characterId: InstanceId; readonly repairUnitsPerSecond: number; readonly occurredAtUtcMs: number }): FreightElevatorResult<FreightElevatorInstanceState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const elevator = this.#state.elevators.find((entry) => entry.id === request.elevatorId);
    if (elevator === undefined) return this.#reject("UNKNOWN_ELEVATOR", "Unknown freight elevator.");
    if (request.taskId !== this.#repairTaskId(elevator) || !isInstanceId(request.characterId) || !positive(request.repairUnitsPerSecond) || !integer(request.occurredAtUtcMs) || request.occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject("INVALID_REQUEST", "Freight elevator repair request is invalid.");
    if (this.#state.editingStartedAtUtcMs !== null) return this.#reject("EDIT_MODE_ACTIVE", "Freight elevator repair cannot start in edit mode.");
    if (elevator.durability >= elevator.maxDurability) return this.#reject("REPAIR_NOT_NEEDED", "Freight elevator does not need repair.");
    if (elevator.phase !== "idle" || elevator.activeClaimId !== null || elevator.repair !== null) return this.#reject("ELEVATOR_BUSY", "Freight elevator is busy.");
    const durationMs = Math.max(1, Math.ceil((elevator.maxDurability - elevator.durability) * 1_000 / request.repairUnitsPerSecond));
    return this.#run(operationId, request.occurredAtUtcMs, [this.#event(operationId, "freight-elevator.repair-started", request.occurredAtUtcMs, { elevatorId: elevator.id, taskId: request.taskId, characterId: request.characterId, durationMs })], () => {
      const next = cloneElevator({ ...elevator, repair: Object.freeze({ taskId: request.taskId, characterId: request.characterId, repairUnitsPerSecond: request.repairUnitsPerSecond, startedAtUtcMs: request.occurredAtUtcMs, endsAtUtcMs: request.occurredAtUtcMs + durationMs }) });
      this.#replace({ elevators: this.#state.elevators.map((entry) => entry.id === elevator.id ? next : entry) });
      return next;
    });
  }

  updateSpeed(operationId: string, elevatorId: string, speedUnitsPerSecond: number, occurredAtUtcMs: number): FreightElevatorResult<FreightElevatorInstanceState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const elevator = this.#state.elevators.find((entry) => entry.id === elevatorId);
    if (elevator === undefined) return this.#reject("UNKNOWN_ELEVATOR", "Unknown freight elevator.");
    if (!positive(speedUnitsPerSecond) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Freight elevator speed update is invalid.");
    return this.#run(operationId, occurredAtUtcMs, [this.#event(operationId, "freight-elevator.speed-updated", occurredAtUtcMs, { elevatorId, previousSpeed: elevator.speedUnitsPerSecond, speedUnitsPerSecond })], () => {
      const next = cloneElevator({ ...elevator, speedUnitsPerSecond });
      this.#replace({ elevators: this.#state.elevators.map((entry) => entry.id === elevatorId ? next : entry) });
      return next;
    });
  }

  enterEditMode(operationId: string, occurredAtUtcMs: number): FreightElevatorResult<FreightElevatorState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    if (!integer(occurredAtUtcMs) || occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs || this.#state.editingStartedAtUtcMs !== null) return this.#reject("INVALID_REQUEST", "Freight elevator edit mode request is invalid.");
    return this.#run(operationId, occurredAtUtcMs, [], () => { this.#replace({ editingStartedAtUtcMs: occurredAtUtcMs, lastAdvancedAtUtcMs: occurredAtUtcMs }); return this.exportState(); });
  }

  confirmRoute(operationId: string, routeLengthUnits: number, occurredAtUtcMs: number): FreightElevatorResult<FreightElevatorState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const freezeAt = this.#state.editingStartedAtUtcMs;
    if (freezeAt === null) return this.#reject("EDIT_MODE_INACTIVE", "Freight elevator route is not being edited.");
    if (!positive(routeLengthUnits) || !integer(occurredAtUtcMs) || occurredAtUtcMs < freezeAt) return this.#reject("INVALID_REQUEST", "Freight elevator route confirmation is invalid.");
    const pauseMs = occurredAtUtcMs - freezeAt;
    return this.#run(operationId, occurredAtUtcMs, [this.#event(operationId, "freight-elevator.route-confirmed", occurredAtUtcMs, { previousLengthUnits: this.#state.routeLengthUnits, routeLengthUnits })], () => {
      const elevators = this.#state.elevators.map((entry) => {
        if (entry.phase === "idle") return cloneElevator({ ...entry, repair: entry.repair === null ? null : Object.freeze({ ...entry.repair, startedAtUtcMs: entry.repair.startedAtUtcMs + pauseMs, endsAtUtcMs: entry.repair.endsAtUtcMs + pauseMs }) });
        const oldDuration = entry.motionEndsAtUtcMs! - entry.motionStartedAtUtcMs!;
        const progress = Math.max(0, Math.min(1, (freezeAt - entry.motionStartedAtUtcMs!) / oldDuration));
        const newDuration = this.#travelDuration(routeLengthUnits, entry.motionSpeedUnitsPerSecond!);
        return cloneElevator({ ...entry, motionPathLengthUnits: routeLengthUnits, motionStartedAtUtcMs: occurredAtUtcMs - Math.round(progress * newDuration), motionEndsAtUtcMs: occurredAtUtcMs + Math.ceil((1 - progress) * newDuration) });
      });
      this.#replace({ routeLengthUnits, editingStartedAtUtcMs: null, elevators, lastAdvancedAtUtcMs: occurredAtUtcMs });
      return this.exportState();
    });
  }

  cancelEditMode(operationId: string, occurredAtUtcMs: number): FreightElevatorResult<FreightElevatorState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const freezeAt = this.#state.editingStartedAtUtcMs;
    if (freezeAt === null) return this.#reject("EDIT_MODE_INACTIVE", "Freight elevator route is not being edited.");
    if (!integer(occurredAtUtcMs) || occurredAtUtcMs < freezeAt) return this.#reject("INVALID_REQUEST", "Freight elevator edit cancellation is invalid.");
    const pauseMs = occurredAtUtcMs - freezeAt;
    return this.#run(operationId, occurredAtUtcMs, [], () => {
      const elevators = this.#state.elevators.map((entry) => cloneElevator({
        ...entry,
        motionStartedAtUtcMs: entry.motionStartedAtUtcMs === null ? null : entry.motionStartedAtUtcMs + pauseMs,
        motionEndsAtUtcMs: entry.motionEndsAtUtcMs === null ? null : entry.motionEndsAtUtcMs + pauseMs,
        repair: entry.repair === null ? null : Object.freeze({ ...entry.repair, startedAtUtcMs: entry.repair.startedAtUtcMs + pauseMs, endsAtUtcMs: entry.repair.endsAtUtcMs + pauseMs }),
      }));
      this.#replace({ editingStartedAtUtcMs: null, elevators, lastAdvancedAtUtcMs: occurredAtUtcMs });
      return this.exportState();
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Freight elevator transaction is already active.");
    this.#transactionActive = true; const saved = this.exportState();
    return { validateTransaction: () => this.#validate(), commitTransaction: () => { this.#transactionActive = false; }, rollbackTransaction: () => { this.#state = saved; this.#transactionActive = false; } };
  }

  #repairTaskId(elevator: FreightElevatorInstanceState): string {
    return createStableTaskKey({
      sourceType: "freight-elevator-group",
      sourceId: this.#state.groupId,
      taskType: "equipment.repair",
      targetType: "freight-elevator",
      targetId: elevator.id,
      discriminator: `damage-at-${elevator.repairNeededAtUtcMs ?? elevator.repair?.startedAtUtcMs ?? 0}`,
    });
  }

  #repairTaskRequest(elevator: FreightElevatorInstanceState): TaskRequest {
    const missing = elevator.maxDurability - elevator.durability;
    return Object.freeze({
      taskId: this.#repairTaskId(elevator),
      taskType: "equipment.repair",
      source: Object.freeze({ type: "freight-elevator-group", id: this.#state.groupId }),
      target: Object.freeze({ type: "freight-elevator", id: elevator.id }),
      basePriority: elevator.durability === 0 ? 350 : 120,
      requiredTags: Object.freeze(["employee"]),
      eligibleJobIds: Object.freeze(["job.repairer"]),
      requiredSkills: Object.freeze([Object.freeze({ skill: "repair" as const, minimumLevel: 1 })]),
      urgency: elevator.durability === 0 ? 100 : Math.min(99, Math.ceil(missing * 50 / elevator.maxDurability)),
      urgent: elevator.durability === 0,
      interruptible: true,
      createdAtUtcMs: elevator.repairNeededAtUtcMs!,
    });
  }
  #requiredClaim(claimId: string): LogisticsUnitClaimState {
    const claim = this.#logistics.getClaim(claimId);
    if (claim === null) throw new Error(`Freight elevator claim is missing: ${claimId}`);
    return claim;
  }

  #loadClaim(claim: LogisticsUnitClaimState, elevator: FreightElevatorInstanceState, occurredAtUtcMs: number): InstanceId {
    if (claim.inventoryMode === "stack") {
      const cargoInstanceId = instanceId(`instance.freight_cargo.c${claim.id.split(".").at(-1)}`);
      const loaded = this.#inventory.beginStackUnitTransit(`freight-load:${claim.id}`, cargoInstanceId, claim.itemId, claim.sourceLocationId, elevator.transitLocationId, occurredAtUtcMs, claim.sourceReservationId);
      if (!loaded.accepted) throw new Error(`Freight stack loading failed: ${loaded.code}: ${loaded.message}`);
      return cargoInstanceId;
    }
    if (claim.inventoryInstanceId === null) throw new Error("Freight instance claim has no inventory instance.");
    const loaded = this.#inventory.transferInstance(`freight-load:${claim.id}`, claim.inventoryInstanceId, elevator.transitLocationId, occurredAtUtcMs);
    if (!loaded.accepted) throw new Error(`Freight instance loading failed: ${loaded.code}: ${loaded.message}`);
    return claim.inventoryInstanceId;
  }

  #unloadClaim(claim: LogisticsUnitClaimState, elevator: FreightElevatorInstanceState, occurredAtUtcMs: number): void {
    const unloaded = claim.inventoryMode === "stack"
      ? this.#inventory.completeStackUnitTransit(`freight-unload:${claim.id}`, elevator.cargoInstanceId!, claim.targetLocationId, occurredAtUtcMs, claim.capacityReservationId)
      : this.#inventory.transferInstance(`freight-unload:${claim.id}`, elevator.cargoInstanceId!, claim.targetLocationId, occurredAtUtcMs, claim.capacityReservationId);
    if (!unloaded.accepted) throw new Error(`Freight unloading failed: ${unloaded.code}: ${unloaded.message}`);
    const completed = this.#logistics.completeClaim(`freight-complete:${claim.id}`, claim.id, occurredAtUtcMs);
    if (!completed.accepted) throw new Error(`Freight claim completion failed: ${completed.code}: ${completed.message}`);
  }

  #startLoadedTrip(elevator: Partial<FreightElevatorInstanceState> & Pick<FreightElevatorInstanceState, "id" | "transitLocationId" | "speedUnitsPerSecond" | "maxDurability" | "durability" | "durabilityLossPerTrip">, claim: LogisticsUnitClaimState, time: number): FreightElevatorInstanceState {
    return this.#startTrip({ ...elevator, activeClaimId: claim.id } as FreightElevatorInstanceState, "moving-loaded", claim.sourceLocationId, claim.targetLocationId, time);
  }

  #startTrip(elevator: FreightElevatorInstanceState, phase: "moving-empty" | "moving-loaded", from: string, to: string, time: number): FreightElevatorInstanceState {
    const speed = elevator.speedUnitsPerSecond;
    return cloneElevator({ ...elevator, phase, dockedStationId: null, motionFromStationId: from, motionToStationId: to, motionStartedAtUtcMs: time, motionEndsAtUtcMs: time + this.#travelDuration(this.#state.routeLengthUnits, speed), motionPathLengthUnits: this.#state.routeLengthUnits, motionSpeedUnitsPerSecond: speed });
  }

  #clearTrip(elevator: FreightElevatorInstanceState): FreightElevatorInstanceState {
    return cloneElevator({ ...elevator, phase: "idle", motionFromStationId: null, motionToStationId: null, motionStartedAtUtcMs: null, motionEndsAtUtcMs: null, motionPathLengthUnits: null, motionSpeedUnitsPerSecond: null, activeClaimId: null, cargoInstanceId: null });
  }

  #deductTripDurability(elevator: FreightElevatorInstanceState, occurredAtUtcMs: number): FreightElevatorInstanceState {
    const durability = Math.max(0, elevator.durability - elevator.durabilityLossPerTrip);
    return cloneElevator({ ...elevator, durability, repairNeededAtUtcMs: durability < elevator.maxDurability ? (elevator.repairNeededAtUtcMs ?? occurredAtUtcMs) : null });
  }

  #travelDuration(length: number, speed: number): number { return Math.max(1, Math.ceil(length * 1_000 / speed)); }
  #tripPayload(elevator: FreightElevatorInstanceState): unknown { return { elevatorId: elevator.id, claimId: elevator.activeClaimId, fromStationId: elevator.motionFromStationId, toStationId: elevator.motionToStationId, pathLengthUnits: elevator.motionPathLengthUnits, speedUnitsPerSecond: elevator.motionSpeedUnitsPerSecond, endsAtUtcMs: elevator.motionEndsAtUtcMs }; }
  #operationIssue(operationId: string): FreightElevatorResult<never> | null { if (!valid(operationId)) return this.#reject("INVALID_REQUEST", "Freight elevator operation id is invalid."); if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Freight elevator operation was already processed."); return null; }
  #run<T>(operationId: string, _time: number, events: readonly DomainEvent[], work: () => T): FreightElevatorResult<T> { try { const result = this.#transaction.run([this], ({ emit }) => { this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) }); const value = work(); for (const event of events) emit(event); return value; }); return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds }); } catch (error) { return this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Freight elevator operation failed."); } }
  #replace(update: Partial<FreightElevatorState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown, discriminator = "0"): DomainEvent { return Object.freeze({ id: `${type}:${operationId}:${discriminator}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload }); }
  #reject(code: FreightElevatorRejectionCode, message: string): FreightElevatorResult<never> { return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const }); }

  #validate(): void {
    const state = this.#state;
    if (state.schemaVersion !== 1 || !integer(state.revision) || !valid(state.groupId) || state.stationIds.length !== 2 || state.stationIds[0] === state.stationIds[1] || !positive(state.routeLengthUnits) || !integer(state.nextClaimSequence, 1) || !integer(state.lastAdvancedAtUtcMs) || new Set(state.elevators.map((entry) => entry.id)).size !== state.elevators.length || new Set(state.elevators.map((entry) => entry.transitLocationId)).size !== state.elevators.length || new Set(state.processedOperationIds).size !== state.processedOperationIds.length) throw new Error("Freight elevator state metadata is invalid.");
    const claimIds = state.elevators.map((entry) => entry.activeClaimId).filter((value): value is string => value !== null);
    if (new Set(claimIds).size !== claimIds.length) throw new Error("Freight elevator claims are duplicated.");
    for (const elevator of state.elevators) {
      if (!valid(elevator.id) || !valid(elevator.transitLocationId) || !positive(elevator.speedUnitsPerSecond) || !integer(elevator.maxDurability, 1) || !integer(elevator.durability) || elevator.durability > elevator.maxDurability || !integer(elevator.durabilityLossPerTrip, 1) || elevator.durabilityLossPerTrip > elevator.maxDurability || (elevator.repairNeededAtUtcMs !== null && !integer(elevator.repairNeededAtUtcMs)) || (elevator.durability < elevator.maxDurability && elevator.repairNeededAtUtcMs === null) || (elevator.durability === elevator.maxDurability && elevator.repairNeededAtUtcMs !== null)) throw new Error(`Freight elevator values are invalid: ${elevator.id}`);
      if (elevator.phase === "idle" && (elevator.dockedStationId === null || !state.stationIds.includes(elevator.dockedStationId) || elevator.motionFromStationId !== null || elevator.motionToStationId !== null || elevator.motionStartedAtUtcMs !== null || elevator.motionEndsAtUtcMs !== null || elevator.motionPathLengthUnits !== null || elevator.motionSpeedUnitsPerSecond !== null || elevator.activeClaimId !== null || elevator.cargoInstanceId !== null)) throw new Error(`Idle freight elevator state is invalid: ${elevator.id}`);
      if (elevator.phase === "moving-empty" && (elevator.dockedStationId !== null || elevator.activeClaimId === null || elevator.cargoInstanceId !== null)) throw new Error(`Empty freight trip is invalid: ${elevator.id}`);
      if (elevator.phase === "moving-loaded" && (elevator.dockedStationId !== null || elevator.activeClaimId === null || elevator.cargoInstanceId === null)) throw new Error(`Loaded freight trip is invalid: ${elevator.id}`);
      if (elevator.phase !== "idle" && (elevator.motionFromStationId === null || elevator.motionToStationId === null || elevator.motionStartedAtUtcMs === null || elevator.motionEndsAtUtcMs === null || elevator.motionPathLengthUnits === null || elevator.motionSpeedUnitsPerSecond === null || elevator.motionEndsAtUtcMs <= elevator.motionStartedAtUtcMs)) throw new Error(`Freight elevator motion is invalid: ${elevator.id}`);
      if (elevator.repair !== null && (elevator.phase !== "idle" || elevator.durability >= elevator.maxDurability || !valid(elevator.repair.taskId) || !isInstanceId(elevator.repair.characterId) || !positive(elevator.repair.repairUnitsPerSecond) || elevator.repair.endsAtUtcMs <= elevator.repair.startedAtUtcMs)) throw new Error(`Freight elevator repair is invalid: ${elevator.id}`);
      if (elevator.activeClaimId !== null) {
        const claim = this.#logistics.getClaim(elevator.activeClaimId);
        if (claim === null || !state.stationIds.includes(claim.sourceLocationId) || !state.stationIds.includes(claim.targetLocationId)) throw new Error(`Freight elevator claim is missing on restore: ${elevator.activeClaimId}`);
        if (elevator.phase === "moving-loaded") {
          const transit = this.#inventory.getLocationSnapshot(elevator.transitLocationId)!;
          const cargoExists = claim.inventoryMode === "stack"
            ? transit.stackCargo.some((entry) => entry.id === elevator.cargoInstanceId && entry.itemId === claim.itemId)
            : transit.instances.some((entry) => entry.id === elevator.cargoInstanceId && entry.itemId === claim.itemId);
          if (!cargoExists) throw new Error(`Freight elevator cargo is missing on restore: ${elevator.cargoInstanceId}`);
        }
      }
    }
  }
}