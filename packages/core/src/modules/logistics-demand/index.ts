import type { InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { InventoryModule } from "../inventory";

export const LOGISTICS_DEMAND_MODULE_ID = "module.logistics-demand";
export const LOGISTICS_DEMAND_SCHEMA_VERSION = 1;

export type LogisticsDemandKind = "finished-meal" | "order-blocking" | "manual" | "replenishment";
export type LogisticsDemandStatus = "in-progress" | "completed" | "stopped";
export type LogisticsBlockReason = "NONE" | "WAITING_SOURCE" | "WAITING_CAPACITY";

export interface LogisticsDemandGroupState {
  readonly id: string;
  readonly kind: LogisticsDemandKind;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly itemId: string;
  readonly instanceId: InstanceId | null;
  readonly sourceReservationId: string | null;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly requestedQuantity: number;
  readonly claimedQuantity: number;
  readonly deliveredQuantity: number;
  readonly remainingQuantity: number;
  readonly replenishmentCoverageBasisPoints: number | null;
  readonly manualOrder: number;
  readonly status: LogisticsDemandStatus;
  readonly blockReason: LogisticsBlockReason;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
}

export interface LogisticsUnitClaimState {
  readonly id: string;
  readonly groupId: string;
  readonly itemId: string;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly inventoryMode: "stack" | "instance";
  readonly inventoryInstanceId: InstanceId | null;
  readonly sourceReservationId: string;
  readonly ownsSourceReservation: boolean;
  readonly capacityReservationId: string;
  readonly claimedAtUtcMs: number;
}

export interface LogisticsDemandState {
  readonly schemaVersion: typeof LOGISTICS_DEMAND_SCHEMA_VERSION;
  readonly revision: number;
  readonly groups: readonly LogisticsDemandGroupState[];
  readonly claims: readonly LogisticsUnitClaimState[];
  readonly processedOperationIds: readonly string[];
}

export interface CreateLogisticsDemandRequest {
  readonly id: string;
  readonly kind: LogisticsDemandKind;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly itemId: string;
  readonly instanceId?: InstanceId;
  readonly sourceReservationId?: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly quantity: number;
  readonly replenishmentCoverageBasisPoints?: number;
  readonly manualOrder?: number;
  readonly occurredAtUtcMs: number;
}

export interface UpdateManualLogisticsDemandRequest {
  readonly remainingQuantity?: number;
  readonly manualOrder?: number;
  readonly occurredAtUtcMs: number;
}

export interface LogisticsDemandCandidate extends LogisticsDemandGroupState {
  readonly effectivePriority: number;
}

export type LogisticsDemandResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: "INVALID_REQUEST" | "DUPLICATE" | "UNKNOWN_GROUP" | "NOT_MANUAL" | "NOT_ACTIVE" | "WAITING_SOURCE" | "WAITING_CAPACITY" | "DEPENDENCY_REJECTED"; readonly message: string; readonly committedEventIds: readonly [] };

const BASE_PRIORITY: Readonly<Record<LogisticsDemandKind, number>> = Object.freeze({
  "finished-meal": 4_000,
  "order-blocking": 3_000,
  manual: 2_000,
  replenishment: 1_000,
});
const HISTORY_LIMIT = 4_096;

function valid(value: string): boolean { return value.trim().length > 0 && value.length <= 240; }
function integer(value: number, minimum = 0): boolean { return Number.isSafeInteger(value) && value >= minimum; }
function cloneGroup(value: LogisticsDemandGroupState): LogisticsDemandGroupState { return Object.freeze({ ...value }); }
function cloneClaim(value: LogisticsUnitClaimState): LogisticsUnitClaimState { return Object.freeze({ ...value }); }
function cloneState(value: LogisticsDemandState): LogisticsDemandState {
  return Object.freeze({ ...value, groups: Object.freeze(value.groups.map(cloneGroup)), claims: Object.freeze(value.claims.map(cloneClaim)), processedOperationIds: Object.freeze([...value.processedOperationIds]) });
}

