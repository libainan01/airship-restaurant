import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  EmploymentModule,
  FinanceModule,
  InventoryModule,
  LocalProcurementModule,
  isLocalProcurementState,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  TaskModule,
  instanceId,
  type TaskCandidate,
} from "../src";

const ottoId = instanceId("instance.character.otto_procurement");

function fixture(initialCopper = 100) {
  const characters = new CharacterModule([{
    id: "character.otto",
    name: "奥拓",
    baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  }], []);
  characters.createCharacter("create-otto", { instanceId: ottoId, definitionId: "character.otto", coreMember: true, occurredAtUtcMs: 0 });
  const employment = new EmploymentModule(characters);
  employment.addEmployee("employ-otto", {
    characterId: ottoId,
    kind: "core",
    learnedJobIds: ["job.waiter", "job.local_procurer"],
    primaryJobId: "job.waiter",
    dailyShift: { startMinuteInclusive: 0, endMinuteExclusive: 1_439 },
    occurredAtUtcMs: 0,
  });
  const inventory = new InventoryModule([
    { id: "ingredient.egg", category: "ingredient", storageMode: "stack" },
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
  ], new StaticInventoryStorageDefinitions([
    { id: "station.ground", compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }] },
  ]));
  const finance = new FinanceModule(initialCopper);
  const tasks = new TaskModule();
  const recipes = new StaticOrderRecipeCatalog([{
    id: "recipe.tomato_egg",
    ingredients: [
      { itemId: "ingredient.egg", quantity: 2 },
      { itemId: "ingredient.tomato", quantity: 3 },
    ],
  }]);
  const options = {
    finance,
    inventory,
    characters,
    employment,
    tasks,
    recipes,
    pricing: { calculateUnitPriceCopper: (base: number, charm: number) => Math.max(1, base - Math.max(0, charm - 1)) },
    destinationLocationId: "station.ground",
    suppliers: [{
      id: "supplier.local_market",
      sourceRegionId: "region.greyfeather",
      preparationDurationMs: 500,
      roundTripDistanceUnits: 100,
      items: [
        { itemId: "ingredient.egg", baseUnitPriceCopper: 4 },
        { itemId: "ingredient.tomato", baseUnitPriceCopper: 3 },
      ],
    }],
    carts: [{ id: "cart.otto", capacity: 3, speedUnitsPerSecond: 100, levels: [{ level: 1, upgradeCostCopper: 0, capacity: 3, speedUnitsPerSecond: 100 }, { level: 2, upgradeCostCopper: 40, capacity: 5, speedUnitsPerSecond: 200 }] }],
  } as const;
  const procurement = new LocalProcurementModule(options);
  return { ...options, finance, inventory, characters, employment, tasks, recipes, procurement };
}

function candidate(): TaskCandidate {
  return {
    characterId: ottoId,
    available: true,
    tags: ["employee"],
    learnedJobIds: ["job.waiter", "job.local_procurer"],
    primaryJobId: "job.waiter",
    skills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
  };
}

const orderRequest = {
  recipeSelections: [{ recipeId: "recipe.tomato_egg", quantity: 1 }],
  freeItems: [],
  minuteOfDay: 100,
  destinationRegionId: "region.greyfeather",
  occurredAtUtcMs: 0,
} as const;

