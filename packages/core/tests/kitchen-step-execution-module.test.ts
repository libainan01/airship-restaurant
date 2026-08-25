import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  DishwareModule,
  DomainEventBus,
  FinanceModule,
  InventoryModule,
  KitchenFacilityAdapter,
  KitchenFacilityModule,
  KitchenProductModule,
  KitchenStepExecutionModule,
  MovementModule,
  OrderModule,
  RecipeExecutionModule,
  SceneLayoutInteractionTargetResolver,
  SceneLayoutModule,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticRecipeExecutionCatalog,
  TaskModule,
  createRecipeExecutionStepId,
  instanceId,
  type BuildingRuntimeDefinition,
  type KitchenFacilityLevelDefinition,
  type RecipeExecutionDefinition,
  type TaskCandidate,
} from "../src";

const TOMATO = "ingredient.tomato";
const EGG = "ingredient.egg";
const RECIPE = "recipe.parallel-breakfast";

const recipe: RecipeExecutionDefinition = Object.freeze({
  id: RECIPE,
  version: 1,
  outputItemId: "dish.breakfast",
  ingredients: Object.freeze([
    Object.freeze({ itemId: TOMATO, quantity: 1 }),
    Object.freeze({ itemId: EGG, quantity: 1 }),
  ]),
  steps: Object.freeze([
    Object.freeze({
      id: "step.prep",
      name: "切番茄",
      durationMs: 10_000,
      requiredCapabilityIds: Object.freeze(["station.prep"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze([]),
      ingredientInputs: Object.freeze([Object.freeze({ itemId: TOMATO, quantity: 1 })]),
      outputItemId: "intermediate.tomato",
      outputQuantity: 1,
      qualityWeight: 2,
    }),
    Object.freeze({
      id: "step.boil",
      name: "煮鸡蛋",
      durationMs: 20_000,
      requiredCapabilityIds: Object.freeze(["station.steam_boil"]),
      attendance: "unattended",
      prerequisiteStepIds: Object.freeze([]),
      ingredientInputs: Object.freeze([Object.freeze({ itemId: EGG, quantity: 1 })]),
      outputItemId: "intermediate.egg",
      outputQuantity: 1,
      qualityWeight: 1,
    }),
    Object.freeze({
      id: "step.finish",
      name: "混合装盘",
      durationMs: 5_000,
      requiredCapabilityIds: Object.freeze(["station.plating"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze(["step.prep", "step.boil"]),
      ingredientInputs: Object.freeze([]),
      outputItemId: "dish.breakfast",
      outputQuantity: 1,
      qualityWeight: 0,
    }),
  ]),
});

const scene = Object.freeze({
  id: "scene.airship",
  placementRegions: Object.freeze([
    Object.freeze({
      id: "region.airship",
      tag: "zone.airship",
      bounds: Object.freeze({ x: 0, y: 0, width: 300, height: 100 }),
    }),
  ]),
});

function building(id: string): BuildingRuntimeDefinition {
  return Object.freeze({
    id,
    buildCostCopper: 100,
    allowedRegionTags: Object.freeze(["zone.airship"]),
    styleIds: Object.freeze(["default"]),
    defaultStyleId: "default",
    defaultOrientation: "front",
    necessary: false,
    movable: true,
    storable: true,
    removable: true,
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        upgradeCostCopper: 0,
        maxDurability: 100,
        components: Object.freeze([]),
        layouts: Object.freeze({
          front: Object.freeze({
            hardFootprints: Object.freeze([Object.freeze({ x: 0, y: 0, width: 10, height: 10 })]),
            visualBounds: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
            interactionAreas: Object.freeze([
              Object.freeze({
                id: "interaction.main",
                required: true,
                bounds: Object.freeze({ x: 10, y: 0, width: 4, height: 4 }),
              }),
            ]),
          }),
        }),
      }),
    ]),
  });
}

const prepBuilding = building("building.prep");
const boilBuilding = building("building.boil");
const platingBuilding = building("building.plating");

