import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { instanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const INVENTORY_MODULE_ID = "module.inventory";
export const INVENTORY_SCHEMA_VERSION = 1;

export type InventoryItemCategory = "ingredient" | "dishware" | "intermediate" | "meal";
export type InventoryStorageMode = "stack" | "instance";

export interface InventoryItemDefinition {
  readonly id: string;
  readonly category: InventoryItemCategory;
  readonly storageMode: InventoryStorageMode;
  readonly capacityUnits?: number;
}

export interface InventoryCompartmentDefinition {
  readonly id: string;
  readonly capacity: number;
  readonly acceptedCategories: readonly InventoryItemCategory[];
  readonly acceptedItemIds?: readonly string[];
}

export interface InventoryLocationDefinition {
  readonly id: string;
  readonly compartments: readonly InventoryCompartmentDefinition[];
}

export interface InventoryStorageDefinitionPort {
  getLocation(locationId: string): InventoryLocationDefinition | null;
  listLocations(): readonly InventoryLocationDefinition[];
}

export class StaticInventoryStorageDefinitions implements InventoryStorageDefinitionPort {
  readonly #locations = new Map<string, InventoryLocationDefinition>();

  constructor(locations: readonly InventoryLocationDefinition[]) {
    for (const location of locations) {
      if (this.#locations.has(location.id)) throw new Error(`Duplicate inventory location: ${location.id}`);
      this.#locations.set(location.id, freezeLocation(location));
    }
  }

  getLocation(locationId: string): InventoryLocationDefinition | null {
    return this.#locations.get(locationId) ?? null;
  }

  listLocations(): readonly InventoryLocationDefinition[] {
    return Object.freeze([...this.#locations.values()]);
  }
}

export interface InventoryStackState {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: number;
}

export interface InventoryInstanceState {
  readonly id: InstanceId;
  readonly itemId: string;
  readonly locationId: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

/** A single stack unit temporarily split out while a carrier owns it. */
export interface InventoryStackCargoState {
  readonly id: InstanceId;
  readonly itemId: string;
  readonly locationId: string;
  readonly reservationId: string | null;
}

export interface InventoryStackReservationAllocationState {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: number;
}

export interface InventoryReservationState {
  readonly id: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly stackAllocations: readonly InventoryStackReservationAllocationState[];
  readonly stackCargoIds: readonly InstanceId[];
  readonly instanceIds: readonly InstanceId[];
  readonly createdAtUtcMs: number;
}

export interface InventoryCapacityReservationState {
  readonly id: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly locationId: string;
  readonly compartmentId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly createdAtUtcMs: number;
}

export interface InventoryState {
  readonly schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  readonly revision: number;
  readonly stacks: readonly InventoryStackState[];
  readonly instances: readonly InventoryInstanceState[];
  readonly stackCargo: readonly InventoryStackCargoState[];
  readonly reservations: readonly InventoryReservationState[];
  readonly capacityReservations: readonly InventoryCapacityReservationState[];
  readonly processedOperationIds: readonly string[];
}

export interface InventoryStackSnapshot extends InventoryStackState {
  readonly category: InventoryItemCategory;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}

export interface InventoryInstanceSnapshot extends InventoryInstanceState {
  readonly category: InventoryItemCategory;
  readonly reservationId: string | null;
}

export interface InventoryStackCargoSnapshot extends InventoryStackCargoState {
  readonly category: InventoryItemCategory;
}

export interface InventoryLocationSnapshot {
  readonly id: string;
  readonly stacks: readonly InventoryStackSnapshot[];
  readonly instances: readonly InventoryInstanceSnapshot[];
  readonly stackCargo: readonly InventoryStackCargoSnapshot[];
  readonly compartments: readonly {
    readonly id: string;
    readonly capacity: number;
    readonly occupied: number;
    readonly reservedCapacity: number;
    readonly availableCapacity: number;
  }[];
}

export interface InventorySnapshot {
  readonly schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  readonly revision: number;
  readonly locations: readonly InventoryLocationSnapshot[];
  readonly reservations: readonly InventoryReservationState[];
  readonly capacityReservations: readonly InventoryCapacityReservationState[];
}

export interface StackQuantityRequest {
  readonly itemId: string;
  readonly quantity: number;
}

export interface StackReservationRequest extends StackQuantityRequest {
  readonly locationId: string;
}

export interface InventoryReservationRequest {
  readonly reservationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly stacks?: readonly StackReservationRequest[];
  readonly stackCargoIds?: readonly InstanceId[];
  readonly instanceIds?: readonly InstanceId[];
  readonly createdAtUtcMs: number;
}

export interface ReservedStackConsumptionPlan {
  readonly reservationId: string;
  readonly consumable: boolean;
  readonly requested: readonly StackQuantityRequest[];
  readonly allocations: readonly StackReservationRequest[];
  readonly missing: readonly StackQuantityRequest[];
}

export interface ReservedStackConsumptionResult {
  readonly reservationId: string;
  readonly consumed: readonly StackReservationRequest[];
  readonly remainingReservation: InventoryReservationState | null;
}

export interface CreateInventoryInstanceRequest {
  readonly instanceId: InstanceId;
  readonly itemId: string;
  readonly locationId: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAtUtcMs: number;
  readonly capacityReservationId?: string;
}

export type InventoryModuleRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_ITEM"
  | "WRONG_STORAGE_MODE"
  | "UNKNOWN_LOCATION"
  | "ITEM_NOT_ACCEPTED"
  | "CAPACITY_EXCEEDED"
  | "INSUFFICIENT_AVAILABLE"
  | "DUPLICATE_INSTANCE"
  | "UNKNOWN_INSTANCE"
  | "DUPLICATE_RESERVATION"
  | "UNKNOWN_RESERVATION"
  | "RESERVATION_MISMATCH"
  | "INSTANCE_RESERVED"
  | "DUPLICATE_CAPACITY_RESERVATION"
  | "UNKNOWN_CAPACITY_RESERVATION";

export type InventoryModuleOperationResult<TValue = undefined> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: InventoryModuleRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 1_024;

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function freezeLocation(location: InventoryLocationDefinition): InventoryLocationDefinition {
  if (!validId(location.id) || location.compartments.length === 0) {
    throw new Error(`Invalid inventory location: ${location.id}`);
  }
  const ids = new Set<string>();
  const compartments = location.compartments.map((compartment) => {
    if (!validId(compartment.id) || ids.has(compartment.id) ||
      !nonNegativeInteger(compartment.capacity) || compartment.acceptedCategories.length === 0 ||
      new Set(compartment.acceptedCategories).size !== compartment.acceptedCategories.length ||
      (compartment.acceptedItemIds !== undefined &&
        new Set(compartment.acceptedItemIds).size !== compartment.acceptedItemIds.length)) {
      throw new Error(`Invalid inventory compartment: ${location.id}/${compartment.id}`);
    }
    ids.add(compartment.id);
    return Object.freeze({
      ...compartment,
      acceptedCategories: Object.freeze([...compartment.acceptedCategories]),
      ...(compartment.acceptedItemIds === undefined
        ? {}
        : { acceptedItemIds: Object.freeze([...compartment.acceptedItemIds]) }),
    });
  });
  return Object.freeze({ id: location.id, compartments: Object.freeze(compartments) });
}

function cloneAttributes(
  attributes: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({ ...attributes });
}

function cloneState(state: InventoryState): InventoryState {
  return Object.freeze({
    ...state,
    stacks: Object.freeze(state.stacks.map((entry) => Object.freeze({ ...entry }))),
    instances: Object.freeze(state.instances.map((entry) => Object.freeze({
      ...entry,
      attributes: cloneAttributes(entry.attributes),
    }))),
    stackCargo: Object.freeze(state.stackCargo.map((entry) => Object.freeze({ ...entry }))),
    reservations: Object.freeze(state.reservations.map((reservation) => Object.freeze({
      ...reservation,
      stackAllocations: Object.freeze(reservation.stackAllocations.map((entry) => Object.freeze({ ...entry }))),
      stackCargoIds: Object.freeze([...reservation.stackCargoIds]),
      instanceIds: Object.freeze([...reservation.instanceIds]),
    }))),
    capacityReservations: Object.freeze(state.capacityReservations.map((entry) => Object.freeze({ ...entry }))),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export class InventoryModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = INVENTORY_MODULE_ID;
  readonly transactionParticipantId = INVENTORY_MODULE_ID;
  readonly #items = new Map<string, InventoryItemDefinition>();
  readonly #storage: InventoryStorageDefinitionPort;
  #state: InventoryState;
  #transactionActive = false;

  constructor(
    itemDefinitions: readonly InventoryItemDefinition[],
    storage: InventoryStorageDefinitionPort,
    initialState?: InventoryState,
  ) {
    if (itemDefinitions.length === 0) throw new Error("Inventory requires item definitions.");
    for (const definition of itemDefinitions) {
      if (!validId(definition.id) || this.#items.has(definition.id) ||
        (definition.capacityUnits !== undefined && !positiveInteger(definition.capacityUnits))) {
        throw new Error(`Invalid or duplicate inventory item: ${definition.id}`);
      }
      this.#items.set(definition.id, Object.freeze({ ...definition, capacityUnits: definition.capacityUnits ?? 1 }));
    }
    for (const location of storage.listLocations()) freezeLocation(location);
    this.#storage = storage;
    this.#state = initialState === undefined
      ? cloneState({
          schemaVersion: INVENTORY_SCHEMA_VERSION,
          revision: 0,
          stacks: [],
          instances: [],
          stackCargo: [],
          reservations: [],
          capacityReservations: [],
          processedOperationIds: [],
        })
      : cloneState(initialState);
    this.#validateState();
  }

  exportState(): InventoryState {
    return cloneState(this.#state);
  }

  getSnapshot(): InventorySnapshot {
    const locations = this.#storage.listLocations().map((location): InventoryLocationSnapshot => {
      const stacks = this.#state.stacks
        .filter((entry) => entry.locationId === location.id)
        .map((entry): InventoryStackSnapshot => {
          const reservedQuantity = this.#reservedStackQuantity(entry.locationId, entry.itemId);
          return Object.freeze({
            ...entry,
            category: this.#items.get(entry.itemId)!.category,
            reservedQuantity,
            availableQuantity: entry.quantity - reservedQuantity,
          });
        });
      const instances = this.#state.instances
        .filter((entry) => entry.locationId === location.id)
        .map((entry): InventoryInstanceSnapshot => Object.freeze({
          ...entry,
          attributes: cloneAttributes(entry.attributes),
          category: this.#items.get(entry.itemId)!.category,
          reservationId: this.#instanceReservationId(entry.id),
        }));
      const compartments = location.compartments.map((compartment) => {
        const occupied = this.#compartmentOccupancy(location.id, compartment);
        const reservedCapacity = this.#capacityReserved(location.id, compartment.id);
        return Object.freeze({
          id: compartment.id,
          capacity: compartment.capacity,
          occupied,
          reservedCapacity,
          availableCapacity: compartment.capacity - occupied - reservedCapacity,
        });
      });
      return Object.freeze({
        id: location.id,
        stacks: Object.freeze(stacks),
        instances: Object.freeze(instances),
        stackCargo: Object.freeze(this.#state.stackCargo
          .filter((entry) => entry.locationId === location.id)
          .map((entry) => Object.freeze({
            ...entry,
            category: this.#items.get(entry.itemId)!.category,
          }))),
        compartments: Object.freeze(compartments),
      });
    });
    return Object.freeze({
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      revision: this.#state.revision,
      locations: Object.freeze(locations),
      reservations: Object.freeze(this.#state.reservations.map((reservation) =>
        Object.freeze({
          ...reservation,
          stackAllocations: Object.freeze(reservation.stackAllocations.map((entry) =>
            Object.freeze({ ...entry }))),
          stackCargoIds: Object.freeze([...reservation.stackCargoIds]),
          instanceIds: Object.freeze([...reservation.instanceIds]),
        }))),
      capacityReservations: Object.freeze(this.#state.capacityReservations.map((entry) =>
        Object.freeze({ ...entry }))),
    });
  }

  hasProcessedOperation(operationId: string): boolean {
    return this.#state.processedOperationIds.includes(operationId);
  }
  get revision(): number {
    return this.#state.revision;
  }

  getStackQuantity(locationId: string, itemId: string): number {
    return this.#stack(locationId, itemId)?.quantity ?? 0;
  }

  getLocationStackQuantity(locationId: string): number {
    return this.#state.stacks
      .filter((entry) => entry.locationId === locationId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  }
  getStackStates(): readonly InventoryStackState[] {
    return Object.freeze(this.#state.stacks.map((entry) =>
      Object.freeze({ ...entry })));
  }

  getReservation(reservationId: string): InventoryReservationState | null {
    const reservation = this.#state.reservations.find(
      (entry) => entry.id === reservationId,
    );
    return reservation === undefined
      ? null
      : Object.freeze({
          ...reservation,
          stackAllocations: Object.freeze(reservation.stackAllocations.map((entry) =>
            Object.freeze({ ...entry }))),
          stackCargoIds: Object.freeze([...reservation.stackCargoIds]),
          instanceIds: Object.freeze([...reservation.instanceIds]),
        });
  }

planReservedStackConsumption(
    reservationId: string,
    requested: readonly StackQuantityRequest[],
  ): ReservedStackConsumptionPlan {
    const normalized = new Map<string, number>();
    for (const entry of requested) {
      if (!validId(entry.itemId) || !positiveInteger(entry.quantity) ||
        this.#item(entry.itemId, "stack") === null) {
        return Object.freeze({
          reservationId,
          consumable: false,
          requested: Object.freeze([]),
          allocations: Object.freeze([]),
          missing: Object.freeze([]),
        });
      }
      normalized.set(entry.itemId, (normalized.get(entry.itemId) ?? 0) + entry.quantity);
    }
    const quantities = [...normalized.entries()]
      .map(([itemId, quantity]) => Object.freeze({ itemId, quantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const reservation = this.#reservation(reservationId);
    if (!validId(reservationId) || quantities.length === 0 || reservation === null) {
      return Object.freeze({
        reservationId,
        consumable: false,
        requested: Object.freeze(quantities),
        allocations: Object.freeze([]),
        missing: Object.freeze(quantities),
      });
    }
    const allocations: StackReservationRequest[] = [];
    const missing: StackQuantityRequest[] = [];
    for (const request of quantities) {
      let remaining = request.quantity;
      for (const allocation of reservation.stackAllocations.filter((entry) =>
        entry.itemId === request.itemId,
      )) {
        if (remaining === 0) break;
        const actual = this.#stack(allocation.locationId, allocation.itemId)?.quantity ?? 0;
        const quantity = Math.min(remaining, allocation.quantity, actual);
        if (quantity > 0) {
          allocations.push(Object.freeze({
            itemId: allocation.itemId,
            locationId: allocation.locationId,
            quantity,
          }));
          remaining -= quantity;
        }
      }
      if (remaining > 0) missing.push(Object.freeze({ itemId: request.itemId, quantity: remaining }));
    }
    return Object.freeze({
      reservationId,
      consumable: missing.length === 0,
      requested: Object.freeze(quantities),
      allocations: Object.freeze(allocations),
      missing: Object.freeze(missing),
    });
  }

  getLocationSnapshot(locationId: string): InventoryLocationSnapshot | null {
    const location = this.#storage.getLocation(locationId);
    if (location === null) return null;
    const stacks = this.#state.stacks
      .filter((entry) => entry.locationId === location.id)
      .map((entry): InventoryStackSnapshot => {
        const reservedQuantity = this.#reservedStackQuantity(entry.locationId, entry.itemId);
        return Object.freeze({
          ...entry,
          category: this.#items.get(entry.itemId)!.category,
          reservedQuantity,
          availableQuantity: entry.quantity - reservedQuantity,
        });
      });
    const instances = this.#state.instances
      .filter((entry) => entry.locationId === location.id)
      .map((entry): InventoryInstanceSnapshot => Object.freeze({
        ...entry,
        attributes: cloneAttributes(entry.attributes),
        category: this.#items.get(entry.itemId)!.category,
        reservationId: this.#instanceReservationId(entry.id),
      }));
    return Object.freeze({
      id: location.id,
      stacks: Object.freeze(stacks),
      instances: Object.freeze(instances),
      stackCargo: Object.freeze(this.#state.stackCargo
        .filter((entry) => entry.locationId === location.id)
        .map((entry) => Object.freeze({
          ...entry,
          category: this.#items.get(entry.itemId)!.category,
        }))),
      compartments: Object.freeze(location.compartments.map((compartment) => {
        const occupied = this.#compartmentOccupancy(location.id, compartment);
        const reservedCapacity = this.#capacityReserved(location.id, compartment.id);
        return Object.freeze({
          id: compartment.id,
          capacity: compartment.capacity,
          occupied,
          reservedCapacity,
          availableCapacity: compartment.capacity - occupied - reservedCapacity,
        });
      })),
    });
  }

  validateStorageDefinition(location: InventoryLocationDefinition): readonly string[] {
    try {
      const candidate = freezeLocation(location);
      const issues: string[] = [];
      const actual = [
        ...this.#state.stacks.filter((entry) => entry.locationId === candidate.id)
          .map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity })),
        ...this.#state.instances.filter((entry) => entry.locationId === candidate.id)
          .map((entry) => ({ itemId: entry.itemId, quantity: 1 })),
        ...this.#state.stackCargo.filter((entry) => entry.locationId === candidate.id)
          .map((entry) => ({ itemId: entry.itemId, quantity: 1 })),
      ];
      const counts = new Map<string, number>();
      for (const entry of actual) {
        const compartment = this.#compartment(candidate, entry.itemId);
        if (compartment === null) {
          issues.push(`${entry.itemId} is no longer accepted.`);
        } else {
          counts.set(
            compartment.id,
            (counts.get(compartment.id) ?? 0) + entry.quantity * this.#capacityUnits(entry.itemId),
          );
        }
      }
      for (const reservation of this.#state.capacityReservations.filter((entry) => entry.locationId === candidate.id)) {
        const compartment = this.#compartment(candidate, reservation.itemId);
        if (compartment === null) issues.push(`${reservation.itemId} capacity reservation is no longer accepted.`);
        else counts.set(
          compartment.id,
          (counts.get(compartment.id) ?? 0) + reservation.quantity * this.#capacityUnits(reservation.itemId),
        );
      }
      for (const compartment of candidate.compartments) {
        const required = counts.get(compartment.id) ?? 0;
        if (required > compartment.capacity) {
          issues.push(`${compartment.id} requires ${required} capacity but only ${compartment.capacity} is available.`);
        }
      }
      return Object.freeze(issues);
    } catch (error: unknown) {
      return Object.freeze([error instanceof Error ? error.message : "Storage definition is invalid."]);
    }
  }

  depositStack(
    operationId: string,
    locationId: string,
    items: readonly StackQuantityRequest[],
    occurredAtUtcMs: number,
    capacityReservationIds: readonly string[] = [],
  ): InventoryModuleOperationResult<readonly InventoryStackState[]> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const normalized = this.#normalizeStacks(items);
    if (normalized === null) return this.#reject(operationId, "INVALID_REQUEST", "Stack deposit is invalid.");
    const incoming = this.#validateIncoming(locationId, normalized, capacityReservationIds);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);
    this.#consumeCapacityReservations(capacityReservationIds);
    for (const item of normalized) this.#addStack(locationId, item.itemId, item.quantity);
    return this.#accept(
      operationId,
      Object.freeze(normalized.map((item) => this.#stack(locationId, item.itemId)!)),
      [this.#event(operationId, "inventory.stack-deposited", occurredAtUtcMs, { locationId, items: normalized })],
    );
  }

  withdrawStack(
    operationId: string,
    locationId: string,
    items: readonly StackQuantityRequest[],
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<readonly StackQuantityRequest[]> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const normalized = this.#normalizeStacks(items);
    if (normalized === null) return this.#reject(operationId, "INVALID_REQUEST", "Stack withdrawal is invalid.");
    for (const item of normalized) {
      if (this.#item(item.itemId, "stack") === null) return this.#itemRejection(operationId, item.itemId, "stack");
      if (this.#availableStackQuantity(locationId, item.itemId) < item.quantity) {
        return this.#reject(operationId, "INSUFFICIENT_AVAILABLE", `Insufficient available ${item.itemId} at ${locationId}.`);
      }
    }
    for (const item of normalized) this.#removeStack(locationId, item.itemId, item.quantity);
    return this.#accept(operationId, normalized, [
      this.#event(operationId, "inventory.stack-withdrawn", occurredAtUtcMs, { locationId, items: normalized }),
    ]);
  }

  transferStack(
    operationId: string,
    sourceLocationId: string,
    targetLocationId: string,
    items: readonly StackQuantityRequest[],
    occurredAtUtcMs: number,
    capacityReservationIds: readonly string[] = [],
  ): InventoryModuleOperationResult<readonly StackQuantityRequest[]> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (sourceLocationId === targetLocationId) return this.#reject(operationId, "INVALID_REQUEST", "Transfer locations must differ.");
    const normalized = this.#normalizeStacks(items);
    if (normalized === null) return this.#reject(operationId, "INVALID_REQUEST", "Stack transfer is invalid.");
    for (const item of normalized) {
      if (this.#item(item.itemId, "stack") === null) return this.#itemRejection(operationId, item.itemId, "stack");
      if (this.#availableStackQuantity(sourceLocationId, item.itemId) < item.quantity) {
        return this.#reject(operationId, "INSUFFICIENT_AVAILABLE", `Insufficient available ${item.itemId} at ${sourceLocationId}.`);
      }
    }
    const incoming = this.#validateIncoming(targetLocationId, normalized, capacityReservationIds);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);
    this.#consumeCapacityReservations(capacityReservationIds);
    for (const item of normalized) {
      this.#removeStack(sourceLocationId, item.itemId, item.quantity);
      this.#addStack(targetLocationId, item.itemId, item.quantity);
    }
    return this.#accept(operationId, normalized, [this.#event(
      operationId,
      "inventory.stack-transferred",
      occurredAtUtcMs,
      { sourceLocationId, targetLocationId, items: normalized },
    )]);
  }

  createInstance(
    operationId: string,
    request: CreateInventoryInstanceRequest,
  ): InventoryModuleOperationResult<InventoryInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (this.#item(request.itemId, "instance") === null) return this.#itemRejection(operationId, request.itemId, "instance");
    try { instanceId(request.instanceId); } catch { return this.#reject(operationId, "INVALID_REQUEST", "Inventory instance id is invalid."); }
    if (this.#hasObjectId(request.instanceId)) return this.#reject(operationId, "DUPLICATE_INSTANCE", `Duplicate inventory instance: ${request.instanceId}`);
    const capacityIds = request.capacityReservationId === undefined ? [] : [request.capacityReservationId];
    const incoming = this.#validateIncoming(request.locationId, [{ itemId: request.itemId, quantity: 1 }], capacityIds);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);
    this.#consumeCapacityReservations(capacityIds);
    const value = Object.freeze({
      id: request.instanceId,
      itemId: request.itemId,
      locationId: request.locationId,
      attributes: cloneAttributes(request.attributes ?? {}),
    });
    this.#replace({ instances: [...this.#state.instances, value] });
    return this.#accept(operationId, value, [
      this.#event(operationId, "inventory.instance-created", request.occurredAtUtcMs, value),
    ]);
  }

  transferInstance(
    operationId: string,
    inventoryInstanceId: InstanceId,
    targetLocationId: string,
    occurredAtUtcMs: number,
    capacityReservationId?: string,
  ): InventoryModuleOperationResult<InventoryInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const current = this.#state.instances.find((entry) => entry.id === inventoryInstanceId);
    if (current === undefined) return this.#reject(operationId, "UNKNOWN_INSTANCE", `Unknown inventory instance: ${inventoryInstanceId}`);
    if (current.locationId === targetLocationId) return this.#noChange(operationId, current);
    const capacityIds = capacityReservationId === undefined ? [] : [capacityReservationId];
    const incoming = this.#validateIncoming(targetLocationId, [{ itemId: current.itemId, quantity: 1 }], capacityIds);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);
    this.#consumeCapacityReservations(capacityIds);
    const next = Object.freeze({ ...current, locationId: targetLocationId, attributes: cloneAttributes(current.attributes) });
    this.#replace({ instances: this.#state.instances.map((entry) => entry.id === current.id ? next : entry) });
    return this.#accept(operationId, next, [this.#event(
      operationId,
      "inventory.instance-transferred",
      occurredAtUtcMs,
      {
        instanceId: current.id,
        sourceLocationId: current.locationId,
        targetLocationId,
        reservationId: this.#instanceReservationId(current.id),
      },
    )]);
  }

  removeInstance(
    operationId: string,
    inventoryInstanceId: InstanceId,
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<InventoryInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const current = this.#state.instances.find((entry) => entry.id === inventoryInstanceId);
    if (current === undefined) return this.#reject(operationId, "UNKNOWN_INSTANCE", `Unknown inventory instance: ${inventoryInstanceId}`);
    if (this.#instanceReservationId(current.id) !== null) {
      return this.#reject(operationId, "INSTANCE_RESERVED", "Reserved inventory instance cannot be removed.");
    }
    this.#replace({ instances: this.#state.instances.filter((entry) => entry.id !== current.id) });
    return this.#accept(operationId, current, [
      this.#event(operationId, "inventory.instance-removed", occurredAtUtcMs, current),
    ]);
  }

  createReservation(
    operationId: string,
    request: InventoryReservationRequest,
  ): InventoryModuleOperationResult<InventoryReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const duplicate = this.#state.reservations.some((entry) => entry.id === request.reservationId);
    if (!validId(request.reservationId) || !validId(request.ownerType) || !validId(request.ownerId) ||
      !nonNegativeInteger(request.createdAtUtcMs) || duplicate) {
      return this.#reject(
        operationId,
        duplicate ? "DUPLICATE_RESERVATION" : "INVALID_REQUEST",
        "Inventory reservation request is invalid.",
      );
    }
    const stacks = this.#normalizeStackAllocations(request.stacks ?? []);
    const stackCargoIds = [...(request.stackCargoIds ?? [])];
    const instanceIds = [...(request.instanceIds ?? [])];
    if (stacks === null || new Set(stackCargoIds).size !== stackCargoIds.length ||
      new Set(instanceIds).size !== instanceIds.length ||
      (stacks.length === 0 && stackCargoIds.length === 0 && instanceIds.length === 0)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Inventory reservation must contain unique resources.");
    }
    for (const stack of stacks) {
      if (this.#item(stack.itemId, "stack") === null) return this.#itemRejection(operationId, stack.itemId, "stack");
      if (this.#availableStackQuantity(stack.locationId, stack.itemId) < stack.quantity) {
        return this.#reject(operationId, "INSUFFICIENT_AVAILABLE", `Insufficient available ${stack.itemId} at ${stack.locationId}.`);
      }
    }
    for (const id of instanceIds) {
      if (!this.#state.instances.some((entry) => entry.id === id)) {
        return this.#reject(operationId, "UNKNOWN_INSTANCE", `Unknown inventory instance: ${id}`);
      }
      if (this.#instanceReservationId(id) !== null) {
        return this.#reject(operationId, "INSTANCE_RESERVED", `Inventory instance is already reserved: ${id}`);
      }
    }
    for (const id of stackCargoIds) {
      const cargo = this.#state.stackCargo.find((entry) => entry.id === id);
      if (cargo === undefined) {
        return this.#reject(operationId, "UNKNOWN_INSTANCE", `Unknown stack cargo instance: ${id}`);
      }
      if (cargo.reservationId !== null) {
        return this.#reject(operationId, "INSTANCE_RESERVED", `Stack cargo is already reserved: ${id}`);
      }
    }
    const value = Object.freeze({
      id: request.reservationId,
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      stackAllocations: Object.freeze(stacks),
      stackCargoIds: Object.freeze(stackCargoIds),
      instanceIds: Object.freeze(instanceIds),
      createdAtUtcMs: request.createdAtUtcMs,
    });
    this.#replace({
      reservations: [...this.#state.reservations, value],
      stackCargo: this.#state.stackCargo.map((entry) => stackCargoIds.includes(entry.id)
        ? Object.freeze({ ...entry, reservationId: request.reservationId })
        : entry),
    });
    return this.#accept(operationId, value, [
      this.#event(operationId, "inventory.resources-reserved", request.createdAtUtcMs, value),
    ]);
  }

  releaseReservation(
    operationId: string,
    reservationId: string,
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<InventoryReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const reservation = this.#reservation(reservationId);
    if (reservation === null) return this.#reject(operationId, "UNKNOWN_RESERVATION", `Unknown inventory reservation: ${reservationId}`);
    this.#replace({
      reservations: this.#state.reservations.filter((entry) => entry.id !== reservationId),
      stackCargo: this.#state.stackCargo.map((entry) => entry.reservationId === reservationId
        ? Object.freeze({ ...entry, reservationId: null }) : entry),
    });
    return this.#accept(operationId, reservation, [
      this.#event(operationId, "inventory.resources-released", occurredAtUtcMs, { reservationId }),
    ]);
  }

