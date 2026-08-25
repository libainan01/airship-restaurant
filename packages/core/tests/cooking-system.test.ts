import { describe, expect, it } from "vitest";
import { CookingSystem, type CookingRecipe } from "../src/cooking-system";
import { InventorySystem } from "../src/inventory-system";

const WHEAT = "ingredient.cloud_wheat";
const MILK = "ingredient.kettle_milk";
const DISH = "dish.hearth_flatbread";

const RECIPE: CookingRecipe = {
  id: "recipe.hearth_flatbread",
  durationMs: 45_000,
  outputItemId: DISH,
  outputQuantity: 2,
  ingredients: [
    { itemId: WHEAT, quantity: 2 },
    { itemId: MILK, quantity: 1 },
  ],
};

function createInventory(
  ingredientStacks = [
    { itemId: WHEAT, quantity: 6 },
    { itemId: MILK, quantity: 3 },
  ],
  outputCapacity = 4,
): InventorySystem {
  return new InventorySystem(
    [
      {
        id: "kitchen.ingredients",
        capacity: 60,
        acceptedItemIds: [WHEAT, MILK],
      },
      {
        id: "kitchen.output",
        capacity: outputCapacity,
        acceptedItemIds: [DISH],
      },
    ],
    ingredientStacks.length === 0
      ? {}
      : {
          "kitchen.ingredients": ingredientStacks,
        },
  );
}

function createCooking(
  inventory: InventorySystem,
  autoRepeatInitially = false,
): CookingSystem {
  return new CookingSystem({
    inventory,
    recipes: [RECIPE],
    ingredientContainerId: "kitchen.ingredients",
    outputContainerId: "kitchen.output",
    autoRepeatInitially,
  });
}

function entryQuantity(
  inventory: InventorySystem,
  containerId: string,
  itemId: string,
): number {
  return (
    inventory
      .getContainerSnapshot(containerId)
      .entries.find((entry) => entry.itemId === itemId)
      ?.quantity ?? 0
  );
}

