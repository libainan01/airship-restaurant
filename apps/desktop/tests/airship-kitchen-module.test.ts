import type { GameplaySnapshot, InventoryReadModel } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import { resolveKitchenPresentation } from "../src/renderer/desktop/airship-kitchen-module";

function gameplay(
  cooking: GameplaySnapshot["cooking"],
  currentUtcMs = 1_500,
): GameplaySnapshot {
  return {
    currentUtcMs,
    cooking,
    inventory: {
      kitchenIngredients: { totalQuantity: 6, capacity: 12 },
      kitchenOutput: { totalQuantity: 3, capacity: 8 },
    },
  } as GameplaySnapshot;
}


const INVENTORY = {
  sourceRevision: 1,
  locations: [
    { id: "kitchen.ingredients", compartments: [{ id: "capacity", capacity: 12, occupied: 6, reservedCapacity: 0, availableCapacity: 6 }], items: [{ itemId: "ingredient.test", category: "ingredient", quantity: 6, reservedQuantity: 0, availableQuantity: 6, inTransitQuantity: 0 }], instances: [] },
    { id: "kitchen.output", compartments: [{ id: "capacity", capacity: 8, occupied: 3, reservedCapacity: 0, availableCapacity: 5 }], items: [{ itemId: "dish.test", category: "meal", quantity: 3, reservedQuantity: 0, availableQuantity: 3, inTransitQuantity: 0 }], instances: [] },
  ],
  totals: [],
  reservationCount: 0,
  capacityReservationCount: 0,
  dishware: null,
} as const satisfies InventoryReadModel;
const idleCooking: GameplaySnapshot["cooking"] = {
  selectedRecipeId: "recipe.test",
  autoRepeat: true,
  activeJob: null,
  blockedReason: null,
  completedBatches: 0,
  nextTransitionUtcMs: null,
};

describe("airship kitchen presentation", () => {
  it("derives cooking progress and moves the chef from prep to the stove", () => {
    const state = resolveKitchenPresentation(gameplay({
      ...idleCooking,
      activeJob: {
        id: "job-1",
        recipeId: "recipe.test",
        status: "cooking",
        startedAtUtcMs: 1_000,
        finishAtUtcMs: 2_000,
      },
    }), null, INVENTORY);

    expect(state).toMatchObject({
      phase: "cooking",
      task: "stirring",
      progress: 0.5,
      ingredients: [6, 12],
      output: [3, 8],
    });
  });

  it("sends the chef to inspect an empty pantry", () => {
    const state = resolveKitchenPresentation(gameplay({
      ...idleCooking,
      blockedReason: "insufficient-ingredients",
    }), null, INVENTORY);

    expect(state).toMatchObject({
      phase: "blocked",
      task: "checking-pantry",
      blocked: "insufficient-ingredients",
    });
  });

  it("highlights the output rack when a finished batch cannot unload", () => {
    const state = resolveKitchenPresentation(gameplay({
      ...idleCooking,
      activeJob: {
        id: "job-2",
        recipeId: "recipe.test",
        status: "waiting-output",
        startedAtUtcMs: 1_000,
        finishAtUtcMs: 1_400,
      },
    }), null, INVENTORY);

    expect(state).toMatchObject({
      phase: "waiting-output",
      task: "checking-output",
      progress: 1,
    });
  });

  it("shows the chef reading a received restaurant order while idle", () => {
    const state = resolveKitchenPresentation(
      gameplay(idleCooking),
      { phase: "received" },
      INVENTORY,
    );

    expect(state).toMatchObject({
      phase: "idle",
      task: "reading-order",
      signal: "received",
    });
  });
});