describe("LocalProcurementModule", () => {
  it("builds one recipe draft from gameplay ingredients, negotiates with Otto and fixes cart-sized batches", () => {
    const { procurement, finance } = fixture();
    expect(procurement.previewDraft(orderRequest)).toMatchObject({
      accepted: true,
      value: {
        negotiatorCharacterId: ottoId,
        negotiatorCharmLevel: 3,
        batchCapacitySnapshot: 3,
        expectedBatchCount: 2,
        totalPriceCopper: 7,
        lines: [
          { itemId: "ingredient.egg", recipeRequiredQuantity: 2, suggestedRecipeQuantity: 2, finalQuantity: 2, transactionUnitPriceCopper: 2 },
          { itemId: "ingredient.tomato", recipeRequiredQuantity: 3, suggestedRecipeQuantity: 3, finalQuantity: 3, transactionUnitPriceCopper: 1 },
        ],
      },
    });
    expect(procurement.placeOrder("place", orderRequest)).toMatchObject({ accepted: true, value: [{ totalQuantity: 5, totalPriceCopper: 7, negotiatorCharacterId: ottoId }] });
    expect(finance.getSnapshot()).toMatchObject({ balanceCopper: 93 });
    expect(procurement.exportState().batches).toMatchObject([
      { sequence: 1, totalQuantity: 3, capacitySnapshot: 3, status: "preparing", items: [{ itemId: "ingredient.egg", quantity: 2 }, { itemId: "ingredient.tomato", quantity: 1 }] },
      { sequence: 2, totalQuantity: 2, capacitySnapshot: 3, status: "preparing", items: [{ itemId: "ingredient.tomato", quantity: 2 }] },
    ]);
  });

  it("prepares without occupying people, then runs two immutable round trips into ground inventory", () => {
    const setup = fixture();
    setup.procurement.placeOrder("place", orderRequest);
    expect(setup.tasks.createReadModel()).toMatchObject({ waiting: [] });
    setup.procurement.advanceTo("ready", 500);
    expect(setup.tasks.createReadModel().waiting).toHaveLength(2);
    const [first, second] = setup.procurement.exportState().batches;

    expect(setup.procurement.startBatch("start-first", { batchId: first!.id, cartId: "cart.otto", candidate: candidate(), occurredAtUtcMs: 500 })).toMatchObject({ accepted: true, value: { status: "in-transit", cartSpeedSnapshot: 100, arrivesAtUtcMs: 1_500 } });
    expect(setup.inventory.getStackQuantity("station.ground", "ingredient.egg")).toBe(0);
    setup.procurement.advanceTo("arrive-first", 1_500);
    expect(setup.inventory.getStackQuantity("station.ground", "ingredient.egg")).toBe(2);
    expect(setup.inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(1);
    expect(setup.procurement.getOrder(first!.orderId)).toMatchObject({ status: "partial", deliveredQuantity: 3 });

    setup.procurement.startBatch("start-second", { batchId: second!.id, cartId: "cart.otto", candidate: candidate(), occurredAtUtcMs: 1_500 });
    const restored = new LocalProcurementModule({ ...setup, initialState: setup.procurement.exportState() });
    expect(restored.createTaskSourceSnapshot().activeTasks).toHaveLength(1);
    restored.advanceTo("arrive-second", 2_500);
    expect(setup.inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(3);
    expect(restored.getOrder(first!.orderId)).toMatchObject({ status: "completed", deliveredQuantity: 5, completedAtUtcMs: 2_500 });
    restored.advanceTo("no-duplicate", 3_000);
    expect(setup.inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(3);
  });

  it("shares free and recipe draft quantities while subtracting available and incoming stock once", () => {
    const { procurement, inventory } = fixture();
    inventory.depositStack("existing", "station.ground", [{ itemId: "ingredient.egg", quantity: 1 }], 0);
    procurement.placeOrder("incoming", {
      recipeSelections: [],
      freeItems: [{ itemId: "ingredient.tomato", quantity: 2 }],
      minuteOfDay: 100,
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs: 0,
    });
    expect(procurement.previewDraft({
      recipeSelections: [{ recipeId: "recipe.tomato_egg", quantity: 1 }],
      freeItems: [{ itemId: "ingredient.egg", quantity: 1 }],
      minuteOfDay: 100,
    })).toMatchObject({
      accepted: true,
      value: { lines: [
        { itemId: "ingredient.egg", availableInventoryQuantity: 1, incomingQuantity: 0, suggestedRecipeQuantity: 1, freeQuantity: 1, finalQuantity: 2 },
        { itemId: "ingredient.tomato", availableInventoryQuantity: 0, incomingQuantity: 2, suggestedRecipeQuantity: 1, freeQuantity: 0, finalQuantity: 1 },
      ] },
    });
  });
  it("rolls back the whole submission when funds are insufficient", () => {
    const { procurement, finance } = fixture(6);
    expect(procurement.placeOrder("too-expensive", orderRequest)).toMatchObject({ accepted: false, code: "FINANCE_REJECTED" });
    expect(finance.getSnapshot()).toMatchObject({ balanceCopper: 6 });
    expect(procurement.exportState()).toMatchObject({ orders: [], batches: [] });
  });

  it("uses base prices when no local procurer is on shift", () => {
    const { procurement } = fixture();
    expect(procurement.previewDraft({ ...orderRequest, minuteOfDay: 1_439 })).toMatchObject({
      accepted: true,
      value: { negotiatorCharacterId: null, negotiatorCharmLevel: 0, totalPriceCopper: 17 },
    });
  });
  it("upgrades an idle cart atomically and only changes future batch capacity and departure speed", () => {
    const setup = fixture();
    setup.procurement.placeOrder("place-before-upgrade", orderRequest);
    const oldBatches = setup.procurement.exportState().batches;

    expect(setup.procurement.upgradeCart("upgrade-cart", "cart.otto", 0)).toMatchObject({
      accepted: true,
      value: { id: "cart.otto", level: 2, capacity: 5, speedUnitsPerSecond: 200, activeBatchId: null },
    });
    expect(setup.finance.getSnapshot()).toMatchObject({ balanceCopper: 53 });
    expect(setup.procurement.exportState().batches.map((batch) => batch.capacitySnapshot)).toEqual([3, 3]);
    expect(setup.procurement.previewDraft({
      recipeSelections: [],
      freeItems: [{ itemId: "ingredient.egg", quantity: 4 }],
      finalQuantityOverrides: [{ itemId: "ingredient.egg", quantity: 4 }],
      minuteOfDay: 100,
    })).toMatchObject({ accepted: true, value: { batchCapacitySnapshot: 5, expectedBatchCount: 1 } });

    setup.procurement.advanceTo("ready-after-upgrade", 500);
    expect(setup.procurement.startBatch("start-after-upgrade", { batchId: oldBatches[0]!.id, cartId: "cart.otto", candidate: candidate(), occurredAtUtcMs: 500 })).toMatchObject({
      accepted: true,
      value: { capacitySnapshot: 3, cartSpeedSnapshot: 200, arrivesAtUtcMs: 1_000 },
    });
  });

  it("rejects upgrades while the cart is in transit and permits one after arrival", () => {
    const setup = fixture();
    setup.procurement.placeOrder("place-busy", orderRequest);
    setup.procurement.advanceTo("ready-busy", 500);
    const first = setup.procurement.exportState().batches[0]!;
    setup.procurement.startBatch("start-busy", { batchId: first.id, cartId: "cart.otto", candidate: candidate(), occurredAtUtcMs: 500 });

    expect(setup.procurement.upgradeCart("upgrade-busy", "cart.otto", 500)).toMatchObject({ accepted: false, code: "CART_BUSY" });
    expect(setup.finance.getSnapshot()).toMatchObject({ balanceCopper: 93 });
    setup.procurement.advanceTo("arrive-busy", 1_500);
    expect(setup.procurement.upgradeCart("upgrade-after-arrival", "cart.otto", 1_500)).toMatchObject({ accepted: true, value: { level: 2 } });
    expect(setup.finance.getSnapshot()).toMatchObject({ balanceCopper: 53 });
  });

  it("validates v2 procurement states at the persistence boundary", () => {
    const state = fixture().procurement.exportState();
    expect(isLocalProcurementState(state)).toBe(true);
    expect(isLocalProcurementState({ ...state, schemaVersion: 1 })).toBe(false);
    expect(isLocalProcurementState({ ...state, carts: [{ ...state.carts[0], capacity: 0 }] })).toBe(false);
    expect(isLocalProcurementState({ ...state, processedOperationIds: ["duplicate", "duplicate"] })).toBe(false);
  });
  it("rolls back failed cart upgrades and migrates v1 cart states to level one", () => {
    const poor = fixture(39);
    expect(poor.procurement.upgradeCart("upgrade-without-funds", "cart.otto", 0)).toMatchObject({ accepted: false, code: "FINANCE_REJECTED" });
    expect(poor.finance.getSnapshot()).toMatchObject({ balanceCopper: 39 });
    expect(poor.procurement.getCart("cart.otto")).toMatchObject({ level: 1, capacity: 3, speedUnitsPerSecond: 100 });

    const setup = fixture();
    const current = setup.procurement.exportState();
    const legacy = { ...current, schemaVersion: 1, carts: current.carts.map(({ level: _level, ...cart }) => cart) };
    const restored = new LocalProcurementModule({ ...setup, initialState: legacy as never });
    expect(restored.exportState()).toMatchObject({ schemaVersion: 2, carts: [{ id: "cart.otto", level: 1, capacity: 3, speedUnitsPerSecond: 100 }] });
  });
});