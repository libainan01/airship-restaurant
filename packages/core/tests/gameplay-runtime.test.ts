import { describe, expect, it, vi } from "vitest";
import {
  createOfflineEarningsSummary,
  GameRuntime,
  isGameplayRuntimeSaveSlices,
  GameplayRuntime,
  type GameplayRuntimeConfig,
  type GameplayRuntimeSaveSlices,
} from "../src";

const START_UTC_MS = 1_000_000;

function createConfig(
  startUtcMs = START_UTC_MS,
  initialSlices?: GameplayRuntimeSaveSlices,
): GameplayRuntimeConfig {
  const config: GameplayRuntimeConfig = {
    startUtcMs,
    randomSeed: 7_314,
    ingredients: [
      { id: "ingredient.wheat", capacity: 30 },
      { id: "ingredient.milk", capacity: 30 },
    ],
    recipes: [
      {
        id: "recipe.flatbread",
        durationMs: 45_000,
        outputItemId: "dish.flatbread",
        outputQuantity: 2,
        unitPriceCopper: 4,
        ingredients: [
          { itemId: "ingredient.wheat", quantity: 2 },
          { itemId: "ingredient.milk", quantity: 1 },
        ],
      },
    ],
    initialIngredients: [
      { itemId: "ingredient.wheat", quantity: 12 },
      { itemId: "ingredient.milk", quantity: 6 },
    ],
    supply: {
      intervalMs: 120_000,
      items: [
        { itemId: "ingredient.wheat", quantity: 6 },
        { itemId: "ingredient.milk", quantity: 3 },
      ],
    },
    defaultRecipeId: "recipe.flatbread",
  };
  return initialSlices === undefined
    ? config
    : { ...config, initialSlices };
}

function createTwoRecipeConfig(
  initialSlices?: GameplayRuntimeSaveSlices,
): GameplayRuntimeConfig {
  const base = createConfig(START_UTC_MS, initialSlices);
  return {
    ...base,
    recipes: [
      ...base.recipes,
      {
        id: "recipe.soup",
        durationMs: 90_000,
        outputItemId: "dish.soup",
        outputQuantity: 3,
        unitPriceCopper: 7,
        ingredients: [
          { itemId: "ingredient.wheat", quantity: 1 },
          { itemId: "ingredient.milk", quantity: 1 },
        ],
      },
    ],
  };
}

