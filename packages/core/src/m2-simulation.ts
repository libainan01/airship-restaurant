import type { OfflineEarningsSummary } from "@airship-restaurant/contracts";
import {
  CookingSystem,
  type CookingRecipe,
  type CookingSnapshot,
  type CookingSystemState,
} from "./cooking-system";
import { calculateTimeAdvance } from "./game-time";
import {
  InventorySystem,
  type InventoryContainerSnapshot,
  type ItemStack,
} from "./inventory-system";
import {
  LogisticsSystem,
  type LogisticsSnapshot,
  type LogisticsSystemState,
} from "./logistics-system";
import { SeededRandom } from "./random-source";
import {
  RestaurantSystem,
  type RestaurantMenuItem,
  type RestaurantSnapshot,
  type RestaurantSystemState,
} from "./restaurant-system";

const KITCHEN_INGREDIENTS = "kitchen.ingredients";
const KITCHEN_OUTPUT = "kitchen.output";
const CABLE_CARGO = "cable.cargo";
const RESTAURANT_STORAGE = "restaurant.storage";

export interface M2IngredientConfig {
  readonly id: string;
  readonly capacity: number;
}

export interface M2RecipeConfig extends CookingRecipe {
  readonly unitPriceCopper: number;
}

export interface M2SupplyConfig {
  readonly intervalMs: number;
  readonly items: readonly ItemStack[];
}

export interface M2SimulationConfig {
  readonly startUtcMs: number;
  readonly randomSeed: number;
  readonly ingredients: readonly M2IngredientConfig[];
  readonly recipes: readonly M2RecipeConfig[];
  readonly initialIngredients: readonly ItemStack[];
  readonly supply: M2SupplyConfig;
  readonly defaultRecipeId: string;
  readonly initialState?: M2SimulationState;
}

export interface M2InventorySnapshot {
  readonly kitchenIngredients: InventoryContainerSnapshot;
  readonly kitchenOutput: InventoryContainerSnapshot;
  readonly cableCargo: InventoryContainerSnapshot;
  readonly restaurantStorage: InventoryContainerSnapshot;
}

export interface M2SimulationSnapshot {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly inventory: M2InventorySnapshot;
  readonly cooking: CookingSnapshot;
  readonly logistics: LogisticsSnapshot;
  readonly restaurant: RestaurantSnapshot;
}

export interface M2SimulationAdvanceResult {
  readonly changed: boolean;
  readonly clockRollbackDetected: boolean;
  readonly snapshot: M2SimulationSnapshot;
}

export type M2SimulationActionResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly snapshot: M2SimulationSnapshot;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly message: string;
      readonly snapshot: M2SimulationSnapshot;
    };

export interface M2SimulationInventoryState {
  readonly kitchenIngredients: readonly ItemStack[];
  readonly kitchenOutput: readonly ItemStack[];
  readonly cableCargo: readonly ItemStack[];
  readonly restaurantStorage: readonly ItemStack[];
}

export interface M2SimulationState {
  readonly version: 1;
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly randomState: number;
  readonly inventory: M2SimulationInventoryState;
  readonly cooking: CookingSystemState;
  readonly logistics: LogisticsSystemState;
  readonly restaurant: RestaurantSystemState;
}

export function createOfflineEarningsSummary(
  before: M2SimulationSnapshot,
  after: M2SimulationSnapshot,
): OfflineEarningsSummary {
  const delta = (later: number, earlier: number): number =>
    Math.max(0, later - earlier);

  return Object.freeze({
    elapsedMs: delta(after.currentUtcMs, before.currentUtcMs),
    supplyBoxesReceived: delta(
      after.supplyBoxesReceived,
      before.supplyBoxesReceived,
    ),
    cookingBatchesCompleted: delta(
      after.cooking.completedBatches,
      before.cooking.completedBatches,
    ),
    deliveredQuantity: delta(
      after.logistics.totalDeliveredQuantity,
      before.logistics.totalDeliveredQuantity,
    ),
    soldQuantity: delta(
      after.restaurant.totalSoldQuantity,
      before.restaurant.totalSoldQuantity,
    ),
    customersLeft: delta(
      after.restaurant.totalCustomersLeft,
      before.restaurant.totalCustomersLeft,
    ),
    copperEarned: delta(
      after.restaurant.copperBalance,
      before.restaurant.copperBalance,
    ),
  });
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0;
}

