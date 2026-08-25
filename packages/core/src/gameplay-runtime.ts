import type { GameplaySnapshot, OfflineEarningsSummary } from "@airship-restaurant/contracts";
import {
  CookingSystem,
  type CookingRecipe,
  type CookingSnapshot,
  type CookingSystemState,
} from "./cooking-system";
import { calculateTimeAdvance } from "./game-time";
import type { InventoryModule } from "./modules";
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
import {
  ProcurementSystem,
  type ProcurementRegionConfig,
  type ProcurementSnapshot,
  type ProcurementSystemState,
} from "./procurement-system";
import { SeededRandom } from "./random-source";
import {
  RestaurantSystem,
  type RestaurantEvent,
  type RestaurantFinancePort,
  type RestaurantMenuItem,
  type RestaurantSnapshot,
  type RestaurantSystemState,
} from "./restaurant-system";

const KITCHEN_INGREDIENTS = "kitchen.ingredients";
const KITCHEN_OUTPUT = "kitchen.output";
const CABLE_CARGO = "cable.cargo";
const RESTAURANT_STORAGE = "restaurant.storage";
const RESTAURANT_PRESENTATION_EVENT_LIMIT = 64;
const BUSINESS_UPGRADE_MAX_LEVEL = 3;
const BUSINESS_UPGRADE_COSTS = Object.freeze([12, 30, 60]);
const PROCUREMENT_AUTOMATION_COST = 45;
export type BusinessUpgradeId = "kitchen" | "transport" | "restaurant" | "procurement";
export interface BusinessUpgradeLevels {
  readonly kitchen: number;
  readonly transport: number;
  readonly restaurant: number;
  readonly procurement: number;
}
export interface BusinessUpgradeSnapshot extends BusinessUpgradeLevels {
  readonly maxLevel: number;
  readonly maxLevels: Readonly<Record<BusinessUpgradeId, number>>;
  readonly nextCosts: Readonly<Record<BusinessUpgradeId, number | null>>;
}
const DEFAULT_BUSINESS_UPGRADES: BusinessUpgradeLevels = Object.freeze({
  kitchen: 0,
  transport: 0,
  restaurant: 0,
  procurement: 0,
});
function upgradeDuration(baseMs: number, level: number): number {
  return Math.max(1, Math.round(baseMs * (1 - level * 0.15)));
}
function nextUpgradeCost(
  upgradeId: BusinessUpgradeId,
  level: number,
): number | null {
  if (upgradeId === "procurement") {
    return level >= 1 ? null : PROCUREMENT_AUTOMATION_COST;
  }
  return level >= BUSINESS_UPGRADE_MAX_LEVEL ? null : BUSINESS_UPGRADE_COSTS[level] ?? null;
}
export interface GameplayIngredientConfig {
  readonly id: string;
  readonly capacity: number;
}

export interface GameplayRecipeConfig extends CookingRecipe {
  readonly unitPriceCopper: number;
}

export interface GameplaySupplyConfig {
  readonly intervalMs: number;
  readonly items: readonly ItemStack[];
  readonly emergencyThreshold?: number;
}

export interface GameplayRuntimeConfig {
  readonly startUtcMs: number;
  readonly randomSeed: number;
  readonly ingredients: readonly GameplayIngredientConfig[];
  readonly recipes: readonly GameplayRecipeConfig[];
  readonly initialIngredients: readonly ItemStack[];
  readonly supply: GameplaySupplyConfig;
  readonly defaultRecipeId: string;
  readonly procurementRegions?: readonly ProcurementRegionConfig[];
  readonly finance?: RestaurantFinancePort;
  readonly initialSlices?: GameplayRuntimeSaveSlices;
}

export interface M2InventorySnapshot {
  readonly kitchenIngredients: InventoryContainerSnapshot;
  readonly kitchenOutput: InventoryContainerSnapshot;
  readonly cableCargo: InventoryContainerSnapshot;
  readonly restaurantStorage: InventoryContainerSnapshot;
}

export interface GameplayRuntimeSnapshot {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly inventory: M2InventorySnapshot;
  readonly cooking: CookingSnapshot;
  readonly logistics: LogisticsSnapshot;
  readonly restaurant: RestaurantSnapshot;
  readonly upgrades: BusinessUpgradeSnapshot;
  readonly procurement: ProcurementSnapshot;
}

