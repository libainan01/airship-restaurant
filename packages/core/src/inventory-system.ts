const OPERATION_HISTORY_LIMIT = 1_024;
const IDENTIFIER_MAX_LENGTH = 128;

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

interface ContainerState {
  readonly id: string;
  readonly capacity: number;
  readonly acceptedItemIds: ReadonlySet<string> | null;
  readonly itemCapacities: ReadonlyMap<string, number>;
  readonly quantities: Map<string, number>;
  readonly reservedQuantities: Map<string, number>;
}

interface ReservationState {
  readonly id: string;
  readonly containerId: string;
  readonly items: ReadonlyMap<string, number>;
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

function sumQuantities(items: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const quantity of items.values()) {
    total += quantity;
  }
  return total;
}

function normalizeStacks(
  stacks: readonly ItemStack[],
): ReadonlyMap<string, number> | null {
  if (stacks.length === 0) {
    return null;
  }

  const normalized = new Map<string, number>();
  for (const stack of stacks) {
    if (
      !isValidIdentifier(stack.itemId) ||
      !isPositiveInteger(stack.quantity) ||
      normalized.has(stack.itemId)
    ) {
      return null;
    }
    normalized.set(stack.itemId, stack.quantity);
  }
  return normalized;
}

function getTotalQuantity(container: ContainerState): number {
  return sumQuantities(container.quantities);
}

function getAvailableQuantity(
  container: ContainerState,
  itemId: string,
): number {
  return (
    (container.quantities.get(itemId) ?? 0) -
    (container.reservedQuantities.get(itemId) ?? 0)
  );
}

export class InventorySystem {
  readonly #containers = new Map<string, ContainerState>();
  readonly #reservations = new Map<string, ReservationState>();
  readonly #processedOperationIds = new Set<string>();
  readonly #operationHistory: string[] = [];

  constructor(
    definitions: readonly InventoryContainerDefinition[],
    initialContents: Readonly<Record<string, readonly ItemStack[]>> = {},
  ) {
    if (definitions.length === 0) {
      throw new Error("At least one inventory container is required.");
    }

    for (const definition of definitions) {
      this.#registerContainer(definition);
    }

    for (const [containerId, stacks] of Object.entries(initialContents)) {
      const container = this.#containers.get(containerId);
      if (container === undefined) {
        throw new Error(
          `Initial inventory references unknown container: ${containerId}`,
        );
      }
      const normalized = normalizeStacks(stacks);
      if (normalized === null) {
        throw new Error(
          `Initial inventory for ${containerId} is invalid.`,
        );
      }
      const rejection = this.#validateAddition(container, normalized);
      if (rejection !== null) {
        throw new Error(
          `Initial inventory for ${containerId} is invalid: ${rejection.message}`,
        );
      }
      for (const [itemId, quantity] of normalized) {
        container.quantities.set(itemId, quantity);
      }
    }
  }

  getContainerSnapshot(containerId: string): InventoryContainerSnapshot {
    const container = this.#containers.get(containerId);
    if (container === undefined) {
      throw new Error(`Unknown inventory container: ${containerId}`);
    }

    const itemIds = new Set([
      ...container.quantities.keys(),
      ...container.reservedQuantities.keys(),
    ]);
    const entries = [...itemIds]
      .sort()
      .map((itemId): InventoryEntrySnapshot => {
        const quantity = container.quantities.get(itemId) ?? 0;
        const reservedQuantity =
          container.reservedQuantities.get(itemId) ?? 0;
        return Object.freeze({
          itemId,
          quantity,
          reservedQuantity,
          availableQuantity: quantity - reservedQuantity,
        });
      });
    const totalQuantity = getTotalQuantity(container);

    return Object.freeze({
      id: container.id,
      capacity: container.capacity,
      totalQuantity,
      availableCapacity: container.capacity - totalQuantity,
      entries: Object.freeze(entries),
    });
  }

  getReservationSnapshot(
    reservationId: string,
  ): InventoryReservationSnapshot | null {
    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      return null;
    }