describe("GameplayRuntime", () => {
  it("runs supply, cooking, delivery, and restaurant sales as one loop", () => {
    const simulation = new GameplayRuntime(createConfig());

    const result = simulation.advanceTo(START_UTC_MS + 10 * 60_000);

    expect(result.changed).toBe(true);
    expect(result.snapshot.supplyBoxesReceived).toBe(5);
    expect(result.snapshot.cooking.completedBatches).toBeGreaterThan(0);
    expect(
      result.snapshot.logistics.totalDeliveredQuantity,
    ).toBeGreaterThan(0);
    expect(
      result.snapshot.restaurant.totalSoldQuantity,
    ).toBeGreaterThan(0);
    expect(result.snapshot.restaurant.copperBalance).toBe(
      result.snapshot.restaurant.totalSoldQuantity * 4,
    );
    expect(result.restaurantEvents.some((event) => event.type === "customer.arrived")).toBe(true);
    expect(result.restaurantEvents.some((event) => event.type === "order.requested")).toBe(true);
    expect(result.restaurantEvents.some((event) => event.type === "order.confirmed")).toBe(true);
    expect(result.restaurantEvents.some((event) => event.type === "kitchen.order-received")).toBe(true);
    expect(result.restaurantEvents.some((event) => event.type === "order.fulfilled")).toBe(true);
  });

  it("is deterministic across a 24 hour advance", () => {
    const first = new GameplayRuntime(createConfig());
    const second = new GameplayRuntime(createConfig());
    const targetUtcMs = START_UTC_MS + 24 * 60 * 60_000;

    expect(first.advanceTo(targetUtcMs).snapshot).toEqual(
      second.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("clamps clock rollback without replaying production", () => {
    const simulation = new GameplayRuntime(createConfig());
    simulation.advanceTo(START_UTC_MS + 10 * 60_000);
    const beforeRollback = simulation.getSnapshot();

    const result = simulation.advanceTo(START_UTC_MS + 5 * 60_000);

    expect(result.changed).toBe(false);
    expect(result.clockRollbackDetected).toBe(true);
    expect(result.snapshot).toEqual(beforeRollback);
  });

  it("publishes completed business transitions through GameRuntime", () => {
    let nowUtcMs = START_UTC_MS;
    const simulation = new GameplayRuntime(createConfig());
    const runtime = new GameRuntime(
      { nowUtcMs: () => nowUtcMs },
      simulation,
    );
    const listener = vi.fn();
    runtime.markReady();
    runtime.subscribe(listener);

    nowUtcMs += 10 * 60_000;
    const snapshot = runtime.tick();

    expect(snapshot.revision).toBe(2);
    expect(snapshot.gameplay?.restaurant.totalSoldQuantity).toBeGreaterThan(
      0,
    );
    expect(snapshot.restaurantActivity.revision).toBe(1);
    expect(
      snapshot.restaurantActivity.events.some(
        (event) => event.type === "customer.arrived",
      ),
    ).toBe(true);
    expect(
      snapshot.restaurantActivity.events.some(
        (event) => event.type === "order.fulfilled",
      ),
    ).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    runtime.tick();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("round-trips active reservations and future deterministic results", () => {
    const original = new GameplayRuntime(createConfig());
    const serialized = JSON.stringify(original.exportSaveSlices());
    const parsed: unknown = JSON.parse(serialized);

    expect(isGameplayRuntimeSaveSlices(parsed)).toBe(true);
    const restored = new GameplayRuntime(
      createConfig(
        START_UTC_MS,
        parsed as GameplayRuntimeSaveSlices,
      ),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 60 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("restores a shipment while it is traveling", () => {
    const original = new GameplayRuntime(createConfig());
    for (
      let atUtcMs = START_UTC_MS + 45_000;
      atUtcMs <= START_UTC_MS + 180_000;
      atUtcMs += 1_000
    ) {
      original.advanceTo(atUtcMs);
      if (original.getSnapshot().logistics.phase === "outbound") break;
    }
    expect(original.getSnapshot().logistics.phase).toBe("outbound");

    const state = original.exportSaveSlices();
    const restored = new GameplayRuntime(
      createConfig(state.gameplayRuntime.currentUtcMs, state),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 10 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("restores a waiting customer without changing the future order", () => {
    const original = new GameplayRuntime(createConfig());
    original.advanceTo(START_UTC_MS + 40_000);
    expect(original.getSnapshot().restaurant.activeCustomer).not.toBeNull();

    const state = original.exportSaveSlices();
    const restored = new GameplayRuntime(
      createConfig(state.gameplayRuntime.currentUtcMs, state),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 10 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("changes the shared kitchen and restaurant menu and persists it", () => {
    const simulation = new GameplayRuntime(createTwoRecipeConfig());

    const menuResult = simulation.selectRecipe(
      "select-soup",
      "recipe.soup",
    );
    const repeatResult = simulation.setAutoRepeat(
      "disable-repeat",
      false,
    );

    expect(menuResult).toMatchObject({
      accepted: true,
      changed: true,
      snapshot: {
        cooking: { selectedRecipeId: "recipe.soup" },
        restaurant: { selectedRecipeId: "recipe.soup" },
      },
    });
    expect(repeatResult).toMatchObject({
      accepted: true,
      changed: true,
      snapshot: {
        cooking: { autoRepeat: false },
      },
    });

    const state = simulation.exportSaveSlices();
    const restored = new GameplayRuntime(
      createTwoRecipeConfig(state),
    );
    expect(restored.getSnapshot()).toEqual(simulation.getSnapshot());
  });

  it("dispatches gameplay operations and broadcasts accepted changes", () => {
    const simulation = new GameplayRuntime(createTwoRecipeConfig());
    const runtime = new GameRuntime(
      { nowUtcMs: () => START_UTC_MS },
      simulation,
    );
    runtime.markReady();
    const listener = vi.fn();
    runtime.subscribe(listener);

    const menuResult = runtime.dispatch({
      id: "select-soup",
      type: "gameplay.select-recipe",
      payload: { recipeId: "recipe.soup" },
    });
    const menuSnapshot = runtime.getSnapshot();
    const repeatResult = runtime.dispatch({
      id: "disable-repeat",
      type: "gameplay.set-auto-repeat",
      payload: { enabled: false },
    });

    expect(menuResult).toMatchObject({ accepted: true });
    expect(menuSnapshot).toMatchObject({
      revision: 2,
      gameplay: {
        cooking: { selectedRecipeId: "recipe.soup" },
        restaurant: { selectedRecipeId: "recipe.soup" },
      },
    });
    expect(repeatResult).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot()).toMatchObject({
      revision: 3,
      gameplay: { cooking: { autoRepeat: false } },
    });
    expect(listener).toHaveBeenCalledTimes(2);

    const rejected = runtime.dispatch({
      id: "select-missing",
      type: "gameplay.select-recipe",
      payload: { recipeId: "recipe.missing" },
    });
    expect(rejected).toMatchObject({
      accepted: false,
      code: "GAMEPLAY_REJECTED",
    });
    expect(runtime.getSnapshot().revision).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("summarizes only the resources changed during offline advance", () => {
    const simulation = new GameplayRuntime(createConfig());
    const before = simulation.getSnapshot();
    const after = simulation.advanceTo(
      START_UTC_MS + 10 * 60_000,
    ).snapshot;

    expect(createOfflineEarningsSummary(before, after)).toEqual({
      elapsedMs: after.currentUtcMs - before.currentUtcMs,
      supplyBoxesReceived:
        after.supplyBoxesReceived - before.supplyBoxesReceived,
      cookingBatchesCompleted:
        after.cooking.completedBatches -
        before.cooking.completedBatches,
      deliveredQuantity:
        after.logistics.totalDeliveredQuantity -
        before.logistics.totalDeliveredQuantity,
      soldQuantity:
        after.restaurant.totalSoldQuantity -
        before.restaurant.totalSoldQuantity,
      customersLeft:
        after.restaurant.totalCustomersLeft -
        before.restaurant.totalCustomersLeft,
      copperEarned:
        after.restaurant.copperBalance -
        before.restaurant.copperBalance,
    });
  });

  it("rejects malformed save state before restoration", () => {
    const state = new GameplayRuntime(createConfig()).exportSaveSlices();
    const malformed = {
      ...state,
      gameplayRuntime: {
        ...state.gameplayRuntime,
        randomState: -1,
      },
    };

    expect(isGameplayRuntimeSaveSlices(malformed)).toBe(false);
  });

  it(
    "advances a 30 day offline span without an event-count cap",
    () => {
      const simulation = new GameplayRuntime(createConfig());
      const durationMs = 30 * 24 * 60 * 60_000;

      const result = simulation.advanceTo(START_UTC_MS + durationMs);

      expect(result.snapshot.currentUtcMs).toBe(
        START_UTC_MS + durationMs,
      );
      expect(result.snapshot.supplyBoxesReceived).toBe(21_600);
      expect(
        result.snapshot.restaurant.totalSoldQuantity,
      ).toBeGreaterThan(0);
    },
    30_000,
  );
});

describe("Gameplay runtime emergency supply", () => {
  it("does not send free supplies while the pantry is above the threshold", () => {
    const base = createConfig();
    const simulation = new GameplayRuntime({
      ...base,
      recipes: base.recipes.map((recipe) => ({
        ...recipe,
        durationMs: 10 * 60_000,
      })),
      supply: {
        ...base.supply,
        emergencyThreshold: 3,
      },
    });

    simulation.advanceTo(START_UTC_MS + 120_000);

    expect(simulation.getSnapshot().supplyBoxesReceived).toBe(0);
  });
});