export interface GameplayRuntimeAdvanceResult {
  readonly changed: boolean;
  readonly clockRollbackDetected: boolean;
  readonly snapshot: GameplayRuntimeSnapshot;
  readonly restaurantEvents: readonly RestaurantEvent[];
}

export type GameplayRuntimeActionResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly snapshot: GameplayRuntimeSnapshot;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly message: string;
      readonly snapshot: GameplayRuntimeSnapshot;
    };

export interface GameplayRuntimeInventoryState {
  readonly kitchenIngredients: readonly ItemStack[];
  readonly kitchenOutput: readonly ItemStack[];
  readonly cableCargo: readonly ItemStack[];
  readonly restaurantStorage: readonly ItemStack[];
}

export interface LegacyGameplayRuntimeState {
  readonly version: 1;
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly randomState: number;
  /** Missing in legacy saves; inferred from prior kitchen progress during restore. */
  readonly kitchenActivated?: boolean;
  readonly inventory: GameplayRuntimeInventoryState;
  readonly cooking: CookingSystemState;
  readonly logistics: LogisticsSystemState;
  readonly restaurant: RestaurantSystemState;
  readonly upgrades?: BusinessUpgradeLevels;
  readonly procurement?: ProcurementSystemState;
}
export interface GameplayRuntimeCoordinatorState {
  readonly version: 1;
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly randomState: number;
  readonly kitchenActivated: boolean;
  readonly upgrades: BusinessUpgradeLevels;
}

export interface GameplayRuntimeSaveSlices {
  readonly gameplayRuntime: GameplayRuntimeCoordinatorState;
  readonly gameplayInventory: GameplayRuntimeInventoryState;
  readonly cooking: CookingSystemState;
  readonly logistics: LogisticsSystemState;
  readonly restaurant: RestaurantSystemState;
  readonly procurementHistory?: ProcurementSystemState;
}

export function createOfflineEarningsSummary(
  before: GameplaySnapshot,
  after: GameplaySnapshot,
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
      "Gameplay runtime time exceeds the safe integer range.",
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

function isDiningCustomerState(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.recipeId) &&
    isIdentifier(value.dishItemId) &&
    isNonNegativeInteger(value.diningStartedAtUtcMs) &&
    isNonNegativeInteger(value.departAtUtcMs) &&
    value.departAtUtcMs > value.diningStartedAtUtcMs
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

export function isLegacyGameplayRuntimeState(
  value: unknown,
): value is LegacyGameplayRuntimeState {
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
    (value.kitchenActivated !== undefined &&
      typeof value.kitchenActivated !== "boolean") ||
    !isRecord(value.inventory) ||
    !isItemStackArray(value.inventory.kitchenIngredients) ||
    !isItemStackArray(value.inventory.kitchenOutput) ||
    !isItemStackArray(value.inventory.cableCargo) ||
    !isItemStackArray(value.inventory.restaurantStorage) ||
    !isRecord(value.cooking) ||
    !isRecord(value.logistics) ||
    !isRecord(value.restaurant) ||
    (value.upgrades !== undefined &&
      (!isRecord(value.upgrades) ||
        !isNonNegativeInteger(value.upgrades.kitchen) ||
        value.upgrades.kitchen > BUSINESS_UPGRADE_MAX_LEVEL ||
        !isNonNegativeInteger(value.upgrades.transport) ||
        value.upgrades.transport > BUSINESS_UPGRADE_MAX_LEVEL ||
        !isNonNegativeInteger(value.upgrades.restaurant) ||
        value.upgrades.restaurant > BUSINESS_UPGRADE_MAX_LEVEL ||
        (value.upgrades.procurement !== undefined &&
          (!isNonNegativeInteger(value.upgrades.procurement) ||
            value.upgrades.procurement > 1))))
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
    (restaurant.diningCustomers === undefined ||
      (Array.isArray(restaurant.diningCustomers) &&
        restaurant.diningCustomers.every(isDiningCustomerState))) &&
    (restaurant.nextCustomerAtUtcMs === null ||
      isNonNegativeInteger(restaurant.nextCustomerAtUtcMs)) &&
    isNonNegativeInteger(restaurant.customerSequence) &&
    isNonNegativeInteger(restaurant.totalSoldQuantity) &&
    isNonNegativeInteger(restaurant.totalCustomersLeft) &&
    Number.isSafeInteger(restaurant.copperBalance) &&
    Array.isArray(restaurant.soldByDish) &&
    restaurant.soldByDish.every(isDishSalesState) &&
    Array.isArray(restaurant.recentSales) &&
    restaurant.recentSales.length <= 20 &&
    restaurant.recentSales.every(isSaleState)
  );
}

