import { describe, expect, it } from "vitest";
import {
  DishwareModule,
  InventoryModule,
  KitchenProductModule,
  RecipeExecutionModule,
  StaticInventoryStorageDefinitions,
  StaticRecipeExecutionCatalog,
  createKitchenFinishedMealInstanceId,
  createRecipeExecutionStepId,
  instanceId,
  subresourceId,
  type KitchenCacheClaimState,
  type OrderState,
  type RecipeExecutionDefinition,
} from "../src";

const RECIPE_ID = "recipe.breakfast";
const DISH_ITEM = "dish.breakfast";
const PLATE_ITEM = "dishware.plate";

const recipe: RecipeExecutionDefinition = Object.freeze({
  id: RECIPE_ID,
  version: 3,
  outputItemId: DISH_ITEM,
  ingredients: Object.freeze([Object.freeze({ itemId: "ingredient.tomato", quantity: 1 })]),
  steps: Object.freeze([
    Object.freeze({
      id: "step.tomato",
      name: "炒番茄",
      durationMs: 1_000,
      requiredCapabilityIds: Object.freeze(["station.stir_fry"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze([]),
      ingredientInputs: Object.freeze([Object.freeze({ itemId: "ingredient.tomato", quantity: 1 })]),
      outputItemId: "intermediate.tomato",
      outputQuantity: 1,
      qualityWeight: 2,
    }),
    Object.freeze({
      id: "step.egg",
      name: "炒鸡蛋",
      durationMs: 1_000,
      requiredCapabilityIds: Object.freeze(["station.stir_fry"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze([]),
      ingredientInputs: Object.freeze([]),
      outputItemId: "intermediate.egg",
      outputQuantity: 1,
      qualityWeight: 1,
    }),
    Object.freeze({
      id: "step.plating",
      name: "装盘",
      durationMs: 500,
      requiredCapabilityIds: Object.freeze(["station.plating"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze(["step.tomato", "step.egg"]),
      ingredientInputs: Object.freeze([]),
      outputItemId: DISH_ITEM,
      outputQuantity: 1,
      qualityWeight: 0,
    }),
  ]),
});

const mealId = "order.breakfast:meal:line.breakfast:1";
const order: OrderState = Object.freeze({
  id: "order.breakfast",
  pendingOrderId: "pending.breakfast",
  tableId: "table.one",
  customerGroupId: "group.one",
  status: "submitted",
  lines: Object.freeze([Object.freeze({
    id: "line.breakfast",
    recipeId: RECIPE_ID,
    quantity: 1,
    price: Object.freeze({
      baseUnitPriceCopper: 100,
      businessAdjustmentCopper: 0,
      transactionUnitPriceCopper: 100,
    }),
    mealIds: Object.freeze([mealId]),
  })]),
  meals: Object.freeze([Object.freeze({
    id: mealId,
    orderId: "order.breakfast",
    lineId: "line.breakfast",
    recipeId: RECIPE_ID,
    servingIndex: 1,
    status: "pending-production",
    tipCopper: 0,
    blockedReason: null,
    updatedAtUtcMs: 1,
  })]),
  ingredientReservationIds: Object.freeze(["reservation.ingredients"]),
  focusBonusRateBasisPoints: 0,
  submittedAtUtcMs: 1,
  settlementBatchId: null,
  settledAtUtcMs: null,
});

const plateId = instanceId("instance.dishware.demo_1");
const facilityId = instanceId("instance.building.prep");

function createFixture(outputCapacity = 2) {
  const inventory = new InventoryModule(
    [
      { id: PLATE_ITEM, category: "dishware", storageMode: "instance" },
      { id: DISH_ITEM, category: "meal", storageMode: "instance" },
    ],
    new StaticInventoryStorageDefinitions([
      { id: "cabinet.clean", compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.washing", compartments: [{ id: "washing", capacity: 1, acceptedCategories: ["dishware"] }] },
      { id: "airship.plates", compartments: [{ id: "plates", capacity: 4, acceptedCategories: ["dishware"] }] },
      {
        id: "airship.output",
        compartments: [
          { id: "meals", capacity: outputCapacity, acceptedCategories: ["meal"] },
          { id: "bound-plates", capacity: 4, acceptedCategories: ["dishware"] },
        ],
      },
    ]),
  );
  const dishware = new DishwareModule({
    inventory,
    plateItemId: PLATE_ITEM,
    cabinets: [{
      id: "cabinet.main",
      supplyComponentId: "component.cabinet",
      cleanStorageLocationId: "cabinet.clean",
      dirtyStorageLocationId: "cabinet.dirty",
      washingLocationId: "cabinet.washing",
      suppliedPlateCount: 1,
      washDurationMs: 10_000,
      parallelWashCount: 1,
    }],
  });
  expect(dishware.initializeSupply("initialize-plates", "component.cabinet", [plateId], 1))
    .toMatchObject({ accepted: true });
  const recipes = new RecipeExecutionModule({ catalog: new StaticRecipeExecutionCatalog([recipe]) });
  expect(recipes.createExecutionsForOrder("create-execution", order, 2)).toMatchObject({ accepted: true });
  const products = new KitchenProductModule({
    recipes,
    inventory,
    dishware,
    cleanPlateLocationIds: ["airship.plates"],
    platedMealLocationId: "airship.output",
  });
  return { inventory, dishware, recipes, products };
}

function occupiedCache(sourceStepInstanceId: string, index: number): KitchenCacheClaimState {
  const platingStepId = createRecipeExecutionStepId(mealId, "step.plating");
  return Object.freeze({
    id: subresourceId(`subresource.prep_${index}.claim`),
    cacheSlotId: subresourceId(`subresource.prep_${index}.cache`),
    facilityId,
    executionId: mealId,
    sourceStepInstanceId,
    allowedConsumerStepInstanceIds: Object.freeze([platingStepId]),
    status: "occupied",
    reservedAtUtcMs: 3,
    occupiedAtUtcMs: 5 + index,
  });
}

function completeRoot(
  target: ReturnType<typeof createFixture>,
  definitionStepId: "step.tomato" | "step.egg",
  index: number,
) {
  const stepId = createRecipeExecutionStepId(mealId, definitionStepId);
  expect(target.products.reserveStepProducts(`reserve-${index}`, stepId, 3 + index))
    .toMatchObject({ accepted: true });
  expect(target.products.startStep(`product-start-${index}`, stepId, 4 + index))
    .toMatchObject({ accepted: true, value: { consumedIntermediates: [] } });
  expect(target.recipes.startStep(`recipe-start-${index}`, stepId, 4 + index))
    .toMatchObject({ accepted: true });
  expect(target.recipes.completeStep(`recipe-complete-${index}`, stepId, 5 + index))
    .toMatchObject({ accepted: true });
  const cache = occupiedCache(stepId, index);
  expect(target.products.completeStep(`product-complete-${index}`, {
    stepInstanceId: stepId,
    outputCacheClaim: cache,
    qualityContributions: [],
    occurredAtUtcMs: 5 + index,
  })).toMatchObject({
    accepted: true,
    value: {
      sourceStepInstanceId: stepId,
      cacheClaimId: cache.id,
      status: "available",
    },
  });
  return stepId;
}

describe("KitchenProductModule", () => {
  it("binds cached intermediates to one meal, consumes them once, and freezes a plated meal instance", () => {
    const target = createFixture();
    expect(target.inventory.transferInstance("supply-airship", plateId, "airship.plates", 2))
      .toMatchObject({ accepted: true });
    const tomatoStepId = completeRoot(target, "step.tomato", 1);
    const eggStepId = completeRoot(target, "step.egg", 2);
    const platingStepId = createRecipeExecutionStepId(mealId, "step.plating");

    const reserved = target.products.reserveStepProducts("reserve-plating", platingStepId, 10);
    expect(reserved).toMatchObject({
      accepted: true,
      value: {
        plateId,
        status: "reserved",
      },
    });
    if (!reserved.accepted) throw new Error(reserved.message);
    expect(reserved.value?.intermediateInstanceIds).toHaveLength(2);
    const started = target.products.startStep("start-plating-products", platingStepId, 11);
    expect(started).toMatchObject({
      accepted: true,
      value: {
        reservation: { status: "started", plateId },
        consumedIntermediates: [
          { status: "consumed", consumedByStepInstanceId: platingStepId },
          { status: "consumed", consumedByStepInstanceId: platingStepId },
        ],
      },
    });
    expect(target.dishware.getSnapshot().counts).toEqual({ clean: 0, in_use: 1, dirty: 0, washing: 0 });
    expect(target.recipes.startStep("start-plating-recipe", platingStepId, 11)).toMatchObject({ accepted: true });
    expect(target.recipes.completeStep("complete-plating-recipe", platingStepId, 12)).toMatchObject({ accepted: true });

    const completed = target.products.completeStep("complete-plating-product", {
      stepInstanceId: platingStepId,
      outputCacheClaim: null,
      qualityContributions: [
        { stepInstanceId: tomatoStepId, cookingLevel: 10, qualityWeight: 2, weightedQuality: 20 },
        { stepInstanceId: eggStepId, cookingLevel: 5, qualityWeight: 1, weightedQuality: 5 },
        { stepInstanceId: platingStepId, cookingLevel: 8, qualityWeight: 0, weightedQuality: 0 },
      ],
      occurredAtUtcMs: 12,
    });
    expect(completed).toMatchObject({
      accepted: true,
      value: {
        id: createKitchenFinishedMealInstanceId(mealId),
        itemId: DISH_ITEM,
        mealId,
        recipeId: RECIPE_ID,
        recipeVersion: 3,
        plateId,
        quality: 25 / 3,
        qualityWeight: 3,
        locationId: "airship.output",
      },
    });
    expect(target.inventory.getLocationSnapshot("airship.output")?.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: plateId, category: "dishware" }),
      expect.objectContaining({
        id: createKitchenFinishedMealInstanceId(mealId),
        category: "meal",
        attributes: expect.objectContaining({ quality: 25 / 3, plateId }),
      }),
    ]));
    expect(target.products.getReservation(platingStepId)).toBeNull();
    expect(target.products.createReadModel().availableIntermediates).toHaveLength(0);

    const restored = new KitchenProductModule({
      recipes: target.recipes,
      inventory: target.inventory,
      dishware: target.dishware,
      cleanPlateLocationIds: ["airship.plates"],
      platedMealLocationId: "airship.output",
      initialState: target.products.exportState(),
    });
    expect(restored.getFinishedMealByMealId(mealId)).toMatchObject({ quality: 25 / 3, plateId });
    expect(restored.completeStep("completion-retry", {
      stepInstanceId: platingStepId,
      outputCacheClaim: null,
      qualityContributions: [],
      occurredAtUtcMs: 20,
    })).toMatchObject({ accepted: true, changed: false, value: { mealId } });
    expect(target.dishware.markDirty("meal-delivered", plateId, "cabinet.dirty", 21))
      .toMatchObject({ accepted: true, value: { status: "dirty" } });
    expect(() => new KitchenProductModule({
      recipes: target.recipes,
      inventory: target.inventory,
      dishware: target.dishware,
      cleanPlateLocationIds: ["airship.plates"],
      platedMealLocationId: "airship.output",
      initialState: target.products.exportState(),
    })).not.toThrow();
    expect(target.inventory.getLocationSnapshot("airship.output")?.instances
      .filter((entry) => entry.category === "meal")).toHaveLength(1);
  });

  it("keeps prerequisite intermediates available when no clean plate or output slot can be reserved", () => {
    const target = createFixture(1);
    completeRoot(target, "step.tomato", 1);
    completeRoot(target, "step.egg", 2);
    const platingStepId = createRecipeExecutionStepId(mealId, "step.plating");
    expect(target.products.reserveStepProducts("no-plate", platingStepId, 10)).toMatchObject({
      accepted: false,
      code: "NO_CLEAN_PLATE",
    });
    expect(target.products.createReadModel().availableIntermediates).toHaveLength(2);

    expect(target.inventory.transferInstance("supply-airship", plateId, "airship.plates", 11))
      .toMatchObject({ accepted: true });
    expect(target.inventory.createInstance("fill-output", {
      instanceId: instanceId("instance.meal.capacity_blocker"),
      itemId: DISH_ITEM,
      locationId: "airship.output",
      occurredAtUtcMs: 11,
    })).toMatchObject({ accepted: true });
    expect(target.products.reserveStepProducts("no-output", platingStepId, 12)).toMatchObject({
      accepted: false,
      code: "NO_OUTPUT_CAPACITY",
    });
    expect(target.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(target.products.createReadModel().availableIntermediates).toHaveLength(2);
    expect(target.products.getReservation(platingStepId)).toBeNull();
  });
});
