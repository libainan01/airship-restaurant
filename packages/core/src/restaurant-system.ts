import { InventorySystem } from "./inventory-system";
import type { RandomSource } from "./random-source";

const OPERATION_HISTORY_LIMIT = 512;
const RECENT_SALES_LIMIT = 20;
const IDENTIFIER_MAX_LENGTH = 128;
const DEFAULT_SEATED_IDLE_DURATION_MS = 8_000;
const DEFAULT_OTTO_APPROACH_DURATION_MS = 3_200;
const DEFAULT_ORDER_CONFIRMATION_DURATION_MS = 1_800;
const DEFAULT_KITCHEN_NOTIFICATION_DURATION_MS = 1_500;
const DEFAULT_MINIMUM_PREPARATION_DURATION_MS = 5_000;
const DEFAULT_SEAT_CAPACITY = 3;
const DEFAULT_DINING_DURATION_MS = 12_000;

export interface RestaurantMenuItem {
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly unitPriceCopper: number;
}

export type RestaurantCustomerPhase =
  | "seated-idle"
  | "awaiting-order-confirmation"
  | "confirming-order"
  | "notifying-kitchen"
  | "waiting-meal";

export interface RestaurantCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly arrivedAtUtcMs: number;
  readonly leaveAtUtcMs: number;
  readonly phase: RestaurantCustomerPhase;
  readonly phaseEndsAtUtcMs: number | null;
}

export interface RestaurantDiningCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly diningStartedAtUtcMs: number;
  readonly departAtUtcMs: number;
}

export interface RestaurantOrderSnapshot {
  readonly customerId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
}

export interface KitchenOrderNotificationPlan {
  readonly channelId: string;
  readonly sentAtUtcMs: number;
  readonly receivedAtUtcMs: number;
}

export interface KitchenOrderNotificationChannel {
  createNotification(
    order: RestaurantOrderSnapshot,
    sentAtUtcMs: number,
  ): KitchenOrderNotificationPlan;
}

export class FixedDelayKitchenOrderNotificationChannel
implements KitchenOrderNotificationChannel {
  readonly #delayMs: number;

  constructor(delayMs = DEFAULT_KITCHEN_NOTIFICATION_DURATION_MS) {
    if (!isPositiveInteger(delayMs)) {
      throw new Error("Kitchen notification delay must be a positive integer.");
    }
    this.#delayMs = delayMs;
  }

  createNotification(
    _order: RestaurantOrderSnapshot,
    sentAtUtcMs: number,
  ): KitchenOrderNotificationPlan {
    return Object.freeze({
      channelId: "fixed-delay-placeholder",
      sentAtUtcMs,
      receivedAtUtcMs: safeAdd(
        sentAtUtcMs,
        this.#delayMs,
        "Kitchen notification receipt time",
      ),
    });
  }
}

export interface RestaurantSaleSnapshot {
  readonly customerId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly quantity: 1;
  readonly copperEarned: number;
  readonly soldAtUtcMs: number;
}

export interface DishSalesSnapshot {
  readonly dishItemId: string;
  readonly quantity: number;
}

export interface RestaurantSnapshot {
  readonly selectedRecipeId: string | null;
  readonly activeCustomer: RestaurantCustomerSnapshot | null;
  readonly diningCustomers: readonly RestaurantDiningCustomerSnapshot[];
  readonly seatCapacity: number;
  readonly nextCustomerAtUtcMs: number | null;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
  readonly totalCopperSpent: number;
  readonly soldByDish: readonly DishSalesSnapshot[];
  readonly recentSales: readonly RestaurantSaleSnapshot[];
  readonly nextTransitionUtcMs: number | null;
}

export type RestaurantEvent =
  | {
      readonly type: "customer.arrived";
      readonly customer: RestaurantCustomerSnapshot;
    }
  | {
      readonly type: "order.requested";
      readonly order: RestaurantOrderSnapshot;
      readonly requestedAtUtcMs: number;
    }
  | {
      readonly type: "order.confirmation-started";
      readonly order: RestaurantOrderSnapshot;
      readonly startedAtUtcMs: number;
    }
  | {
      readonly type: "order.confirmed";
      readonly order: RestaurantOrderSnapshot;
      readonly confirmedAtUtcMs: number;
    }
  | {
      readonly type: "kitchen.notification-sent";
      readonly order: RestaurantOrderSnapshot;
      readonly channelId: string;
      readonly sentAtUtcMs: number;
      readonly expectedReceiptAtUtcMs: number;
    }
  | {
      readonly type: "kitchen.order-received";
      readonly order: RestaurantOrderSnapshot;
      readonly channelId: string;
      readonly receivedAtUtcMs: number;
    }
  | {
      readonly type: "order.fulfilled";
      readonly sale: RestaurantSaleSnapshot;
    }
  | {
      readonly type: "customer.dining-completed";
      readonly customer: RestaurantDiningCustomerSnapshot;
      readonly completedAtUtcMs: number;
    }
  | {
      readonly type: "customer.left";
      readonly customerId: string;
      readonly recipeId: string;
      readonly leftAtUtcMs: number;
      readonly reason: "out-of-stock" | "wait-timeout";
    }
  | {
      readonly type: "currency.changed";
      readonly deltaCopper: number;
      readonly copperBalance: number;
      readonly atUtcMs: number;
    };