export function legacyGameplayRuntimeStateToSaveSlices(
  state: LegacyGameplayRuntimeState,
): GameplayRuntimeSaveSlices {
  if (!isLegacyGameplayRuntimeState(state)) {
    throw new Error("Gameplay runtime aggregate state is invalid.");
  }
  const kitchenActivated = state.kitchenActivated ??
    (state.cooking.activeJob !== null || state.cooking.completedBatches > 0);
  return Object.freeze({
    gameplayRuntime: Object.freeze({
      version: 1,
      revision: state.revision,
      currentUtcMs: state.currentUtcMs,
      nextSupplyAtUtcMs: state.nextSupplyAtUtcMs,
      supplyBoxesReceived: state.supplyBoxesReceived,
      randomState: state.randomState,
      kitchenActivated,
      upgrades: Object.freeze({
        ...DEFAULT_BUSINESS_UPGRADES,
        ...(state.upgrades ?? {}),
      }),
    }),
    gameplayInventory: Object.freeze({
      kitchenIngredients: Object.freeze([...state.inventory.kitchenIngredients]),
      kitchenOutput: Object.freeze([...state.inventory.kitchenOutput]),
      cableCargo: Object.freeze([...state.inventory.cableCargo]),
      restaurantStorage: Object.freeze([...state.inventory.restaurantStorage]),
    }),
    cooking: state.cooking,
    logistics: state.logistics,
    restaurant: state.restaurant,
    ...(state.procurement === undefined
      ? {}
      : { procurementHistory: state.procurement }),
  });
}

function gameplayRuntimeSaveSlicesToState(
  slices: GameplayRuntimeSaveSlices,
): LegacyGameplayRuntimeState {
  return Object.freeze({
    ...slices.gameplayRuntime,
    inventory: slices.gameplayInventory,
    cooking: slices.cooking,
    logistics: slices.logistics,
    restaurant: slices.restaurant,
    ...(slices.procurementHistory === undefined
      ? {}
      : { procurement: slices.procurementHistory }),
  });
}

