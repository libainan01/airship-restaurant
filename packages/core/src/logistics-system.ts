import {
  InventorySystem,
  type InventoryContainerSnapshot,
  type ItemStack,
} from "./inventory-system";

export type LogisticsPhase =
  | "idle"
  | "outbound"
  | "waiting-unload"
  | "returning";

export interface LogisticsSnapshot {
  readonly phase: LogisticsPhase;
  readonly shipmentId: string | null;
  readonly departedAtUtcMs: number | null;
  readonly arriveAtUtcMs: number | null;
  readonly returnStartedAtUtcMs: number | null;
  readonly returnAtUtcMs: number | null;
  readonly kitchenWaitingSinceUtcMs: number | null;
  readonly kitchenWaitingQuantity: number;
  readonly cargoQuantity: number;
  readonly totalDeliveredQuantity: number;
  readonly nextTransitionUtcMs: number | null;
}

export type LogisticsEvent =
  | {
      readonly type: "shipment.departed";
      readonly shipmentId: string;
      readonly items: readonly ItemStack[];
      readonly departedAtUtcMs: number;
      readonly arriveAtUtcMs: number;
    }
  | {
      readonly type: "shipment.arrived";
      readonly shipmentId: string;
      readonly items: readonly ItemStack[];
      readonly arrivedAtUtcMs: number;
    }
  | {
      readonly type: "shipment.blocked";
      readonly shipmentId: string;
      readonly reason: "restaurant-capacity";
      readonly atUtcMs: number;
    }
  | {
      readonly type: "shipment.returned";
      readonly shipmentId: string;
      readonly returnedAtUtcMs: number;
    };

export interface LogisticsAdvanceResult {
  readonly snapshot: LogisticsSnapshot;
  readonly events: readonly LogisticsEvent[];
}

export interface LogisticsSystemState {
  readonly phase: LogisticsPhase;
  readonly activeShipment: {
    readonly id: string;
    readonly departedAtUtcMs: number;
    readonly arriveAtUtcMs: number;
    readonly returnStartedAtUtcMs: number | null;
    readonly returnAtUtcMs: number | null;
    readonly unloadAttempt: number;
  } | null;
  readonly kitchenWaitingSinceUtcMs: number | null;
  readonly shipmentSequence: number;
  readonly totalDeliveredQuantity: number;
  readonly capacityBlockAnnounced: boolean;
}

export interface LogisticsSystemOptions {
  readonly inventory: InventorySystem;
  readonly kitchenOutputContainerId: string;
  readonly cargoContainerId: string;
  readonly restaurantContainerId: string;
  readonly cargoCapacity: number;
  readonly dispatchThreshold: number;
  readonly maximumWaitMs: number;
  readonly outboundDurationMs: number;
  readonly returnDurationMs: number;
  readonly initialState?: LogisticsSystemState;
}

interface ActiveShipment {
  readonly id: string;
  readonly departedAtUtcMs: number;
  readonly arriveAtUtcMs: number;
  readonly returnStartedAtUtcMs: number | null;
  readonly returnAtUtcMs: number | null;
  readonly unloadAttempt: number;
}

function assertUtcMs(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "Logistics UTC time must be a non-negative safe integer.",
    );
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function freezeStacks(stacks: readonly ItemStack[]): readonly ItemStack[] {
  return Object.freeze(
    stacks.map((stack) => Object.freeze({ ...stack })),
  );
}

function selectAvailableStacks(
  snapshot: InventoryContainerSnapshot,
  limit: number,
): readonly ItemStack[] {
  let remaining = limit;
  const selected: ItemStack[] = [];
  for (const entry of snapshot.entries) {
    if (remaining <= 0) {
      break;
    }
    const quantity = Math.min(entry.availableQuantity, remaining);
    if (quantity > 0) {
      selected.push({ itemId: entry.itemId, quantity });
      remaining -= quantity;
    }
  }
  return selected;
}