const facilityDefinitions: readonly KitchenFacilityLevelDefinition[] = Object.freeze([
  Object.freeze({
    buildingDefinitionId: prepBuilding.id,
    level: 1,
    workstations: Object.freeze([
      Object.freeze({ id: "main", capabilityIds: Object.freeze(["station.prep"]), interactionId: "interaction.main" }),
    ]),
    cacheSlotIds: Object.freeze(["cache_a", "cache_b"]),
  }),
  Object.freeze({
    buildingDefinitionId: boilBuilding.id,
    level: 1,
    workstations: Object.freeze([
      Object.freeze({ id: "main", capabilityIds: Object.freeze(["station.steam_boil"]), interactionId: "interaction.main" }),
    ]),
    cacheSlotIds: Object.freeze([]),
  }),
  Object.freeze({
    buildingDefinitionId: platingBuilding.id,
    level: 1,
    workstations: Object.freeze([
      Object.freeze({ id: "main", capabilityIds: Object.freeze(["station.plating"]), interactionId: "interaction.main" }),
    ]),
    cacheSlotIds: Object.freeze([]),
  }),
]);

const chefA = instanceId("instance.character.chef_a");
const chefB = instanceId("instance.character.chef_b");
const dinerId = instanceId("instance.character.kitchen_diner");
const prepId = instanceId("instance.building.prep_a");
const boilId = instanceId("instance.building.boil_a");
const platingId = instanceId("instance.building.plating_a");

function candidate(characterId: typeof chefA, cooking: number): TaskCandidate {
  return Object.freeze({
    characterId,
    available: true,
    tags: Object.freeze(["employee"]),
    learnedJobIds: Object.freeze(["job.chef"]),
    primaryJobId: "job.chef",
    skills: Object.freeze({ cooking, charm: 1, movement: 1, repair: 1, piloting: 1 }),
  });
}