consumeReservedStacks(
    operationId: string,
    reservationId: string,
    requested: readonly StackQuantityRequest[],
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<ReservedStackConsumptionResult> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (!nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Reserved stack consumption time is invalid.");
    }
    const reservation = this.#reservation(reservationId);
    if (reservation === null) {
      return this.#reject(operationId, "UNKNOWN_RESERVATION", `Unknown inventory reservation: ${reservationId}`);
    }
    const plan = this.planReservedStackConsumption(reservationId, requested);
    if (plan.requested.length === 0) {
      return this.#reject(operationId, "INVALID_REQUEST", "Reserved stack consumption request is invalid.");
    }
    if (!plan.consumable) {
      return this.#reject(operationId, "RESERVATION_MISMATCH", "Reserved stack ingredients are not ready in storage.");
    }
    for (const allocation of plan.allocations) {
      this.#removeStack(allocation.locationId, allocation.itemId, allocation.quantity);
    }
    const consumptionByAllocation = new Map(plan.allocations.map((entry) => [
      `${entry.locationId}\u0000${entry.itemId}`,
      entry.quantity,
    ]));
    const remainingAllocations = reservation.stackAllocations.flatMap((entry) => {
      const consumed = consumptionByAllocation.get(`${entry.locationId}\u0000${entry.itemId}`) ?? 0;
      const remaining = entry.quantity - consumed;
      return remaining === 0 ? [] : [Object.freeze({ ...entry, quantity: remaining })];
    });
    const empty = remainingAllocations.length === 0 && reservation.stackCargoIds.length === 0 &&
      reservation.instanceIds.length === 0;
    const remainingReservation = empty ? null : Object.freeze({
      ...reservation,
      stackAllocations: Object.freeze(remainingAllocations),
      stackCargoIds: Object.freeze([...reservation.stackCargoIds]),
      instanceIds: Object.freeze([...reservation.instanceIds]),
    });
    this.#replace({
      reservations: empty
        ? this.#state.reservations.filter((entry) => entry.id !== reservation.id)
        : this.#state.reservations.map((entry) => entry.id === reservation.id ? remainingReservation! : entry),
    });
    const value = Object.freeze({
      reservationId,
      consumed: Object.freeze(plan.allocations.map((entry) => Object.freeze({ ...entry }))),
      remainingReservation,
    });
    return this.#accept(operationId, value, [this.#event(
      operationId,
      "inventory.reserved-stacks-consumed",
      occurredAtUtcMs,
      {
        reservationId,
        consumed: value.consumed,
        remainingReservationExists: remainingReservation !== null,
      },
    )]);
  }

  consumeReservation(
    operationId: string,
    reservationId: string,
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<InventoryReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const reservation = this.#reservation(reservationId);
    if (reservation === null) return this.#reject(operationId, "UNKNOWN_RESERVATION", `Unknown inventory reservation: ${reservationId}`);
    for (const allocation of reservation.stackAllocations) {
      if ((this.#stack(allocation.locationId, allocation.itemId)?.quantity ?? 0) < allocation.quantity) {
        return this.#reject(operationId, "RESERVATION_MISMATCH", "Reserved stack allocation no longer exists.");
      }
    }
    if (reservation.instanceIds.some((id) => !this.#state.instances.some((entry) => entry.id === id)) ||
      reservation.stackCargoIds.some((id) => !this.#state.stackCargo.some((entry) => entry.id === id))) {
      return this.#reject(operationId, "RESERVATION_MISMATCH", "Reserved instance no longer exists.");
    }
    for (const allocation of reservation.stackAllocations) {
      this.#removeStack(allocation.locationId, allocation.itemId, allocation.quantity);
    }
    this.#replace({
      reservations: this.#state.reservations.filter((entry) => entry.id !== reservationId),
      instances: this.#state.instances.filter((entry) => !reservation.instanceIds.includes(entry.id)),
      stackCargo: this.#state.stackCargo.filter((entry) => !reservation.stackCargoIds.includes(entry.id)),
    });
    return this.#accept(operationId, reservation, [
      this.#event(operationId, "inventory.resources-consumed", occurredAtUtcMs, { reservationId }),
    ]);
  }

  beginStackUnitTransit(
    operationId: string,
    cargoInstanceId: InstanceId,
    itemId: string,
    sourceLocationId: string,
    transitLocationId: string,
    occurredAtUtcMs: number,
    reservationId?: string,
  ): InventoryModuleOperationResult<InventoryStackCargoState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    try { instanceId(cargoInstanceId); } catch { return this.#reject(operationId, "INVALID_REQUEST", "Cargo instance id is invalid."); }
    if (this.#hasObjectId(cargoInstanceId)) return this.#reject(operationId, "DUPLICATE_INSTANCE", `Duplicate inventory object: ${cargoInstanceId}`);
    if (sourceLocationId === transitLocationId) return this.#reject(operationId, "INVALID_REQUEST", "Transit locations must differ.");
    if (this.#item(itemId, "stack") === null) return this.#itemRejection(operationId, itemId, "stack");
    const incoming = this.#validateIncoming(transitLocationId, [{ itemId, quantity: 1 }], []);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);

    let reservation: InventoryReservationState | null = null;
    if (reservationId === undefined) {
      if (this.#availableStackQuantity(sourceLocationId, itemId) < 1) {
        return this.#reject(operationId, "INSUFFICIENT_AVAILABLE", `No available ${itemId} at ${sourceLocationId}.`);
      }
    } else {
      reservation = this.#reservation(reservationId);
      const allocation = reservation?.stackAllocations.find((entry) =>
        entry.locationId === sourceLocationId && entry.itemId === itemId,
      );
      if (reservation === null || allocation === undefined || allocation.quantity < 1) {
        return this.#reject(operationId, "RESERVATION_MISMATCH", "Reservation is not bound to the requested source unit.");
      }
    }

    this.#removeStack(sourceLocationId, itemId, 1);
    const cargo = Object.freeze({
      id: cargoInstanceId,
      itemId,
      locationId: transitLocationId,
      reservationId: reservationId ?? null,
    });
    let reservations = this.#state.reservations;
    if (reservation !== null) {
      const allocations = reservation.stackAllocations.flatMap((entry) => {
        if (entry.locationId !== sourceLocationId || entry.itemId !== itemId) return [entry];
        return entry.quantity === 1 ? [] : [Object.freeze({ ...entry, quantity: entry.quantity - 1 })];
      });
      const next = Object.freeze({
        ...reservation,
        stackAllocations: Object.freeze(allocations),
        stackCargoIds: Object.freeze([...reservation.stackCargoIds, cargoInstanceId]),
      });
      reservations = reservations.map((entry) => entry.id === reservation!.id ? next : entry);
    }
    this.#replace({ stackCargo: [...this.#state.stackCargo, cargo], reservations });
    return this.#accept(operationId, cargo, [this.#event(
      operationId,
      "inventory.stack-unit-transit-started",
      occurredAtUtcMs,
      { cargoInstanceId, itemId, sourceLocationId, transitLocationId, reservationId: reservationId ?? null },
    )]);
  }

  completeStackUnitTransit(
    operationId: string,
    cargoInstanceId: InstanceId,
    targetLocationId: string,
    occurredAtUtcMs: number,
    capacityReservationId?: string,
  ): InventoryModuleOperationResult<InventoryStackState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const cargo = this.#state.stackCargo.find((entry) => entry.id === cargoInstanceId);
    if (cargo === undefined) return this.#reject(operationId, "UNKNOWN_INSTANCE", `Unknown stack cargo: ${cargoInstanceId}`);
    if (cargo.locationId === targetLocationId) return this.#reject(operationId, "INVALID_REQUEST", "Cargo target must differ from transit location.");
    const capacityIds = capacityReservationId === undefined ? [] : [capacityReservationId];
    const incoming = this.#validateIncoming(targetLocationId, [{ itemId: cargo.itemId, quantity: 1 }], capacityIds);
    if (incoming !== null) return this.#reject(operationId, incoming.code, incoming.message);

    let reservations = this.#state.reservations;
    if (cargo.reservationId !== null) {
      const reservation = this.#reservation(cargo.reservationId);
      if (reservation === null || !reservation.stackCargoIds.includes(cargo.id)) {
        return this.#reject(operationId, "RESERVATION_MISMATCH", "Cargo reservation binding is missing.");
      }
      const existing = reservation.stackAllocations.find((entry) =>
        entry.locationId === targetLocationId && entry.itemId === cargo.itemId,
      );
      const allocations = existing === undefined
        ? [...reservation.stackAllocations, Object.freeze({ itemId: cargo.itemId, locationId: targetLocationId, quantity: 1 })]
        : reservation.stackAllocations.map((entry) => entry === existing
          ? Object.freeze({ ...entry, quantity: entry.quantity + 1 }) : entry);
      const next = Object.freeze({
        ...reservation,
        stackAllocations: Object.freeze(allocations),
        stackCargoIds: Object.freeze(reservation.stackCargoIds.filter((id) => id !== cargo.id)),
      });
      reservations = reservations.map((entry) => entry.id === reservation.id ? next : entry);
    }
    this.#consumeCapacityReservations(capacityIds);
    this.#addStack(targetLocationId, cargo.itemId, 1);
    this.#replace({
      stackCargo: this.#state.stackCargo.filter((entry) => entry.id !== cargo.id),
      reservations,
    });
    return this.#accept(operationId, this.#stack(targetLocationId, cargo.itemId)!, [this.#event(
      operationId,
      "inventory.stack-unit-transit-completed",
      occurredAtUtcMs,
      {
        cargoInstanceId,
        itemId: cargo.itemId,
        sourceLocationId: cargo.locationId,
        targetLocationId,
        reservationId: cargo.reservationId,
      },
    )]);
  }

  reserveCapacity(
    operationId: string,
    reservationId: string,
    ownerType: string,
    ownerId: string,
    locationId: string,
    itemId: string,
    quantity: number,
    createdAtUtcMs: number,
  ): InventoryModuleOperationResult<InventoryCapacityReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (!validId(reservationId) || !validId(ownerType) || !validId(ownerId) ||
      !positiveInteger(quantity) || !nonNegativeInteger(createdAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Capacity reservation request is invalid.");
    }
    if (this.#state.capacityReservations.some((entry) => entry.id === reservationId)) {
      return this.#reject(operationId, "DUPLICATE_CAPACITY_RESERVATION", `Duplicate capacity reservation: ${reservationId}`);
    }
    if (!this.#items.has(itemId)) return this.#reject(operationId, "UNKNOWN_ITEM", `Unknown inventory item: ${itemId}`);
    const location = this.#storage.getLocation(locationId);
    if (location === null) return this.#reject(operationId, "UNKNOWN_LOCATION", `Unknown inventory location: ${locationId}`);
    const compartment = this.#compartment(location, itemId);
    if (compartment === null) return this.#reject(operationId, "ITEM_NOT_ACCEPTED", `${itemId} is not accepted at ${locationId}.`);
    if (this.#availableCompartmentCapacity(locationId, compartment) < quantity * this.#capacityUnits(itemId)) {
      return this.#reject(operationId, "CAPACITY_EXCEEDED", `Insufficient ${compartment.id} capacity at ${locationId}.`);
    }
    const value = Object.freeze({
      id: reservationId,
      ownerType,
      ownerId,
      locationId,
      compartmentId: compartment.id,
      itemId,
      quantity,
      createdAtUtcMs,
    });
    this.#replace({ capacityReservations: [...this.#state.capacityReservations, value] });
    return this.#accept(operationId, value, [
      this.#event(operationId, "inventory.capacity-reserved", createdAtUtcMs, value),
    ]);
  }

  releaseCapacityReservation(
    operationId: string,
    reservationId: string,
    occurredAtUtcMs: number,
  ): InventoryModuleOperationResult<InventoryCapacityReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const value = this.#state.capacityReservations.find((entry) => entry.id === reservationId);
    if (value === undefined) {
      return this.#reject(operationId, "UNKNOWN_CAPACITY_RESERVATION", `Unknown capacity reservation: ${reservationId}`);
    }
    this.#replace({ capacityReservations: this.#state.capacityReservations.filter((entry) => entry.id !== reservationId) });
    return this.#accept(operationId, value, [
      this.#event(operationId, "inventory.capacity-released", occurredAtUtcMs, { reservationId }),
    ]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Inventory transaction is already active.");
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

  #normalizeStacks(items: readonly StackQuantityRequest[]): readonly StackQuantityRequest[] | null {
    if (items.length === 0) return null;
    const quantities = new Map<string, number>();
    for (const item of items) {
      if (!validId(item.itemId) || !positiveInteger(item.quantity)) return null;
      quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
    }
    return Object.freeze([...quantities].map(([itemId, quantity]) => Object.freeze({ itemId, quantity })));
  }

  #normalizeStackAllocations(
    entries: readonly StackReservationRequest[],
  ): readonly InventoryStackReservationAllocationState[] | null {
    const quantities = new Map<string, InventoryStackReservationAllocationState>();
    for (const entry of entries) {
      if (!validId(entry.locationId) || !validId(entry.itemId) || !positiveInteger(entry.quantity)) return null;
      const key = `${entry.locationId}\u0000${entry.itemId}`;
      const existing = quantities.get(key);
      quantities.set(key, Object.freeze({ ...entry, quantity: (existing?.quantity ?? 0) + entry.quantity }));
    }
    return Object.freeze([...quantities.values()]);
  }

  #validateIncoming(
    locationId: string,
    items: readonly StackQuantityRequest[],
    capacityReservationIds: readonly string[],
  ): { readonly code: InventoryModuleRejectionCode; readonly message: string } | null {
    const location = this.#storage.getLocation(locationId);
    if (location === null) return { code: "UNKNOWN_LOCATION", message: `Unknown inventory location: ${locationId}` };
    const incomingItems = new Map(items.map((item) => [item.itemId, item.quantity]));
    const consumedReservations: InventoryCapacityReservationState[] = [];
    for (const id of capacityReservationIds) {
      const reservation = this.#state.capacityReservations.find((entry) => entry.id === id);
      if (reservation === undefined || reservation.locationId !== locationId ||
        (incomingItems.get(reservation.itemId) ?? 0) < reservation.quantity) {
        return { code: "RESERVATION_MISMATCH", message: `Capacity reservation does not match incoming inventory: ${id}` };
      }
      consumedReservations.push(reservation);
    }
    const requestedByCompartment = new Map<string, number>();
    for (const item of items) {
      if (!this.#items.has(item.itemId)) return { code: "UNKNOWN_ITEM", message: `Unknown inventory item: ${item.itemId}` };
      const compartment = this.#compartment(location, item.itemId);
      if (compartment === null) return { code: "ITEM_NOT_ACCEPTED", message: `${item.itemId} is not accepted at ${locationId}.` };
      requestedByCompartment.set(
        compartment.id,
        (requestedByCompartment.get(compartment.id) ?? 0) + item.quantity * this.#capacityUnits(item.itemId),
      );
    }
    for (const [compartmentId, quantity] of requestedByCompartment) {
      const compartment = location.compartments.find((entry) => entry.id === compartmentId)!;
      const converting = consumedReservations
        .filter((entry) => entry.compartmentId === compartmentId)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      if (this.#availableCompartmentCapacity(locationId, compartment) + converting < quantity) {
        return { code: "CAPACITY_EXCEEDED", message: `Insufficient ${compartment.id} capacity at ${locationId}.` };
      }
    }
    return null;
  }

  #consumeCapacityReservations(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const unique = new Set(ids);
    this.#replace({ capacityReservations: this.#state.capacityReservations.filter((entry) => !unique.has(entry.id)) });
  }

  #item(itemId: string, mode: InventoryStorageMode): InventoryItemDefinition | null {
    const definition = this.#items.get(itemId);
    return definition?.storageMode === mode ? definition : null;
  }

  #itemRejection(
    operationId: string,
    itemId: string,
    expectedMode: InventoryStorageMode,
  ): InventoryModuleOperationResult<never> {
    return this.#items.has(itemId)
      ? this.#reject(operationId, "WRONG_STORAGE_MODE", `${itemId} is not a ${expectedMode} item.`)
      : this.#reject(operationId, "UNKNOWN_ITEM", `Unknown inventory item: ${itemId}`);
  }

  #compartment(
    location: InventoryLocationDefinition,
    itemId: string,
  ): InventoryCompartmentDefinition | null {
    const item = this.#items.get(itemId);
    if (item === undefined) return null;
    return location.compartments.find((compartment) =>
      compartment.acceptedCategories.includes(item.category) &&
      (compartment.acceptedItemIds === undefined || compartment.acceptedItemIds.includes(itemId)),
    ) ?? null;
  }

  #compartmentOccupancy(locationId: string, compartment: InventoryCompartmentDefinition): number {
    const location = this.#storage.getLocation(locationId);
    if (location === null) return 0;
    const accepted = (itemId: string) => this.#compartment(location, itemId)?.id === compartment.id;
    return this.#state.stacks
      .filter((entry) => entry.locationId === locationId && accepted(entry.itemId))
      .reduce((sum, entry) => sum + entry.quantity * this.#capacityUnits(entry.itemId), 0) +
      this.#state.instances.filter((entry) => entry.locationId === locationId && accepted(entry.itemId))
        .reduce((sum, entry) => sum + this.#capacityUnits(entry.itemId), 0) +
      this.#state.stackCargo.filter((entry) => entry.locationId === locationId && accepted(entry.itemId))
        .reduce((sum, entry) => sum + this.#capacityUnits(entry.itemId), 0);
  }

  #capacityReserved(locationId: string, compartmentId: string): number {
    return this.#state.capacityReservations
      .filter((entry) => entry.locationId === locationId && entry.compartmentId === compartmentId)
      .reduce((sum, entry) => sum + entry.quantity * this.#capacityUnits(entry.itemId), 0);
  }

  #capacityUnits(itemId: string): number {
    return this.#items.get(itemId)?.capacityUnits ?? 1;
  }

  #availableCompartmentCapacity(locationId: string, compartment: InventoryCompartmentDefinition): number {
    return compartment.capacity - this.#compartmentOccupancy(locationId, compartment) -
      this.#capacityReserved(locationId, compartment.id);
  }

  #stack(locationId: string, itemId: string): InventoryStackState | null {
    return this.#state.stacks.find((entry) => entry.locationId === locationId && entry.itemId === itemId) ?? null;
  }

  #addStack(locationId: string, itemId: string, quantity: number): void {
    const current = this.#stack(locationId, itemId);
    this.#replace({
      stacks: current === null
        ? [...this.#state.stacks, Object.freeze({ locationId, itemId, quantity })]
        : this.#state.stacks.map((entry) => entry === current
          ? Object.freeze({ ...entry, quantity: entry.quantity + quantity }) : entry),
    });
  }

  #removeStack(locationId: string, itemId: string, quantity: number): void {
    const current = this.#stack(locationId, itemId);
    if (current === null || current.quantity < quantity) throw new Error(`Inventory stack underflow: ${locationId}/${itemId}`);
    this.#replace({
      stacks: current.quantity === quantity
        ? this.#state.stacks.filter((entry) => entry !== current)
        : this.#state.stacks.map((entry) => entry === current
          ? Object.freeze({ ...entry, quantity: entry.quantity - quantity }) : entry),
    });
  }

  #reservedStackQuantity(locationId: string, itemId: string): number {
    return this.#state.reservations.flatMap((reservation) => reservation.stackAllocations)
      .filter((entry) => entry.locationId === locationId && entry.itemId === itemId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  }

  #availableStackQuantity(locationId: string, itemId: string): number {
    return (this.#stack(locationId, itemId)?.quantity ?? 0) - this.#reservedStackQuantity(locationId, itemId);
  }

  #reservation(reservationId: string): InventoryReservationState | null {
    return this.#state.reservations.find((entry) => entry.id === reservationId) ?? null;
  }

  #instanceReservationId(id: InstanceId): string | null {
    return this.#state.reservations.find((reservation) => reservation.instanceIds.includes(id))?.id ?? null;
  }

  #hasObjectId(id: InstanceId): boolean {
    return this.#state.instances.some((entry) => entry.id === id) ||
      this.#state.stackCargo.some((entry) => entry.id === id);
  }

  #prepare(operationId: string): InventoryModuleOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Inventory operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Inventory operation was already processed.");
    }
    this.#replace({
      processedOperationIds: Object.freeze(
        [...this.#state.processedOperationIds, operationId]
          .slice(-OPERATION_HISTORY_LIMIT),
      ),
    });
    return null;
  }

  #replace(update: Partial<InventoryState>): void {
    this.#state = Object.freeze({
      ...this.#state,
      ...update,
      revision: this.#state.revision + 1,
      stacks: update.stacks === undefined
        ? this.#state.stacks
        : Object.freeze([...update.stacks]),
      instances: update.instances === undefined
        ? this.#state.instances
        : Object.freeze([...update.instances]),
      stackCargo: update.stackCargo === undefined
        ? this.#state.stackCargo
        : Object.freeze([...update.stackCargo]),
      reservations: update.reservations === undefined
        ? this.#state.reservations
        : Object.freeze([...update.reservations]),
      capacityReservations: update.capacityReservations === undefined
        ? this.#state.capacityReservations
        : Object.freeze([...update.capacityReservations]),
      processedOperationIds: update.processedOperationIds === undefined
        ? this.#state.processedOperationIds
        : Object.freeze([...update.processedOperationIds]),
    });
  }

  #accept<TValue>(
    operationId: string,
    value: TValue,
    events: readonly DomainEvent[],
  ): InventoryModuleOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value, events: Object.freeze([...events]) });
  }

  #noChange<TValue>(operationId: string, value: TValue): InventoryModuleOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: false, operationId, value, events: Object.freeze([]) });
  }

  #reject(operationId: string, code: InventoryModuleRejectionCode, message: string): InventoryModuleOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #validateState(): void {
    if (this.#state.schemaVersion !== INVENTORY_SCHEMA_VERSION || !nonNegativeInteger(this.#state.revision)) {
      throw new Error("Inventory state header is invalid.");
    }
    const stackKeys = new Set<string>();
    for (const stack of this.#state.stacks) {
      const key = `${stack.locationId}\u0000${stack.itemId}`;
      if (stackKeys.has(key) || !positiveInteger(stack.quantity) || this.#item(stack.itemId, "stack") === null ||
        this.#storage.getLocation(stack.locationId) === null) {
        throw new Error(`Invalid inventory stack: ${stack.locationId}/${stack.itemId}`);
      }
      stackKeys.add(key);
    }
    const objectIds = new Set<string>();
    for (const entry of this.#state.instances) {
      instanceId(entry.id);
      if (objectIds.has(entry.id) || this.#item(entry.itemId, "instance") === null ||
        this.#storage.getLocation(entry.locationId) === null) throw new Error(`Invalid inventory instance: ${entry.id}`);
      objectIds.add(entry.id);
    }
    for (const cargo of this.#state.stackCargo) {
      instanceId(cargo.id);
      if (objectIds.has(cargo.id) || this.#item(cargo.itemId, "stack") === null ||
        this.#storage.getLocation(cargo.locationId) === null) throw new Error(`Invalid inventory stack cargo: ${cargo.id}`);
      objectIds.add(cargo.id);
    }

    const reservationIds = new Set<string>();
    const reservedInstances = new Set<string>();
    const reservedCargo = new Set<string>();
    for (const reservation of this.#state.reservations) {
      if (!validId(reservation.id) || reservationIds.has(reservation.id)) {
        throw new Error(`Duplicate inventory reservation: ${reservation.id}`);
      }
      reservationIds.add(reservation.id);
      for (const allocation of reservation.stackAllocations) {
        if (!positiveInteger(allocation.quantity) ||
          this.#reservedStackQuantity(allocation.locationId, allocation.itemId) >
            (this.#stack(allocation.locationId, allocation.itemId)?.quantity ?? 0)) {
          throw new Error(`Invalid reserved stack allocation: ${reservation.id}`);
        }
      }
      for (const id of reservation.instanceIds) {
        if (reservedInstances.has(id) || !this.#state.instances.some((entry) => entry.id === id)) {
          throw new Error(`Invalid reserved instance: ${id}`);
        }
        reservedInstances.add(id);
      }
      for (const id of reservation.stackCargoIds) {
        const cargo = this.#state.stackCargo.find((entry) => entry.id === id);
        if (reservedCargo.has(id) || cargo?.reservationId !== reservation.id) {
          throw new Error(`Invalid reserved stack cargo: ${id}`);
        }
        reservedCargo.add(id);
      }
    }
    if (this.#state.stackCargo.some((cargo) =>
      cargo.reservationId !== null && !reservationIds.has(cargo.reservationId),
    )) throw new Error("Inventory cargo references an unknown reservation.");

    const capacityIds = new Set<string>();
    for (const reservation of this.#state.capacityReservations) {
      const location = this.#storage.getLocation(reservation.locationId);
      if (location === null || capacityIds.has(reservation.id) || !positiveInteger(reservation.quantity) ||
        !location.compartments.some((entry) => entry.id === reservation.compartmentId) ||
        this.#compartment(location, reservation.itemId)?.id !== reservation.compartmentId) {
        throw new Error(`Invalid inventory capacity reservation: ${reservation.id}`);
      }
      capacityIds.add(reservation.id);
    }
    for (const location of this.#storage.listLocations()) {
      const issues = this.validateStorageDefinition(location);
      if (issues.length > 0) {
        throw new Error(`Inventory storage constraints are violated at ${location.id}: ${issues.join("; ")}`);
      }
    }
  }
}