describe("CookingSystem", () => {
  it("selects a recipe and reserves ingredients for a timed job", () => {
    const inventory = createInventory();
    const cooking = createCooking(inventory);

    expect(
      cooking.selectRecipe("select-flatbread", RECIPE.id),
    ).toMatchObject({ accepted: true });
    const result = cooking.startBatch("start-flatbread", 10_000);

    expect(result).toMatchObject({
      accepted: true,
      snapshot: {
        selectedRecipeId: RECIPE.id,
        activeJob: {
          id: "cooking-job-1",
          status: "cooking",
          startedAtUtcMs: 10_000,
          finishAtUtcMs: 55_000,
        },
      },
      events: [
        {
          type: "cooking.started",
          automatic: false,
        },
      ],
    });
    expect(
      inventory
        .getContainerSnapshot("kitchen.ingredients")
        .entries,
    ).toEqual([
      {
        itemId: WHEAT,
        quantity: 6,
        reservedQuantity: 2,
        availableQuantity: 4,
      },
      {
        itemId: MILK,
        quantity: 3,
        reservedQuantity: 1,
        availableQuantity: 2,
      },
    ]);
  });

  it("completes at the absolute finish time and writes output", () => {
    const inventory = createInventory();
    const cooking = createCooking(inventory);
    cooking.selectRecipe("select", RECIPE.id);
    cooking.startBatch("start", 1_000);

    expect(cooking.advanceTo(45_999).events).toHaveLength(0);
    const completion = cooking.advanceTo(46_000);

    expect(completion).toMatchObject({
      snapshot: {
        activeJob: null,
        completedBatches: 1,
      },
      events: [
        {
          type: "cooking.completed",
          recipeId: RECIPE.id,
          outputItemId: DISH,
          outputQuantity: 2,
          completedAtUtcMs: 46_000,
        },
      ],
    });
    expect(
      entryQuantity(inventory, "kitchen.ingredients", WHEAT),
    ).toBe(4);
    expect(
      entryQuantity(inventory, "kitchen.ingredients", MILK),
    ).toBe(2);
    expect(entryQuantity(inventory, "kitchen.output", DISH)).toBe(2);
  });

  it("starts the next batch automatically at the prior finish time", () => {
    const inventory = createInventory();
    const cooking = createCooking(inventory, true);
    cooking.selectRecipe("select", RECIPE.id);
    cooking.startBatch("start", 1_000);

    const result = cooking.advanceTo(46_000);
    expect(result.events.map((event) => event.type)).toEqual([
      "cooking.completed",
      "cooking.started",
    ]);
    expect(result.snapshot.activeJob).toMatchObject({
      id: "cooking-job-2",
      startedAtUtcMs: 46_000,
      finishAtUtcMs: 91_000,
    });
    expect(
      inventory
        .getContainerSnapshot("kitchen.ingredients")
        .entries,
    ).toEqual([
      {
        itemId: WHEAT,
        quantity: 4,
        reservedQuantity: 2,
        availableQuantity: 2,
      },
      {
        itemId: MILK,
        quantity: 2,
        reservedQuantity: 1,
        availableQuantity: 1,
      },
    ]);
  });

  it("waits for ingredients and resumes automatic cooking", () => {
    const inventory = createInventory([], 4);
    const cooking = createCooking(inventory, true);
    cooking.selectRecipe("select", RECIPE.id);

    expect(cooking.startBatch("start", 1_000)).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_INGREDIENTS",
      snapshot: { blockedReason: "insufficient-ingredients" },
    });

    cooking.advanceTo(1_500);
    cooking.advanceTo(1_900);
    expect(cooking.exportState().automaticAttemptSequence).toBe(0);

    inventory.deposit("supply", "kitchen.ingredients", [
      { itemId: WHEAT, quantity: 2 },
      { itemId: MILK, quantity: 1 },
    ]);
    expect(cooking.advanceTo(2_000)).toMatchObject({
      snapshot: {
        blockedReason: null,
        activeJob: {
          startedAtUtcMs: 2_000,
          finishAtUtcMs: 47_000,
        },
      },
      events: [{ type: "cooking.started", automatic: true }],
    });
    expect(cooking.exportState().automaticAttemptSequence).toBe(1);
  });

  it("keeps ingredients reserved while the output counter is full", () => {
    const inventory = createInventory(undefined, 2);
    const cooking = createCooking(inventory);
    cooking.selectRecipe("select", RECIPE.id);
    cooking.startBatch("start", 1_000);
    inventory.deposit("fill-output", "kitchen.output", [
      { itemId: DISH, quantity: 2 },
    ]);

    expect(cooking.advanceTo(46_000)).toMatchObject({
      snapshot: {
        activeJob: { status: "waiting-output" },
        blockedReason: "output-capacity",
        completedBatches: 0,
      },
      events: [
        {
          type: "cooking.blocked",
          reason: "output-capacity",
        },
      ],
    });
    expect(
      inventory
        .getContainerSnapshot("kitchen.ingredients")
        .entries.find((entry) => entry.itemId === WHEAT),
    ).toMatchObject({
      quantity: 6,
      reservedQuantity: 2,
    });

    cooking.advanceTo(46_500);
    expect(
      cooking.exportState().activeJob?.completionAttempt,
    ).toBe(1);

    inventory.withdraw("clear-output", "kitchen.output", [
      { itemId: DISH, quantity: 2 },
    ]);
    expect(cooking.advanceTo(47_000)).toMatchObject({
      snapshot: {
        activeJob: null,
        blockedReason: null,
        completedBatches: 1,
      },
      events: [{ type: "cooking.completed" }],
    });
  });

  it("rejects a duplicate start command without creating another job", () => {
    const inventory = createInventory();
    const cooking = createCooking(inventory);
    cooking.selectRecipe("select", RECIPE.id);

    expect(cooking.startBatch("start", 1_000).accepted).toBe(true);
    expect(cooking.startBatch("start", 1_000)).toMatchObject({
      accepted: false,
      code: "DUPLICATE_OPERATION",
      snapshot: { activeJob: { id: "cooking-job-1" } },
    });
  });
});
