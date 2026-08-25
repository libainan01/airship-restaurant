import {
  InventoryModule,
  StaticInventoryStorageDefinitions,
  type InventoryItemCategory,
  type InventoryModuleOperationResult,
} from "./modules";

const IDENTIFIER_MAX_LENGTH = 128;
const COMPATIBILITY_ITEM_ID = "compatibility.placeholder";

export interface ItemStack {
  readonly itemId: string;
  readonly quantity: number;
}

export interface InventoryContainerDefinition {
  readonly id: string;
  readonly capacity: number;
  readonly acceptedItemIds?: readonly string[];
  readonly itemCapacities?: Readonly<Record<string, number>>;
}

export interface InventoryContainerSnapshot {
  readonly id: string;
  readonly capacity: number;
  readonly totalQuantity: number;
  readonly availableCapacity: number;
  readonly entries: readonly InventoryEntrySnapshot[];
}

export interface InventoryEntrySnapshot {
  readonly itemId: string;
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}

export interface InventoryReservationSnapshot {
  readonly id: string;
  readonly containerId: string;
  readonly items: readonly ItemStack[];
}

export type InventoryRejectionCode =
  | "INVALID_OPERATION_ID"
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_CONTAINER"
  | "UNKNOWN_RESERVATION"
  | "DUPLICATE_RESERVATION"
  | "ITEM_NOT_ACCEPTED"
  | "INSUFFICIENT_AVAILABLE"
  | "TARGET_CAPACITY_EXCEEDED";

export interface AcceptedInventoryOperation {
  readonly accepted: true;
  readonly operationId: string;
}

export interface RejectedInventoryOperation {
  readonly accepted: false;
  readonly operationId: string;
  readonly code: InventoryRejectionCode;
  readonly message: string;
}

export type InventoryOperationResult =
  | AcceptedInventoryOperation
  | RejectedInventoryOperation;

interface NormalizedContainerDefinition {
  readonly id: string;
  readonly capacity: number;
  readonly acceptedItemIds: ReadonlySet<string> | null;
  readonly itemCapacities: ReadonlyMap<string, number>;
}

function isValidIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= IDENTIFIER_MAX_LENGTH;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeStacks(
  stacks: readonly ItemStack[],
): readonly ItemStack[] | null {
  if (stacks.length === 0) return null;
  const itemIds = new Set<string>();
  const normalized: ItemStack[] = [];
  for (const stack of stacks) {
    if (
      !isValidIdentifier(stack.itemId) ||
      !isPositiveInteger(stack.quantity) ||
      itemIds.has(stack.itemId)
    ) {
      return null;
    }
    itemIds.add(stack.itemId);
    normalized.push(Object.freeze({ ...stack }));
  }
  return Object.freeze(normalized);
}

function inferCategory(itemId: string): InventoryItemCategory {
  if (itemId.startsWith("ingredient.")) return "ingredient";
  if (itemId.startsWith("dishware.")) return "dishware";
  if (itemId.startsWith("dish.") || itemId.startsWith("meal.")) return "meal";
  return "intermediate";
}

export class InventorySystem {
  readonly #definitions = new Map<string, NormalizedContainerDefinition>();
  readonly #module: InventoryModule;
  readonly #snapshotCache = new Map<string, InventoryContainerSnapshot>();
  #snapshotCacheRevision = -1;

