import { InventorySystem } from "./inventory-system";
import type { RandomSource } from "./random-source";

const OPERATION_HISTORY_LIMIT = 512;
const RECENT_SALES_LIMIT = 20;
const IDENTIFIER_MAX_LENGTH = 128;

export interface RestaurantMenuItem {
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly unitPriceCopper: number;
}

export interface RestaurantCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly arrivedAtUtcMs: number;
  readonly leaveAtUtcMs: number;
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
  readonly nextCustomerAtUtcMs: number | null;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
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
      readonly type: "order.fulfilled";
      readonly sale: RestaurantSaleSnapshot;
    }
  | {
      readonly type: "customer.left";
      readonly customerId: string;
      readonly recipeId: string;
      readonly leftAtUtcMs: number;
      readonly reason: "out-of-stock";
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
  } | null;
  readonly nextCustomerAtUtcMs: number | null;
  readonly customerSequence: number;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
  readonly soldByDish: readonly DishSalesSnapshot[];
  readonly recentSales: readonly RestaurantSaleSnapshot[];
}

export interface RestaurantSystemOptions {
  readonly inventory: InventorySystem;
  readonly restaurantContainerId: string;
  readonly menuItems: readonly RestaurantMenuItem[];
  readonly random: RandomSource;
  readonly minimumArrivalIntervalMs: number;
  readonly maximumArrivalIntervalMs: number;
  readonly maximumWaitMs: number;
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
  readonly #processedOperationIds = new Set<string>();
  readonly #operationHistory: string[] = [];
  readonly #soldByDish = new Map<string, number>();
  readonly #recentSales: RestaurantSaleSnapshot[] = [];
  #selectedRecipeId: string | null = null;
  #activeCustomer: ActiveCustomer | null = null;
  #nextCustomerAtUtcMs: number | null = null;
  #customerSequence = 0;
  #totalSoldQuantity = 0;
  #totalCustomersLeft = 0;
  #copperBalance: number;
  #lastFulfillmentAttemptSignature: string | null = null;

  constructor(options: RestaurantSystemOptions) {
    if (
      options.menuItems.length === 0 ||
      !isPositiveInteger(options.minimumArrivalIntervalMs) ||
      !isPositiveInteger(options.maximumArrivalIntervalMs) ||
      options.maximumArrivalIntervalMs <
        options.minimumArrivalIntervalMs ||
      !isPositiveInteger(options.maximumWaitMs) ||
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
          });
    const soldByDish = [...this.#soldByDish]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dishItemId, quantity]) =>
        Object.freeze({ dishItemId, quantity }),
      );

    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      activeCustomer,
      nextCustomerAtUtcMs: this.#nextCustomerAtUtcMs,
      totalSoldQuantity: this.#totalSoldQuantity,
      totalCustomersLeft: this.#totalCustomersLeft,
      copperBalance: this.#copperBalance,
      soldByDish: Object.freeze(soldByDish),
      recentSales: Object.freeze([...this.#recentSales]),
      nextTransitionUtcMs:
        activeCustomer?.leaveAtUtcMs ??
        this.#nextCustomerAtUtcMs,
    });
  }

  exportState(): RestaurantSystemState {
    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      activeCustomer:
        this.#activeCustomer === null
          ? null
          : Object.freeze({ ...this.#activeCustomer }),
      nextCustomerAtUtcMs: this.#nextCustomerAtUtcMs,
      customerSequence: this.#customerSequence,
      totalSoldQuantity: this.#totalSoldQuantity,
      totalCustomersLeft: this.#totalCustomersLeft,
      copperBalance: this.#copperBalance,
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

    if (this.#activeCustomer !== null) {
      if (nowUtcMs >= this.#activeCustomer.leaveAtUtcMs) {
        this.#leaveActiveCustomer(events);
      } else {
        this.#tryFulfillActiveCustomer(nowUtcMs, events);
      }
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
    };
    this.#lastFulfillmentAttemptSignature = null;
    this.#nextCustomerAtUtcMs = null;
    events.push(Object.freeze({
      type: "customer.arrived",
      customer: this.getSnapshot()
        .activeCustomer as RestaurantCustomerSnapshot,
    }));
    this.#tryFulfillActiveCustomer(arrivedAtUtcMs, events);

    return Object.freeze({
      snapshot: this.getSnapshot(),
      events: Object.freeze(events),
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
    this.#copperBalance = safeAdd(
      this.#copperBalance,
      menuItem.unitPriceCopper,
      "Copper balance",
    );
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
    this.#recentSales.push(sale);
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
      copperBalance: this.#copperBalance,
      atUtcMs: soldAtUtcMs,
    }));
    this.#scheduleNextCustomer(soldAtUtcMs);
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
      reason: "out-of-stock",
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
    const intervalMs =
      this.#minimumArrivalIntervalMs +
      Math.floor(randomValue * (range + 1));
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
      !isNonNegativeInteger(state.copperBalance) ||
      state.recentSales.length > RECENT_SALES_LIMIT
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
      expectedCopper !== state.copperBalance
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
        state.customerSequence === 0
      ) {
        throw new Error(
          "Active restaurant customer state is invalid.",
        );
      }
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
      activeCustomer === null ? null : { ...activeCustomer };
    if (activeCustomer !== null) {
      this.#lastFulfillmentAttemptSignature =
        this.#createFulfillmentAttemptSignature(
          activeCustomer.dishItemId,
        );
    }
    this.#nextCustomerAtUtcMs = state.nextCustomerAtUtcMs;
    this.#customerSequence = state.customerSequence;
    this.#totalSoldQuantity = state.totalSoldQuantity;
    this.#totalCustomersLeft = state.totalCustomersLeft;
    this.#copperBalance = state.copperBalance;
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