    return Object.freeze({
      id: reservation.id,
      containerId: reservation.containerId,
      items: Object.freeze(
        [...reservation.items].map(([itemId, quantity]) =>
          Object.freeze({ itemId, quantity }),
        ),
      ),
    });
  }

  canDeposit(
    containerId: string,
    stacks: readonly ItemStack[],
  ): boolean {
    const container = this.#containers.get(containerId);
    const normalized = normalizeStacks(stacks);
    return (
      container !== undefined &&
      normalized !== null &&
      this.#validateAddition(container, normalized) === null
    );
  }

  deposit(
    operationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId, stacks);
    if (!preparation.accepted) {
      return preparation.result;
    }

    const container = this.#containers.get(containerId);
    if (container === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_CONTAINER",
        `Unknown target container: ${containerId}`,
      );
    }

    const rejection = this.#validateAddition(
      container,
      preparation.items,
    );
    if (rejection !== null) {
      return this.#reject(operationId, rejection.code, rejection.message);
    }

    for (const [itemId, quantity] of preparation.items) {
      container.quantities.set(
        itemId,
        (container.quantities.get(itemId) ?? 0) + quantity,
      );
    }
    return this.#accept(operationId);
  }

  withdraw(
    operationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId, stacks);
    if (!preparation.accepted) {
      return preparation.result;
    }

    const container = this.#containers.get(containerId);
    if (container === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_CONTAINER",
        `Unknown source container: ${containerId}`,
      );
    }

    const availabilityRejection = this.#validateAvailability(
      container,
      preparation.items,
    );
    if (availabilityRejection !== null) {
      return this.#reject(
        operationId,
        availabilityRejection.code,
        availabilityRejection.message,
      );
    }

    this.#subtractItems(container, preparation.items);
    return this.#accept(operationId);
  }

  transfer(
    operationId: string,
    sourceContainerId: string,
    targetContainerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId, stacks);
    if (!preparation.accepted) {
      return preparation.result;
    }

    const source = this.#containers.get(sourceContainerId);
    const target = this.#containers.get(targetContainerId);
    if (source === undefined || target === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_CONTAINER",
        "Source or target inventory container is unknown.",
      );
    }
    if (source === target) {
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        "Source and target containers must be different.",
      );
    }

    const availabilityRejection = this.#validateAvailability(
      source,
      preparation.items,
    );
    if (availabilityRejection !== null) {
      return this.#reject(
        operationId,
        availabilityRejection.code,
        availabilityRejection.message,
      );
    }
    const additionRejection = this.#validateAddition(
      target,
      preparation.items,
    );
    if (additionRejection !== null) {
      return this.#reject(
        operationId,
        additionRejection.code,
        additionRejection.message,
      );
    }

    this.#subtractItems(source, preparation.items);
    for (const [itemId, quantity] of preparation.items) {
      target.quantities.set(
        itemId,
        (target.quantities.get(itemId) ?? 0) + quantity,
      );
    }
    return this.#accept(operationId);
  }

  createReservation(
    operationId: string,
    reservationId: string,
    containerId: string,
    stacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId, stacks);
    if (!preparation.accepted) {
      return preparation.result;
    }
    if (!isValidIdentifier(reservationId)) {
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        "Reservation id is invalid.",
      );
    }
    if (this.#reservations.has(reservationId)) {
      return this.#reject(
        operationId,
        "DUPLICATE_RESERVATION",
        `Reservation already exists: ${reservationId}`,
      );
    }

    const container = this.#containers.get(containerId);
    if (container === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_CONTAINER",
        `Unknown reservation container: ${containerId}`,
      );
    }
    const availabilityRejection = this.#validateAvailability(
      container,
      preparation.items,
    );
    if (availabilityRejection !== null) {
      return this.#reject(
        operationId,
        availabilityRejection.code,
        availabilityRejection.message,
      );
    }

    for (const [itemId, quantity] of preparation.items) {
      container.reservedQuantities.set(
        itemId,
        (container.reservedQuantities.get(itemId) ?? 0) + quantity,
      );
    }
    this.#reservations.set(reservationId, {
      id: reservationId,
      containerId,
      items: preparation.items,
    });
    return this.#accept(operationId);
  }

  consumeReservationAndDeposit(
    operationId: string,
    reservationId: string,
    targetContainerId: string,
    outputStacks: readonly ItemStack[],
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(
      operationId,
      outputStacks,
    );
    if (!preparation.accepted) {
      return preparation.result;
    }

    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_RESERVATION",
        `Unknown reservation: ${reservationId}`,
      );
    }
    const source = this.#containers.get(reservation.containerId);
    const target = this.#containers.get(targetContainerId);
    if (source === undefined || target === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_CONTAINER",
        "Reservation source or output target container is unknown.",
      );
    }
    if (source === target) {
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        "Cooking input and output containers must be different.",
      );
    }

    const additionRejection = this.#validateAddition(
      target,
      preparation.items,
    );
    if (additionRejection !== null) {
      return this.#reject(
        operationId,
        additionRejection.code,
        additionRejection.message,
      );
    }

    this.#subtractItems(source, reservation.items);
    this.#subtractReservedItems(source, reservation.items);
    for (const [itemId, quantity] of preparation.items) {
      target.quantities.set(
        itemId,
        (target.quantities.get(itemId) ?? 0) + quantity,
      );
    }
    this.#reservations.delete(reservationId);
    return this.#accept(operationId);
  }

  consumeReservation(
    operationId: string,
    reservationId: string,
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId);
    if (!preparation.accepted) {
      return preparation.result;
    }

    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_RESERVATION",
        `Unknown reservation: ${reservationId}`,
      );
    }
    const container = this.#containers.get(reservation.containerId);
    if (container === undefined) {
      throw new Error(
        `Reservation references missing container: ${reservation.containerId}`,
      );
    }

    this.#subtractItems(container, reservation.items);
    this.#subtractReservedItems(container, reservation.items);
    this.#reservations.delete(reservationId);
    return this.#accept(operationId);
  }

  releaseReservation(
    operationId: string,
    reservationId: string,
  ): InventoryOperationResult {
    const preparation = this.#prepareOperation(operationId);
    if (!preparation.accepted) {
      return preparation.result;
    }

    const reservation = this.#reservations.get(reservationId);
    if (reservation === undefined) {
      return this.#reject(
        operationId,
        "UNKNOWN_RESERVATION",
        `Unknown reservation: ${reservationId}`,
      );
    }
    const container = this.#containers.get(reservation.containerId);
    if (container === undefined) {
      throw new Error(
        `Reservation references missing container: ${reservation.containerId}`,
      );
    }

    this.#subtractReservedItems(container, reservation.items);
    this.#reservations.delete(reservationId);
    return this.#accept(operationId);
  }

  #registerContainer(definition: InventoryContainerDefinition): void {
    if (
      !isValidIdentifier(definition.id) ||
      !isNonNegativeInteger(definition.capacity) ||
      this.#containers.has(definition.id)
    ) {
      throw new Error(`Invalid inventory container: ${definition.id}`);
    }

    const acceptedItemIds =
      definition.acceptedItemIds === undefined
        ? null
        : new Set(definition.acceptedItemIds);
    if (
      acceptedItemIds !== null &&
      (acceptedItemIds.size !== definition.acceptedItemIds?.length ||
        [...acceptedItemIds].some((itemId) => !isValidIdentifier(itemId)))
    ) {
      throw new Error(
        `Invalid accepted items for container: ${definition.id}`,
      );
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
        throw new Error(
          `Invalid item capacity for ${definition.id}: ${itemId}`,
        );
      }
      itemCapacities.set(itemId, capacity);
    }

    this.#containers.set(definition.id, {
      id: definition.id,
      capacity: definition.capacity,
      acceptedItemIds,
      itemCapacities,
      quantities: new Map(),
      reservedQuantities: new Map(),
    });
  }

  #prepareOperation(
    operationId: string,
    stacks?: readonly ItemStack[],
  ):
    | {
        readonly accepted: true;
        readonly items: ReadonlyMap<string, number>;
      }
    | {
        readonly accepted: false;
        readonly result: RejectedInventoryOperation;
      } {
    if (!isValidIdentifier(operationId)) {
      return {
        accepted: false,
        result: this.#rejectWithoutRemembering(
          operationId,
          "INVALID_OPERATION_ID",
          "Operation id is invalid.",
        ),
      };
    }
    if (this.#processedOperationIds.has(operationId)) {
      return {
        accepted: false,
        result: this.#rejectWithoutRemembering(
          operationId,
          "DUPLICATE_OPERATION",
          `Operation was already processed: ${operationId}`,
        ),
      };
    }

    this.#rememberOperation(operationId);
    if (stacks === undefined) {
      return { accepted: true, items: new Map() };
    }

    const normalized = normalizeStacks(stacks);
    if (normalized === null) {
      return {
        accepted: false,
        result: this.#rejectWithoutRemembering(
          operationId,
          "INVALID_REQUEST",
          "Item stacks must be unique positive integer quantities.",
        ),
      };
    }
    return { accepted: true, items: normalized };
  }

  #validateAvailability(
    container: ContainerState,
    items: ReadonlyMap<string, number>,
  ): RejectedInventoryOperation | null {
    for (const [itemId, quantity] of items) {
      if (getAvailableQuantity(container, itemId) < quantity) {
        return this.#rejectWithoutRemembering(
          "",
          "INSUFFICIENT_AVAILABLE",
          `Insufficient available quantity for item: ${itemId}`,
        );
      }
    }
    return null;
  }

  #validateAddition(
    container: ContainerState,
    items: ReadonlyMap<string, number>,
  ): RejectedInventoryOperation | null {
    for (const [itemId, quantity] of items) {
      if (
        container.acceptedItemIds !== null &&
        !container.acceptedItemIds.has(itemId)
      ) {
        return this.#rejectWithoutRemembering(
          "",
          "ITEM_NOT_ACCEPTED",
          `Container ${container.id} does not accept item: ${itemId}`,
        );
      }
      const itemCapacity = container.itemCapacities.get(itemId);
      if (
        itemCapacity !== undefined &&
        (container.quantities.get(itemId) ?? 0) + quantity >
          itemCapacity
      ) {
        return this.#rejectWithoutRemembering(
          "",
          "TARGET_CAPACITY_EXCEEDED",
          `Item capacity exceeded for ${itemId} in ${container.id}`,
        );
      }
    }

    if (
      getTotalQuantity(container) + sumQuantities(items) >
      container.capacity
    ) {
      return this.#rejectWithoutRemembering(
        "",
        "TARGET_CAPACITY_EXCEEDED",
        `Container capacity exceeded: ${container.id}`,
      );
    }
    return null;
  }

  #subtractItems(
    container: ContainerState,
    items: ReadonlyMap<string, number>,
  ): void {
    for (const [itemId, quantity] of items) {
      const nextQuantity =
        (container.quantities.get(itemId) ?? 0) - quantity;
      if (nextQuantity === 0) {
        container.quantities.delete(itemId);
      } else {
        container.quantities.set(itemId, nextQuantity);
      }
    }
  }

  #subtractReservedItems(
    container: ContainerState,
    items: ReadonlyMap<string, number>,
  ): void {
    for (const [itemId, quantity] of items) {
      const nextQuantity =
        (container.reservedQuantities.get(itemId) ?? 0) - quantity;
      if (nextQuantity === 0) {
        container.reservedQuantities.delete(itemId);
      } else {
        container.reservedQuantities.set(itemId, nextQuantity);
      }
    }
  }

  #rememberOperation(operationId: string): void {
    this.#processedOperationIds.add(operationId);
    this.#operationHistory.push(operationId);
    if (this.#operationHistory.length <= OPERATION_HISTORY_LIMIT) {
      return;
    }

    const oldestOperationId = this.#operationHistory.shift();
    if (oldestOperationId !== undefined) {
      this.#processedOperationIds.delete(oldestOperationId);
    }
  }

  #accept(operationId: string): AcceptedInventoryOperation {
    return Object.freeze({ accepted: true, operationId });
  }

  #reject(
    operationId: string,
    code: InventoryRejectionCode,
    message: string,
  ): RejectedInventoryOperation {
    return this.#rejectWithoutRemembering(operationId, code, message);
  }

  #rejectWithoutRemembering(
    operationId: string,
    code: InventoryRejectionCode,
    message: string,
  ): RejectedInventoryOperation {
    return Object.freeze({
      accepted: false,
      operationId,
      code,
      message,
    });
  }
}