export class LogisticsDemandModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = LOGISTICS_DEMAND_MODULE_ID;
  readonly transactionParticipantId = LOGISTICS_DEMAND_MODULE_ID;
  readonly #inventory: InventoryModule;
  readonly #transaction: TransactionScope;
  readonly #agingIntervalMs: number;
  #state: LogisticsDemandState;
  #transactionActive = false;

  constructor(options: { readonly inventory: InventoryModule; readonly agingIntervalMs?: number; readonly eventBus?: DomainEventBus; readonly initialState?: LogisticsDemandState }) {
    this.#inventory = options.inventory;
    this.#agingIntervalMs = options.agingIntervalMs ?? 60_000;
    if (!integer(this.#agingIntervalMs, 1)) throw new Error("Logistics demand aging interval is invalid.");
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined ? cloneState({ schemaVersion: 1, revision: 0, groups: [], claims: [], processedOperationIds: [] }) : cloneState(options.initialState);
    this.#validate();
  }

  exportState(): LogisticsDemandState { return cloneState(this.#state); }
  getGroup(id: string): LogisticsDemandGroupState | null { const value = this.#state.groups.find((entry) => entry.id === id); return value === undefined ? null : cloneGroup(value); }
  getClaim(id: string): LogisticsUnitClaimState | null { const value = this.#state.claims.find((entry) => entry.id === id); return value === undefined ? null : cloneClaim(value); }

  createDemand(operationId: string, request: CreateLogisticsDemandRequest): LogisticsDemandResult<LogisticsDemandGroupState> {
    if (this.#duplicate(operationId)) return this.#reject("DUPLICATE", "Duplicate logistics operation or group.");
    if (!valid(request.id) || !valid(request.sourceLocationId) || !valid(request.targetLocationId) || request.sourceLocationId === request.targetLocationId || !valid(request.itemId) || !valid(request.ownerType) || !valid(request.ownerId) || !integer(request.quantity, 1) || !integer(request.occurredAtUtcMs) || (request.kind === "finished-meal" && (request.instanceId === undefined || request.quantity !== 1)) || (request.replenishmentCoverageBasisPoints !== undefined && !integer(request.replenishmentCoverageBasisPoints)) || (request.manualOrder !== undefined && !integer(request.manualOrder))) return this.#reject("INVALID_REQUEST", "Logistics demand request is invalid.");
    if (this.#state.groups.some((entry) => entry.id === request.id)) return this.#reject("DUPLICATE", "Duplicate logistics demand group.");
    return this.#run(operationId, request.occurredAtUtcMs, "logistics.demand-created", request.id, () => {
      const value = cloneGroup({ id: request.id, kind: request.kind, sourceLocationId: request.sourceLocationId, targetLocationId: request.targetLocationId, itemId: request.itemId, instanceId: request.instanceId ?? null, sourceReservationId: request.sourceReservationId ?? null, ownerType: request.ownerType, ownerId: request.ownerId, requestedQuantity: request.quantity, claimedQuantity: 0, deliveredQuantity: 0, remainingQuantity: request.quantity, replenishmentCoverageBasisPoints: request.replenishmentCoverageBasisPoints ?? null, manualOrder: request.manualOrder ?? this.#state.groups.filter((entry) => entry.kind === "manual").length, status: "in-progress", blockReason: "NONE", createdAtUtcMs: request.occurredAtUtcMs, updatedAtUtcMs: request.occurredAtUtcMs });
      this.#replace({ groups: [...this.#state.groups, value] }); return value;
    });
  }

  listCandidates(nowUtcMs: number): readonly LogisticsDemandCandidate[] {
    if (!integer(nowUtcMs)) throw new RangeError("Logistics candidate time is invalid.");
    return Object.freeze(this.#state.groups.filter((entry) => entry.status === "in-progress" && entry.remainingQuantity > 0 && entry.createdAtUtcMs <= nowUtcMs).map((entry) => {
      const aging = Math.floor(Math.max(0, nowUtcMs - entry.createdAtUtcMs) / this.#agingIntervalMs);
      const effectivePriority = entry.kind === "finished-meal" ? BASE_PRIORITY[entry.kind] : Math.min(3_999, BASE_PRIORITY[entry.kind] + aging);
      return Object.freeze({ ...entry, effectivePriority });
    }).sort((left, right) => right.effectivePriority - left.effectivePriority || (left.kind === "replenishment" && right.kind === "replenishment" ? (left.replenishmentCoverageBasisPoints ?? 10_000) - (right.replenishmentCoverageBasisPoints ?? 10_000) : 0) || (left.kind === "manual" && right.kind === "manual" ? left.manualOrder - right.manualOrder : 0) || left.createdAtUtcMs - right.createdAtUtcMs || left.id.localeCompare(right.id)));
  }

  claimNextUnit(operationId: string, claimId: string, nowUtcMs: number, eligibleGroupIds?: readonly string[]): LogisticsDemandResult<LogisticsUnitClaimState> {
    if (this.#duplicate(operationId) || this.#state.claims.some((entry) => entry.id === claimId)) return this.#reject("DUPLICATE", "Duplicate logistics claim.");
    if (!valid(claimId) || !integer(nowUtcMs) || (eligibleGroupIds !== undefined && (eligibleGroupIds.length === 0 || eligibleGroupIds.some((id) => !valid(id))))) return this.#reject("INVALID_REQUEST", "Logistics claim request is invalid.");
    const eligible = eligibleGroupIds === undefined ? null : new Set(eligibleGroupIds);
    for (const group of this.listCandidates(nowUtcMs).filter((entry) => eligible === null || eligible.has(entry.id))) {
      const source = this.#selectSource(group);
      if (source === null) { this.#setBlock(group.id, "WAITING_SOURCE", nowUtcMs); continue; }
      const sourceReservationId = group.sourceReservationId ?? `reservation.logistics-source.${claimId}`;
      let ownsSourceReservation = false;
      if (group.sourceReservationId === null) {
        const reserved = this.#inventory.createReservation(`${operationId}:source:${group.id}`, { reservationId: sourceReservationId, ownerType: "logistics-demand", ownerId: group.id, ...(source.mode === "stack" ? { stacks: [{ locationId: group.sourceLocationId, itemId: group.itemId, quantity: 1 }] } : { instanceIds: [source.instanceId!] }), createdAtUtcMs: nowUtcMs });
        if (!reserved.accepted) { this.#setBlock(group.id, "WAITING_SOURCE", nowUtcMs); continue; }
        ownsSourceReservation = true;
      }
      const capacityReservationId = `reservation.logistics-capacity.${claimId}`;
      const capacity = this.#inventory.reserveCapacity(`${operationId}:capacity:${group.id}`, capacityReservationId, "logistics-demand", group.id, group.targetLocationId, group.itemId, 1, nowUtcMs);
      if (!capacity.accepted) {
        if (ownsSourceReservation) this.#inventory.releaseReservation(`${operationId}:source-rollback:${group.id}`, sourceReservationId, nowUtcMs);
        this.#setBlock(group.id, "WAITING_CAPACITY", nowUtcMs); continue;
      }
      this.#setBlock(group.id, "NONE", nowUtcMs);
      return this.#run(operationId, nowUtcMs, "logistics.unit-claimed", claimId, () => {
        const claim = cloneClaim({ id: claimId, groupId: group.id, itemId: group.itemId, sourceLocationId: group.sourceLocationId, targetLocationId: group.targetLocationId, inventoryMode: source.mode, inventoryInstanceId: source.instanceId, sourceReservationId, ownsSourceReservation, capacityReservationId, claimedAtUtcMs: nowUtcMs });
        this.#replace({ claims: [...this.#state.claims, claim], groups: this.#state.groups.map((entry) => entry.id === group.id ? cloneGroup({ ...entry, claimedQuantity: entry.claimedQuantity + 1, remainingQuantity: entry.remainingQuantity - 1, blockReason: "NONE", updatedAtUtcMs: nowUtcMs }) : entry) }); return claim;
      });
    }
    return this.#reject(this.#state.groups.some((entry) => entry.blockReason === "WAITING_CAPACITY") ? "WAITING_CAPACITY" : "WAITING_SOURCE", "No logistics unit can currently be claimed.");
  }

  completeClaim(operationId: string, claimId: string, occurredAtUtcMs: number): LogisticsDemandResult<LogisticsDemandGroupState> {
    const claim = this.#state.claims.find((entry) => entry.id === claimId); if (claim === undefined) return this.#reject("INVALID_REQUEST", "Unknown logistics claim.");
    if (claim.ownsSourceReservation && this.#inventory.getReservation(claim.sourceReservationId) !== null) this.#inventory.releaseReservation(`${operationId}:source`, claim.sourceReservationId, occurredAtUtcMs);
    return this.#run(operationId, occurredAtUtcMs, "logistics.unit-delivered", claimId, () => {
      const current = this.#state.groups.find((entry) => entry.id === claim.groupId)!; const delivered = current.deliveredQuantity + 1;
      const next = cloneGroup({ ...current, claimedQuantity: current.claimedQuantity - 1, deliveredQuantity: delivered, status: current.status === "stopped" ? "stopped" : delivered === current.requestedQuantity ? "completed" : "in-progress", updatedAtUtcMs: occurredAtUtcMs });
      this.#replace({ claims: this.#state.claims.filter((entry) => entry.id !== claimId), groups: this.#state.groups.map((entry) => entry.id === next.id ? next : entry) }); return next;
    });
  }

  stopDemand(operationId: string, groupId: string, occurredAtUtcMs: number): LogisticsDemandResult<LogisticsDemandGroupState> {
    const group = this.#state.groups.find((entry) => entry.id === groupId); if (group === undefined) return this.#reject("UNKNOWN_GROUP", "Unknown logistics demand.");
    if (group.kind !== "manual" && group.kind !== "replenishment") return this.#reject("NOT_MANUAL", "This demand cannot be stopped by the player.");
    return this.#run(operationId, occurredAtUtcMs, "logistics.demand-stopped", groupId, () => { const next = cloneGroup({ ...group, remainingQuantity: 0, status: "stopped", updatedAtUtcMs: occurredAtUtcMs }); this.#replace({ groups: this.#state.groups.map((entry) => entry.id === groupId ? next : entry) }); return next; });
  }

  updateManualDemand(operationId: string, groupId: string, request: UpdateManualLogisticsDemandRequest): LogisticsDemandResult<LogisticsDemandGroupState> {
    const group = this.#state.groups.find((entry) => entry.id === groupId);
    if (group === undefined) return this.#reject("UNKNOWN_GROUP", "Unknown logistics demand.");
    if (group.kind !== "manual") return this.#reject("NOT_MANUAL", "Only manual logistics demands can be adjusted by the player.");
    if (group.status !== "in-progress") return this.#reject("NOT_ACTIVE", "Only active manual logistics demands can be adjusted.");
    if ((request.remainingQuantity === undefined && request.manualOrder === undefined) || (request.remainingQuantity !== undefined && !integer(request.remainingQuantity)) || (request.manualOrder !== undefined && !integer(request.manualOrder)) || !integer(request.occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Manual logistics demand update is invalid.");
    return this.#run(operationId, request.occurredAtUtcMs, "logistics.manual-demand-updated", groupId, () => {
      const remainingQuantity = request.remainingQuantity ?? group.remainingQuantity;
      const next = cloneGroup({
        ...group,
        requestedQuantity: group.deliveredQuantity + group.claimedQuantity + remainingQuantity,
        remainingQuantity,
        manualOrder: request.manualOrder ?? group.manualOrder,
        status: remainingQuantity === 0 ? "stopped" : "in-progress",
        updatedAtUtcMs: request.occurredAtUtcMs,
      });
      this.#replace({ groups: this.#state.groups.map((entry) => entry.id === groupId ? next : entry) });
      return next;
    });
  }

  beginTransaction(): TransactionParticipantSession { if (this.#transactionActive) throw new Error("Logistics transaction active."); this.#transactionActive = true; const saved = this.exportState(); return { validateTransaction: () => this.#validate(), commitTransaction: () => { this.#transactionActive = false; }, rollbackTransaction: () => { this.#state = saved; this.#transactionActive = false; } }; }
  #selectSource(group: LogisticsDemandGroupState): { mode: "stack" | "instance"; instanceId: InstanceId | null } | null {
    const snapshot = this.#inventory.getLocationSnapshot(group.sourceLocationId); if (snapshot === null) return null;
    if (group.sourceReservationId !== null) { const reservation = this.#inventory.getReservation(group.sourceReservationId); const active = this.#state.claims.filter((entry) => entry.sourceReservationId === group.sourceReservationId).length; const stack = reservation?.stackAllocations.find((entry) => entry.locationId === group.sourceLocationId && entry.itemId === group.itemId); if ((stack?.quantity ?? 0) > active) return { mode: "stack", instanceId: null }; const id = group.instanceId ?? reservation?.instanceIds.find((value) => snapshot.instances.some((entry) => entry.id === value && entry.itemId === group.itemId)); return id === undefined ? null : { mode: "instance", instanceId: id }; }
    const instance = group.instanceId === null ? snapshot.instances.find((entry) => entry.itemId === group.itemId && entry.reservationId === null)?.id : snapshot.instances.find((entry) => entry.id === group.instanceId && entry.reservationId === null)?.id;
    if (instance !== undefined) return { mode: "instance", instanceId: instance }; const stack = snapshot.stacks.find((entry) => entry.itemId === group.itemId); return (stack?.availableQuantity ?? 0) > 0 ? { mode: "stack", instanceId: null } : null;
  }
  #setBlock(id: string, reason: LogisticsBlockReason, time: number): void { const current = this.#state.groups.find((entry) => entry.id === id); if (current === undefined || current.blockReason === reason) return; const transitionRevision = this.#state.revision + 1; this.#transaction.run([this], ({ emit }) => { const next = cloneGroup({ ...current, blockReason: reason, updatedAtUtcMs: time }); this.#replace({ groups: this.#state.groups.map((entry) => entry.id === id ? next : entry) }); emit(Object.freeze({ id: `logistics.demand-block-reason-changed:${id}:${reason}:${time}:${transitionRevision}`, type: "logistics.demand-block-reason-changed", occurredAtUtcMs: time, causationId: id, correlationId: id, payload: { groupId: id, previousReason: current.blockReason, reason } })); }); }
  #duplicate(operationId: string): boolean { return !valid(operationId) || this.#state.processedOperationIds.includes(operationId); }
  #run<T>(operationId: string, time: number, type: string, discriminator: string, work: () => T): LogisticsDemandResult<T> { try { const result = this.#transaction.run([this], ({ emit }) => { this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) }); const value = work(); emit(Object.freeze({ id: `${type}:${discriminator}:${operationId}`, type, occurredAtUtcMs: time, causationId: operationId, correlationId: operationId, payload: value })); return value; }); return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds }); } catch (error) { return this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Logistics operation failed."); } }
  #replace(update: Partial<LogisticsDemandState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #reject(code: "INVALID_REQUEST" | "DUPLICATE" | "UNKNOWN_GROUP" | "NOT_MANUAL" | "NOT_ACTIVE" | "WAITING_SOURCE" | "WAITING_CAPACITY" | "DEPENDENCY_REJECTED", message: string): LogisticsDemandResult<never> { return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const }); }
  #validate(): void { if (this.#state.schemaVersion !== 1 || !integer(this.#state.revision) || new Set(this.#state.groups.map((entry) => entry.id)).size !== this.#state.groups.length || new Set(this.#state.claims.map((entry) => entry.id)).size !== this.#state.claims.length) throw new Error("Logistics demand state invariant failed."); for (const group of this.#state.groups) if (group.claimedQuantity < 0 || group.deliveredQuantity < 0 || group.remainingQuantity < 0 || group.claimedQuantity + group.deliveredQuantity + group.remainingQuantity > group.requestedQuantity) throw new Error(`Logistics demand quantity invariant failed: ${group.id}`); }
}