export function isGameplayRuntimeSaveSlices(
  value: unknown,
): value is GameplayRuntimeSaveSlices {
  if (!isRecord(value) || !isRecord(value.gameplayRuntime) ||
    !isRecord(value.gameplayInventory) || !isRecord(value.cooking) ||
    !isRecord(value.logistics) || !isRecord(value.restaurant) ||
    (value.procurementHistory !== undefined && !isRecord(value.procurementHistory))) {
    return false;
  }
  const runtime = value.gameplayRuntime;
  if (runtime.version !== 1 || typeof runtime.kitchenActivated !== "boolean" ||
    !isRecord(runtime.upgrades)) {
    return false;
  }
  return isLegacyGameplayRuntimeState({
    ...runtime,
    inventory: value.gameplayInventory,
    cooking: value.cooking,
    logistics: value.logistics,
    restaurant: value.restaurant,
    ...(value.procurementHistory === undefined
      ? {}
      : { procurement: value.procurementHistory }),
  });
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


export class GameplayRuntime {
  readonly #inventory: InventorySystem;
  readonly #cooking: CookingSystem;
  readonly #logistics: LogisticsSystem;
  readonly #restaurant: RestaurantSystem;
  readonly #procurement: ProcurementSystem;
  readonly #random: SeededRandom;
  readonly #ingredientCapacities = new Map<string, number>();
  readonly #supply: GameplaySupplyConfig;
  #revision = 0;
  #currentUtcMs: number;
  #nextSupplyAtUtcMs: number;
  #supplyBoxesReceived = 0;
  #kitchenActivated = false;
  #upgradeLevels: BusinessUpgradeLevels = DEFAULT_BUSINESS_UPGRADES;

  constructor(config: GameplayRuntimeConfig) {
    if (
      !Number.isSafeInteger(config.startUtcMs) ||
      config.startUtcMs < 0 ||
      config.ingredients.length === 0 ||
      config.recipes.length === 0 ||
      !isPositiveInteger(config.supply.intervalMs) ||
      (config.supply.emergencyThreshold !== undefined &&
        !isNonNegativeInteger(config.supply.emergencyThreshold))
    ) {
      throw new Error("Gameplay runtime configuration is invalid.");
    }
    if (config.initialSlices !== undefined && !isGameplayRuntimeSaveSlices(config.initialSlices)) {
      throw new Error("Gameplay runtime save slices are invalid.");
    }
    const initialState = config.initialSlices === undefined
      ? undefined
      : gameplayRuntimeSaveSlicesToState(config.initialSlices);
    if (
      initialState !== undefined &&
      !isLegacyGameplayRuntimeState(initialState)
    ) {
      throw new Error("Gameplay runtime restore state is invalid.");
    }
    this.#currentUtcMs =
      initialState?.currentUtcMs ?? config.startUtcMs;
    this.#supply = Object.freeze({
      intervalMs: config.supply.intervalMs,
      ...(config.supply.emergencyThreshold === undefined
        ? {}
        : { emergencyThreshold: config.supply.emergencyThreshold }),
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
    this.#upgradeLevels = Object.freeze({
      ...DEFAULT_BUSINESS_UPGRADES,
      ...(initialState?.upgrades ?? {}),
    });
    this.#kitchenActivated = initialState?.kitchenActivated ??
      (initialState !== undefined &&
        (initialState.cooking.activeJob !== null ||
          initialState.cooking.completedBatches > 0));

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

    const procurementRegions = config.procurementRegions ?? [
      {
        id: "region.local",
        name: "Local Port",
        deliveryDurationMs: 15_000,
        freightCostCopper: 0,
        cargoCapacity: 12,
        minimumTransportLevel: 0,
        items: ingredientIds.map((itemId) => ({
          itemId,
          unitPriceCopper: 1,
        })),
      },
    ];
    this.#procurement = new ProcurementSystem({
      inventory: this.#inventory,
      ingredientContainerId: KITCHEN_INGREDIENTS,
      ingredientCapacities: this.#ingredientCapacities,
      regions: procurementRegions,
      ...(initialState?.procurement === undefined
        ? {}
        : { initialState: initialState.procurement }),
    });
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
      maximumWaitMs: 360_000,
      seatedIdleDurationMs: 24_000,
      seatCapacity: 3 + this.#upgradeLevels.restaurant,
      ...(config.finance === undefined ? {} : { finance: config.finance }),
      ...(initialState === undefined
        ? {}
        : { initialState: initialState.restaurant }),
    });

    this.#applyUpgradeEffects();

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
    if (
      !selectedCooking.accepted ||
      !selectedMenu.accepted
    ) {
      throw new Error(
        "Gameplay runtime could not start its default recipe.",
      );
    }
  }

  get inventoryModule(): InventoryModule {
    return this.#inventory.inventoryModule;
  }

  setCustomerArrivalIntervalRateBasisPoints(rateBasisPoints: number): boolean {
    return this.#restaurant.setCustomerArrivalIntervalRateBasisPoints(rateBasisPoints);
  }

  getSnapshot(): GameplayRuntimeSnapshot {
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
      upgrades: this.#getUpgradeSnapshot(),
      procurement: this.#procurement.getSnapshot(),
    });
  }

  exportSaveSlices(): GameplayRuntimeSaveSlices {
    const snapshot = this.getSnapshot();
    return Object.freeze({
      gameplayRuntime: Object.freeze({
        version: 1,
        revision: this.#revision,
        currentUtcMs: this.#currentUtcMs,
        nextSupplyAtUtcMs: this.#nextSupplyAtUtcMs,
        supplyBoxesReceived: this.#supplyBoxesReceived,
        randomState: this.#random.getState(),
        kitchenActivated: this.#kitchenActivated,
        upgrades: Object.freeze({ ...this.#upgradeLevels }),
      }),
      gameplayInventory: Object.freeze({
        kitchenIngredients: stacksFromSnapshot(snapshot.inventory.kitchenIngredients),
        kitchenOutput: stacksFromSnapshot(snapshot.inventory.kitchenOutput),
        cableCargo: stacksFromSnapshot(snapshot.inventory.cableCargo),
        restaurantStorage: stacksFromSnapshot(snapshot.inventory.restaurantStorage),
      }),
      cooking: this.#cooking.exportState(),
      logistics: this.#logistics.exportState(),
      restaurant: this.#restaurant.exportState(),
      procurementHistory: this.#procurement.exportState(),
    });
  }
  selectRecipe(
    operationId: string,
    recipeId: string,
  ): GameplayRuntimeActionResult {
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
  ): GameplayRuntimeActionResult {
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

  #getUpgradeSnapshot(): BusinessUpgradeSnapshot {
    return Object.freeze({
      ...this.#upgradeLevels,
      maxLevel: BUSINESS_UPGRADE_MAX_LEVEL,
      maxLevels: Object.freeze({
        kitchen: BUSINESS_UPGRADE_MAX_LEVEL,
        transport: BUSINESS_UPGRADE_MAX_LEVEL,
        restaurant: BUSINESS_UPGRADE_MAX_LEVEL,
        procurement: 1,
      }),
      nextCosts: Object.freeze({
        kitchen: nextUpgradeCost("kitchen", this.#upgradeLevels.kitchen),
        transport: nextUpgradeCost("transport", this.#upgradeLevels.transport),
        restaurant: nextUpgradeCost("restaurant", this.#upgradeLevels.restaurant),
        procurement: nextUpgradeCost("procurement", this.#upgradeLevels.procurement),
      }),
    });
  }
  #applyUpgradeEffects(): void {
    this.#cooking.setDurationScale(1 - this.#upgradeLevels.kitchen * 0.15);
    const travelDurationMs = upgradeDuration(20_000, this.#upgradeLevels.transport);
    this.#logistics.setTravelDurationMs(travelDurationMs, travelDurationMs);
    this.#restaurant.setSeatCapacity(3 + this.#upgradeLevels.restaurant);
    this.#procurement.setUnlocks(
      this.#upgradeLevels.transport,
      this.#upgradeLevels.procurement > 0,
    );
  }
  advanceTo(observedUtcMs: number): GameplayRuntimeAdvanceResult {
    const timeAdvance = calculateTimeAdvance(
      this.#currentUtcMs,
      observedUtcMs,
    );
    const targetUtcMs = timeAdvance.effectiveUtcMs;
    let changeCount = 0;
    const restaurantEvents: RestaurantEvent[] = [];
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
          "Gameplay runtime produced a transition before its current time.",
        );
      }

      const transitionChanges = this.#processAt(
        nextTransitionUtcMs,
        restaurantEvents,
      );
      if (
        transitionChanges === 0 &&
        nextTransitionUtcMs === this.#currentUtcMs
      ) {
        throw new Error("Gameplay runtime transition became stalled.");
      }
      changeCount += transitionChanges;
      this.#currentUtcMs = nextTransitionUtcMs;
      targetWasProcessed = nextTransitionUtcMs === targetUtcMs;
    }

    if (!targetWasProcessed) {
      changeCount += this.#processAt(targetUtcMs, restaurantEvents);
    }
    this.#currentUtcMs = targetUtcMs;
    if (changeCount > 0) {
      this.#revision += 1;
    }

    return Object.freeze({
      changed: changeCount > 0,
      clockRollbackDetected: timeAdvance.clockRollbackDetected,
      snapshot: this.getSnapshot(),
      restaurantEvents: Object.freeze([...restaurantEvents]),
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
      this.#procurement.getSnapshot().nextTransitionUtcMs,
      this.#nextSupplyAtUtcMs,
    ]);
  }

  #processAt(
    atUtcMs: number,
    restaurantEvents: RestaurantEvent[],
  ): number {
    let changeCount = 0;
    const procurement = this.#procurement.advanceTo(atUtcMs);
    if (procurement.changed) changeCount += procurement.arrivals.length;
    if (atUtcMs === this.#nextSupplyAtUtcMs) {
      this.#deliverSupply();
      changeCount += 1;
    }

    // Additional passes resolve same-time cross-system effects:
    // cooking can free/load transport, and a sale can free unload space.
    for (let pass = 0; pass < 3; pass += 1) {
      const cookingEventCount = this.#kitchenActivated
        ? this.#cooking.advanceTo(atUtcMs).events.length
        : 0;
      changeCount += cookingEventCount;
      const logisticsEventCount = this.#logistics.advanceTo(atUtcMs).events.length;
      changeCount += logisticsEventCount;
      const restaurantResult = this.#restaurant.advanceTo(atUtcMs);
      changeCount += restaurantResult.events.length;
      const kitchenOrderReceived = restaurantResult.events.some(
        (event) => event.type === "kitchen.order-received",
      );
      if (kitchenOrderReceived) this.#kitchenActivated = true;
      restaurantEvents.push(...restaurantResult.events);
      if (
        kitchenOrderReceived ||
        cookingEventCount > 0 ||
        logisticsEventCount > 0 ||
        atUtcMs === this.#nextSupplyAtUtcMs
      ) {
        changeCount += this.#ensureActiveOrderCooking(atUtcMs);
      }
      if (restaurantEvents.length > RESTAURANT_PRESENTATION_EVENT_LIMIT) {
        restaurantEvents.splice(
          0,
          restaurantEvents.length - RESTAURANT_PRESENTATION_EVENT_LIMIT,
        );
      }
    }

    return changeCount;
  }

  #ensureActiveOrderCooking(atUtcMs: number): number {
    const customer = this.#restaurant.getSnapshot().activeCustomer;
    if (customer === null || customer.phase !== "waiting-meal") return 0;

    const dishAlreadyInTransit = [
      KITCHEN_OUTPUT,
      CABLE_CARGO,
      RESTAURANT_STORAGE,
    ].some((containerId) =>
      this.#inventory
        .getContainerSnapshot(containerId)
        .entries.some(
          (entry) => entry.itemId === customer.dishItemId && entry.quantity > 0,
        ),
    );
    if (dishAlreadyInTransit || this.#cooking.getSnapshot().activeJob !== null) {
      return 0;
    }

    this.#kitchenActivated = true;
    let changeCount = 0;
    if (this.#cooking.getSnapshot().selectedRecipeId !== customer.recipeId) {
      const selection = this.#cooking.selectRecipe(
        `${customer.id}:kitchen-select:${atUtcMs}`,
        customer.recipeId,
      );
      if (!selection.accepted) {
        throw new Error(`Kitchen order recipe selection failed: ${selection.code}`);
      }
      changeCount += 1;
    }
    const start = this.#cooking.startBatch(
      `${customer.id}:kitchen-start:${atUtcMs}`,
      atUtcMs,
    );
    if (start.accepted) return changeCount + 1;
    if (
      start.code !== "INSUFFICIENT_INGREDIENTS" &&
      start.code !== "OUTPUT_CAPACITY_EXCEEDED"
    ) {
      throw new Error(`Kitchen order start failed: ${start.code}`);
    }
    return changeCount;
  }
  #deliverSupply(): void {
    const pantry = this.#inventory.getContainerSnapshot(
      KITCHEN_INGREDIENTS,
    );
    if (
      this.#supply.emergencyThreshold !== undefined &&
      pantry.totalQuantity > this.#supply.emergencyThreshold
    ) {
      this.#nextSupplyAtUtcMs = safeAddTime(
        this.#nextSupplyAtUtcMs,
        this.#supply.intervalMs,
      );
      return;
    }

    this.#supplyBoxesReceived += 1;
    if (!Number.isSafeInteger(this.#supplyBoxesReceived)) {
      throw new RangeError(
        "Supply delivery count exceeds the safe integer range.",
      );
    }
    const incomingQuantities = new Map(
      this.#procurement.getSnapshot().incomingItems.map(
        (entry) => [entry.itemId, entry.quantity],
      ),
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
      const incoming = incomingQuantities.get(item.itemId) ?? 0;
      const quantity = Math.min(item.quantity, capacity - current - incoming);
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