function createFixture(withProducts = false) {
  const eventBus = new DomainEventBus();
  const events: string[] = [];
  eventBus.subscribe("*", (event) => events.push(event.type));
  const inventory = new InventoryModule(
    [
      { id: TOMATO, category: "ingredient", storageMode: "stack" },
      { id: EGG, category: "ingredient", storageMode: "stack" },
      { id: "dishware.plate", category: "dishware", storageMode: "instance" },
      { id: recipe.outputItemId, category: "meal", storageMode: "instance" },
    ],
    new StaticInventoryStorageDefinitions([
      {
        id: "storage.airship",
        compartments: [{ id: "ingredients", capacity: 20, acceptedCategories: ["ingredient"] }],
      },
      { id: "airship.plates", compartments: [{ id: "plates", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.clean", compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.washing", compartments: [{ id: "washing", capacity: 1, acceptedCategories: ["dishware"] }] },
      { id: "airship.output", compartments: [
        { id: "meals", capacity: 2, acceptedCategories: ["meal"] },
        { id: "bound-plates", capacity: 4, acceptedCategories: ["dishware"] },
      ] },
    ]),
  );
  expect(inventory.depositStack("seed", "storage.airship", [
    { itemId: TOMATO, quantity: 1 },
    { itemId: EGG, quantity: 1 },
  ], 1)).toMatchObject({ accepted: true });
  const dishware = new DishwareModule({
    inventory,
    plateItemId: "dishware.plate",
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
    eventBus,
  });
  if (withProducts) {
    const plate = instanceId("instance.dishware.kitchen_1");
    expect(dishware.initializeSupply("initialize-plate", "component.cabinet", [plate], 1)).toMatchObject({ accepted: true });
    expect(inventory.transferInstance("supply-plate", plate, "airship.plates", 2)).toMatchObject({ accepted: true });
  }
  const orders = new OrderModule({
    finance: new FinanceModule(1_000),
    inventory,
    recipeCatalog: new StaticOrderRecipeCatalog([
      { id: RECIPE, ingredients: recipe.ingredients },
    ]),
    ingredientSources: [{ kind: "stack", locationId: "storage.airship" }],
    eventBus,
  });
  const pending = orders.createPendingOrder({
    operationId: "pending",
    pendingOrderId: "pending.breakfast",
    tableId: "table.one",
    customerGroupId: "group.one",
    lines: [{ id: "line.breakfast", recipeId: RECIPE, quantity: 1, dinerCharacterIds: [dinerId] }],
    ingredientReservationId: "reservation.breakfast",
    createdAtUtcMs: 2,
  });
  if (!pending.accepted) throw new Error(pending.message);
  const submitted = orders.submitPendingOrder({
    operationId: "submit",
    pendingOrderId: pending.value.id,
    orderId: "order.breakfast",
    linePrices: [{
      lineId: "line.breakfast",
      baseUnitPriceCopper: 100,
      businessAdjustmentCopper: 0,
      transactionUnitPriceCopper: 100,
    }],
    submittedAtUtcMs: 3,
  });
  if (!submitted.accepted) throw new Error(submitted.message);

  const recipes = new RecipeExecutionModule({
    catalog: new StaticRecipeExecutionCatalog([recipe]),
    eventBus,
  });
  const executions = recipes.createExecutionsForOrder("create-execution", submitted.value, 4);
  if (!executions.accepted) throw new Error(executions.message);
  const mealId = submitted.value.meals[0]!.id;

  const tasks = new TaskModule();
  for (const request of recipes.createTaskSourceSnapshot().waitingTasks) {
    expect(tasks.createTask(`create-${request.target.id}`, request)).toMatchObject({ accepted: true });
  }

  const characters = new CharacterModule([
    {
      id: "character.chef_a",
      name: "白夜城",
      baseSkills: { cooking: 10, charm: 1, movement: 1, repair: 1, piloting: 1 },
      defaultTalentIds: [],
    },
    {
      id: "character.chef_b",
      name: "副厨",
      baseSkills: { cooking: 5, charm: 1, movement: 1, repair: 1, piloting: 1 },
      defaultTalentIds: [],
    },
  ], []);
  expect(characters.createCharacter("character-a", {
    instanceId: chefA,
    definitionId: "character.chef_a",
    coreMember: true,
    occurredAtUtcMs: 1,
  })).toMatchObject({ accepted: true });
  expect(characters.createCharacter("character-b", {
    instanceId: chefB,
    definitionId: "character.chef_b",
    coreMember: false,
    occurredAtUtcMs: 1,
  })).toMatchObject({ accepted: true });

  const adapter = new KitchenFacilityAdapter(facilityDefinitions);
  const layout = new SceneLayoutModule(
    [scene],
    [prepBuilding, boilBuilding, platingBuilding],
    adapter,
  );
  adapter.attachLayout(layout);
  for (const [operationId, instance, definitionId, x] of [
    ["place-prep", prepId, prepBuilding.id, 20],
    ["place-boil", boilId, boilBuilding.id, 60],
    ["place-plating", platingId, platingBuilding.id, 100],
  ] as const) {
    expect(layout.placeBuilding(operationId, {
      instanceId: instance,
      definitionId,
      sceneId: scene.id,
      transform: { x, y: 20, orientation: "front" },
      totalInvestmentCopper: 100,
      occurredAtUtcMs: 2,
    })).toMatchObject({ accepted: true });
  }
  const movement = new MovementModule({
    targetResolver: new SceneLayoutInteractionTargetResolver(layout, (entry) => entry.sceneId),
    reservationTtlMs: 100_000,
  });
  expect(movement.registerCharacter("movement-a", chefA, scene.id, { x: 30, y: 20 })).toMatchObject({ accepted: true });
  expect(movement.registerCharacter("movement-b", chefB, scene.id, { x: 70, y: 20 })).toMatchObject({ accepted: true });
  const facilities = new KitchenFacilityModule({ facilities: adapter, movement, eventBus });
  adapter.attachRuntime(facilities);
  const products = withProducts ? new KitchenProductModule({
    recipes,
    inventory,
    dishware,
    cleanPlateLocationIds: ["airship.plates"],
    platedMealLocationId: "airship.output",
    eventBus,
  }) : null;
  const cooking = new KitchenStepExecutionModule({
    recipes,
    facilities,
    inventory,
    orders,
    characters,
    tasks,
    movement,
    ...(products === null ? {} : { products }),
    eventBus,
  });
  return {
    events,
    inventory,
    orders,
    recipes,
    tasks,
    characters,
    layout,
    movement,
    facilities,
    dishware,
    products,
    cooking,
    mealId,
    prepStepId: createRecipeExecutionStepId(mealId, "step.prep"),
    boilStepId: createRecipeExecutionStepId(mealId, "step.boil"),
  };
}

describe("KitchenStepExecutionModule", () => {
  it("claims parallel chef tasks and consumes the whole-table reservation one step at a time", () => {
    const target = createFixture();
    expect(target.cooking.claimStep("claim-prep", {
      stepInstanceId: target.prepStepId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 1_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true, value: { status: "claimed", characterId: chefA } });
    expect(target.cooking.claimStep("claim-boil", {
      stepInstanceId: target.boilStepId,
      candidate: candidate(chefB, 5),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 1_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true, value: { status: "claimed", characterId: chefB } });
    expect(target.cooking.createTaskSourceSnapshot()).toMatchObject({
      waitingTasks: [],
      activeTasks: [{ assignedCharacterId: chefA }, { assignedCharacterId: chefB }],
    });

    expect(target.cooking.startStep("start-prep", target.prepStepId, 11)).toMatchObject({
      accepted: true,
      value: {
        status: "running",
        performance: { cookingLevel: 10, qualityWeight: 2, weightedQuality: 20 },
      },
    });
    expect(target.inventory.getReservation("reservation.breakfast")).toMatchObject({
      stackAllocations: [{ itemId: EGG, quantity: 1 }],
    });
    expect(target.orders.getMeal(target.mealId)).toMatchObject({ status: "in-production" });
    expect(target.tasks.getTask(target.cooking.getStep(target.prepStepId)!.taskRequest.taskId)).toMatchObject({
      status: "in-progress",
      interruptible: false,
    });

    expect(target.cooking.startStep("start-boil", target.boilStepId, 12)).toMatchObject({
      accepted: true,
      value: {
        status: "running",
        performance: { cookingLevel: 5, qualityWeight: 1, weightedQuality: 5 },
      },
    });
    expect(target.inventory.getReservation("reservation.breakfast")).toBeNull();
    expect(target.tasks.getTask(target.cooking.getStep(target.boilStepId)!.taskRequest.taskId)).toMatchObject({
      status: "completed",
      result: { phase: "automatic-running" },
    });
    expect(target.movement.getCharacter(chefB)).toMatchObject({ status: "idle", plan: null });
    expect(target.cooking.createTaskSourceSnapshot().activeTasks).toHaveLength(1);
    expect(target.cooking.advance("complete-roots", 30_000)).toMatchObject({
      accepted: true,
      value: [{ status: "completed" }, { status: "completed" }],
    });
    const finishId = createRecipeExecutionStepId(target.mealId, "step.finish");
    const finishRequest = target.recipes.getStepContext(finishId)!.taskRequest;
    expect(target.tasks.getTask(finishRequest.taskId)).toMatchObject({
      status: "waiting",
      target: { id: finishId },
    });
  });

  it("keeps started work non-interruptible, pauses attended progress after a device move, and resumes on arrival", () => {
    const target = createFixture();
    expect(target.cooking.claimStep("claim", {
      stepInstanceId: target.prepStepId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 10,
      reservationExpiresAtUtcMs: 100_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    expect(target.cooking.startStep("start", target.prepStepId, 11)).toMatchObject({ accepted: true });
    const taskId = target.cooking.getStep(target.prepStepId)!.taskRequest.taskId;
    expect(target.tasks.interruptTask("interrupt", taskId, chefA, "urgent-work", 12)).toMatchObject({
      accepted: false,
      code: "TASK_NOT_INTERRUPTIBLE",
    });
    expect(target.cooking.advance("progress", 4_011)).toMatchObject({
      accepted: true,
      value: [{ progressMs: 4_000, status: "running" }],
    });
    expect(target.layout.moveBuilding(
      "move-prep",
      prepId,
      scene.id,
      { x: 140, y: 20, orientation: "front" },
      4_012,
    )).toMatchObject({ accepted: true });
    expect(target.movement.advanceCharacter("replan", chefA, 4_013)).toMatchObject({
      accepted: true,
      value: { status: "moving" },
    });
    expect(target.cooking.advance("paused", 6_011)).toMatchObject({
      accepted: true,
      value: [{ progressMs: 4_000, status: "running" }],
    });
    expect(target.movement.advanceCharacter("arrive", chefA, 30_000)).toMatchObject({
      accepted: true,
      value: { status: "arrived" },
    });
    expect(target.cooking.advance("complete", 40_000)).toMatchObject({
      accepted: true,
      value: [{ status: "completed", progressMs: 9_175 }],
    });
    expect(target.tasks.getTask(taskId)).toMatchObject({ status: "completed" });
    expect(target.facilities.getBinding(target.prepStepId)).toBeNull();
    expect(target.events).toEqual(expect.arrayContaining([
      "kitchen-step.paused",
      "kitchen-step.completed",
    ]));
  });

  it("freezes automatic-step quality at start, lets the chef take new work, and restores progress without consuming twice", () => {
    const target = createFixture();
    expect(target.cooking.claimStep("claim", {
      stepInstanceId: target.boilStepId,
      candidate: candidate(chefB, 5),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 100_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    expect(target.cooking.startStep("start", target.boilStepId, 11)).toMatchObject({ accepted: true });
    expect(target.characters.addSkillExperience("level-up", {
      characterId: chefB,
      skill: "cooking",
      amount: 100,
      source: "training",
      occurredAtUtcMs: 12,
    })).toMatchObject({ accepted: true, value: { level: 6 } });
    expect(target.cooking.advance("progress", 5_011)).toMatchObject({
      accepted: true,
      value: [{ status: "running", progressMs: 5_000 }],
    });
    const saved = target.cooking.exportState();
    const restored = new KitchenStepExecutionModule({
      recipes: target.recipes,
      facilities: target.facilities,
      inventory: target.inventory,
      orders: target.orders,
      characters: target.characters,
      tasks: target.tasks,
      movement: target.movement,
      initialState: saved,
    });
    expect(restored.exportState()).toEqual(saved);
    expect(restored.getStep(target.boilStepId)).toMatchObject({
      performance: { cookingLevel: 5, weightedQuality: 5 },
    });
    expect(restored.startStep("start-again", target.boilStepId, 6_000)).toMatchObject({
      accepted: false,
      code: "ASSIGNMENT_NOT_CLAIMED",
    });
    expect(target.inventory.getStackQuantity("storage.airship", EGG)).toBe(0);
    expect(restored.advance("finish", 30_000)).toMatchObject({
      accepted: true,
      value: [{ status: "completed", performance: { cookingLevel: 5 } }],
    });
  });

it("expires pre-start claims by releasing the workstation, movement plan, chef assignment, and task together", () => {
    const target = createFixture();
    expect(target.cooking.claimStep("claim-timeout", {
      stepInstanceId: target.prepStepId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 15,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    const taskId = target.cooking.getStep(target.prepStepId)!.taskRequest.taskId;
    expect(target.cooking.expireClaims("expire", 16)).toMatchObject({
      accepted: true,
      value: [{ stepInstanceId: target.prepStepId }],
    });
    expect(target.cooking.getStep(target.prepStepId)).toBeNull();
    expect(target.facilities.getBinding(target.prepStepId)).toBeNull();
    expect(target.movement.getCharacter(chefA)).toMatchObject({ status: "idle", plan: null });
    expect(target.tasks.getTask(taskId)).toMatchObject({ status: "waiting", assignedCharacterId: null });
  });

  it("rejects locked steps and releases a claim when reserved ingredients are not ready", () => {
    const target = createFixture();
    const finishId = createRecipeExecutionStepId(target.mealId, "step.finish");
    expect(target.cooking.claimStep("claim-locked", {
      stepInstanceId: finishId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 1_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: false, code: "STEP_NOT_READY" });

    expect(target.cooking.claimStep("claim-prep", {
      stepInstanceId: target.prepStepId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 1_000,
      occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    expect(target.inventory.beginStackUnitTransit(
      "move-reserved-tomato",
      instanceId("instance.cargo.tomato"),
      TOMATO,
      "storage.airship",
      "storage.airship",
      10,
      "reservation.breakfast",
    )).toMatchObject({ accepted: false });
    // Simulate a reserved ingredient that is not yet at a stack location by restoring the
    // same reservation with only its egg allocation available.
    const inventoryState = target.inventory.exportState();
    const reservation = inventoryState.reservations[0]!;
    const missingTomatoState = Object.freeze({
      ...inventoryState,
      reservations: Object.freeze([
        Object.freeze({
          ...reservation,
          stackAllocations: Object.freeze(reservation.stackAllocations.filter((entry) => entry.itemId !== TOMATO)),
        }),
      ]),
    });
    const inventoryWithoutTomatoReservation = new InventoryModule(
      [
        { id: TOMATO, category: "ingredient", storageMode: "stack" },
        { id: EGG, category: "ingredient", storageMode: "stack" },
      { id: "dishware.plate", category: "dishware", storageMode: "instance" },
      { id: recipe.outputItemId, category: "meal", storageMode: "instance" },
      ],
      new StaticInventoryStorageDefinitions([
        {
          id: "storage.airship",
          compartments: [{ id: "ingredients", capacity: 20, acceptedCategories: ["ingredient"] }],
        },
      ]),
      missingTomatoState,
    );
    const alternate = new KitchenStepExecutionModule({
      recipes: target.recipes,
      facilities: target.facilities,
      inventory: inventoryWithoutTomatoReservation,
      orders: target.orders,
      characters: target.characters,
      tasks: target.tasks,
      movement: target.movement,
      initialState: target.cooking.exportState(),
    });
    expect(alternate.startStep("start-missing", target.prepStepId, 11)).toMatchObject({
      accepted: false,
      code: "INGREDIENTS_NOT_READY",
    });
    expect(alternate.getStep(target.prepStepId)).toBeNull();
    expect(target.tasks.getTask(target.cooking.getStep(target.prepStepId)!.taskRequest.taskId)).toMatchObject({
      status: "waiting",
    });
    expect(target.facilities.getBinding(target.prepStepId)).toBeNull();
  });
  it("runs parallel outputs through plating into one finished meal and advances the order", () => {
    const target = createFixture(true);
    for (const [operation, stepInstanceId, chef] of [
      ["prep", target.prepStepId, chefA],
      ["boil", target.boilStepId, chefB],
    ] as const) {
      expect(target.cooking.claimStep(`claim-${operation}`, {
        stepInstanceId,
        candidate: candidate(chef, chef === chefA ? 10 : 5),
        speedUnitsPerSecond: 20,
        reservationExpiresAtUtcMs: 100_000,
        occurredAtUtcMs: 10,
      })).toMatchObject({ accepted: true });
      expect(target.cooking.startStep(`start-${operation}`, stepInstanceId, 11))
        .toMatchObject({ accepted: true });
    }
    expect(target.cooking.advance("complete-parallel", 30_000)).toMatchObject({ accepted: true });
    expect(target.products?.createReadModel().availableIntermediates).toHaveLength(2);

    const platingStepId = createRecipeExecutionStepId(target.mealId, "step.finish");
    expect(target.cooking.claimStep("claim-plating", {
      stepInstanceId: platingStepId,
      candidate: candidate(chefA, 10),
      speedUnitsPerSecond: 20,
      reservationExpiresAtUtcMs: 200_000,
      occurredAtUtcMs: 30_001,
    })).toMatchObject({ accepted: true });
    expect(target.products?.getReservation(platingStepId)).toMatchObject({
      plateId: instanceId("instance.dishware.kitchen_1"),
      status: "reserved",
    });
    expect(target.movement.advanceCharacter("arrive-plating", chefA, 100_000))
      .toMatchObject({ accepted: true, value: { status: "arrived" } });
    expect(target.cooking.startStep("start-plating", platingStepId, 100_000))
      .toMatchObject({ accepted: true });
    expect(target.facilities.createReadModel().cacheClaims).toHaveLength(0);
    expect(target.cooking.advance("complete-plating", 110_000)).toMatchObject({
      accepted: true,
      value: [expect.objectContaining({ stepInstanceId: platingStepId, status: "completed" })],
    });
    expect(target.orders.getMeal(target.mealId)).toMatchObject({ status: "awaiting-pickup" });
    expect(target.products?.getFinishedMealByMealId(target.mealId)).toMatchObject({
      itemId: recipe.outputItemId,
      quality: 25 / 3,
      qualityWeight: 3,
      plateId: instanceId("instance.dishware.kitchen_1"),
      locationId: "airship.output",
    });
    expect(target.inventory.getLocationSnapshot("airship.output")?.instances
      .filter((entry) => entry.category === "meal")).toHaveLength(1);
  });
  it("records the same true completion boundaries under coarse and fine time advancement", () => {
    const run = (ticks: readonly number[]) => {
      const target = createFixture(true);
      for (const [operation, stepInstanceId, chef] of [
        ["prep", target.prepStepId, chefA],
        ["boil", target.boilStepId, chefB],
      ] as const) {
        target.cooking.claimStep(`deterministic-claim-${operation}`, {
          stepInstanceId,
          candidate: candidate(chef, chef === chefA ? 10 : 5),
          speedUnitsPerSecond: 20,
          reservationExpiresAtUtcMs: 100_000,
          occurredAtUtcMs: 10,
        });
        target.cooking.startStep(`deterministic-start-${operation}`, stepInstanceId, 11);
      }
      for (const tick of ticks) target.cooking.advance(`tick-${tick}`, tick);
      return {
        execution: target.recipes.getExecution(target.mealId),
        intermediates: target.products!.exportState().intermediates,
      };
    };
    const coarse = run([30_000]);
    const fine = run([5_000, 10_000, 15_000, 20_000, 30_000]);
    expect(fine.execution?.steps.map((step) => ({
      id: step.definitionStepId,
      status: step.status,
      readyAtUtcMs: step.readyAtUtcMs,
      completedAtUtcMs: step.completedAtUtcMs,
    }))).toEqual(coarse.execution?.steps.map((step) => ({
      id: step.definitionStepId,
      status: step.status,
      readyAtUtcMs: step.readyAtUtcMs,
      completedAtUtcMs: step.completedAtUtcMs,
    })));
    expect(fine.intermediates.map((entry) => ({
      sourceStepInstanceId: entry.sourceStepInstanceId,
      producedAtUtcMs: entry.producedAtUtcMs,
    }))).toEqual(coarse.intermediates.map((entry) => ({
      sourceStepInstanceId: entry.sourceStepInstanceId,
      producedAtUtcMs: entry.producedAtUtcMs,
    })));
  });

  it("continues a partially advanced kitchen from coordinator and product module state", () => {
    const target = createFixture(true);
    for (const [operation, stepInstanceId, chef] of [
      ["prep", target.prepStepId, chefA],
      ["boil", target.boilStepId, chefB],
    ] as const) {
      target.cooking.claimStep(`restore-claim-${operation}`, {
        stepInstanceId,
        candidate: candidate(chef, chef === chefA ? 10 : 5),
        speedUnitsPerSecond: 20,
        reservationExpiresAtUtcMs: 100_000,
        occurredAtUtcMs: 10,
      });
      target.cooking.startStep(`restore-start-${operation}`, stepInstanceId, 11);
    }
    expect(target.cooking.advance("restore-partial", 5_011)).toMatchObject({ accepted: true });
    const restoredProducts = new KitchenProductModule({
      recipes: target.recipes,
      inventory: target.inventory,
      dishware: target.dishware,
      cleanPlateLocationIds: ["airship.plates"],
      platedMealLocationId: "airship.output",
      initialState: target.products!.exportState(),
    });
    const restoredCooking = new KitchenStepExecutionModule({
      recipes: target.recipes,
      facilities: target.facilities,
      inventory: target.inventory,
      orders: target.orders,
      characters: target.characters,
      tasks: target.tasks,
      movement: target.movement,
      products: restoredProducts,
      initialState: target.cooking.exportState(),
    });
    expect(restoredCooking.advance("restore-complete", 30_000)).toMatchObject({
      accepted: true,
      value: [{ status: "completed" }, { status: "completed" }],
    });
    expect(restoredProducts.createReadModel().availableIntermediates).toHaveLength(2);
    expect(target.inventory.getStackQuantity("storage.airship", TOMATO)).toBe(0);
    expect(target.inventory.getStackQuantity("storage.airship", EGG)).toBe(0);
    expect(target.recipes.getExecution(target.mealId)).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({ definitionStepId: "step.finish", status: "ready" }),
      ]),
    });
  });
});

