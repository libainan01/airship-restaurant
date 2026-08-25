import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  CustomerModule,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  InventoryModule,
  OrderModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  SceneCustomerVenueAdapter,
  SceneLayoutModule,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  instanceId,
  type CharacterDefinition,
  type CustomerModuleState,
  type CustomerVenuePort,
  type BuildingRuntimeDefinition,
} from "../src";

const sceneId = "scene.restaurant.ground";
const tomatoEggRecipeId = "recipe.tomato_egg";
const unavailableRecipeId = "recipe.onion_soup";
const characterDefinitions: readonly CharacterDefinition[] = [
  {
    id: "character.guest_a",
    name: "客人甲",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.guest_b",
    name: "客人乙",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.guest_c",
    name: "客人丙",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.worker",
    name: "轮班员工",
    baseSkills: { cooking: 1, charm: 2, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
];

function createFixture(options: {
  readonly customerState?: CustomerModuleState;
  readonly inventoryState?: ReturnType<InventoryModule["exportState"]>;
  readonly orderState?: ReturnType<OrderModule["exportState"]>;
  readonly tableSizes?: readonly number[];
  readonly waitingCapacity?: number;
  readonly venues?: CustomerVenuePort;
} = {}) {
  const eventBus = new DomainEventBus();
  const events: string[] = [];
  const emitted: { readonly type: string; readonly payload: unknown }[] = [];
  eventBus.subscribe("*", (event) => { events.push(event.type); emitted.push(event); });
  const characters = new CharacterModule(characterDefinitions, []);
  const guests = [
    instanceId("instance.character.customer_a"),
    instanceId("instance.character.customer_b"),
    instanceId("instance.character.customer_c"),
    instanceId("instance.character.customer_worker"),
  ] as const;
  characterDefinitions.forEach((definition, index) => {
    const result = characters.createCharacter(`create-customer-${index}`, {
      instanceId: guests[index]!,
      definitionId: definition.id,
      coreMember: index === 3,
      occurredAtUtcMs: 0,
    });
    if (!result.accepted) throw new Error(result.message);
  });
  const employment = new EmploymentModule(characters);
  const finance = new FinanceModule(100);
  const inventory = new InventoryModule(
    [
      { id: "ingredient.egg", category: "ingredient", storageMode: "stack" },
      { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
      { id: "ingredient.onion", category: "ingredient", storageMode: "stack" },
    ],
    new StaticInventoryStorageDefinitions([{
      id: "storage.airship.ingredients",
      compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }],
    }]),
    options.inventoryState,
  );
  if (options.inventoryState === undefined) {
    const seeded = inventory.depositStack("seed-customer-ingredients", "storage.airship.ingredients", [
      { itemId: "ingredient.egg", quantity: 4 },
      { itemId: "ingredient.tomato", quantity: 6 },
    ], 1);
    if (!seeded.accepted) throw new Error(seeded.message);
  }
  const recipes = new StaticOrderRecipeCatalog([
    {
      id: tomatoEggRecipeId,
      ingredients: [
        { itemId: "ingredient.egg", quantity: 2 },
        { itemId: "ingredient.tomato", quantity: 3 },
      ],
    },
    {
      id: unavailableRecipeId,
      ingredients: [{ itemId: "ingredient.onion", quantity: 1 }],
    },
  ]);
  const orders = new OrderModule({
    finance,
    inventory,
    recipeCatalog: recipes,
    ingredientSources: [{ kind: "stack", locationId: "storage.airship.ingredients" }],
    eventBus,
    initialState: options.orderState,
  });
  const tableSizes = options.tableSizes ?? [2];
  const venues = options.venues ?? new StaticCustomerVenueCatalog([{
    sceneId,
    waitingArea: {
      id: "waiting-area.ground",
      slotIds: Array.from({ length: options.waitingCapacity ?? 3 }, (_, index) => `waiting-slot-${index + 1}`),
    },
    tables: tableSizes.map((size, tableIndex) => ({
      id: `table-${tableIndex + 1}`,
      seatIds: Array.from({ length: size }, (_, seatIndex) => `table-${tableIndex + 1}-seat-${seatIndex + 1}`),
    })),
  }]);
  const menu = new StaticCustomerMenuCatalog([{
    sceneId,
    items: [
      { recipeId: tomatoEggRecipeId, baseUnitPriceCopper: 30 },
      { recipeId: unavailableRecipeId, baseUnitPriceCopper: 20 },
    ],
  }]);
  const customer = new CustomerModule({
    characters,
    employment,
    orders,
    venues,
    menu,
    mealDurationMs: 1_000,
    eventBus,
    initialState: options.customerState,
  });
  return { customer, employment, emitted, events, finance, guests, inventory, menu, orders, venues };
}

function arrive(
  customer: CustomerModule,
  visitId: string,
  members: readonly ReturnType<typeof instanceId>[],
  time: number,
) {
  return customer.arriveGroup(`arrive-${visitId}`, {
    visitId,
    sceneId,
    memberCharacterIds: members,
    minuteOfDay: 1_100,
    arrivedAtUtcMs: time,
  });
}

function submitPendingOrder(orders: OrderModule, pendingOrderId: string, orderId: string, time: number) {
  const pending = orders.exportState().pendingOrders.find((entry) => entry.id === pendingOrderId)!;
  return orders.submitPendingOrder({
    operationId: `submit-${orderId}`,
    pendingOrderId,
    orderId,
    linePrices: pending.lines.map((line) => ({
      lineId: line.id,
      baseUnitPriceCopper: 30,
      businessAdjustmentCopper: 0,
      transactionUnitPriceCopper: 30,
    })),
    submittedAtUtcMs: time,
  });
}

describe("CustomerModule", () => {
  it("keeps groups together, reserves the smallest suitable clean table, and queues by arrival", () => {
    const target = createFixture({ tableSizes: [1, 2], waitingCapacity: 3 });
    const pair = arrive(target.customer, "visit-pair", [target.guests[0], target.guests[1]], 10);
    expect(pair).toMatchObject({
      accepted: true,
      value: { phase: "moving-to-table", tableId: "table-2" },
    });
    const single = arrive(target.customer, "visit-single", [target.guests[2]], 11);
    expect(single).toMatchObject({
      accepted: true,
      value: { phase: "moving-to-table", tableId: "table-1" },
    });
    expect(target.customer.getVisit("visit-pair")?.seatAssignments).toHaveLength(2);
    expect(new Set(target.customer.getVisit("visit-pair")?.seatAssignments.map((seat) => seat.seatId)).size).toBe(2);
  });

  it("rejects overflow only when unmatched people cannot fit in the scene waiting area", () => {
    const target = createFixture({ tableSizes: [1], waitingCapacity: 1 });
    expect(arrive(target.customer, "visit-first", [target.guests[0]], 10)).toMatchObject({ accepted: true });
    expect(arrive(target.customer, "visit-waiting", [target.guests[1]], 11)).toMatchObject({
      accepted: true,
      value: { phase: "waiting", waitingSlotIds: ["waiting-slot-1"] },
    });
    expect(arrive(target.customer, "visit-overflow", [target.guests[2]], 12)).toMatchObject({
      accepted: false,
      code: "WAITING_AREA_FULL",
    });
    expect(target.customer.isCustomerVisitActive(target.guests[2])).toBe(false);
  });

  it("shows only ingredient-backed choices as orderable and records one table-side pending order", () => {
    const target = createFixture();
    arrive(target.customer, "visit-order", [target.guests[0]], 10);
    expect(target.customer.confirmSeated("seat-order", "visit-order", 20)).toMatchObject({ accepted: true });
    expect(target.customer.getOrderableMenu("visit-order")).toEqual([
      expect.objectContaining({ recipeId: tomatoEggRecipeId, orderable: true }),
      expect.objectContaining({
        recipeId: unavailableRecipeId,
        orderable: false,
        missingIngredients: [{ itemId: "ingredient.onion", quantity: 1 }],
      }),
    ]);
    const beforeDialogue = target.customer.exportState();
    expect(target.customer.getDialogueContext("visit-order")).toEqual({
      context: "waiting",
      tableId: "table-1",
      requiresMovement: false,
    });
    expect(target.customer.exportState()).toEqual(beforeDialogue);
    expect(target.customer.recordPendingOrder("record-wrong-diner", "visit-order", {
      pendingOrderId: "pending-wrong-diner",
      ingredientReservationId: "reservation-wrong-diner",
      lines: [{ id: "line-wrong", recipeId: tomatoEggRecipeId, quantity: 1, dinerCharacterIds: [target.guests[1]] }],
      occurredAtUtcMs: 29,
    })).toMatchObject({ accepted: false, code: "NO_ORDERABLE_SELECTION" });    expect(target.customer.recordPendingOrder("record-order", "visit-order", {
      pendingOrderId: "pending-order",
      ingredientReservationId: "reservation-order",
      lines: [{ id: "line-main", recipeId: tomatoEggRecipeId, quantity: 1, dinerCharacterIds: [target.guests[0]] }],
      occurredAtUtcMs: 30,
    })).toMatchObject({
      accepted: true,
      value: { phase: "pending-order", pendingOrderId: "pending-order" },
    });
    expect(target.orders.getReadModel()).toMatchObject({
      pendingSubmissions: [{ tableId: "table-1", customerGroupId: "visit-order" }],
      openOrders: [],
    });
  });
  it("continues a submitted order through eating, checkout, departure, dirty table and cleaning", () => {
    const target = createFixture({ tableSizes: [1], waitingCapacity: 2 });
    arrive(target.customer, "visit-main", [target.guests[0]], 10);
    target.customer.confirmSeated("seat-main", "visit-main", 20);
    target.customer.recordPendingOrder("record-main", "visit-main", {
      pendingOrderId: "pending-main",
      ingredientReservationId: "reservation-main",
      lines: [{ id: "line-main", recipeId: tomatoEggRecipeId, quantity: 1, dinerCharacterIds: [target.guests[0]] }],
      occurredAtUtcMs: 30,
    });
    const submitted = submitPendingOrder(target.orders, "pending-main", "order-main", 40);
    expect(submitted.accepted).toBe(true);
    expect(target.customer.advanceTo("observe-submission", 40)).toMatchObject({ accepted: true });
    expect(target.customer.getVisit("visit-main")).toMatchObject({ phase: "dining", orderId: "order-main" });

    const mealId = target.orders.getOrder("order-main")!.meals[0]!.id;
    (["in-production", "awaiting-pickup", "in-transit", "served"] as const).forEach((status, index) => {
      const result = target.orders.advanceMeal(
        `meal-${status}`,
        mealId,
        status,
        50 + index * 10,
        status === "served" ? 5 : undefined,
      );
      expect(result.accepted).toBe(true);
    });
    expect(target.customer.advanceTo("start-eating", 500)).toMatchObject({ accepted: true });
    expect(target.customer.getVisit("visit-main")?.mealProgress).toEqual([
      expect.objectContaining({ mealId, startedAtUtcMs: 80, completesAtUtcMs: 1_080, consumedAtUtcMs: null }),
    ]);

    const saved = {
      customer: target.customer.exportState(),
      inventory: target.inventory.exportState(),
      orders: target.orders.exportState(),
    };
    const restored = createFixture({
      customerState: saved.customer,
      inventoryState: saved.inventory,
      orderState: saved.orders,
      tableSizes: [1],
      waitingCapacity: 2,
    });
    expect(restored.customer.advanceTo("before-finish", 1_079)).toMatchObject({ accepted: true });
    expect(restored.orders.getMeal(mealId)?.status).toBe("served");
    expect(restored.customer.advanceTo("finish-eating", 1_080)).toMatchObject({ accepted: true });
    expect(restored.orders.getMeal(mealId)?.status).toBe("consumed");
    expect(restored.customer.getVisit("visit-main")?.phase).toBe("awaiting-payment");
    expect(restored.customer.advanceTo("repeat-after-finish", 1_100)).toMatchObject({ accepted: true });
    expect(restored.events.filter((type) => type === "customer.meal-consumed")).toHaveLength(1);
    expect(restored.emitted.find((event) => event.type === "customer.meal-consumed")?.payload).toEqual({
      visitId: "visit-main",
      orderId: "order-main",
      mealId,
      dinerCharacterId: restored.guests[0],
    });

    const settled = restored.orders.settleOrder({
      operationId: "settle-main",
      orderId: "order-main",
      settlementBatchId: "settlement-main",
      regionId: "region.demo",
      settledAtUtcMs: 1_200,
    });
    expect(settled).toMatchObject({ accepted: true, value: { status: "settled" } });
    restored.customer.advanceTo("observe-checkout", 1_200);
    expect(restored.customer.getVisit("visit-main")?.phase).toBe("departing");
    expect(restored.customer.getTable("table-1")).toMatchObject({
      cleanliness: "dirty",
      assignedVisitId: "visit-main",
    });

    expect(arrive(restored.customer, "visit-next", [restored.guests[1]], 1_210)).toMatchObject({
      accepted: true,
      value: { phase: "waiting" },
    });
    expect(restored.customer.confirmDeparted("depart-main", "visit-main", 1_300)).toMatchObject({
      accepted: true,
      value: { phase: "departed" },
    });
    expect(restored.customer.isCustomerVisitActive(restored.guests[0])).toBe(false);
    expect(restored.customer.getVisit("visit-next")?.phase).toBe("waiting");
    expect(restored.customer.markTableCleaned("clean-main", "table-1", 1_400)).toMatchObject({
      accepted: true,
      value: { cleanliness: "clean", assignedVisitId: "visit-next" },
    });
    expect(restored.customer.getVisit("visit-next")).toMatchObject({
      phase: "moving-to-table",
      tableId: "table-1",
    });
  });

  it("keeps an off-shift employee in customer context when their shift begins mid-visit", () => {
    const target = createFixture();
    const employee = target.employment.addEmployee("employ-customer-worker", {
      characterId: target.guests[3],
      kind: "core",
      learnedJobIds: ["job.waiter", "job.chef"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 1_000, endMinuteExclusive: 1_200 },
      occurredAtUtcMs: 2,
    });
    expect(employee.accepted).toBe(true);
    expect(target.customer.arriveGroup("arrive-worker", {
      visitId: "visit-worker",
      sceneId,
      memberCharacterIds: [target.guests[3]],
      minuteOfDay: 900,
      arrivedAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    expect(target.employment.getWorkContext(target.guests[3], {
      minuteOfDay: 1_100,
      customerVisitActive: target.customer.isCustomerVisitActive(target.guests[3]),
      voyageActive: false,
    })).toMatchObject({
      onShift: true,
      tags: ["customer"],
    });
  });
  it("reads waiting capacity from the current waiting-area building level", () => {
    const waitingBuilding: BuildingRuntimeDefinition = {
      id: "building.waiting_area",
      buildCostCopper: 100,
      allowedRegionTags: ["zone.ground"],
      styleIds: ["default"],
      defaultStyleId: "default",
      defaultOrientation: "front",
      necessary: false,
      movable: true,
      storable: false,
      removable: true,
      levels: [1, 2].map((level) => ({
        level,
        upgradeCostCopper: level === 1 ? 0 : 80,
        maxDurability: 100,
        components: [{ slotId: "slot.waiting_area", capabilityId: "capability.waiting_area" }],
        capabilityValues: { "waiting-area.slot-count": level },
        layouts: {
          front: {
            hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
            visualBounds: { x: 0, y: 0, width: 10, height: 10 },
            interactionAreas: [],
          },
        },
      })),
    };
    const venueAdapter = new SceneCustomerVenueAdapter([{
      sceneId,
      waitingAreaBuildingDefinitionId: waitingBuilding.id,
      waitingAreaSlotId: "slot.waiting_area",
      waitingSlotCountValueKey: "waiting-area.slot-count",
      tables: [{ id: "table-1", seatIds: ["table-1-seat-1"] }],
    }]);
    const layout = new SceneLayoutModule([{
      id: sceneId,
      placementRegions: [{ id: "region.ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 100, height: 100 } }],
    }], [waitingBuilding], venueAdapter);
    venueAdapter.attachLayout(layout);
    const placed = layout.placeBuilding("place-waiting-area", {
      instanceId: instanceId("instance.building.waiting_area"),
      definitionId: waitingBuilding.id,
      sceneId,
      transform: { x: 0, y: 0, orientation: "front" },
      totalInvestmentCopper: 100,
      occurredAtUtcMs: 1,
    });
    if (!placed.accepted) throw new Error(placed.message);
    const target = createFixture({ venues: venueAdapter });
    venueAdapter.attachRuntime(target.customer);

    expect(arrive(target.customer, "visit-table", [target.guests[0]], 10)).toMatchObject({ accepted: true, value: { phase: "moving-to-table" } });
    expect(arrive(target.customer, "visit-waiting-one", [target.guests[1]], 11)).toMatchObject({ accepted: true, value: { phase: "waiting" } });
    expect(arrive(target.customer, "visit-overflow-before-upgrade", [target.guests[2]], 12)).toMatchObject({ accepted: false, code: "WAITING_AREA_FULL" });

    expect(layout.upgradeBuilding("upgrade-waiting-area", placed.value.id, 2, 80, 2)).toMatchObject({ accepted: true });
    expect(venueAdapter.listVenues()[0]?.waitingArea.slotIds).toHaveLength(2);
    expect(arrive(target.customer, "visit-after-upgrade", [target.guests[2]], 13)).toMatchObject({ accepted: true, value: { phase: "waiting" } });
    expect(layout.removeBuilding("remove-occupied-waiting-area", placed.value.id, 3)).toMatchObject({ accepted: false, code: "TRANSITION_BLOCKED" });
  });
});