  constructor(
    definitions: readonly InventoryContainerDefinition[],
    initialContents: Readonly<Record<string, readonly ItemStack[]>> = {},
  ) {
    if (definitions.length === 0) {
      throw new Error("At least one inventory container is required.");
    }

    const itemIds = new Set<string>();
    for (const definition of definitions) {
      const normalized = this.#normalizeDefinition(definition);
      if (this.#definitions.has(normalized.id)) {
        throw new Error(`Invalid inventory container: ${definition.id}`);
      }
      this.#definitions.set(normalized.id, normalized);
      for (const itemId of normalized.acceptedItemIds ?? []) itemIds.add(itemId);
      for (const itemId of normalized.itemCapacities.keys()) itemIds.add(itemId);
    }
    for (const [containerId, stacks] of Object.entries(initialContents)) {
      if (!this.#definitions.has(containerId)) {
        throw new Error(
          `Initial inventory references unknown container: ${containerId}`,
        );
      }
      const normalized = normalizeStacks(stacks);
      if (normalized === null) {
        throw new Error(`Initial inventory for ${containerId} is invalid.`);
      }
      for (const stack of normalized) itemIds.add(stack.itemId);
    }
    if (itemIds.size === 0) itemIds.add(COMPATIBILITY_ITEM_ID);

    const storage = new StaticInventoryStorageDefinitions(
      [...this.#definitions.values()].map((definition) => ({
        id: definition.id,
        compartments: [{
          id: `${definition.id}.compatibility-capacity`,
          capacity: definition.capacity,
          acceptedCategories: [
            "ingredient",
            "dishware",
            "intermediate",
            "meal",
          ],
          ...(definition.acceptedItemIds === null
            ? {}
            : { acceptedItemIds: [...definition.acceptedItemIds] }),
        }],
      })),
    );
    const initialStacks = Object.entries(initialContents).flatMap(
      ([locationId, stacks]) =>
        stacks.map((stack) => Object.freeze({ ...stack, locationId })),
    );
    for (const [containerId, stacks] of Object.entries(initialContents)) {
      const rejection = this.#validateAdditionAgainst(
        containerId,
        normalizeStacks(stacks) ?? [],
        initialStacks.filter((stack) => stack.locationId !== containerId),
      );
      if (rejection !== null) {
        throw new Error(
          `Initial inventory for ${containerId} is invalid: ${rejection.message}`,
        );
      }
    }
    this.#module = new InventoryModule(
      [...itemIds].map((id) => ({
        id,
        category: inferCategory(id),
        storageMode: "stack" as const,
      })),
      storage,
      {
        schemaVersion: 1,
        revision: 0,
        stacks: Object.freeze(initialStacks),
        instances: Object.freeze([]),
        stackCargo: Object.freeze([]),
        reservations: Object.freeze([]),
        capacityReservations: Object.freeze([]),
        processedOperationIds: Object.freeze([]),
      },
    );
  }

  get inventoryModule(): InventoryModule {
    return this.#module;
  }

  getContainerSnapshot(containerId: string): InventoryContainerSnapshot {
    if (this.#snapshotCacheRevision !== this.#module.revision) {
      this.#snapshotCache.clear();
      this.#snapshotCacheRevision = this.#module.revision;
    }
    const cached = this.#snapshotCache.get(containerId);
    if (cached !== undefined) return cached;
    const definition = this.#definitions.get(containerId);
    const location = this.#module.getLocationSnapshot(containerId);
    if (definition === undefined || location === null) {
      throw new Error(`Unknown inventory container: ${containerId}`);
    }
    const entries = location.stacks
      .map((entry) => Object.freeze({
        itemId: entry.itemId,
        quantity: entry.quantity,
        reservedQuantity: entry.reservedQuantity,
        availableQuantity: entry.availableQuantity,
      }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const totalQuantity = entries.reduce(
      (sum, entry) => sum + entry.quantity,
      0,
    );
    const snapshot = Object.freeze({
      id: containerId,
      capacity: definition.capacity,
      totalQuantity,
      availableCapacity: definition.capacity - totalQuantity,
      entries: Object.freeze(entries),
    });
    this.#snapshotCache.set(containerId, snapshot);
    return snapshot;
  }

  getReservationSnapshot(
    reservationId: string,
  ): InventoryReservationSnapshot | null {
    const reservation = this.#module.getReservation(reservationId);
    if (reservation === null || reservation.stackAllocations.length === 0) {
      return null;
    }
    const containerId = reservation.stackAllocations[0]!.locationId;
    return Object.freeze({
      id: reservation.id,
      containerId,
      items: Object.freeze(
        reservation.stackAllocations.map((entry) =>
          Object.freeze({ itemId: entry.itemId, quantity: entry.quantity }),
        ),
      ),
    });
  }

  canDeposit(containerId: string, stacks: readonly ItemStack[]): boolean {
    const normalized = normalizeStacks(stacks);
    return normalized !== null &&
      this.#validateAddition(containerId, normalized) === null;
  }

  deposit(
    operationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId, stacks);
    if (!prepared.accepted) return prepared.result;
    const rejection = this.#validateAddition(containerId, prepared.items);
    if (rejection !== null) return rejection;
    return this.#result(
      operationId,
      this.#module.depositStack(
        operationId,
        containerId,
        prepared.items,
        0,
      ),
    );
  }

  withdraw(
    operationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId, stacks);
    if (!prepared.accepted) return prepared.result;
    const rejection = this.#validateAvailability(containerId, prepared.items);
    if (rejection !== null) return rejection;
    return this.#result(
      operationId,
      this.#module.withdrawStack(operationId, containerId, prepared.items, 0),
    );
  }

  transfer(
    operationId: string,
    sourceContainerId: string,
    targetContainerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId, stacks);
    if (!prepared.accepted) return prepared.result;
    if (sourceContainerId === targetContainerId) {
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        "Source and target containers must be different.",
      );
    }
    const availability = this.#validateAvailability(
      sourceContainerId,
      prepared.items,
    );
    if (availability !== null) return availability;
    const addition = this.#validateAddition(targetContainerId, prepared.items);
    if (addition !== null) return addition;
    return this.#result(
      operationId,
      this.#module.transferStack(
        operationId,
        sourceContainerId,
        targetContainerId,
        prepared.items,
        0,
      ),
    );
  }

  createReservation(
    operationId: string,
    reservationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId, stacks);
    if (!prepared.accepted) return prepared.result;
    if (!isValidIdentifier(reservationId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Reservation id is invalid.");
    }
    if (this.getReservationSnapshot(reservationId) !== null) {
      return this.#reject(
        operationId,
        "DUPLICATE_RESERVATION",
        `Reservation already exists: ${reservationId}`,
      );
    }
    const availability = this.#validateAvailability(containerId, prepared.items);
    if (availability !== null) return availability;
    return this.#result(
      operationId,
      this.#module.createReservation(operationId, {
        reservationId,
        ownerType: "compatibility.inventory-system",
        ownerId: reservationId,
        stacks: prepared.items.map((item) => ({
          ...item,
          locationId: containerId,
        })),
        createdAtUtcMs: 0,
      }),
    );
  }

  consumeReservationAndDeposit(
    operationId: string,
    reservationId: string,
    targetContainerId: string,
    outputStacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId, outputStacks, true);
    if (!prepared.accepted) return prepared.result;
    const reservation = this.getReservationSnapshot(reservationId);
    if (reservation === null) {
      return this.#reject(
        operationId,
        "UNKNOWN_RESERVATION",
        `Unknown reservation: ${reservationId}`,
      );
    }
    if (reservation.containerId === targetContainerId) {
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        "Cooking input and output containers must be different.",
      );
    }
    const addition = this.#validateAddition(targetContainerId, prepared.items);
    if (addition !== null) return addition;

    const session = this.#module.beginTransaction();
    try {
      const consumed = this.#module.consumeReservation(
        `${operationId}:consume`,
        reservationId,
        0,
      );
      if (!consumed.accepted) {
        session.rollbackTransaction();
        return this.#result(operationId, consumed);
      }
      const deposited = this.#module.depositStack(
        `${operationId}:deposit`,
        targetContainerId,
        prepared.items,
        0,
      );
      if (!deposited.accepted) {
        session.rollbackTransaction();
        return this.#result(operationId, deposited);
      }
      session.validateTransaction();
      session.commitTransaction();
      return this.#accept(operationId);
    } catch (error: unknown) {
      session.rollbackTransaction();
      throw error;
    }
  }

  consumeReservation(
    operationId: string,
    reservationId: string,
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId);
    if (!prepared.accepted) return prepared.result;
    return this.#result(
      operationId,
      this.#module.consumeReservation(operationId, reservationId, 0),
    );
  }

  releaseReservation(
    operationId: string,
    reservationId: string,
  ): InventoryOperationResult {
    const prepared = this.#prepare(operationId);
    if (!prepared.accepted) return prepared.result;
    return this.#result(
      operationId,
      this.#module.releaseReservation(operationId, reservationId, 0),
    );
  }

  #normalizeDefinition(
    definition: InventoryContainerDefinition,
  ): NormalizedContainerDefinition {
    if (!isValidIdentifier(definition.id) || !isNonNegativeInteger(definition.capacity)) {
      throw new Error(`Invalid inventory container: ${definition.id}`);
    }
    const acceptedItemIds = definition.acceptedItemIds === undefined
      ? null
      : new Set(definition.acceptedItemIds);
    if (
      acceptedItemIds !== null &&
      (acceptedItemIds.size !== definition.acceptedItemIds?.length ||
        [...acceptedItemIds].some((itemId) => !isValidIdentifier(itemId)))
    ) {
      throw new Error(`Invalid accepted items for container: ${definition.id}`);
    }
    const itemCapacities = new Map<string, number>();
    for (const [itemId, capacity] of Object.entries(
      definition.itemCapacities ?? {},
    )) {
      if (
        !isValidIdentifier(itemId) ||
        !isNonNegativeInteger(capacity) ||
        capacity > definition.capacity
      ) {
        throw new Error(`Invalid item capacity for ${definition.id}: ${itemId}`);
      }
      itemCapacities.set(itemId, capacity);
    }
    return Object.freeze({
      id: definition.id,
      capacity: definition.capacity,
      acceptedItemIds,
      itemCapacities,
    });
  }

  #prepare(
    operationId: string,
    stacks?: readonly ItemStack[],
    compound = false,
  ):
    | { readonly accepted: true; readonly items: readonly ItemStack[] }
    | { readonly accepted: false; readonly result: RejectedInventoryOperation } {
    if (!isValidIdentifier(operationId)) {
      return {
        accepted: false,
        result: this.#reject(
          operationId,
          "INVALID_OPERATION_ID",
          "Operation id is invalid.",
        ),
      };
    }
    if (
      this.#module.hasProcessedOperation(operationId) ||
      (compound && this.#module.hasProcessedOperation(`${operationId}:consume`))
    ) {
      return {
        accepted: false,
        result: this.#reject(
          operationId,
          "DUPLICATE_OPERATION",
          `Operation was already processed: ${operationId}`,
        ),
      };
    }
    if (stacks === undefined) return { accepted: true, items: [] };
    const items = normalizeStacks(stacks);
    if (items === null) {
      return {
        accepted: false,
        result: this.#reject(
          operationId,
          "INVALID_REQUEST",
          "Item stacks must be unique positive integer quantities.",
        ),
      };
    }
    return { accepted: true, items };
  }

  #validateAvailability(
    containerId: string,
    items: readonly ItemStack[],
  ): RejectedInventoryOperation | null {
    if (!this.#definitions.has(containerId)) {
      return this.#reject(
        "",
        "UNKNOWN_CONTAINER",
        `Unknown source container: ${containerId}`,
      );
    }
    const snapshot = this.getContainerSnapshot(containerId);
    for (const item of items) {
      const available = snapshot.entries.find(
        (entry) => entry.itemId === item.itemId,
      )?.availableQuantity ?? 0;
      if (available < item.quantity) {
        return this.#reject(
          "",
          "INSUFFICIENT_AVAILABLE",
          `Insufficient available quantity for item: ${item.itemId}`,
        );
      }
    }
    return null;
  }

  #validateAddition(
    containerId: string,
    items: readonly ItemStack[],
  ): RejectedInventoryOperation | null {
    const definition = this.#definitions.get(containerId);
    if (definition === undefined) {
      return this.#reject(
        "",
        "UNKNOWN_CONTAINER",
        `Unknown target container: ${containerId}`,
      );
    }
    let total = this.#module.getLocationStackQuantity(containerId);
    for (const item of items) {
      if (
        definition.acceptedItemIds !== null &&
        !definition.acceptedItemIds.has(item.itemId)
      ) {
        return this.#reject(
          "",
          "ITEM_NOT_ACCEPTED",
          `Container ${containerId} does not accept item: ${item.itemId}`,
        );
      }
      const itemCapacity = definition.itemCapacities.get(item.itemId);
      if (
        itemCapacity !== undefined &&
        this.#module.getStackQuantity(containerId, item.itemId) + item.quantity > itemCapacity
      ) {
        return this.#reject(
          "",
          "TARGET_CAPACITY_EXCEEDED",
          `Item capacity exceeded for ${item.itemId} in ${containerId}`,
        );
      }
      total += item.quantity;
    }
    return total > definition.capacity
      ? this.#reject(
          "",
          "TARGET_CAPACITY_EXCEEDED",
          `Container capacity exceeded: ${containerId}`,
        )
      : null;
  }

  #validateAdditionAgainst(
    containerId: string,
    items: readonly ItemStack[],
    stacks: readonly { readonly locationId: string; readonly itemId: string; readonly quantity: number }[],
  ): RejectedInventoryOperation | null {
    const definition = this.#definitions.get(containerId);
    if (definition === undefined) {
      return this.#reject(
        "",
        "UNKNOWN_CONTAINER",
        `Unknown target container: ${containerId}`,
      );
    }
    let total = stacks
      .filter((stack) => stack.locationId === containerId)
      .reduce((sum, stack) => sum + stack.quantity, 0);
    for (const item of items) {
      if (
        definition.acceptedItemIds !== null &&
        !definition.acceptedItemIds.has(item.itemId)
      ) {
        return this.#reject(
          "",
          "ITEM_NOT_ACCEPTED",
          `Container ${containerId} does not accept item: ${item.itemId}`,
        );
      }
      const current = stacks
        .filter((stack) =>
          stack.locationId === containerId && stack.itemId === item.itemId)
        .reduce((sum, stack) => sum + stack.quantity, 0);
      const itemCapacity = definition.itemCapacities.get(item.itemId);
      if (itemCapacity !== undefined && current + item.quantity > itemCapacity) {
        return this.#reject(
          "",
          "TARGET_CAPACITY_EXCEEDED",
          `Item capacity exceeded for ${item.itemId} in ${containerId}`,
        );
      }
      total += item.quantity;
    }
    return total > definition.capacity
      ? this.#reject(
          "",
          "TARGET_CAPACITY_EXCEEDED",
          `Container capacity exceeded: ${containerId}`,
        )
      : null;
  }

  #result(
    operationId: string,
    result: InventoryModuleOperationResult<unknown>,
  ): InventoryOperationResult {
    if (result.accepted) return this.#accept(operationId);
    const code: InventoryRejectionCode = (() => {
      switch (result.code) {
        case "DUPLICATE_OPERATION": return "DUPLICATE_OPERATION";
        case "UNKNOWN_LOCATION": return "UNKNOWN_CONTAINER";
        case "UNKNOWN_RESERVATION": return "UNKNOWN_RESERVATION";
        case "DUPLICATE_RESERVATION": return "DUPLICATE_RESERVATION";
        case "ITEM_NOT_ACCEPTED":
        case "UNKNOWN_ITEM":
        case "WRONG_STORAGE_MODE": return "ITEM_NOT_ACCEPTED";
        case "INSUFFICIENT_AVAILABLE": return "INSUFFICIENT_AVAILABLE";
        case "CAPACITY_EXCEEDED": return "TARGET_CAPACITY_EXCEEDED";
        default: return "INVALID_REQUEST";
      }
    })();
    return this.#reject(operationId, code, result.message);
  }

  #accept(operationId: string): AcceptedInventoryOperation {
    return Object.freeze({ accepted: true, operationId });
  }

  #reject(
    operationId: string,
    code: InventoryRejectionCode,
    message: string,
  ): RejectedInventoryOperation {
    return Object.freeze({ accepted: false, operationId, code, message });
  }
}