function safeAddTime(startUtcMs: number, durationMs: number): number {
  const result = startUtcMs + durationMs;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(
      "M2 simulation time exceeds the safe integer range.",
    );
  }
  return result;
}

function minimumTime(
  values: readonly (number | null)[],
): number | null {
  let minimum: number | null = null;
  for (const value of values) {
    if (value !== null && (minimum === null || value < minimum)) {
      minimum = value;
    }
  }
  return minimum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128
  );
}

function isNullableUtcMs(value: unknown): boolean {
  return value === null || isNonNegativeInteger(value);
}

function isCookingJobState(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isIdentifier(value.id) &&
      isIdentifier(value.recipeId) &&
      isIdentifier(value.reservationId) &&
      isNonNegativeInteger(value.startedAtUtcMs) &&
      isNonNegativeInteger(value.finishAtUtcMs) &&
      value.finishAtUtcMs >= value.startedAtUtcMs &&
      isNonNegativeInteger(value.completionAttempt) &&
      (value.status === "cooking" ||
        value.status === "waiting-output"))
  );
}

function isShipmentState(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isIdentifier(value.id) &&
      isNonNegativeInteger(value.departedAtUtcMs) &&
      isNonNegativeInteger(value.arriveAtUtcMs) &&
      value.arriveAtUtcMs >= value.departedAtUtcMs &&
      isNullableUtcMs(value.returnStartedAtUtcMs) &&
      isNullableUtcMs(value.returnAtUtcMs) &&
      isNonNegativeInteger(value.unloadAttempt))
  );
}

function isCustomerState(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isIdentifier(value.id) &&
      isIdentifier(value.recipeId) &&
      isIdentifier(value.dishItemId) &&
      isNonNegativeInteger(value.arrivedAtUtcMs) &&
      isNonNegativeInteger(value.leaveAtUtcMs) &&
      value.leaveAtUtcMs >= value.arrivedAtUtcMs &&
      isNonNegativeInteger(value.fulfillmentAttempt))
  );
}

function isDishSalesState(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentifier(value.dishItemId) &&
    isNonNegativeInteger(value.quantity)
  );
}

function isSaleState(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentifier(value.customerId) &&
    isIdentifier(value.recipeId) &&
    isIdentifier(value.dishItemId) &&
    value.quantity === 1 &&
    isPositiveInteger(value.copperEarned as number) &&
    isNonNegativeInteger(value.soldAtUtcMs)
  );
}

function isItemStackArray(value: unknown): value is readonly ItemStack[] {
  return Array.isArray(value) && value.every(
    (item) =>
      isRecord(item) &&
      typeof item.itemId === "string" &&
      item.itemId.length > 0 &&
      isPositiveInteger(item.quantity as number),
  );
}