function sumStacks(stacks: readonly ItemStack[]): number {
  return stacks.reduce((total, stack) => total + stack.quantity, 0);
}

function safeAddTime(startUtcMs: number, durationMs: number): number {
  const result = startUtcMs + durationMs;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(
      "Logistics transition time exceeds the safe integer range.",
    );
  }
  return result;
}

export class LogisticsSystem {
  readonly #inventory: InventorySystem;
  readonly #kitchenOutputContainerId: string;
  readonly #cargoContainerId: string;
  readonly #restaurantContainerId: string;
  readonly #cargoCapacity: number;
  readonly #dispatchThreshold: number;
  readonly #maximumWaitMs: number;
  #outboundDurationMs: number;
  #returnDurationMs: number;
  #phase: LogisticsPhase = "idle";
  #activeShipment: ActiveShipment | null = null;
  #kitchenWaitingSinceUtcMs: number | null = null;
  #shipmentSequence = 0;
  #totalDeliveredQuantity = 0;
  #capacityBlockAnnounced = false;

  constructor(options: LogisticsSystemOptions) {
    if (
      !isPositiveInteger(options.cargoCapacity) ||
      !isPositiveInteger(options.dispatchThreshold) ||
      options.dispatchThreshold > options.cargoCapacity ||
      !isPositiveInteger(options.maximumWaitMs) ||
      !isPositiveInteger(options.outboundDurationMs) ||
      !isPositiveInteger(options.returnDurationMs)
    ) {
      throw new Error("Logistics timing and capacity options are invalid.");
    }

    this.#inventory = options.inventory;
    this.#kitchenOutputContainerId =
      options.kitchenOutputContainerId;
    this.#cargoContainerId = options.cargoContainerId;
    this.#restaurantContainerId = options.restaurantContainerId;
    this.#cargoCapacity = options.cargoCapacity;
    this.#dispatchThreshold = options.dispatchThreshold;
    this.#maximumWaitMs = options.maximumWaitMs;
    this.#outboundDurationMs = options.outboundDurationMs;
    this.#returnDurationMs = options.returnDurationMs;

    this.#inventory.getContainerSnapshot(
      this.#kitchenOutputContainerId,
    );
    const cargo = this.#inventory.getContainerSnapshot(
      this.#cargoContainerId,
    );
    this.#inventory.getContainerSnapshot(this.#restaurantContainerId);
    if (
      cargo.totalQuantity !== 0 &&
      options.initialState === undefined
    ) {
      throw new Error("A new LogisticsSystem requires an empty cargo hold.");
    }
    if (cargo.capacity < this.#cargoCapacity) {
      throw new Error(
        "Configured cargo capacity exceeds the inventory container.",
      );
    }

    if (options.initialState !== undefined) {
      this.#restoreState(options.initialState);
    }
  }

  setTravelDurationMs(outboundDurationMs: number, returnDurationMs: number): void {
    if (!isPositiveInteger(outboundDurationMs) || !isPositiveInteger(returnDurationMs)) {
      throw new RangeError("Logistics travel durations must be positive integers.");
    }
    this.#outboundDurationMs = outboundDurationMs;
    this.#returnDurationMs = returnDurationMs;
  }
  getSnapshot(): LogisticsSnapshot {
    const kitchen = this.#inventory.getContainerSnapshot(
      this.#kitchenOutputContainerId,
    );
    const cargo = this.#inventory.getContainerSnapshot(
      this.#cargoContainerId,
    );
    const nextTransitionUtcMs =
      this.#phase === "outbound"
        ? (this.#activeShipment?.arriveAtUtcMs ?? null)
        : this.#phase === "returning"
          ? (this.#activeShipment?.returnAtUtcMs ?? null)
          : this.#phase === "idle" &&
              this.#kitchenWaitingSinceUtcMs !== null &&
              kitchen.totalQuantity < this.#dispatchThreshold
            ? safeAddTime(
                this.#kitchenWaitingSinceUtcMs,
                this.#maximumWaitMs,
              )
            : null;

    return Object.freeze({
      phase: this.#phase,
      shipmentId: this.#activeShipment?.id ?? null,
      departedAtUtcMs:
        this.#activeShipment?.departedAtUtcMs ?? null,
      arriveAtUtcMs: this.#activeShipment?.arriveAtUtcMs ?? null,
      returnStartedAtUtcMs:
        this.#activeShipment?.returnStartedAtUtcMs ?? null,
      returnAtUtcMs: this.#activeShipment?.returnAtUtcMs ?? null,
      kitchenWaitingSinceUtcMs: this.#kitchenWaitingSinceUtcMs,
      kitchenWaitingQuantity: kitchen.totalQuantity,
      cargoQuantity: cargo.totalQuantity,
      totalDeliveredQuantity: this.#totalDeliveredQuantity,
      nextTransitionUtcMs,
    });
  }

  exportState(): LogisticsSystemState {
    return Object.freeze({
      phase: this.#phase,
      activeShipment:
        this.#activeShipment === null
          ? null
          : Object.freeze({ ...this.#activeShipment }),
      kitchenWaitingSinceUtcMs: this.#kitchenWaitingSinceUtcMs,
      shipmentSequence: this.#shipmentSequence,
      totalDeliveredQuantity: this.#totalDeliveredQuantity,
      capacityBlockAnnounced: this.#capacityBlockAnnounced,
    });
  }

  advanceTo(nowUtcMs: number): LogisticsAdvanceResult {
    assertUtcMs(nowUtcMs);
    const events: LogisticsEvent[] = [];
    this.#syncKitchenWaiting(nowUtcMs);

    switch (this.#phase) {
      case "idle":
        this.#tryDispatch(nowUtcMs, events);
        break;
      case "outbound":
        if (
          this.#activeShipment !== null &&
          nowUtcMs >= this.#activeShipment.arriveAtUtcMs
        ) {
          this.#phase = "waiting-unload";
          this.#tryUnload(
            this.#activeShipment.arriveAtUtcMs,
            events,
          );
        }
        break;
      case "waiting-unload":
        this.#tryUnload(nowUtcMs, events);
        break;
      case "returning":
        if (
          this.#activeShipment !== null &&
          this.#activeShipment.returnAtUtcMs !== null &&
          nowUtcMs >= this.#activeShipment.returnAtUtcMs
        ) {
          const shipmentId = this.#activeShipment.id;
          const returnedAtUtcMs =
            this.#activeShipment.returnAtUtcMs;
          this.#activeShipment = null;
          this.#phase = "idle";
          events.push(Object.freeze({
            type: "shipment.returned",
            shipmentId,
            returnedAtUtcMs,
          }));
          this.#syncKitchenWaiting(returnedAtUtcMs);
        }
        break;
    }

    return Object.freeze({
      snapshot: this.getSnapshot(),
      events: Object.freeze(events),
    });
  }

  #syncKitchenWaiting(nowUtcMs: number): void {
    const kitchen = this.#inventory.getContainerSnapshot(
      this.#kitchenOutputContainerId,
    );
    if (kitchen.totalQuantity === 0) {
      this.#kitchenWaitingSinceUtcMs = null;
    } else if (this.#kitchenWaitingSinceUtcMs === null) {
      this.#kitchenWaitingSinceUtcMs = nowUtcMs;
    }
  }

  #tryDispatch(
    nowUtcMs: number,
    events: LogisticsEvent[],
  ): void {
    const kitchen = this.#inventory.getContainerSnapshot(
      this.#kitchenOutputContainerId,
    );
    if (
      kitchen.totalQuantity === 0 ||
      this.#kitchenWaitingSinceUtcMs === null
    ) {
      return;
    }

    const waitedMs = nowUtcMs - this.#kitchenWaitingSinceUtcMs;
    if (
      kitchen.totalQuantity < this.#dispatchThreshold &&
      waitedMs < this.#maximumWaitMs
    ) {
      return;
    }

    const items = selectAvailableStacks(
      kitchen,
      this.#cargoCapacity,
    );
    if (items.length === 0) {
      return;
    }

    const shipmentId = `shipment-${this.#shipmentSequence + 1}`;
    const transfer = this.#inventory.transfer(
      `${shipmentId}:load`,
      this.#kitchenOutputContainerId,
      this.#cargoContainerId,
      items,
    );
    if (!transfer.accepted) {
      throw new Error(
        `Shipment load invariant failed: ${transfer.code}`,
      );
    }

    this.#shipmentSequence += 1;
    const arriveAtUtcMs = safeAddTime(
      nowUtcMs,
      this.#outboundDurationMs,
    );
    this.#activeShipment = {
      id: shipmentId,
      departedAtUtcMs: nowUtcMs,
      arriveAtUtcMs,
      returnStartedAtUtcMs: null,
      returnAtUtcMs: null,
      unloadAttempt: 0,
    };
    this.#phase = "outbound";
    this.#capacityBlockAnnounced = false;
    this.#syncKitchenWaiting(nowUtcMs);
    events.push(Object.freeze({
      type: "shipment.departed",
      shipmentId,
      items: freezeStacks(items),
      departedAtUtcMs: nowUtcMs,
      arriveAtUtcMs,
    }));
  }

  #tryUnload(
    nowUtcMs: number,
    events: LogisticsEvent[],
  ): void {
    const shipment = this.#activeShipment;
    if (shipment === null) {
      throw new Error("Waiting logistics phase has no active shipment.");
    }

    const cargo = this.#inventory.getContainerSnapshot(
      this.#cargoContainerId,
    );
    if (cargo.totalQuantity === 0) {
      this.#beginReturn(nowUtcMs);
      return;
    }

    const restaurant = this.#inventory.getContainerSnapshot(
      this.#restaurantContainerId,
    );
    const unloadCapacity = restaurant.availableCapacity;
    if (unloadCapacity <= 0) {
      this.#announceCapacityBlock(shipment.id, nowUtcMs, events);
      return;
    }

    const items = selectAvailableStacks(cargo, unloadCapacity);
    if (items.length === 0) {
      this.#announceCapacityBlock(shipment.id, nowUtcMs, events);
      return;
    }

    const transfer = this.#inventory.transfer(
      `${shipment.id}:unload:${shipment.unloadAttempt}`,
      this.#cargoContainerId,
      this.#restaurantContainerId,
      items,
    );
    if (!transfer.accepted) {
      if (transfer.code === "TARGET_CAPACITY_EXCEEDED") {
        this.#activeShipment = {
          ...shipment,
          unloadAttempt: shipment.unloadAttempt + 1,
        };
        this.#announceCapacityBlock(shipment.id, nowUtcMs, events);
        return;
      }
      throw new Error(
        `Shipment unload invariant failed: ${transfer.code}`,
      );
    }

    const deliveredQuantity = sumStacks(items);
    this.#totalDeliveredQuantity += deliveredQuantity;
    if (!Number.isSafeInteger(this.#totalDeliveredQuantity)) {
      throw new RangeError("Delivered quantity exceeds safe integer range.");
    }
    this.#activeShipment = {
      ...shipment,
      unloadAttempt: shipment.unloadAttempt + 1,
    };
    this.#capacityBlockAnnounced = false;
    events.push(Object.freeze({
      type: "shipment.arrived",
      shipmentId: shipment.id,
      items: freezeStacks(items),
      arrivedAtUtcMs: nowUtcMs,
    }));

    const remainingCargo = this.#inventory.getContainerSnapshot(
      this.#cargoContainerId,
    );
    if (remainingCargo.totalQuantity === 0) {
      this.#beginReturn(nowUtcMs);
    } else {
      this.#phase = "waiting-unload";
      this.#announceCapacityBlock(shipment.id, nowUtcMs, events);
    }
  }

  #beginReturn(nowUtcMs: number): void {
    if (this.#activeShipment === null) {
      throw new Error("Cannot return without an active shipment.");
    }
    this.#activeShipment = {
      ...this.#activeShipment,
      returnStartedAtUtcMs: nowUtcMs,
      returnAtUtcMs: safeAddTime(
        nowUtcMs,
        this.#returnDurationMs,
      ),
    };
    this.#phase = "returning";
    this.#capacityBlockAnnounced = false;
  }

  #announceCapacityBlock(
    shipmentId: string,
    atUtcMs: number,
    events: LogisticsEvent[],
  ): void {
    if (this.#capacityBlockAnnounced) {
      return;
    }
    this.#capacityBlockAnnounced = true;
    events.push(Object.freeze({
      type: "shipment.blocked",
      shipmentId,
      reason: "restaurant-capacity",
      atUtcMs,
    }));
  }

  #restoreState(state: LogisticsSystemState): void {
    if (
      (state.phase !== "idle" &&
        state.phase !== "outbound" &&
        state.phase !== "waiting-unload" &&
        state.phase !== "returning") ||
      (state.kitchenWaitingSinceUtcMs !== null &&
        !isNonNegativeInteger(state.kitchenWaitingSinceUtcMs)) ||
      !isNonNegativeInteger(state.shipmentSequence) ||
      !isNonNegativeInteger(state.totalDeliveredQuantity) ||
      typeof state.capacityBlockAnnounced !== "boolean"
    ) {
      throw new Error("Logistics restore state is invalid.");
    }

    const shipment = state.activeShipment;
    if ((state.phase === "idle") !== (shipment === null)) {
      throw new Error(
        "Logistics restore phase does not match its active shipment.",
      );
    }
    if (shipment !== null) {
      if (
        shipment.id.length === 0 ||
        shipment.id.length > 128 ||
        !isNonNegativeInteger(shipment.departedAtUtcMs) ||
        !isNonNegativeInteger(shipment.arriveAtUtcMs) ||
        shipment.arriveAtUtcMs < shipment.departedAtUtcMs ||
        (shipment.returnStartedAtUtcMs !== null &&
          !isNonNegativeInteger(shipment.returnStartedAtUtcMs)) ||
        (shipment.returnAtUtcMs !== null &&
          !isNonNegativeInteger(shipment.returnAtUtcMs)) ||
        !isNonNegativeInteger(shipment.unloadAttempt) ||
        state.shipmentSequence === 0
      ) {
        throw new Error("Active shipment restore state is invalid.");
      }
      const hasReturnTimes =
        shipment.returnStartedAtUtcMs !== null &&
        shipment.returnAtUtcMs !== null;
      if (
        (state.phase === "returning") !== hasReturnTimes ||
        (hasReturnTimes &&
          shipment.returnAtUtcMs! <
            shipment.returnStartedAtUtcMs!)
      ) {
        throw new Error(
          "Shipment return times do not match the logistics phase.",
        );
      }
    }

    const cargo = this.#inventory.getContainerSnapshot(
      this.#cargoContainerId,
    );
    const expectsCargo =
      state.phase === "outbound" ||
      state.phase === "waiting-unload";
    if (
      (expectsCargo && cargo.totalQuantity === 0) ||
      (!expectsCargo && cargo.totalQuantity !== 0)
    ) {
      throw new Error(
        "Saved cargo inventory does not match the logistics phase.",
      );
    }

    this.#phase = state.phase;
    this.#activeShipment =
      shipment === null ? null : { ...shipment };
    this.#kitchenWaitingSinceUtcMs =
      state.kitchenWaitingSinceUtcMs;
    this.#shipmentSequence = state.shipmentSequence;
    this.#totalDeliveredQuantity = state.totalDeliveredQuantity;
    this.#capacityBlockAnnounced = state.capacityBlockAnnounced;
  }
}
