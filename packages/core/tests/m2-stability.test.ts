import {
  M2_CONTENT_DEFINITIONS,
  M2_INITIAL_INGREDIENTS,
} from "../../content/src";
import { describe, expect, it } from "vitest";
import {
  isGameplayRuntimeSaveSlices,
  GameplayRuntime,
  type InventoryContainerSnapshot,
  type GameplayRuntimeConfig,
  type GameplayRuntimeSnapshot,
  type GameplayRuntimeSaveSlices,
} from "../src";

const START_UTC_MS = Date.UTC(2026, 0, 1);
const HOUR_MS = 60 * 60_000;
const STABILITY_DURATION_MS = 8 * HOUR_MS;
const TARGET_UTC_MS = START_UTC_MS + STABILITY_DURATION_MS;

const RECIPE_PRICES = new Map(
  M2_CONTENT_DEFINITIONS.recipes.map((recipe) => [
    recipe.outputItemId,
    recipe.unitPriceCopper,
  ]),
);

function createConfig(
  initialSlices?: GameplayRuntimeSaveSlices,
): GameplayRuntimeConfig {
  const supply = M2_CONTENT_DEFINITIONS.supplyBundles[0];
  if (supply === undefined) {
    throw new Error("M2 stability test requires the basic supply bundle.");
  }
  const config: GameplayRuntimeConfig = {
    startUtcMs: initialSlices?.gameplayRuntime.currentUtcMs ?? START_UTC_MS,
    randomSeed: 0x0a17_5eed,
    ingredients: M2_CONTENT_DEFINITIONS.ingredients.map(
      (ingredient) => ({
        id: ingredient.id,
        capacity: ingredient.capacity,
      }),
    ),
    recipes: M2_CONTENT_DEFINITIONS.recipes.map((recipe) => ({
      ...recipe,
    })),
    initialIngredients: M2_INITIAL_INGREDIENTS,
    supply: {
      intervalMs: supply.intervalMs,
      items: supply.items,
    },
    defaultRecipeId: "recipe.hearth_flatbread",
  };
  return initialSlices === undefined
    ? config
    : { ...config, initialSlices };
}

function getComparableState(simulation: GameplayRuntime) {
  const state = simulation.exportSaveSlices();
  const { revision: _revision, ...gameplayRuntime } = state.gameplayRuntime;
  return { ...state, gameplayRuntime };
}

function getComparableSnapshot(
  simulation: GameplayRuntime,
): Omit<GameplayRuntimeSnapshot, "revision"> {
  const { revision: _revision, ...snapshot } =
    simulation.getSnapshot();
  return snapshot;
}

function advanceInOneSecondTicks(
  simulation: GameplayRuntime,
  targetUtcMs: number,
): void {
  for (
    let nextUtcMs = simulation.getSnapshot().currentUtcMs + 1_000;
    nextUtcMs <= targetUtcMs;
    nextUtcMs += 1_000
  ) {
    simulation.advanceTo(nextUtcMs);
  }
  if (simulation.getSnapshot().currentUtcMs < targetUtcMs) {
    simulation.advanceTo(targetUtcMs);
  }
}

function restoreFromSerializedState(
  simulation: GameplayRuntime,
): GameplayRuntime {
  const parsed: unknown = JSON.parse(
    JSON.stringify(simulation.exportSaveSlices()),
  );
  expect(isGameplayRuntimeSaveSlices(parsed)).toBe(true);
  return new GameplayRuntime(createConfig(parsed as GameplayRuntimeSaveSlices));
}

function expectContainerInvariants(
  container: InventoryContainerSnapshot,
): void {
  const totalQuantity = container.entries.reduce(
    (total, entry) => total + entry.quantity,
    0,
  );
  expect(container.totalQuantity).toBe(totalQuantity);
  expect(container.availableCapacity).toBe(
    container.capacity - totalQuantity,
  );
  expect(totalQuantity).toBeGreaterThanOrEqual(0);
  expect(totalQuantity).toBeLessThanOrEqual(container.capacity);
  for (const entry of container.entries) {
    expect(entry.quantity).toBeGreaterThan(0);
    expect(entry.reservedQuantity).toBeGreaterThanOrEqual(0);
    expect(entry.reservedQuantity).toBeLessThanOrEqual(entry.quantity);
    expect(entry.availableQuantity).toBe(
      entry.quantity - entry.reservedQuantity,
    );
  }
}

function expectBusinessInvariants(
  snapshot: GameplayRuntimeSnapshot,
): void {
  for (const container of Object.values(snapshot.inventory)) {
    expectContainerInvariants(container);
  }

  const soldByDish = snapshot.restaurant.soldByDish.reduce(
    (total, entry) => total + entry.quantity,
    0,
  );
  const expectedCopper = snapshot.restaurant.soldByDish.reduce(
    (total, entry) => {
      const price = RECIPE_PRICES.get(entry.dishItemId);
      expect(price).toBeDefined();
      return total + entry.quantity * (price ?? 0);
    },
    0,
  );
  expect(snapshot.restaurant.totalSoldQuantity).toBe(soldByDish);
  expect(snapshot.restaurant.copperBalance).toBe(expectedCopper);

  expect(snapshot.logistics.cargoQuantity).toBe(
    snapshot.inventory.cableCargo.totalQuantity,
  );
  expect(snapshot.logistics.kitchenWaitingQuantity).toBe(
    snapshot.inventory.kitchenOutput.totalQuantity,
  );
  expect(snapshot.logistics.totalDeliveredQuantity).toBe(
    snapshot.inventory.restaurantStorage.totalQuantity +
      snapshot.restaurant.totalSoldQuantity,
  );
}

