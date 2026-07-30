import { describe, expect, it, vi } from "vitest";
import {
  createOfflineEarningsSummary,
  GameRuntime,
  isM2SimulationState,
  M2Simulation,
  type M2SimulationConfig,
  type M2SimulationState,
} from "../src";

const START_UTC_MS = 1_000_000;

function createConfig(
  startUtcMs = START_UTC_MS,
  initialState?: M2SimulationState,
): M2SimulationConfig {
  const config: M2SimulationConfig = {
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
  return initialState === undefined
    ? config
    : { ...config, initialState };
}

function createTwoRecipeConfig(
  initialState?: M2SimulationState,
): M2SimulationConfig {
  const base = createConfig(START_UTC_MS, initialState);
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

describe("M2Simulation", () => {
  it("runs supply, cooking, delivery, and restaurant sales as one loop", () => {
    const simulation = new M2Simulation(createConfig());

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
  });

  it("is deterministic across a 24 hour advance", () => {
    const first = new M2Simulation(createConfig());
    const second = new M2Simulation(createConfig());
    const targetUtcMs = START_UTC_MS + 24 * 60 * 60_000;

    expect(first.advanceTo(targetUtcMs).snapshot).toEqual(
      second.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("clamps clock rollback without replaying production", () => {
    const simulation = new M2Simulation(createConfig());
    simulation.advanceTo(START_UTC_MS + 10 * 60_000);
    const beforeRollback = simulation.getSnapshot();

    const result = simulation.advanceTo(START_UTC_MS + 5 * 60_000);

    expect(result.changed).toBe(false);
    expect(result.clockRollbackDetected).toBe(true);
    expect(result.snapshot).toEqual(beforeRollback);
  });

  it("publishes completed business transitions through GameRuntime", () => {
    let nowUtcMs = START_UTC_MS;
    const simulation = new M2Simulation(createConfig());
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
    expect(listener).toHaveBeenCalledOnce();
    runtime.tick();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("round-trips active reservations and future deterministic results", () => {
    const original = new M2Simulation(createConfig());
    const serialized = JSON.stringify(original.exportState());
    const parsed: unknown = JSON.parse(serialized);

    expect(isM2SimulationState(parsed)).toBe(true);
    const restored = new M2Simulation(
      createConfig(
        START_UTC_MS,
        parsed as M2SimulationState,
      ),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 60 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("restores a shipment while it is traveling", () => {
    const original = new M2Simulation(createConfig());
    original.advanceTo(START_UTC_MS + 45_000);
    expect(original.getSnapshot().logistics.phase).toBe("outbound");

    const state = original.exportState();
    const restored = new M2Simulation(
      createConfig(state.currentUtcMs, state),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 10 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("restores a waiting customer without changing the future order", () => {
    const original = new M2Simulation(createConfig());
    original.advanceTo(START_UTC_MS + 40_000);
    expect(original.getSnapshot().restaurant.activeCustomer).not.toBeNull();

    const state = original.exportState();
    const restored = new M2Simulation(
      createConfig(state.currentUtcMs, state),
    );
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());

    const targetUtcMs = START_UTC_MS + 10 * 60_000;
    expect(restored.advanceTo(targetUtcMs).snapshot).toEqual(
      original.advanceTo(targetUtcMs).snapshot,
    );
  });

  it("changes the shared kitchen and restaurant menu and persists it", () => {
    const simulation = new M2Simulation(createTwoRecipeConfig());

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

    const state = simulation.exportState();
    const restored = new M2Simulation(
      createTwoRecipeConfig(state),
    );
    expect(restored.getSnapshot()).toEqual(simulation.getSnapshot());
  });

  it("dispatches gameplay operations and broadcasts accepted changes", () => {
    const simulation = new M2Simulation(createTwoRecipeConfig());
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
    const repeatResult = runtime.dispatch({
      id: "disable-repeat",
      type: "gameplay.set-auto-repeat",
      payload: { enabled: false },
    });

    expect(menuResult).toMatchObject({
      accepted: true,
      snapshot: {
        revision: 2,
        gameplay: {
          cooking: { selectedRecipeId: "recipe.soup" },
          restaurant: { selectedRecipeId: "recipe.soup" },
        },
      },
    });
    expect(repeatResult).toMatchObject({
      accepted: true,
      snapshot: {
        revision: 3,
        gameplay: {
          cooking: { autoRepeat: false },
        },
      },
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
      snapshot: { revision: 3 },
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("summarizes only the resources changed during offline advance", () => {
    const simulation = new M2Simulation(createConfig());
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
    const state = new M2Simulation(createConfig()).exportState();
    const malformed = {
      ...state,
      randomState: -1,
    };

    expect(isM2SimulationState(malformed)).toBe(false);
  });

  it("advances a 30 day offline span without an event-count cap", () => {
    const simulation = new M2Simulation(createConfig());
    const durationMs = 30 * 24 * 60 * 60_000;

    const result = simulation.advanceTo(START_UTC_MS + durationMs);

    expect(result.snapshot.currentUtcMs).toBe(
      START_UTC_MS + durationMs,
    );
    expect(result.snapshot.supplyBoxesReceived).toBe(21_600);
    expect(
      result.snapshot.restaurant.totalSoldQuantity,
    ).toBeGreaterThan(0);
  });
});
