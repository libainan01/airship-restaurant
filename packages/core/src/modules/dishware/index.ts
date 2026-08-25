import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus, TransactionScope, instanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { InventoryModule, InventoryReservationState } from "../inventory";

export const DISHWARE_MODULE_ID = "module.dishware";
export const DISHWARE_SCHEMA_VERSION = 1;

export type DishwareStatus = "clean" | "in_use" | "dirty" | "washing";

export interface DishwareCabinetDefinition {
  readonly id: string;
  readonly supplyComponentId: string;
  readonly cleanStorageLocationId: string;
  readonly dirtyStorageLocationId: string;
  readonly washingLocationId: string;
  readonly suppliedPlateCount: number;
  readonly washDurationMs: number;
  readonly parallelWashCount: number;
}

export interface DishwareCabinetDefinitionPort {
  listCabinets(): readonly DishwareCabinetDefinition[];
}

export class StaticDishwareCabinetCatalog implements DishwareCabinetDefinitionPort {
  readonly #cabinets: readonly DishwareCabinetDefinition[];
  constructor(cabinets: readonly DishwareCabinetDefinition[]) {
    this.#cabinets = Object.freeze(cabinets.map((cabinet) => Object.freeze({ ...cabinet })));
  }
  listCabinets(): readonly DishwareCabinetDefinition[] {
    return Object.freeze(this.#cabinets.map((cabinet) => Object.freeze({ ...cabinet })));
  }
}

export interface DishwarePlateState {
  readonly id: InstanceId;
  readonly supplyComponentId: string;
  readonly status: DishwareStatus;
}

export interface DishwareWashJobState {
  readonly id: string;
  readonly cabinetId: string;
  readonly plateId: InstanceId;
  readonly startedAtUtcMs: number;
  readonly completesAtUtcMs: number;
}

export interface DishwareState {
  readonly schemaVersion: typeof DISHWARE_SCHEMA_VERSION;
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly plates: readonly DishwarePlateState[];
  readonly washJobs: readonly DishwareWashJobState[];
  readonly initializedSupplyComponentIds: readonly string[];
  readonly processedOperationIds: readonly string[];
}

export interface DishwareSnapshot extends DishwareState {
  readonly counts: Readonly<Record<DishwareStatus, number>>;
  readonly totalPlateCount: number;
}

export type DishwareRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_CABINET"
  | "SUPPLY_ALREADY_INITIALIZED"
  | "SUPPLY_NOT_INITIALIZED"
  | "SUPPLY_COUNT_MISMATCH"
  | "UNKNOWN_PLATE"
  | "NO_CLEAN_PLATE"
  | "UNKNOWN_RESERVATION"
  | "RESERVATION_MISMATCH"
  | "INVALID_PLATE_STATE"
  | "INVENTORY_REJECTED"
  | "TIME_REVERSED";

export type DishwareOperationResult<TValue = undefined> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly committedEventIds: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: DishwareRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;

class DishwareRejected extends Error {
  constructor(readonly code: DishwareRejectionCode, message: string) {
    super(message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function cloneState(state: DishwareState): DishwareState {
  return Object.freeze({
    ...state,
    plates: Object.freeze(state.plates.map((entry) => Object.freeze({ ...entry }))),
    washJobs: Object.freeze(state.washJobs.map((entry) => Object.freeze({ ...entry }))),
    initializedSupplyComponentIds: Object.freeze([...state.initializedSupplyComponentIds]),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export class DishwareModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = DISHWARE_MODULE_ID;
  readonly transactionParticipantId = DISHWARE_MODULE_ID;
  readonly #inventory: InventoryModule;
  readonly #transaction: TransactionScope;
  readonly #cabinetDefinitions: DishwareCabinetDefinitionPort;
  readonly #plateItemId: string;
  #state: DishwareState;
  #transactionActive = false;

  constructor(options: {
    readonly inventory: InventoryModule;
    readonly eventBus?: DomainEventBus;
    readonly plateItemId: string;
    readonly cabinets?: readonly DishwareCabinetDefinition[];
    readonly cabinetDefinitions?: DishwareCabinetDefinitionPort;
    readonly initialState?: DishwareState;
  }) {
    if (!validId(options.plateItemId) || (options.cabinets === undefined) === (options.cabinetDefinitions === undefined)) {
      throw new Error("Dishware requires a plate item and cabinet definitions.");
    }
    this.#inventory = options.inventory;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#plateItemId = options.plateItemId;
    this.#cabinetDefinitions = options.cabinetDefinitions ?? new StaticDishwareCabinetCatalog(options.cabinets!);
    this.#cabinetMaps();
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: DISHWARE_SCHEMA_VERSION,
          revision: 0,
          currentUtcMs: 0,
          plates: [],
          washJobs: [],
          initializedSupplyComponentIds: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): DishwareState {
    return cloneState(this.#state);
  }

  getSnapshot(): DishwareSnapshot {
    const counts: Record<DishwareStatus, number> = { clean: 0, in_use: 0, dirty: 0, washing: 0 };
    for (const plate of this.#state.plates) counts[plate.status] += 1;
    return Object.freeze({
      ...cloneState(this.#state),
      counts: Object.freeze(counts),
      totalPlateCount: this.#state.plates.length,
    });
  }

  initializeSupply(
    operationId: string,
    supplyComponentId: string,
    plateIds: readonly InstanceId[],
    occurredAtUtcMs: number,
  ): DishwareOperationResult<readonly DishwarePlateState[]> {
    return this.#run(operationId, (emit) => {
      const cabinet = this.#cabinetMaps().bySupply.get(supplyComponentId);
      if (cabinet === undefined) throw new DishwareRejected("UNKNOWN_CABINET", `Unknown dishware supply: ${supplyComponentId}`);
      if (this.#state.initializedSupplyComponentIds.includes(supplyComponentId)) {
        throw new DishwareRejected("SUPPLY_ALREADY_INITIALIZED", `Dishware supply is already initialized: ${supplyComponentId}`);
      }
      if (plateIds.length !== cabinet.suppliedPlateCount || new Set(plateIds).size !== plateIds.length) {
        throw new DishwareRejected("SUPPLY_COUNT_MISMATCH", "Plate ids must exactly match the cabinet supply count.");
      }
      const plates: DishwarePlateState[] = [];
      for (const id of plateIds) {
        try { instanceId(id); } catch { throw new DishwareRejected("INVALID_REQUEST", `Invalid plate id: ${id}`); }
        const created = this.#inventory.createInstance(`${operationId}:inventory:${id}`, {
          instanceId: id,
          itemId: this.#plateItemId,
          locationId: cabinet.cleanStorageLocationId,
          occurredAtUtcMs,
        });
        if (!created.accepted) throw new DishwareRejected("INVENTORY_REJECTED", created.message);
        for (const event of created.events) emit(event);
        const plate = Object.freeze({ id, supplyComponentId, status: "clean" as const });
        plates.push(plate);
        emit(this.#event(operationId, "dishware.plate-created", occurredAtUtcMs, plate, id));
      }
      this.#replace({
        currentUtcMs: Math.max(this.#state.currentUtcMs, occurredAtUtcMs),
        plates: [...this.#state.plates, ...plates],
        initializedSupplyComponentIds: [...this.#state.initializedSupplyComponentIds, supplyComponentId],
      });
      emit(this.#event(operationId, "dishware.supply-initialized", occurredAtUtcMs, {
        supplyComponentId,
        plateIds,
      }));
      return Object.freeze(plates);
    });
  }

  expandSupply(
    operationId: string,
    supplyComponentId: string,
    plateIds: readonly InstanceId[],
    occurredAtUtcMs: number,
  ): DishwareOperationResult<readonly DishwarePlateState[]> {
    return this.#run(operationId, (emit) => {
      const cabinet = this.#cabinetMaps().bySupply.get(supplyComponentId);
      if (cabinet === undefined) throw new DishwareRejected("UNKNOWN_CABINET", `Unknown dishware supply: ${supplyComponentId}`);
      if (!this.#state.initializedSupplyComponentIds.includes(supplyComponentId)) throw new DishwareRejected("SUPPLY_NOT_INITIALIZED", `Dishware supply is not initialized: ${supplyComponentId}`);
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < this.#state.currentUtcMs) throw new DishwareRejected("TIME_REVERSED", "Dishware supply expansion time cannot move backwards.");
      const currentCount = this.#state.plates.filter((plate) => plate.supplyComponentId === supplyComponentId).length;
      const requiredCount = cabinet.suppliedPlateCount - currentCount;
      if (requiredCount <= 0 || plateIds.length !== requiredCount || new Set(plateIds).size !== plateIds.length || plateIds.some((id) => this.#plate(id) !== null)) throw new DishwareRejected("SUPPLY_COUNT_MISMATCH", "New plate ids must exactly match the expanded cabinet supply count.");
      const plates: DishwarePlateState[] = [];
      for (const id of plateIds) {
        try { instanceId(id); } catch { throw new DishwareRejected("INVALID_REQUEST", `Invalid plate id: ${id}`); }
        const created = this.#inventory.createInstance(`${operationId}:inventory:${id}`, { instanceId: id, itemId: this.#plateItemId, locationId: cabinet.cleanStorageLocationId, occurredAtUtcMs });
        if (!created.accepted) throw new DishwareRejected("INVENTORY_REJECTED", created.message);
        for (const event of created.events) emit(event);
        const plate = Object.freeze({ id, supplyComponentId, status: "clean" as const });
        plates.push(plate);
        emit(this.#event(operationId, "dishware.plate-created", occurredAtUtcMs, plate, id));
      }
      this.#replace({ currentUtcMs: occurredAtUtcMs, plates: [...this.#state.plates, ...plates] });
      emit(this.#event(operationId, "dishware.supply-expanded", occurredAtUtcMs, { supplyComponentId, previousPlateCount: currentCount, suppliedPlateCount: cabinet.suppliedPlateCount, plateIds }));
      return Object.freeze(plates);
    });
  }
  reserveCleanPlate(
    operationId: string,
    reservationId: string,
    ownerType: string,
    ownerId: string,
    preferredLocationIds: readonly string[],
    occurredAtUtcMs: number,
  ): DishwareOperationResult<InstanceId> {
    return this.#run(operationId, (emit) => {
      const inventory = this.#inventory.getSnapshot();
      const reservedIds = new Set(inventory.reservations.flatMap((entry) => entry.instanceIds));
      const locations = preferredLocationIds.length === 0
        ? inventory.locations.map((location) => location.id)
        : preferredLocationIds;
      let selected: InstanceId | null = null;
      for (const locationId of locations) {
        const ids = inventory.locations.find((location) => location.id === locationId)?.instances
          .filter((entry) => entry.itemId === this.#plateItemId)
          .map((entry) => entry.id) ?? [];
        selected = ids.find((id) =>
          this.#plate(id)?.status === "clean" && !reservedIds.has(id),
        ) ?? null;
        if (selected !== null) break;
      }
      if (selected === null) throw new DishwareRejected("NO_CLEAN_PLATE", "No clean plate is available at the requested locations.");
      const reservation = this.#inventory.createReservation(`${operationId}:inventory`, {
        reservationId,
        ownerType,
        ownerId,
        instanceIds: [selected],
        createdAtUtcMs: occurredAtUtcMs,
      });
      if (!reservation.accepted) throw new DishwareRejected("INVENTORY_REJECTED", reservation.message);
      for (const event of reservation.events) emit(event);
      this.#replace({ currentUtcMs: Math.max(this.#state.currentUtcMs, occurredAtUtcMs) });
      emit(this.#event(operationId, "dishware.clean-plate-reserved", occurredAtUtcMs, {
        plateId: selected,
        reservationId,
        ownerType,
        ownerId,
      }));
      return selected;
    });
  }

  beginUse(
    operationId: string,
    reservationId: string,
    useLocationId: string,
    occurredAtUtcMs: number,
  ): DishwareOperationResult<DishwarePlateState> {
    return this.#run(operationId, (emit) => {
      const reservation = this.#inventory.getSnapshot().reservations.find((entry) => entry.id === reservationId);
      const plateId = this.#singleReservedPlate(reservation);
      const plate = this.#plate(plateId);
      if (plate?.status !== "clean") throw new DishwareRejected("INVALID_PLATE_STATE", "Only a clean plate can enter use.");
      const released = this.#inventory.releaseReservation(`${operationId}:release`, reservationId, occurredAtUtcMs);
      if (!released.accepted) throw new DishwareRejected("INVENTORY_REJECTED", released.message);
      const moved = this.#inventory.transferInstance(`${operationId}:move`, plateId, useLocationId, occurredAtUtcMs);
      if (!moved.accepted) throw new DishwareRejected("INVENTORY_REJECTED", moved.message);
      for (const event of [...released.events, ...moved.events]) emit(event);
      const next = this.#setStatus(plateId, "in_use", occurredAtUtcMs);
      emit(this.#event(operationId, "dishware.status-changed", occurredAtUtcMs, {
        plateId,
        previousStatus: "clean",
        status: "in_use",
        locationId: useLocationId,
      }));
      return next;
    });
  }

  markDirty(
    operationId: string,
    plateId: InstanceId,
    dirtyLocationId: string,
    occurredAtUtcMs: number,
  ): DishwareOperationResult<DishwarePlateState> {
    return this.#moveAndChangeStatus(operationId, plateId, "in_use", "dirty", dirtyLocationId, occurredAtUtcMs);
  }

  returnDirtyToCabinet(
    operationId: string,
    plateId: InstanceId,
    cabinetId: string,
    occurredAtUtcMs: number,
  ): DishwareOperationResult<DishwarePlateState> {
    const cabinet = this.#cabinetMaps().byId.get(cabinetId);
    if (cabinet === undefined) return this.#reject(operationId, "UNKNOWN_CABINET", `Unknown dishware cabinet: ${cabinetId}`);
    return this.#moveAndChangeStatus(
      operationId,
      plateId,
      "dirty",
      "dirty",
      cabinet.dirtyStorageLocationId,
      occurredAtUtcMs,
    );
  }

  advanceTo(
    operationId: string,
    observedUtcMs: number,
  ): DishwareOperationResult<DishwareSnapshot> {
    return this.#run(operationId, (emit) => {
      if (!nonNegativeInteger(observedUtcMs)) throw new DishwareRejected("INVALID_REQUEST", "Dishware time is invalid.");
      if (observedUtcMs < this.#state.currentUtcMs) throw new DishwareRejected("TIME_REVERSED", "Dishware time cannot move backwards.");
      let cursor = this.#state.currentUtcMs;
      while (true) {
        this.#startAvailableWashJobs(operationId, cursor, emit);
        const nextCompletion = this.#state.washJobs
          .filter((job) => job.completesAtUtcMs <= observedUtcMs)
          .sort((left, right) => left.completesAtUtcMs - right.completesAtUtcMs || left.id.localeCompare(right.id))[0];
        if (nextCompletion === undefined) break;
        cursor = nextCompletion.completesAtUtcMs;
        this.#completeWashJob(operationId, nextCompletion, emit);
      }
      this.#replace({ currentUtcMs: observedUtcMs });
      return this.getSnapshot();
    });
  }

  getSupplyTransitionIssues(supplyComponentId: string): readonly string[] {
    const plates = this.#state.plates.filter((plate) => plate.supplyComponentId === supplyComponentId);
    if (plates.length === 0) return Object.freeze([]);
    const inventory = this.#inventory.getSnapshot();
    const issues: string[] = [];
    for (const plate of plates) {
      const location = inventory.locations.find((entry) => entry.instances.some((value) => value.id === plate.id))?.id;
      if (plate.status !== "clean") issues.push(`${plate.id} is ${plate.status}.`);
      const cabinet = this.#cabinetMaps().bySupply.get(supplyComponentId)!;
      if (location !== undefined && location !== cabinet.cleanStorageLocationId) {
        issues.push(`${plate.id} is outside its source cabinet.`);
      }
      if (inventory.reservations.some((entry) => entry.instanceIds.includes(plate.id))) {
        issues.push(`${plate.id} is reserved.`);
      }
      if (location === undefined) issues.push(`${plate.id} has no inventory location.`);
    }
    return Object.freeze(issues);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Dishware transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = cloneState(checkpoint);
        this.#transactionActive = false;
      },
    };
  }

  #moveAndChangeStatus(
    operationId: string,
    plateId: InstanceId,
    expectedStatus: DishwareStatus,
    status: DishwareStatus,
    targetLocationId: string,
    occurredAtUtcMs: number,
  ): DishwareOperationResult<DishwarePlateState> {
    return this.#run(operationId, (emit) => {
      const plate = this.#plate(plateId);
      if (plate === null) throw new DishwareRejected("UNKNOWN_PLATE", `Unknown plate: ${plateId}`);
      if (plate.status !== expectedStatus) {
        throw new DishwareRejected("INVALID_PLATE_STATE", `Plate ${plateId} must be ${expectedStatus}.`);
      }
      const moved = this.#inventory.transferInstance(`${operationId}:inventory`, plateId, targetLocationId, occurredAtUtcMs);
      if (!moved.accepted) throw new DishwareRejected("INVENTORY_REJECTED", moved.message);
      for (const event of moved.events) emit(event);
      const next = this.#setStatus(plateId, status, occurredAtUtcMs);
      emit(this.#event(operationId, "dishware.status-changed", occurredAtUtcMs, {
        plateId,
        previousStatus: plate.status,
        status,
        locationId: targetLocationId,
      }));
      return next;
    });
  }

  #startAvailableWashJobs(
    operationId: string,
    atUtcMs: number,
    emit: (event: DomainEvent) => void,
  ): void {
    const inventory = this.#inventory.getSnapshot();
    for (const cabinet of [...this.#cabinetMaps().byId.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      let available = cabinet.parallelWashCount - this.#state.washJobs.filter((job) => job.cabinetId === cabinet.id).length;
      if (available <= 0) continue;
      const candidates = this.#state.plates
        .filter((plate) => plate.status === "dirty")
        .filter((plate) => inventory.locations.find((location) => location.id === cabinet.dirtyStorageLocationId)
          ?.instances.some((entry) => entry.id === plate.id) === true)
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const plate of candidates) {
        if (available <= 0) break;
        const moved = this.#inventory.transferInstance(
          `${operationId}:wash-start:${plate.id}:${atUtcMs}`,
          plate.id,
          cabinet.washingLocationId,
          atUtcMs,
        );
        if (!moved.accepted) continue;
        for (const event of moved.events) emit(event);
        this.#setStatus(plate.id, "washing", atUtcMs);
        const job = Object.freeze({
          id: `wash:${cabinet.id}:${plate.id}:${atUtcMs}`,
          cabinetId: cabinet.id,
          plateId: plate.id,
          startedAtUtcMs: atUtcMs,
          completesAtUtcMs: atUtcMs + cabinet.washDurationMs,
        });
        this.#replace({ washJobs: [...this.#state.washJobs, job] });
        emit(this.#event(operationId, "dishware.washing-started", atUtcMs, job, job.id));
        available -= 1;
      }
    }
  }

  #completeWashJob(
    operationId: string,
    job: DishwareWashJobState,
    emit: (event: DomainEvent) => void,
  ): void {
    const cabinet = this.#cabinetMaps().byId.get(job.cabinetId)!;
    const moved = this.#inventory.transferInstance(
      `${operationId}:wash-complete:${job.id}`,
      job.plateId,
      cabinet.cleanStorageLocationId,
      job.completesAtUtcMs,
    );
    if (!moved.accepted) throw new DishwareRejected("INVENTORY_REJECTED", moved.message);
    for (const event of moved.events) emit(event);
    this.#setStatus(job.plateId, "clean", job.completesAtUtcMs);
    this.#replace({ washJobs: this.#state.washJobs.filter((entry) => entry.id !== job.id) });
    emit(this.#event(operationId, "dishware.washing-completed", job.completesAtUtcMs, {
      jobId: job.id,
      cabinetId: job.cabinetId,
      plateId: job.plateId,
      cleanStorageLocationId: cabinet.cleanStorageLocationId,
    }, job.id));
  }

  #singleReservedPlate(reservation: InventoryReservationState | undefined): InstanceId {
    if (reservation === undefined) throw new DishwareRejected("UNKNOWN_RESERVATION", "Unknown clean-plate reservation.");
    if (reservation.instanceIds.length !== 1 || reservation.stackAllocations.length > 0 ||
      reservation.stackCargoIds.length > 0) {
      throw new DishwareRejected("RESERVATION_MISMATCH", "Reservation does not contain exactly one plate.");
    }
    const plateId = reservation.instanceIds[0]!;
    if (this.#plate(plateId) === null) throw new DishwareRejected("RESERVATION_MISMATCH", "Reserved instance is not a plate.");
    return plateId;
  }

  #setStatus(plateId: InstanceId, status: DishwareStatus, occurredAtUtcMs: number): DishwarePlateState {
    const plate = this.#plate(plateId);
    if (plate === null) throw new DishwareRejected("UNKNOWN_PLATE", `Unknown plate: ${plateId}`);
    const next = Object.freeze({ ...plate, status });
    this.#replace({
      currentUtcMs: Math.max(this.#state.currentUtcMs, occurredAtUtcMs),
      plates: this.#state.plates.map((entry) => entry.id === plateId ? next : entry),
    });
    return next;
  }

  #plate(plateId: InstanceId): DishwarePlateState | null {
    return this.#state.plates.find((entry) => entry.id === plateId) ?? null;
  }

  #run<TValue>(
    operationId: string,
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): DishwareOperationResult<TValue> {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Dishware operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Dishware operation was already processed.");
    }
    try {
      const result = this.#transaction.run([this, this.#inventory], ({ emit }) => {
        this.#replace({
          processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
        });
        return work(emit);
      });
      return Object.freeze({
        accepted: true,
        changed: true,
        operationId,
        value: result.value,
        committedEventIds: result.committedEventIds,
      });
    } catch (error: unknown) {
      return error instanceof DishwareRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(operationId, "INVALID_REQUEST", error instanceof Error ? error.message : "Dishware operation failed.");
    }
  }

  #replace(update: Partial<DishwareState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(
    operationId: string,
    code: DishwareRejectionCode,
    message: string,
  ): DishwareOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, committedEventIds: [] as const });
  }

  #event(
    operationId: string,
    type: string,
    occurredAtUtcMs: number,
    payload: unknown,
    discriminator = operationId,
  ): DomainEvent {
    return Object.freeze({
      id: `${type}:${discriminator}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #cabinetMaps(): { readonly byId: ReadonlyMap<string, DishwareCabinetDefinition>; readonly bySupply: ReadonlyMap<string, DishwareCabinetDefinition> } {
    const byId = new Map<string, DishwareCabinetDefinition>();
    const bySupply = new Map<string, DishwareCabinetDefinition>();
    for (const cabinet of this.#cabinetDefinitions.listCabinets()) {
      if (!validId(cabinet.id) || !validId(cabinet.supplyComponentId) ||
        !validId(cabinet.cleanStorageLocationId) || !validId(cabinet.dirtyStorageLocationId) ||
        !validId(cabinet.washingLocationId) || !positiveInteger(cabinet.suppliedPlateCount) ||
        !positiveInteger(cabinet.washDurationMs) || !positiveInteger(cabinet.parallelWashCount) ||
        byId.has(cabinet.id) || bySupply.has(cabinet.supplyComponentId)) {
        throw new Error(`Invalid or duplicate dishware cabinet: ${cabinet.id}`);
      }
      const frozen = Object.freeze({ ...cabinet });
      byId.set(cabinet.id, frozen);
      bySupply.set(cabinet.supplyComponentId, frozen);
    }
    if (byId.size === 0) throw new Error("Dishware cabinet definitions are empty.");
    return Object.freeze({ byId, bySupply });
  }
  #validateState(): void {
    if (this.#state.schemaVersion !== DISHWARE_SCHEMA_VERSION ||
      !nonNegativeInteger(this.#state.revision) || !nonNegativeInteger(this.#state.currentUtcMs)) {
      throw new Error("Dishware state header is invalid.");
    }
    const plateIds = new Set<string>();
    const inventoryInstances = new Map(this.#inventory.getSnapshot().locations
      .flatMap((location) => location.instances)
      .map((entry) => [entry.id, entry]));
    for (const plate of this.#state.plates) {
      instanceId(plate.id);
      if (plateIds.has(plate.id) || !this.#cabinetMaps().bySupply.has(plate.supplyComponentId) ||
        inventoryInstances.get(plate.id)?.itemId !== this.#plateItemId) {
        throw new Error(`Dishware plate invariant failed: ${plate.id}`);
      }
      plateIds.add(plate.id);
    }
    for (const [supplyComponentId, cabinet] of this.#cabinetMaps().bySupply) {
      const supplied = this.#state.plates.filter((plate) => plate.supplyComponentId === supplyComponentId).length;
      if (supplied > cabinet.suppliedPlateCount) throw new Error(`Dishware supply exceeds current cabinet capacity: ${supplyComponentId}`);
    }
    const jobIds = new Set<string>();
    const jobPlateIds = new Set<string>();
    for (const job of this.#state.washJobs) {
      const cabinet = this.#cabinetMaps().byId.get(job.cabinetId);
      const plate = this.#plate(job.plateId);
      const locationId = [...inventoryInstances.entries()].find(([id]) => id === job.plateId)?.[1].locationId;
      if (cabinet === undefined || plate?.status !== "washing" || locationId !== cabinet.washingLocationId ||
        jobIds.has(job.id) || jobPlateIds.has(job.plateId) ||
        !nonNegativeInteger(job.startedAtUtcMs) || job.completesAtUtcMs <= job.startedAtUtcMs) {
        throw new Error(`Dishware wash job invariant failed: ${job.id}`);
      }
      jobIds.add(job.id);
      jobPlateIds.add(job.plateId);
    }
    for (const cabinet of this.#cabinetMaps().byId.values()) {
      if (this.#state.washJobs.filter((job) => job.cabinetId === cabinet.id).length > cabinet.parallelWashCount) {
        throw new Error(`Dishware cabinet exceeds parallel washing capacity: ${cabinet.id}`);
      }
    }
    if (new Set(this.#state.initializedSupplyComponentIds).size !== this.#state.initializedSupplyComponentIds.length ||
      this.#state.initializedSupplyComponentIds.some((id) => !this.#cabinetMaps().bySupply.has(id))) {
      throw new Error("Dishware initialized supply references are invalid.");
    }
  }
}

export * from "./scene-cabinet-adapter";
export * from "./supply-demand";