export interface RestaurantAdvanceResult {
  readonly snapshot: RestaurantSnapshot;
  readonly events: readonly RestaurantEvent[];
}

export type RestaurantRejectionCode =
  | "INVALID_OPERATION_ID"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_MENU_ITEM";

export type RestaurantActionResult =
  | {
      readonly accepted: true;
      readonly operationId: string;
      readonly snapshot: RestaurantSnapshot;
    }
  | {
      readonly accepted: false;
      readonly operationId: string;
      readonly code: RestaurantRejectionCode;
      readonly message: string;
      readonly snapshot: RestaurantSnapshot;
    };

export interface RestaurantSystemState {
  readonly selectedRecipeId: string | null;
  readonly activeCustomer: {
    readonly id: string;
    readonly recipeId: string;
    readonly dishItemId: string;
    readonly arrivedAtUtcMs: number;
    readonly leaveAtUtcMs: number;
    readonly fulfillmentAttempt: number;
    readonly phase?: RestaurantCustomerPhase;
    readonly phaseEndsAtUtcMs?: number | null;
    readonly notificationChannelId?: string | null;
  } | null;
  readonly diningCustomers?: readonly RestaurantDiningCustomerSnapshot[];
  readonly nextCustomerAtUtcMs: number | null;
  readonly customerSequence: number;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
  readonly totalCopperSpent?: number;
  readonly soldByDish: readonly DishSalesSnapshot[];
  readonly recentSales: readonly RestaurantSaleSnapshot[];
}

export interface RestaurantFinancePort {
  getSnapshot(): {
    readonly balanceCopper: number;
    readonly totalCopperSpent: number;
  };
  recordSale(sale: RestaurantSaleSnapshot): void;
}
export interface RestaurantSystemOptions {
  readonly inventory: InventorySystem;
  readonly restaurantContainerId: string;
  readonly menuItems: readonly RestaurantMenuItem[];
  readonly random: RandomSource;
  readonly minimumArrivalIntervalMs: number;
  readonly maximumArrivalIntervalMs: number;
  readonly maximumWaitMs: number;
  readonly seatedIdleDurationMs?: number;
  readonly ottoApproachDurationMs?: number;
  readonly orderConfirmationDurationMs?: number;
  readonly minimumPreparationDurationMs?: number;
  readonly seatCapacity?: number;
  readonly diningDurationMs?: number;
  readonly kitchenNotificationChannel?: KitchenOrderNotificationChannel;
  readonly finance?: RestaurantFinancePort;
  readonly initialCopper?: number;
  readonly initialState?: RestaurantSystemState;
}

interface ActiveCustomer {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly arrivedAtUtcMs: number;
  readonly leaveAtUtcMs: number;
  readonly fulfillmentAttempt: number;
  readonly phase: RestaurantCustomerPhase;
  readonly phaseEndsAtUtcMs: number | null;
  readonly notificationChannelId: string | null;
}

function isValidIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= IDENTIFIER_MAX_LENGTH;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertUtcMs(value: number): void {
  if (!isNonNegativeInteger(value)) {
    throw new RangeError(
      "Restaurant UTC time must be a non-negative safe integer.",
    );
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return result;
}

export class RestaurantSystem {
  readonly #inventory: InventorySystem;
  readonly #restaurantContainerId: string;
  readonly #menuItems = new Map<string, RestaurantMenuItem>();
  readonly #menuItemsByDish = new Map<string, RestaurantMenuItem>();
  readonly #random: RandomSource;
  readonly #minimumArrivalIntervalMs: number;
  readonly #maximumArrivalIntervalMs: number;
  readonly #maximumWaitMs: number;
  readonly #seatedIdleDurationMs: number;
  readonly #ottoApproachDurationMs: number;
  readonly #orderConfirmationDurationMs: number;
  readonly #minimumPreparationDurationMs: number;
  #seatCapacity: number;
  #customerArrivalIntervalRateBasisPoints = 10_000;
  readonly #diningDurationMs: number;
  readonly #kitchenNotificationChannel: KitchenOrderNotificationChannel;
  readonly #finance: RestaurantFinancePort | null;
  readonly #processedOperationIds = new Set<string>();
  readonly #operationHistory: string[] = [];
  readonly #soldByDish = new Map<string, number>();
  readonly #recentSales: RestaurantSaleSnapshot[] = [];
  #selectedRecipeId: string | null = null;
  #activeCustomer: ActiveCustomer | null = null;
  readonly #diningCustomers: RestaurantDiningCustomerSnapshot[] = [];
  #nextCustomerAtUtcMs: number | null = null;
  #customerSequence = 0;
  #totalSoldQuantity = 0;
  #totalCustomersLeft = 0;
  #copperBalance: number;
  #totalCopperSpent = 0;
  #lastFulfillmentAttemptSignature: string | null = null;

  constructor(options: RestaurantSystemOptions) {
    if (
      options.menuItems.length === 0 ||
      !isPositiveInteger(options.minimumArrivalIntervalMs) ||
      !isPositiveInteger(options.maximumArrivalIntervalMs) ||
      options.maximumArrivalIntervalMs <
        options.minimumArrivalIntervalMs ||
      !isPositiveInteger(options.maximumWaitMs) ||
      !isPositiveInteger(options.seatedIdleDurationMs ?? DEFAULT_SEATED_IDLE_DURATION_MS) ||
      !isPositiveInteger(options.ottoApproachDurationMs ?? DEFAULT_OTTO_APPROACH_DURATION_MS) ||
      !isPositiveInteger(options.orderConfirmationDurationMs ?? DEFAULT_ORDER_CONFIRMATION_DURATION_MS) ||
      !isPositiveInteger(options.minimumPreparationDurationMs ?? DEFAULT_MINIMUM_PREPARATION_DURATION_MS) ||
      !isPositiveInteger(options.seatCapacity ?? DEFAULT_SEAT_CAPACITY) ||
      !isPositiveInteger(options.diningDurationMs ?? DEFAULT_DINING_DURATION_MS) ||
      !isNonNegativeInteger(options.initialCopper ?? 0)
    ) {
      throw new Error("RestaurantSystem options are invalid.");
    }

    this.#inventory = options.inventory;
    this.#restaurantContainerId = options.restaurantContainerId;
    this.#random = options.random;
    this.#minimumArrivalIntervalMs =
      options.minimumArrivalIntervalMs;
    this.#maximumArrivalIntervalMs =
      options.maximumArrivalIntervalMs;
    this.#maximumWaitMs = options.maximumWaitMs;
    this.#seatedIdleDurationMs = options.seatedIdleDurationMs ?? DEFAULT_SEATED_IDLE_DURATION_MS;
    this.#ottoApproachDurationMs = options.ottoApproachDurationMs ?? DEFAULT_OTTO_APPROACH_DURATION_MS;
    this.#orderConfirmationDurationMs = options.orderConfirmationDurationMs ?? DEFAULT_ORDER_CONFIRMATION_DURATION_MS;
    this.#minimumPreparationDurationMs = options.minimumPreparationDurationMs ?? DEFAULT_MINIMUM_PREPARATION_DURATION_MS;
    this.#seatCapacity = options.seatCapacity ?? DEFAULT_SEAT_CAPACITY;
    this.#diningDurationMs = options.diningDurationMs ?? DEFAULT_DINING_DURATION_MS;
    this.#kitchenNotificationChannel = options.kitchenNotificationChannel ??
      new FixedDelayKitchenOrderNotificationChannel();
    this.#finance = options.finance ?? null;
    this.#copperBalance = options.initialCopper ?? 0;

    this.#inventory.getContainerSnapshot(
      this.#restaurantContainerId,
    );
    for (const item of options.menuItems) {
      if (
        !isValidIdentifier(item.recipeId) ||
        !isValidIdentifier(item.dishItemId) ||
        !isPositiveInteger(item.unitPriceCopper) ||
        this.#menuItems.has(item.recipeId) ||
        this.#menuItemsByDish.has(item.dishItemId)
      ) {
        throw new Error(
          `Invalid restaurant menu item: ${item.recipeId}`,
        );
      }
      const frozenItem = Object.freeze({ ...item });
      this.#menuItems.set(item.recipeId, frozenItem);
      this.#menuItemsByDish.set(item.dishItemId, frozenItem);
    }

    if (options.initialState !== undefined) {
      this.#restoreState(options.initialState);
    }
  }

  setSeatCapacity(seatCapacity: number): void {
    if (!isPositiveInteger(seatCapacity) || seatCapacity < this.#diningCustomers.length) {
      throw new RangeError("Restaurant seat capacity is invalid.");
    }
    this.#seatCapacity = seatCapacity;
  }

  setCustomerArrivalIntervalRateBasisPoints(rateBasisPoints: number): boolean {
    if (!isPositiveInteger(rateBasisPoints) || rateBasisPoints > 10_000) {
      throw new RangeError("Restaurant customer arrival interval rate is invalid.");
    }
    if (this.#customerArrivalIntervalRateBasisPoints === rateBasisPoints) {
      return false;
    }
    this.#customerArrivalIntervalRateBasisPoints = rateBasisPoints;
    return true;
  }

  #getCopperSnapshot(): { readonly balanceCopper: number; readonly totalCopperSpent: number } {
    return this.#finance?.getSnapshot() ?? Object.freeze({
      balanceCopper: this.#copperBalance,
      totalCopperSpent: this.#totalCopperSpent,
    });
  }
  getSnapshot(): RestaurantSnapshot {
    const activeCustomer =
      this.#activeCustomer === null
        ? null
        : Object.freeze({
            id: this.#activeCustomer.id,
            recipeId: this.#activeCustomer.recipeId,
            dishItemId: this.#activeCustomer.dishItemId,
            arrivedAtUtcMs: this.#activeCustomer.arrivedAtUtcMs,
            leaveAtUtcMs: this.#activeCustomer.leaveAtUtcMs,
            phase: this.#activeCustomer.phase,
            phaseEndsAtUtcMs: this.#activeCustomer.phaseEndsAtUtcMs,
          });
    const diningCustomers = Object.freeze(
      this.#diningCustomers.map((customer) => Object.freeze({ ...customer })),
    );
    const soldByDish = [...this.#soldByDish]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dishItemId, quantity]) =>
        Object.freeze({ dishItemId, quantity }),
      );

    const copper = this.#getCopperSnapshot();
    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      activeCustomer,
      diningCustomers,
      seatCapacity: this.#seatCapacity,
      nextCustomerAtUtcMs: this.#nextCustomerAtUtcMs,
      totalSoldQuantity: this.#totalSoldQuantity,
      totalCustomersLeft: this.#totalCustomersLeft,
      copperBalance: copper.balanceCopper,
      totalCopperSpent: copper.totalCopperSpent,
      soldByDish: Object.freeze(soldByDish),
      recentSales: Object.freeze([...this.#recentSales]),
      nextTransitionUtcMs: [
        this.#nextCustomerAtUtcMs,
        activeCustomer === null
          ? null
          : Math.min(
              activeCustomer.leaveAtUtcMs,
              activeCustomer.phaseEndsAtUtcMs ?? activeCustomer.leaveAtUtcMs,
            ),
        ...diningCustomers.map((customer) => customer.departAtUtcMs),
      ].reduce<number | null>(
        (minimum, value) =>
          value !== null && (minimum === null || value < minimum)
            ? value
            : minimum,
        null,
      ),
    });
  }

  exportState(): RestaurantSystemState {
    const copper = this.#getCopperSnapshot();
    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      activeCustomer:
        this.#activeCustomer === null
          ? null
          : Object.freeze({ ...this.#activeCustomer }),
      diningCustomers: Object.freeze(
        this.#diningCustomers.map((customer) => Object.freeze({ ...customer })),
      ),
      nextCustomerAtUtcMs: this.#nextCustomerAtUtcMs,
      customerSequence: this.#customerSequence,
      totalSoldQuantity: this.#totalSoldQuantity,
      totalCustomersLeft: this.#totalCustomersLeft,
      copperBalance: copper.balanceCopper,
      totalCopperSpent: copper.totalCopperSpent,
      soldByDish: Object.freeze(
        [...this.#soldByDish].map(([dishItemId, quantity]) =>
          Object.freeze({ dishItemId, quantity }),
        ),
      ),
      recentSales: Object.freeze(
        this.#recentSales.map((sale) => Object.freeze({ ...sale })),
      ),
    });
  }

  selectMenuItem(
    operationId: string,
    recipeId: string,
    nowUtcMs: number,
  ): RestaurantActionResult {
    assertUtcMs(nowUtcMs);
    const duplicate = this.#prepareOperation(operationId);
    if (duplicate !== null) {
      return duplicate;
    }
    if (!this.#menuItems.has(recipeId)) {
      return this.#reject(
        operationId,
        "UNKNOWN_MENU_ITEM",
        `Unknown restaurant menu item: ${recipeId}`,
      );
    }

    this.#selectedRecipeId = recipeId;
    if (
      this.#activeCustomer === null &&
      this.#nextCustomerAtUtcMs === null
    ) {
      this.#scheduleNextCustomer(nowUtcMs);
    }
    return this.#accept(operationId);
  }

  advanceTo(nowUtcMs: number): RestaurantAdvanceResult {
    assertUtcMs(nowUtcMs);
    const events: RestaurantEvent[] = [];
    this.#completeDiningCustomers(nowUtcMs, events);

    if (this.#activeCustomer !== null) {
      this.#advanceActiveCustomer(nowUtcMs, events);
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: Object.freeze(events),
      });
    }

    if (
      this.#selectedRecipeId === null ||
      this.#nextCustomerAtUtcMs === null ||
      nowUtcMs < this.#nextCustomerAtUtcMs
    ) {
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: Object.freeze(events),
      });
    }

    if (this.#diningCustomers.length >= this.#seatCapacity) {
      this.#nextCustomerAtUtcMs = Math.min(
        ...this.#diningCustomers.map((customer) => customer.departAtUtcMs),
      );
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: Object.freeze(events),
      });
    }

    const menuItem = this.#chooseCustomerMenuItem(
      this.#selectedRecipeId,
    );
    const arrivedAtUtcMs = this.#nextCustomerAtUtcMs;
    const customerId = `customer-${this.#customerSequence + 1}`;
    this.#customerSequence += 1;
    this.#activeCustomer = {
      id: customerId,
      recipeId: menuItem.recipeId,
      dishItemId: menuItem.dishItemId,
      arrivedAtUtcMs,
      leaveAtUtcMs: safeAdd(
        arrivedAtUtcMs,
        this.#maximumWaitMs,
        "Customer leave time",
      ),
      fulfillmentAttempt: 0,
      phase: "seated-idle",
      phaseEndsAtUtcMs: safeAdd(
        arrivedAtUtcMs,
        this.#seatedIdleDurationMs,
        "Customer order decision time",
      ),
      notificationChannelId: null,
    };
    this.#lastFulfillmentAttemptSignature = null;
    this.#nextCustomerAtUtcMs = null;
    events.push(Object.freeze({
      type: "customer.arrived",
      customer: this.getSnapshot()
        .activeCustomer as RestaurantCustomerSnapshot,
    }));

    return Object.freeze({
      snapshot: this.getSnapshot(),
      events: Object.freeze(events),
    });
  }

  #advanceActiveCustomer(
    nowUtcMs: number,
    events: RestaurantEvent[],
  ): void {
    while (this.#activeCustomer !== null) {
      const customer = this.#activeCustomer;
      const phaseTransitionAtUtcMs = customer.phaseEndsAtUtcMs;
      const nextTransitionAtUtcMs = Math.min(
        customer.leaveAtUtcMs,
        phaseTransitionAtUtcMs ?? customer.leaveAtUtcMs,
      );
      if (nowUtcMs < nextTransitionAtUtcMs) {
        break;
      }
      if (nextTransitionAtUtcMs === customer.leaveAtUtcMs) {
        this.#leaveActiveCustomer(events);
        return;
      }
      this.#advanceActiveCustomerPhase(nextTransitionAtUtcMs, events);
    }

    if (
      this.#activeCustomer?.phase === "waiting-meal" &&
      this.#activeCustomer.phaseEndsAtUtcMs === null
    ) {
      this.#tryFulfillActiveCustomer(nowUtcMs, events);
    }
  }

  #advanceActiveCustomerPhase(
    atUtcMs: number,
    events: RestaurantEvent[],
  ): void {
    const customer = this.#activeCustomer;
    if (customer === null) return;
    const order = this.#createOrderSnapshot(customer);

    switch (customer.phase) {
      case "seated-idle":
        this.#activeCustomer = {
          ...customer,
          phase: "awaiting-order-confirmation",
          phaseEndsAtUtcMs: safeAdd(
            atUtcMs,
            this.#ottoApproachDurationMs,
            "Order confirmation approach time",
          ),
        };
        events.push(Object.freeze({
          type: "order.requested",
          order,
          requestedAtUtcMs: atUtcMs,
        }));
        break;
      case "awaiting-order-confirmation":
        this.#activeCustomer = {
          ...customer,
          phase: "confirming-order",
          phaseEndsAtUtcMs: safeAdd(
            atUtcMs,
            this.#orderConfirmationDurationMs,
            "Order confirmation finish time",
          ),
        };
        events.push(Object.freeze({
          type: "order.confirmation-started",
          order,
          startedAtUtcMs: atUtcMs,
        }));
        break;
      case "confirming-order": {
        const notification = this.#kitchenNotificationChannel
          .createNotification(order, atUtcMs);
        if (
          !isValidIdentifier(notification.channelId) ||
          notification.sentAtUtcMs !== atUtcMs ||
          !isNonNegativeInteger(notification.receivedAtUtcMs) ||
          notification.receivedAtUtcMs <= atUtcMs
        ) {
          throw new Error("Kitchen notification channel returned an invalid plan.");
        }
        this.#activeCustomer = {
          ...customer,
          phase: "notifying-kitchen",
          phaseEndsAtUtcMs: notification.receivedAtUtcMs,
          notificationChannelId: notification.channelId,
        };
        events.push(Object.freeze({
          type: "order.confirmed",
          order,
          confirmedAtUtcMs: atUtcMs,
        }));
        events.push(Object.freeze({
          type: "kitchen.notification-sent",
          order,
          channelId: notification.channelId,
          sentAtUtcMs: notification.sentAtUtcMs,
          expectedReceiptAtUtcMs: notification.receivedAtUtcMs,
        }));
        break;
      }
      case "notifying-kitchen":
        this.#activeCustomer = {
          ...customer,
          phase: "waiting-meal",
          phaseEndsAtUtcMs: safeAdd(
            atUtcMs,
            this.#minimumPreparationDurationMs,
            "Minimum order preparation time",
          ),
        };
        events.push(Object.freeze({
          type: "kitchen.order-received",
          order,
          channelId: customer.notificationChannelId ?? "unknown",
          receivedAtUtcMs: atUtcMs,
        }));
        break;
      case "waiting-meal":
        this.#activeCustomer = {
          ...customer,
          phaseEndsAtUtcMs: null,
        };
        this.#tryFulfillActiveCustomer(atUtcMs, events);
        break;
    }
  }

  #createOrderSnapshot(customer: ActiveCustomer): RestaurantOrderSnapshot {
    return Object.freeze({
      customerId: customer.id,
      recipeId: customer.recipeId,
      dishItemId: customer.dishItemId,
    });
  }
  #tryFulfillActiveCustomer(
    soldAtUtcMs: number,
    events: RestaurantEvent[],
  ): void {
    const customer = this.#activeCustomer;
    if (customer === null) {
      return;
    }
    const menuItem = this.#requireMenuItem(customer.recipeId);
    const signature = this.#createFulfillmentAttemptSignature(
      customer.dishItemId,
    );
    if (signature === this.#lastFulfillmentAttemptSignature) {
      return;
    }
    this.#lastFulfillmentAttemptSignature = signature;
    const withdrawal = this.#inventory.withdraw(
      `${customer.id}:sale:${customer.fulfillmentAttempt}`,
      this.#restaurantContainerId,
      [{ itemId: customer.dishItemId, quantity: 1 }],
    );
    if (!withdrawal.accepted) {
      if (withdrawal.code !== "INSUFFICIENT_AVAILABLE") {
        throw new Error(
          `Restaurant sale invariant failed: ${withdrawal.code}`,
        );
      }
      this.#activeCustomer = {
        ...customer,
        fulfillmentAttempt: customer.fulfillmentAttempt + 1,
      };
      return;
    }

    this.#totalSoldQuantity = safeAdd(
      this.#totalSoldQuantity,
      1,
      "Total sold quantity",
    );
    if (this.#finance === null) {
      this.#copperBalance = safeAdd(
        this.#copperBalance,
        menuItem.unitPriceCopper,
        "Copper balance",
      );
    }
    this.#soldByDish.set(
      customer.dishItemId,
      safeAdd(
        this.#soldByDish.get(customer.dishItemId) ?? 0,
        1,
        "Dish sold quantity",
      ),
    );

    const sale: RestaurantSaleSnapshot = Object.freeze({
      customerId: customer.id,
      recipeId: customer.recipeId,
      dishItemId: customer.dishItemId,
      quantity: 1,
      copperEarned: menuItem.unitPriceCopper,
      soldAtUtcMs,
    });
    this.#finance?.recordSale(sale);
    this.#recentSales.push(sale);
    this.#diningCustomers.push(Object.freeze({
      id: customer.id,
      recipeId: customer.recipeId,
      dishItemId: customer.dishItemId,
      diningStartedAtUtcMs: soldAtUtcMs,
      departAtUtcMs: safeAdd(
        soldAtUtcMs,
        this.#diningDurationMs,
        "Customer dining completion time",
      ),
    }));
    if (this.#recentSales.length > RECENT_SALES_LIMIT) {
      this.#recentSales.shift();
    }
    this.#activeCustomer = null;
    this.#lastFulfillmentAttemptSignature = null;
    events.push(Object.freeze({
      type: "order.fulfilled",
      sale,
    }));
    events.push(Object.freeze({
      type: "currency.changed",
      deltaCopper: menuItem.unitPriceCopper,
      copperBalance: this.#getCopperSnapshot().balanceCopper,
      atUtcMs: soldAtUtcMs,
    }));
    this.#scheduleNextCustomer(soldAtUtcMs);
  }

  #completeDiningCustomers(
    nowUtcMs: number,
    events: RestaurantEvent[],
  ): void {
    for (let index = this.#diningCustomers.length - 1; index >= 0; index -= 1) {
      const customer = this.#diningCustomers[index];
      if (customer === undefined || nowUtcMs < customer.departAtUtcMs) continue;
      this.#diningCustomers.splice(index, 1);
      events.push(Object.freeze({
        type: "customer.dining-completed",
        customer,
        completedAtUtcMs: customer.departAtUtcMs,
      }));
    }
  }

  #leaveActiveCustomer(events: RestaurantEvent[]): void {
    const customer = this.#activeCustomer;
    if (customer === null) {
      return;
    }

    this.#totalCustomersLeft = safeAdd(
      this.#totalCustomersLeft,
      1,
      "Customers left",
    );
    this.#activeCustomer = null;
    this.#lastFulfillmentAttemptSignature = null;
    events.push(Object.freeze({
      type: "customer.left",
      customerId: customer.id,
      recipeId: customer.recipeId,
      leftAtUtcMs: customer.leaveAtUtcMs,
      reason: customer.phase === "waiting-meal" ? "out-of-stock" : "wait-timeout",
    }));
    this.#scheduleNextCustomer(customer.leaveAtUtcMs);
  }

  #scheduleNextCustomer(fromUtcMs: number): void {
    const randomValue = this.#random.nextFloat();
    if (
      !Number.isFinite(randomValue) ||
      randomValue < 0 ||
      randomValue >= 1
    ) {
      throw new RangeError(
        "RandomSource must return a value in the range [0, 1).",
      );
    }
    const range =
      this.#maximumArrivalIntervalMs -
      this.#minimumArrivalIntervalMs;
    const baseIntervalMs =
      this.#minimumArrivalIntervalMs +
      Math.floor(randomValue * (range + 1));
    const intervalMs = Math.max(
      1,
      Math.round(
        baseIntervalMs * this.#customerArrivalIntervalRateBasisPoints / 10_000,
      ),
    );
    this.#nextCustomerAtUtcMs = safeAdd(
      fromUtcMs,
      intervalMs,
      "Next customer time",
    );
  }

  #restoreState(state: RestaurantSystemState): void {
    if (
      (state.selectedRecipeId !== null &&
        !this.#menuItems.has(state.selectedRecipeId)) ||
      (state.nextCustomerAtUtcMs !== null &&
        !isNonNegativeInteger(state.nextCustomerAtUtcMs)) ||
      !isNonNegativeInteger(state.customerSequence) ||
      !isNonNegativeInteger(state.totalSoldQuantity) ||
      !isNonNegativeInteger(state.totalCustomersLeft) ||
      !Number.isSafeInteger(state.copperBalance) ||
      !isNonNegativeInteger(state.totalCopperSpent ?? 0) ||
      state.recentSales.length > RECENT_SALES_LIMIT ||
      (state.diningCustomers !== undefined &&
        state.diningCustomers.length > this.#seatCapacity)
    ) {
      throw new Error("Restaurant restore state is invalid.");
    }
    const hasScheduledCustomer =
      state.nextCustomerAtUtcMs !== null;
    const hasActiveCustomer = state.activeCustomer !== null;
    if (
      state.selectedRecipeId === null
        ? hasScheduledCustomer || hasActiveCustomer
        : hasScheduledCustomer === hasActiveCustomer
    ) {
      throw new Error(
        "Restaurant customer schedule is inconsistent.",
      );
    }

    const soldByDish = new Map<string, number>();
    let soldQuantity = 0;
    let expectedCopper = 0;
    for (const entry of state.soldByDish) {
      const menuItem = [...this.#menuItems.values()].find(
        (candidate) => candidate.dishItemId === entry.dishItemId,
      );
      if (
        menuItem === undefined ||
        !isNonNegativeInteger(entry.quantity) ||
        soldByDish.has(entry.dishItemId)
      ) {
        throw new Error("Restaurant dish sales state is invalid.");
      }
      soldByDish.set(entry.dishItemId, entry.quantity);
      soldQuantity = safeAdd(
        soldQuantity,
        entry.quantity,
        "Restored sold quantity",
      );
      expectedCopper = safeAdd(
        expectedCopper,
        entry.quantity * menuItem.unitPriceCopper,
        "Restored copper balance",
      );
    }
    if (
      soldQuantity !== state.totalSoldQuantity ||
      (this.#finance === null &&
        expectedCopper !== state.copperBalance + (state.totalCopperSpent ?? 0))
    ) {
      throw new Error(
        "Restaurant sales totals do not match their breakdown.",
      );
    }

    const activeCustomer = state.activeCustomer;
    if (activeCustomer !== null) {
      const menuItem = this.#menuItems.get(activeCustomer.recipeId);
      if (
        menuItem === undefined ||
        menuItem.dishItemId !== activeCustomer.dishItemId ||
        activeCustomer.id.length === 0 ||
        activeCustomer.id.length > IDENTIFIER_MAX_LENGTH ||
        !isNonNegativeInteger(activeCustomer.arrivedAtUtcMs) ||
        !isNonNegativeInteger(activeCustomer.leaveAtUtcMs) ||
        activeCustomer.leaveAtUtcMs <
          activeCustomer.arrivedAtUtcMs ||
        !isNonNegativeInteger(activeCustomer.fulfillmentAttempt) ||
        (activeCustomer.phase !== undefined &&
          ![
            "seated-idle",
            "awaiting-order-confirmation",
            "confirming-order",
            "notifying-kitchen",
            "waiting-meal",
          ].includes(activeCustomer.phase)) ||
        (activeCustomer.phaseEndsAtUtcMs !== undefined &&
          activeCustomer.phaseEndsAtUtcMs !== null &&
          (!isNonNegativeInteger(activeCustomer.phaseEndsAtUtcMs) ||
            activeCustomer.phaseEndsAtUtcMs < activeCustomer.arrivedAtUtcMs)) ||
        (activeCustomer.notificationChannelId !== undefined &&
          activeCustomer.notificationChannelId !== null &&
          !isValidIdentifier(activeCustomer.notificationChannelId)) ||
        state.customerSequence === 0
      ) {
        throw new Error(
          "Active restaurant customer state is invalid.",
        );
      }
    }

    const diningCustomers = (state.diningCustomers ?? []).map((customer) => {
      const menuItem = this.#menuItems.get(customer.recipeId);
      if (
        menuItem === undefined ||
        menuItem.dishItemId !== customer.dishItemId ||
        !isValidIdentifier(customer.id) ||
        !isNonNegativeInteger(customer.diningStartedAtUtcMs) ||
        !isNonNegativeInteger(customer.departAtUtcMs) ||
        customer.departAtUtcMs <= customer.diningStartedAtUtcMs
      ) {
        throw new Error("Restaurant dining customer state is invalid.");
      }
      return Object.freeze({ ...customer });
    });

    const restoredCustomerIds = new Set(
      diningCustomers.map((customer) => customer.id),
    );
    if (
      restoredCustomerIds.size !== diningCustomers.length ||
      (activeCustomer !== null && restoredCustomerIds.has(activeCustomer.id))
    ) {
      throw new Error("Restaurant customer identities are inconsistent.");
    }

    const recentSales = state.recentSales.map((sale) => {
      const menuItem = this.#menuItems.get(sale.recipeId);
      if (
        menuItem === undefined ||
        menuItem.dishItemId !== sale.dishItemId ||
        sale.quantity !== 1 ||
        sale.copperEarned !== menuItem.unitPriceCopper ||
        sale.customerId.length === 0 ||
        sale.customerId.length > IDENTIFIER_MAX_LENGTH ||
        !isNonNegativeInteger(sale.soldAtUtcMs)
      ) {
        throw new Error("Recent restaurant sale state is invalid.");
      }
      return Object.freeze({ ...sale });
    });

    this.#selectedRecipeId = state.selectedRecipeId;
    this.#activeCustomer =
      activeCustomer === null
        ? null
        : {
            ...activeCustomer,
            phase: activeCustomer.phase ?? "waiting-meal",
            phaseEndsAtUtcMs: activeCustomer.phaseEndsAtUtcMs ?? null,
            notificationChannelId: activeCustomer.notificationChannelId ?? null,
          };
    if (this.#activeCustomer?.phase === "waiting-meal") {
      this.#lastFulfillmentAttemptSignature =
        this.#createFulfillmentAttemptSignature(
          this.#activeCustomer.dishItemId,
        );
    }
    this.#diningCustomers.push(...diningCustomers);
    this.#nextCustomerAtUtcMs = state.nextCustomerAtUtcMs;
    this.#customerSequence = state.customerSequence;
    this.#totalSoldQuantity = state.totalSoldQuantity;
    this.#totalCustomersLeft = state.totalCustomersLeft;
    if (this.#finance === null) {
      this.#copperBalance = state.copperBalance;
      this.#totalCopperSpent = state.totalCopperSpent ?? 0;
    }
    for (const [dishItemId, quantity] of soldByDish) {
      this.#soldByDish.set(dishItemId, quantity);
    }
    this.#recentSales.push(...recentSales);
  }

  #createFulfillmentAttemptSignature(dishItemId: string): string {
    const storage = this.#inventory.getContainerSnapshot(
      this.#restaurantContainerId,
    );
    const quantity =
      storage.entries.find(
        (entry) => entry.itemId === dishItemId,
      )?.availableQuantity ?? 0;
    return `${dishItemId}:${quantity}`;
  }

  #chooseCustomerMenuItem(
    selectedRecipeId: string,
  ): RestaurantMenuItem {
    const selected = this.#requireMenuItem(selectedRecipeId);
    const storage = this.#inventory.getContainerSnapshot(
      this.#restaurantContainerId,
    );
    for (const entry of storage.entries) {
      if (
        entry.quantity <= 0 ||
        entry.itemId === selected.dishItemId
      ) {
        continue;
      }
      const legacyItem = this.#menuItemsByDish.get(entry.itemId);
      if (legacyItem !== undefined) {
        return legacyItem;
      }
    }
    return selected;
  }

  #requireMenuItem(recipeId: string): RestaurantMenuItem {
    const menuItem = this.#menuItems.get(recipeId);
    if (menuItem === undefined) {
      throw new Error(`Missing restaurant menu item: ${recipeId}`);
    }
    return menuItem;
  }

  #prepareOperation(
    operationId: string,
  ): RestaurantActionResult | null {
    if (!isValidIdentifier(operationId)) {
      return this.#reject(
        operationId,
        "INVALID_OPERATION_ID",
        "Restaurant operation id is invalid.",
      );
    }
    if (this.#processedOperationIds.has(operationId)) {
      return this.#reject(
        operationId,
        "DUPLICATE_OPERATION",
        `Restaurant operation was already processed: ${operationId}`,
      );
    }

    this.#processedOperationIds.add(operationId);
    this.#operationHistory.push(operationId);
    if (this.#operationHistory.length > OPERATION_HISTORY_LIMIT) {
      const oldestOperationId = this.#operationHistory.shift();
      if (oldestOperationId !== undefined) {
        this.#processedOperationIds.delete(oldestOperationId);
      }
    }
    return null;
  }

  #accept(operationId: string): RestaurantActionResult {
    return Object.freeze({
      accepted: true,
      operationId,
      snapshot: this.getSnapshot(),
    });
  }

  #reject(
    operationId: string,
    code: RestaurantRejectionCode,
    message: string,
  ): RestaurantActionResult {
    return Object.freeze({
      accepted: false,
      operationId,
      code,
      message,
      snapshot: this.getSnapshot(),
    });
  }
}
