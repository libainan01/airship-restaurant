import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  RecipeExecutionModule,
  createRecipeExecutionStepId,
  instanceId,
  restoreTaskModuleFromSources,
  StaticRecipeExecutionCatalog,
  type OrderState,
  type RecipeExecutionDefinition,
} from "../src";

const dinerId = instanceId("instance.character.recipe_diner");

const recipe: RecipeExecutionDefinition = {
  id: "recipe.carrot-meat",
  version: 1,
  outputItemId: "dish.carrot-meat",
  ingredients: [
    { itemId: "ingredient.carrot", quantity: 2 },
    { itemId: "ingredient.meat", quantity: 1 },
  ],
  steps: [
    {
      id: "step.cut-carrot",
      name: "切萝卜",
      durationMs: 10_000,
      requiredCapabilityIds: ["station.prep"],
      attendance: "required",
      prerequisiteStepIds: [],
      ingredientInputs: [{ itemId: "ingredient.carrot", quantity: 2 }],
      outputItemId: "intermediate.cut-carrot",
      outputQuantity: 1,
      qualityWeight: 1,
    },
    {
      id: "step.simmer-meat",
      name: "煮肉",
      durationMs: 30_000,
      requiredCapabilityIds: ["station.steam-boil"],
      attendance: "unattended",
      prerequisiteStepIds: [],
      ingredientInputs: [{ itemId: "ingredient.meat", quantity: 1 }],
      outputItemId: "intermediate.simmered-meat",
      outputQuantity: 1,
      qualityWeight: 1,
    },
    {
      id: "step.saute-carrot",
      name: "炒萝卜",
      durationMs: 15_000,
      requiredCapabilityIds: ["station.pan-fry"],
      attendance: "required",
      prerequisiteStepIds: ["step.cut-carrot"],
      ingredientInputs: [],
      outputItemId: "intermediate.sauteed-carrot",
      outputQuantity: 1,
      qualityWeight: 2,
    },
    {
      id: "step.finish",
      name: "炒肉",
      durationMs: 20_000,
      requiredCapabilityIds: ["station.pan-fry"],
      attendance: "required",
      prerequisiteStepIds: ["step.simmer-meat", "step.saute-carrot"],
      ingredientInputs: [],
      outputItemId: "dish.carrot-meat",
      outputQuantity: 1,
      qualityWeight: 3,
    },
  ],
};

function order(orderId = "order-one", quantity = 1, recipeId = recipe.id): OrderState {
  const lineId = `line-${orderId}`;
  const mealIds = Array.from({ length: quantity }, (_, index) =>
    `${orderId}:meal:${index + 1}`,
  );
  return {
    id: orderId,
    pendingOrderId: `pending-${orderId}`,
    tableId: `table-${orderId}`,
    customerGroupId: `group-${orderId}`,
    status: "submitted",
    lines: [{
      id: lineId,
      recipeId,
      quantity,
      price: {
        baseUnitPriceCopper: 100,
        businessAdjustmentCopper: 0,
        transactionUnitPriceCopper: 100,
      },
      mealIds,
      dinerCharacterIds: Array.from({ length: quantity }, () => dinerId),
    }],
    meals: mealIds.map((id, index) => ({
      id,
      orderId,
      lineId,
      recipeId,
      servingIndex: index + 1,
      dinerCharacterId: dinerId,
      status: "pending-production",
      tipCopper: 0,
      blockedReason: null,
      updatedAtUtcMs: 1,
    })),
    ingredientReservationIds: [`reservation-${orderId}`],
    focusBonusRateBasisPoints: 0,
    submittedAtUtcMs: 1,
    settlementBatchId: null,
    settledAtUtcMs: null,
  };
}

function createSubject(eventBus = new DomainEventBus()) {
  return new RecipeExecutionModule({
    catalog: new StaticRecipeExecutionCatalog([recipe]),
    eventBus,
  });
}

function stepId(mealId: string, definitionStepId: string): string {
  return createRecipeExecutionStepId(mealId, definitionStepId);
}

function startAndComplete(
  module: RecipeExecutionModule,
  mealId: string,
  definitionStepId: string,
  time: number,
) {
  const id = stepId(mealId, definitionStepId);
  expect(module.startStep(`start-${definitionStepId}-${time}`, id, time).accepted).toBe(true);
  const completed = module.completeStep(`complete-${definitionStepId}-${time}`, id, time + 1);
  expect(completed.accepted).toBe(true);
  if (!completed.accepted) throw new Error(completed.message);
  return completed.value;
}

