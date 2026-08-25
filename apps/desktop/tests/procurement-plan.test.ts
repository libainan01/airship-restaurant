import { describe, expect, it } from "vitest";
import {
  adjustQuantitySelection,
  buildProcurementPlan,
  subtractQuantitySelection,
  type ProcurementPlanningSnapshot,
} from "../src/renderer/management/features/procurement/procurement-plan";

const WHEAT = "ingredient.cloud_wheat";
const MILK = "ingredient.kettle_milk";
const WIND_ROOT = "ingredient.wind_root";
const MOON_HERB = "ingredient.moon_herb";

function createPlanningSnapshot(options?: {
  readonly entries?: ProcurementPlanningSnapshot["inventory"]["kitchenIngredients"]["entries"];
  readonly incomingItems?: ProcurementPlanningSnapshot["procurement"]["incomingItems"];
  readonly remoteUnlocked?: boolean;
  readonly availableCapacity?: number;
}): ProcurementPlanningSnapshot {
  return {
    inventory: {
      kitchenIngredients: {
        availableCapacity: options?.availableCapacity ?? 50,
        entries: options?.entries ?? [],
      },
    },
    procurement: {
      incomingItems: options?.incomingItems ?? [],
      regions: [
        {
          id: "region.local",
          name: "灰羽港",
          unlocked: true,
          deliveryDurationMs: 15_000,
          freightCostCopper: 0,
          cargoCapacity: 12,
          minimumTransportLevel: 0,
          items: [
            { itemId: WHEAT, unitPriceCopper: 1 },
            { itemId: MILK, unitPriceCopper: 2 },
          ],
        },
        {
          id: "region.remote",
          name: "风根谷",
          unlocked: options?.remoteUnlocked ?? true,
          deliveryDurationMs: 60_000,
          freightCostCopper: 3,
          cargoCapacity: 10,
          minimumTransportLevel: 1,
          items: [
            { itemId: WIND_ROOT, unitPriceCopper: 3 },
            { itemId: MOON_HERB, unitPriceCopper: 4 },
          ],
        },
      ],
    },
  };
}

describe("buildProcurementPlan", () => {
  it("keeps free purchases exact and calculates freight per shipment", () => {
    const plan = buildProcurementPlan(createPlanningSnapshot(), {
      mode: "free",
      freeSelection: {
        [WHEAT]: 13,
        [WIND_ROOT]: 2,
      },
      recipeSelection: {},
    });

    expect(plan).toMatchObject({
      totalQuantity: 15,
      totalCostCopper: 22,
      blockedByLockedPort: false,
      exceedsCapacity: false,
    });
    expect(plan.regions).toEqual([
      expect.objectContaining({
        id: "region.local",
        quantity: 13,
        costCopper: 13,
      }),
      expect.objectContaining({
        id: "region.remote",
        quantity: 2,
        costCopper: 9,
      }),
    ]);
  });

  it("subtracts available and incoming ingredients in recipe mode", () => {
    const plan = buildProcurementPlan(
      createPlanningSnapshot({
        entries: [{
          itemId: MILK,
          quantity: 1,
          reservedQuantity: 0,
          availableQuantity: 1,
        }],
        incomingItems: [{ itemId: WIND_ROOT, quantity: 1 }],
      }),
      {
        mode: "recipe",
        freeSelection: {},
        recipeSelection: {
          "recipe.windroot_soup": 1,
        },
      },
    );

    expect(plan.items).toEqual([
      { itemId: WIND_ROOT, quantity: 1 },
      { itemId: MOON_HERB, quantity: 1 },
    ]);
    expect(plan).toMatchObject({
      totalQuantity: 2,
      totalCostCopper: 10,
      blockedByLockedPort: false,
    });
  });

  it("ignores recipe quantities that are no longer unlocked", () => {
    const plan = buildProcurementPlan(createPlanningSnapshot(), {
      mode: "recipe",
      freeSelection: {},
      recipeSelection: {
        "recipe.windroot_soup": 2,
      },
      allowedRecipeIds: new Set(["recipe.tomato_scrambled_egg"]),
    });

    expect(plan.items).toEqual([]);
    expect(plan.totalCostCopper).toBe(0);
  });
  it("reports locked routes and per-ingredient capacity overflow", () => {
    const plan = buildProcurementPlan(
      createPlanningSnapshot({
        remoteUnlocked: false,
        entries: [{
          itemId: WHEAT,
          quantity: 29,
          reservedQuantity: 0,
          availableQuantity: 29,
        }],
      }),
      {
        mode: "free",
        freeSelection: {
          [WHEAT]: 2,
          [WIND_ROOT]: 1,
        },
        recipeSelection: {},
      },
    );

    expect(plan.blockedByLockedPort).toBe(true);
    expect(plan.exceedsCapacity).toBe(true);
  });
});

describe("adjustQuantitySelection", () => {
  it("clamps draft quantities between zero and 99", () => {
    expect(adjustQuantitySelection({}, WHEAT, -1)[WHEAT]).toBe(0);
    expect(
      adjustQuantitySelection({ [WHEAT]: 98 }, WHEAT, 5)[WHEAT],
    ).toBe(99);
  });

  it("removes only quantities included in an accepted submission", () => {
    expect(subtractQuantitySelection(
      { wheat: 5, milk: 2, egg: 1 },
      { wheat: 3, milk: 4 },
    )).toEqual({ wheat: 2, egg: 1 });
  });
});