export function isM2SimulationState(
  value: unknown,
): value is M2SimulationState {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonNegativeInteger(value.revision) ||
    !isNonNegativeInteger(value.currentUtcMs) ||
    !isNonNegativeInteger(value.nextSupplyAtUtcMs) ||
    value.nextSupplyAtUtcMs < value.currentUtcMs ||
    !isNonNegativeInteger(value.supplyBoxesReceived) ||
    !isNonNegativeInteger(value.randomState) ||
    value.randomState > 0xffff_ffff ||
    !isRecord(value.inventory) ||
    !isItemStackArray(value.inventory.kitchenIngredients) ||
    !isItemStackArray(value.inventory.kitchenOutput) ||
    !isItemStackArray(value.inventory.cableCargo) ||
    !isItemStackArray(value.inventory.restaurantStorage) ||
    !isRecord(value.cooking) ||
    !isRecord(value.logistics) ||
    !isRecord(value.restaurant)
  ) {
    return false;
  }

  const cooking = value.cooking;
  const logistics = value.logistics;
  const restaurant = value.restaurant;
  return (
    (cooking.selectedRecipeId === null ||
      typeof cooking.selectedRecipeId === "string") &&
    typeof cooking.autoRepeat === "boolean" &&
    isCookingJobState(cooking.activeJob) &&
    (cooking.blockedReason === null ||
      cooking.blockedReason === "insufficient-ingredients" ||
      cooking.blockedReason === "output-capacity") &&
    isNonNegativeInteger(cooking.completedBatches) &&
    isNonNegativeInteger(cooking.jobSequence) &&
    isNonNegativeInteger(cooking.automaticAttemptSequence) &&
    (logistics.phase === "idle" ||
      logistics.phase === "outbound" ||
      logistics.phase === "waiting-unload" ||
      logistics.phase === "returning") &&
    isShipmentState(logistics.activeShipment) &&
    (logistics.kitchenWaitingSinceUtcMs === null ||
      isNonNegativeInteger(logistics.kitchenWaitingSinceUtcMs)) &&
    isNonNegativeInteger(logistics.shipmentSequence) &&
    isNonNegativeInteger(logistics.totalDeliveredQuantity) &&
    typeof logistics.capacityBlockAnnounced === "boolean" &&
    (restaurant.selectedRecipeId === null ||
      typeof restaurant.selectedRecipeId === "string") &&
    isCustomerState(restaurant.activeCustomer) &&
    (restaurant.nextCustomerAtUtcMs === null ||
      isNonNegativeInteger(restaurant.nextCustomerAtUtcMs)) &&
    isNonNegativeInteger(restaurant.customerSequence) &&
    isNonNegativeInteger(restaurant.totalSoldQuantity) &&
    isNonNegativeInteger(restaurant.totalCustomersLeft) &&
    isNonNegativeInteger(restaurant.copperBalance) &&
    Array.isArray(restaurant.soldByDish) &&
    restaurant.soldByDish.every(isDishSalesState) &&
    Array.isArray(restaurant.recentSales) &&
    restaurant.recentSales.length <= 20 &&
    restaurant.recentSales.every(isSaleState)
  );
}

function stacksFromSnapshot(
  snapshot: InventoryContainerSnapshot,
): readonly ItemStack[] {
  return Object.freeze(
    snapshot.entries
      .filter((entry) => entry.quantity > 0)
      .map((entry) =>
        Object.freeze({
          itemId: entry.itemId,
          quantity: entry.quantity,
        }),
      ),
  );
}

export class M2Simulation {
  readonly #inventory: InventorySystem;
  readonly #cooking: CookingSystem;
  readonly #logistics: LogisticsSystem;
  readonly #restaurant: RestaurantSystem;
  readonly #random: SeededRandom;
  readonly #ingredientCapacities = new Map<string, number>();
  readonly #supply: M2SupplyConfig;
  #revision = 0;
  #currentUtcMs: number;
  #nextSupplyAtUtcMs: number;
  #supplyBoxesReceived = 0;