describe("RecipeExecutionModule", () => {
  it("publishes roots in parallel, unlocks linear work, and waits for every join prerequisite", () => {
    const eventBus = new DomainEventBus();
    const eventTypes: string[] = [];
    eventBus.subscribe("*", (event) => eventTypes.push(event.type));
    const module = createSubject(eventBus);
    const formalOrder = order();
    const mealId = formalOrder.meals[0]!.id;

    const created = module.createExecutionsForOrder("create-executions", formalOrder, 10);
    expect(created.accepted).toBe(true);
    if (!created.accepted) throw new Error(created.message);
    expect(created.value).toHaveLength(1);
    expect(created.value[0]).toMatchObject({
      id: mealId,
      mealId,
      recipe: { id: recipe.id, version: 1 },
      status: "active",
    });
    expect(created.value[0]!.steps.map((step) => [step.definitionStepId, step.status])).toEqual([
      ["step.cut-carrot", "ready"],
      ["step.simmer-meat", "ready"],
      ["step.saute-carrot", "locked"],
      ["step.finish", "locked"],
    ]);
    expect(module.createTaskSourceSnapshot().waitingTasks.map((task) => task.target.id)).toEqual([
      stepId(mealId, "step.cut-carrot"),
      stepId(mealId, "step.simmer-meat"),
    ]);    const rebuiltTasks = restoreTaskModuleFromSources({
      persistence: null,
      sources: [module.createTaskSourceSnapshot()],
    }).module.createReadModel();
    expect(rebuiltTasks.waiting).toHaveLength(2);
    expect(rebuiltTasks.waiting.every((task) =>
      task.taskType === "kitchen.recipe-step" && task.eligibleJobIds.includes("job.chef") &&
      task.interruptible,
    )).toBe(true);

    let execution = startAndComplete(module, mealId, "step.cut-carrot", 20);
    expect(execution.steps.find((step) => step.definitionStepId === "step.saute-carrot")?.status)
      .toBe("ready");
    expect(execution.steps.find((step) => step.definitionStepId === "step.finish")?.status)
      .toBe("locked");

    execution = startAndComplete(module, mealId, "step.saute-carrot", 30);
    expect(execution.steps.find((step) => step.definitionStepId === "step.finish")?.status)
      .toBe("locked");

    execution = startAndComplete(module, mealId, "step.simmer-meat", 40);
    expect(execution.steps.find((step) => step.definitionStepId === "step.finish")?.status)
      .toBe("ready");
    expect(module.createTaskSourceSnapshot().waitingTasks.map((task) => task.target.id))
      .toEqual([stepId(mealId, "step.finish")]);

    execution = startAndComplete(module, mealId, "step.finish", 50);
    expect(execution.status).toBe("completed");
    expect(execution.completedAtUtcMs).toBe(51);
    expect(module.createTaskSourceSnapshot().waitingTasks).toEqual([]);
    expect(eventTypes.filter((type) => type === "recipe.step-ready")).toHaveLength(4);
    expect(eventTypes).toContain("recipe.execution-completed");
  });

  it("creates one independent execution and stable task set for every ordered serving", () => {
    const module = createSubject();
    const formalOrder = order("order-two-servings", 2);
    const created = module.createExecutionsForOrder("create-two", formalOrder, 10);
    expect(created.accepted).toBe(true);
    if (!created.accepted) throw new Error(created.message);
    expect(created.value.map((execution) => execution.mealId)).toEqual(
      formalOrder.meals.map((meal) => meal.id),
    );
    expect(new Set(created.value.flatMap((execution) => execution.steps.map((step) => step.id))).size)
      .toBe(8);
    const firstTasks = module.createTaskSourceSnapshot().waitingTasks;
    expect(firstTasks).toHaveLength(4);
    expect(new Set(firstTasks.map((task) => task.taskId)).size).toBe(4);

    const repeated = module.createExecutionsForOrder("create-two-repeat", formalOrder, 999);
    expect(repeated).toMatchObject({ accepted: true, changed: false });
    expect(module.exportState().executions).toHaveLength(2);
    expect(module.createTaskSourceSnapshot().waitingTasks.map((task) => task.taskId))
      .toEqual(firstTasks.map((task) => task.taskId));
  });

  it("removes blocked work from task projection and republishes it after recovery", () => {
    const module = createSubject();
    const formalOrder = order();
    const mealId = formalOrder.meals[0]!.id;
    module.createExecutionsForOrder("create", formalOrder, 10);
    const cutStepId = stepId(mealId, "step.cut-carrot");

    const blocked = module.blockStep("block", cutStepId, "no prep station", 20);
    expect(blocked.accepted).toBe(true);
    expect(module.createReadModel().blockedStepCount).toBe(1);
    expect(module.createTaskSourceSnapshot().waitingTasks.map((task) => task.target.id))
      .toEqual([stepId(mealId, "step.simmer-meat")]);
    expect(module.startStep("start-blocked", cutStepId, 21))
      .toMatchObject({ accepted: false, code: "STEP_NOT_READY" });

    const restored = module.restoreStep("restore", cutStepId, 30);
    expect(restored.accepted).toBe(true);
    expect(module.createReadModel().blockedStepCount).toBe(0);
    expect(module.createTaskSourceSnapshot().waitingTasks.map((task) => task.target.id))
      .toContain(cutStepId);
  });

  it("keeps each execution on its creation-time recipe version and restores without replay", () => {
    let currentRecipe = recipe;
    const eventBus = new DomainEventBus();
    const module = new RecipeExecutionModule({
      catalog: { getRecipe: (recipeId) => recipeId === recipe.id ? currentRecipe : null },
      eventBus,
    });
    const firstOrder = order("order-v1");
    module.createExecutionsForOrder("create-v1", firstOrder, 10);
    currentRecipe = {
      ...recipe,
      version: 2,
      steps: recipe.steps.map((step) => step.id === "step.finish"
        ? { ...step, durationMs: 99_000 }
        : step),
    };
    const secondOrder = order("order-v2");
    module.createExecutionsForOrder("create-v2", secondOrder, 20);
    expect(module.getExecutionForMeal(firstOrder.meals[0]!.id)?.recipe).toMatchObject({
      version: 1,
      steps: expect.arrayContaining([expect.objectContaining({ id: "step.finish", durationMs: 20_000 })]),
    });
    expect(module.getExecutionForMeal(secondOrder.meals[0]!.id)?.recipe).toMatchObject({
      version: 2,
      steps: expect.arrayContaining([expect.objectContaining({ id: "step.finish", durationMs: 99_000 })]),
    });

    const saved = module.exportState();
    const replayed: string[] = [];
    const restoreBus = new DomainEventBus();
    restoreBus.subscribe("*", (event) => replayed.push(event.id));
    const restored = new RecipeExecutionModule({
      catalog: { getRecipe: () => currentRecipe },
      eventBus: restoreBus,
      initialState: saved,
    });
    expect(restored.exportState()).toEqual(saved);
    expect(restored.createTaskSourceSnapshot()).toEqual(module.createTaskSourceSnapshot());
    expect(replayed).toEqual([]);
  });

  it("rejects cyclic, disconnected-output, and mismatched-ingredient recipe graphs", () => {
    const cyclic: RecipeExecutionDefinition = {
      ...recipe,
      id: "recipe.cyclic",
      steps: recipe.steps.map((step) => {
        if (step.id === "step.cut-carrot") {
          return { ...step, prerequisiteStepIds: ["step.finish"] };
        }
        return step;
      }),
    };
    expect(() => new StaticRecipeExecutionCatalog([cyclic])).toThrow(/cycle/i);

    const multipleSinks: RecipeExecutionDefinition = {
      ...recipe,
      id: "recipe.multiple-sinks",
      steps: recipe.steps.map((step) => step.id === "step.finish"
        ? { ...step, prerequisiteStepIds: ["step.simmer-meat"] }
        : step),
    };
    expect(() => new StaticRecipeExecutionCatalog([multipleSinks])).toThrow(/final output/i);

    const mismatchedIngredients: RecipeExecutionDefinition = {
      ...recipe,
      id: "recipe.mismatched-ingredients",
      ingredients: recipe.ingredients.map((ingredient) => ingredient.itemId === "ingredient.carrot"
        ? { ...ingredient, quantity: 3 }
        : ingredient),
    };
    expect(() => new StaticRecipeExecutionCatalog([mismatchedIngredients]))
      .toThrow(/do not match/i);
  });
});