function expectFlatbreadConservation(
  snapshot: GameplayRuntimeSnapshot,
): void {
  const dishesOnHand =
    snapshot.inventory.kitchenOutput.totalQuantity +
    snapshot.inventory.cableCargo.totalQuantity +
    snapshot.inventory.restaurantStorage.totalQuantity;
  expect(snapshot.cooking.completedBatches * 2).toBe(
    dishesOnHand + snapshot.restaurant.totalSoldQuantity,
  );
  expect(snapshot.restaurant.copperBalance).toBe(
    snapshot.restaurant.totalSoldQuantity * 4,
  );
}

function runMenuSchedule(
  restoreEachCheckpoint: boolean,
): GameplayRuntime {
  let simulation = new GameplayRuntime(createConfig());
  const checkpoints = [
    {
      atUtcMs: START_UTC_MS + 2 * HOUR_MS,
      recipeId: "recipe.windroot_soup",
    },
    {
      atUtcMs: START_UTC_MS + 4 * HOUR_MS,
      recipeId: "recipe.homecoming_stew",
    },
    {
      atUtcMs: START_UTC_MS + 6 * HOUR_MS,
      recipeId: "recipe.hearth_flatbread",
    },
  ] as const;

  for (const [index, checkpoint] of checkpoints.entries()) {
    simulation.advanceTo(checkpoint.atUtcMs);
    const result = simulation.selectRecipe(
      `stability-menu-${index}`,
      checkpoint.recipeId,
    );
    expect(result.accepted).toBe(true);
    if (restoreEachCheckpoint) {
      simulation = restoreFromSerializedState(simulation);
    }
  }
  simulation.advanceTo(TARGET_UTC_MS);
  return simulation;
}

function reportStabilityResult(
  elapsedWallMs: number,
  snapshot: GameplayRuntimeSnapshot,
): void {
  if (process.env.AIRSHIP_STABILITY_REPORT !== "1") {
    return;
  }
  console.info(
    `M2_STABILITY_REPORT ${JSON.stringify({
      simulatedHours: 8,
      elapsedWallMs: Math.round(elapsedWallMs),
      currentUtcMs: snapshot.currentUtcMs,
      supplyBoxesReceived: snapshot.supplyBoxesReceived,
      cookingBatches: snapshot.cooking.completedBatches,
      deliveredQuantity: snapshot.logistics.totalDeliveredQuantity,
      soldQuantity: snapshot.restaurant.totalSoldQuantity,
      customersLeft: snapshot.restaurant.totalCustomersLeft,
      copperBalance: snapshot.restaurant.copperBalance,
      inventory: Object.fromEntries(
        Object.entries(snapshot.inventory).map(([id, container]) => [
          id,
          container.totalQuantity,
        ]),
      ),
    })}`,
  );
}

describe("M2 eight-hour stability", () => {
  it("produces the same business state with one jump or one-second ticks", () => {
    const startedAt = performance.now();
    const oneJump = new GameplayRuntime(createConfig());
    const oneSecondTicks = new GameplayRuntime(createConfig());

    oneJump.advanceTo(TARGET_UTC_MS);
    advanceInOneSecondTicks(oneSecondTicks, TARGET_UTC_MS);

    expect(getComparableSnapshot(oneSecondTicks)).toEqual(
      getComparableSnapshot(oneJump),
    );
    expect(oneSecondTicks.exportSaveSlices().gameplayRuntime.randomState).toBe(
      oneJump.exportSaveSlices().gameplayRuntime.randomState,
    );
    const snapshot = oneJump.getSnapshot();
    expect(snapshot.currentUtcMs).toBe(TARGET_UTC_MS);
    expect(snapshot.supplyBoxesReceived).toBe(240);
    expectBusinessInvariants(snapshot);
    expectFlatbreadConservation(snapshot);
    reportStabilityResult(performance.now() - startedAt, snapshot);
  }, 15_000);

  it("remains deterministic across hourly serialized restarts", () => {
    const continuous = new GameplayRuntime(createConfig());
    continuous.advanceTo(TARGET_UTC_MS);

    let restarted = new GameplayRuntime(createConfig());
    for (let hour = 1; hour <= 8; hour += 1) {
      restarted.advanceTo(START_UTC_MS + hour * HOUR_MS);
      restarted = restoreFromSerializedState(restarted);
      expectBusinessInvariants(restarted.getSnapshot());
    }

    expect(getComparableState(restarted)).toEqual(
      getComparableState(continuous),
    );
    expectFlatbreadConservation(restarted.getSnapshot());
  });

  it("preserves a multi-menu schedule across checkpoint restores", () => {
    const continuous = runMenuSchedule(false);
    const restarted = runMenuSchedule(true);

    expect(getComparableState(restarted)).toEqual(
      getComparableState(continuous),
    );
    expectBusinessInvariants(restarted.getSnapshot());
    expect(
      restarted.getSnapshot().restaurant.soldByDish.length,
    ).toBeGreaterThan(1);
  });
});