  constructor(config: M2SimulationConfig) {
    if (
      !Number.isSafeInteger(config.startUtcMs) ||
      config.startUtcMs < 0 ||
      config.ingredients.length === 0 ||
      config.recipes.length === 0 ||
      !isPositiveInteger(config.supply.intervalMs)
    ) {
      throw new Error("M2 simulation configuration is invalid.");
    }
    const initialState = config.initialState;
    if (
      initialState !== undefined &&
      !isM2SimulationState(initialState)
    ) {
      throw new Error("M2 simulation restore state is invalid.");
    }
    this.#currentUtcMs =
      initialState?.currentUtcMs ?? config.startUtcMs;
    this.#supply = Object.freeze({
      intervalMs: config.supply.intervalMs,
      items: Object.freeze(
        config.supply.items.map((item) =>
          Object.freeze({ ...item }),
        ),
      ),
    });
    this.#nextSupplyAtUtcMs =
      initialState?.nextSupplyAtUtcMs ??
      safeAddTime(config.startUtcMs, config.supply.intervalMs);
    this.#revision = initialState?.revision ?? 0;
    this.#supplyBoxesReceived =
      initialState?.supplyBoxesReceived ?? 0;

    for (const ingredient of config.ingredients) {
      if (
        !isPositiveInteger(ingredient.capacity) ||
        this.#ingredientCapacities.has(ingredient.id)
      ) {
        throw new Error(
          `Invalid M2 ingredient capacity: ${ingredient.id}`,
        );
      }
      this.#ingredientCapacities.set(
        ingredient.id,
        ingredient.capacity,
      );
    }
    const ingredientIds = [...this.#ingredientCapacities.keys()];
    const dishIds = [...new Set(
      config.recipes.map((recipe) => recipe.outputItemId),
    )];
    const ingredientCapacity = [...this.#ingredientCapacities.values()]
      .reduce((total, capacity) => total + capacity, 0);
    const itemCapacities = Object.fromEntries(
      this.#ingredientCapacities,
    );

    const restoredContents: Record<string, readonly ItemStack[]> = {};
    if (initialState !== undefined) {
      for (const [containerId, stacks] of [
        [KITCHEN_INGREDIENTS, initialState.inventory.kitchenIngredients],
        [KITCHEN_OUTPUT, initialState.inventory.kitchenOutput],
        [CABLE_CARGO, initialState.inventory.cableCargo],
        [RESTAURANT_STORAGE, initialState.inventory.restaurantStorage],
      ] as const) {
        if (stacks.length > 0) {
          restoredContents[containerId] = stacks;
        }
      }
    } else if (config.initialIngredients.length > 0) {
      restoredContents[KITCHEN_INGREDIENTS] =
        config.initialIngredients;
    }

    this.#inventory = new InventorySystem(
      [
        {
          id: KITCHEN_INGREDIENTS,
          capacity: ingredientCapacity,
          acceptedItemIds: ingredientIds,
          itemCapacities,
        },
        {
          id: KITCHEN_OUTPUT,
          capacity: 12,
          acceptedItemIds: dishIds,
        },
        {
          id: CABLE_CARGO,
          capacity: 6,
          acceptedItemIds: dishIds,
        },
        {
          id: RESTAURANT_STORAGE,
          capacity: 18,
          acceptedItemIds: dishIds,
        },
      ],
      restoredContents,
    );

    this.#cooking = new CookingSystem({
      inventory: this.#inventory,
      recipes: config.recipes,
      ingredientContainerId: KITCHEN_INGREDIENTS,
      outputContainerId: KITCHEN_OUTPUT,
      autoRepeatInitially: true,
      ...(initialState === undefined
        ? {}
        : { initialState: initialState.cooking }),
    });
    this.#logistics = new LogisticsSystem({
      inventory: this.#inventory,
      kitchenOutputContainerId: KITCHEN_OUTPUT,
      cargoContainerId: CABLE_CARGO,
      restaurantContainerId: RESTAURANT_STORAGE,
      cargoCapacity: 6,
      dispatchThreshold: 2,
      maximumWaitMs: 60_000,
      outboundDurationMs: 20_000,
      returnDurationMs: 20_000,
      ...(initialState === undefined
        ? {}
        : { initialState: initialState.logistics }),
    });
    const menuItems: RestaurantMenuItem[] = config.recipes.map(
      (recipe) => ({
        recipeId: recipe.id,
        dishItemId: recipe.outputItemId,
        unitPriceCopper: recipe.unitPriceCopper,
      }),
    );
    this.#random = new SeededRandom(
      initialState?.randomState ?? config.randomSeed,
    );
    this.#restaurant = new RestaurantSystem({
      inventory: this.#inventory,
      restaurantContainerId: RESTAURANT_STORAGE,
      menuItems,
      random: this.#random,
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
      ...(initialState === undefined
        ? {}
        : { initialState: initialState.restaurant }),
    });

    if (initialState !== undefined) {
      return;
    }

    const selectedCooking = this.#cooking.selectRecipe(
      "simulation-initial-recipe",
      config.defaultRecipeId,
    );
    const selectedMenu = this.#restaurant.selectMenuItem(
      "simulation-initial-menu",
      config.defaultRecipeId,
      config.startUtcMs,
    );
    const startedCooking = this.#cooking.startBatch(
      "simulation-initial-batch",
      config.startUtcMs,
    );
    if (
      !selectedCooking.accepted ||
      !selectedMenu.accepted ||
      !startedCooking.accepted
    ) {
      throw new Error(
        "M2 simulation could not start its default recipe.",
      );
    }
  }

  getSnapshot(): M2SimulationSnapshot {
    return Object.freeze({
      revision: this.#revision,
      currentUtcMs: this.#currentUtcMs,
      nextSupplyAtUtcMs: this.#nextSupplyAtUtcMs,
      supplyBoxesReceived: this.#supplyBoxesReceived,
      inventory: Object.freeze({
        kitchenIngredients: this.#inventory.getContainerSnapshot(
          KITCHEN_INGREDIENTS,
        ),
        kitchenOutput: this.#inventory.getContainerSnapshot(
          KITCHEN_OUTPUT,
        ),
        cableCargo: this.#inventory.getContainerSnapshot(CABLE_CARGO),
        restaurantStorage: this.#inventory.getContainerSnapshot(
          RESTAURANT_STORAGE,
        ),
      }),
      cooking: this.#cooking.getSnapshot(),
      logistics: this.#logistics.getSnapshot(),
      restaurant: this.#restaurant.getSnapshot(),
    });
  }

  exportState(): M2SimulationState {
    const snapshot = this.getSnapshot();
    return Object.freeze({
      version: 1,
      revision: this.#revision,
      currentUtcMs: this.#currentUtcMs,
      nextSupplyAtUtcMs: this.#nextSupplyAtUtcMs,
      supplyBoxesReceived: this.#supplyBoxesReceived,
      randomState: this.#random.getState(),
      inventory: Object.freeze({
        kitchenIngredients: stacksFromSnapshot(
          snapshot.inventory.kitchenIngredients,
        ),
        kitchenOutput: stacksFromSnapshot(
          snapshot.inventory.kitchenOutput,
        ),
        cableCargo: stacksFromSnapshot(
          snapshot.inventory.cableCargo,
        ),
        restaurantStorage: stacksFromSnapshot(
          snapshot.inventory.restaurantStorage,
        ),
      }),
      cooking: this.#cooking.exportState(),
      logistics: this.#logistics.exportState(),
      restaurant: this.#restaurant.exportState(),
    });
  }

  selectRecipe(
    operationId: string,
    recipeId: string,
  ): M2SimulationActionResult {
    const beforeCookingRecipe =
      this.#cooking.getSnapshot().selectedRecipeId;
    const beforeRestaurantRecipe =
      this.#restaurant.getSnapshot().selectedRecipeId;
    const cooking = this.#cooking.selectRecipe(
      operationId,
      recipeId,
    );
    if (!cooking.accepted) {
      return Object.freeze({
        accepted: false,
        changed: false,
        message: cooking.message,
        snapshot: this.getSnapshot(),
      });
    }
    const restaurant = this.#restaurant.selectMenuItem(
      operationId,
      recipeId,
      this.#currentUtcMs,
    );
    if (!restaurant.accepted) {
      throw new Error(
        `Restaurant menu invariant failed: ${restaurant.code}`,
      );
    }

    const changed =
      beforeCookingRecipe !== recipeId ||
      beforeRestaurantRecipe !== recipeId;
    if (changed) {
      this.#revision += 1;
    }
    return Object.freeze({
      accepted: true,
      changed,
      snapshot: this.getSnapshot(),
    });
  }

  setAutoRepeat(
    operationId: string,
    enabled: boolean,
  ): M2SimulationActionResult {
    const before = this.#cooking.getSnapshot().autoRepeat;
    const cooking = this.#cooking.setAutoRepeat(
      operationId,
      enabled,
    );
    if (!cooking.accepted) {
      return Object.freeze({
        accepted: false,
        changed: false,
        message: cooking.message,
        snapshot: this.getSnapshot(),
      });
    }

    const changed = before !== enabled;
    if (changed) {
      this.#revision += 1;
    }
    return Object.freeze({
      accepted: true,
      changed,
      snapshot: this.getSnapshot(),
    });
  }

  advanceTo(observedUtcMs: number): M2SimulationAdvanceResult {
    const timeAdvance = calculateTimeAdvance(
      this.#currentUtcMs,
      observedUtcMs,
    );
    const targetUtcMs = timeAdvance.effectiveUtcMs;
    let changeCount = 0;
    let targetWasProcessed = false;

    while (true) {
      const nextTransitionUtcMs = this.#getNextTransitionUtcMs();
      if (
        nextTransitionUtcMs === null ||
        nextTransitionUtcMs > targetUtcMs
      ) {
        break;
      }
      if (nextTransitionUtcMs < this.#currentUtcMs) {
        throw new Error(
          "M2 simulation produced a transition before its current time.",
        );
      }

      const transitionChanges = this.#processAt(
        nextTransitionUtcMs,
      );
      if (
        transitionChanges === 0 &&
        nextTransitionUtcMs === this.#currentUtcMs
      ) {
        throw new Error("M2 simulation transition became stalled.");
      }
      changeCount += transitionChanges;
      this.#currentUtcMs = nextTransitionUtcMs;
      targetWasProcessed = nextTransitionUtcMs === targetUtcMs;
    }

    if (!targetWasProcessed) {
      changeCount += this.#processAt(targetUtcMs);
    }
    this.#currentUtcMs = targetUtcMs;
    if (changeCount > 0) {
      this.#revision += 1;
    }

    return Object.freeze({
      changed: changeCount > 0,
      clockRollbackDetected: timeAdvance.clockRollbackDetected,
      snapshot: this.getSnapshot(),
    });
  }

  #getNextTransitionUtcMs(): number | null {
    const cooking = this.#cooking.getSnapshot();
    const logistics = this.#logistics.getSnapshot();
    const restaurant = this.#restaurant.getSnapshot();
    return minimumTime([
      cooking.nextTransitionUtcMs,
      logistics.nextTransitionUtcMs,
      restaurant.nextTransitionUtcMs,
      this.#nextSupplyAtUtcMs,
    ]);
  }

  #processAt(atUtcMs: number): number {
    let changeCount = 0;
    if (atUtcMs === this.#nextSupplyAtUtcMs) {
      this.#deliverSupply();
      changeCount += 1;
    }

    // A second pass resolves same-time cross-system effects:
    // cooking can free/load transport, and a sale can free unload space.
    for (let pass = 0; pass < 2; pass += 1) {
      changeCount += this.#cooking.advanceTo(atUtcMs).events.length;
      changeCount += this.#logistics.advanceTo(atUtcMs).events.length;
      changeCount += this.#restaurant.advanceTo(atUtcMs).events.length;
    }
    return changeCount;
  }

  #deliverSupply(): void {
    this.#supplyBoxesReceived += 1;
    if (!Number.isSafeInteger(this.#supplyBoxesReceived)) {
      throw new RangeError(
        "Supply delivery count exceeds the safe integer range.",
      );
    }

    const pantry = this.#inventory.getContainerSnapshot(
      KITCHEN_INGREDIENTS,
    );
    const currentQuantities = new Map(
      pantry.entries.map((entry) => [entry.itemId, entry.quantity]),
    );
    for (const item of this.#supply.items) {
      const capacity = this.#ingredientCapacities.get(item.itemId);
      if (capacity === undefined) {
        throw new Error(
          `Supply references unknown ingredient: ${item.itemId}`,
        );
      }
      const current = currentQuantities.get(item.itemId) ?? 0;
      const quantity = Math.min(item.quantity, capacity - current);
      if (quantity <= 0) {
        continue;
      }
      const result = this.#inventory.deposit(
        `supply-${this.#supplyBoxesReceived}:${item.itemId}`,
        KITCHEN_INGREDIENTS,
        [{ itemId: item.itemId, quantity }],
      );
      if (!result.accepted) {
        throw new Error(
          `Supply deposit invariant failed: ${result.code}`,
        );
      }
      currentQuantities.set(item.itemId, current + quantity);
    }
    this.#nextSupplyAtUtcMs = safeAddTime(
      this.#nextSupplyAtUtcMs,
      this.#supply.intervalMs,
    );
  }
}
