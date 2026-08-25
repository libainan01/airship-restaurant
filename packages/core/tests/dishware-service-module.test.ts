import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  CustomerModule,
  DishwareModule,
  DishwareServiceModule,
  DishwareServiceSupplyBridge,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  InventoryModule,
  LinearTrayTipPolicy,
  LogisticsDemandModule,
  OrderModule,
  ServiceModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticTrayCarrierLocations,
  TaskModule,
  instanceId,
  type CharacterDefinition,
  type TaskCandidate,
} from "../src";

const recipeId = "recipe.tomato_egg";
const plateItemId = "dishware.plate";
const waiterId = instanceId("instance.character.dishware_waiter");
const customerId = instanceId("instance.character.dishware_customer");
const plateIds = [1, 2, 3, 4].map((value) => instanceId(`instance.dishware.service_${value}`));
const definitions: readonly CharacterDefinition[] = [
  { id: "character.waiter", name: "奥拓", baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 }, defaultTalentIds: [] },
  { id: "character.customer", name: "顾客", baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 }, defaultTalentIds: [] },
];

function fixture(saved?: ReturnType<DishwareServiceModule["exportState"]>, orderBlocking = false) {
  const bus = new DomainEventBus();
  const eventTypes: string[] = [];
  bus.subscribe("*", (event) => eventTypes.push(event.type));
  const characters = new CharacterModule(definitions, []);
  for (const [index, id] of [waiterId, customerId].entries()) {
    const created = characters.createCharacter(`create-character-${index}`, {
      instanceId: id,
      definitionId: definitions[index]!.id,
      coreMember: index === 0,
      occurredAtUtcMs: 0,
    });
    if (!created.accepted) throw new Error(created.message);
  }
  const employment = new EmploymentModule(characters);
  const inventory = new InventoryModule([
    { id: "ingredient.egg", category: "ingredient", storageMode: "stack" },
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
    { id: plateItemId, category: "dishware", storageMode: "instance" },
  ], new StaticInventoryStorageDefinitions([
    { id: "airship.ingredients", compartments: [{ id: "ingredients", capacity: 50, acceptedCategories: ["ingredient"] }] },
    { id: "cabinet.clean", compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "cabinet.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "cabinet.washing", compartments: [{ id: "washing", capacity: 1, acceptedCategories: ["dishware"] }] },
    { id: "meal.binding", compartments: [{ id: "binding", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "table.1.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "waiter.dishware", compartments: [{ id: "carry", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "ground.exchange.plates", compartments: [{ id: "plates", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: "airship.exchange.plates", compartments: [{ id: "plates", capacity: 2, acceptedCategories: ["dishware"] }] },
  ]));
  const seeded = inventory.depositStack("seed-ingredients", "airship.ingredients", [
    { itemId: "ingredient.egg", quantity: 4 },
    { itemId: "ingredient.tomato", quantity: 6 },
  ], 1);
  if (!seeded.accepted) throw new Error(seeded.message);
  const dishware = new DishwareModule({
    inventory,
    eventBus: bus,
    plateItemId,
    cabinets: [{
      id: "cabinet.main",
      supplyComponentId: "component.cabinet.supply",
      cleanStorageLocationId: "cabinet.clean",
      dirtyStorageLocationId: "cabinet.dirty",
      washingLocationId: "cabinet.washing",
      suppliedPlateCount: 4,
      washDurationMs: 10,
      parallelWashCount: 1,
    }],
  });
  const initialized = dishware.initializeSupply("initialize-plates", "component.cabinet.supply", plateIds, 2);
  if (!initialized.accepted) throw new Error(initialized.message);
  const reservedPlate = dishware.reserveCleanPlate("reserve-meal-plate", "reservation.meal.plate", "recipe", "meal", ["cabinet.clean"], 3);
  if (!reservedPlate.accepted) throw new Error(reservedPlate.message);
  const usedPlate = dishware.beginUse("use-meal-plate", "reservation.meal.plate", "meal.binding", 4);
  if (!usedPlate.accepted) throw new Error(usedPlate.message);

  const orders = new OrderModule({
    finance: new FinanceModule(0),
    inventory,
    recipeCatalog: new StaticOrderRecipeCatalog([{
      id: recipeId,
      ingredients: [{ itemId: "ingredient.egg", quantity: 2 }, { itemId: "ingredient.tomato", quantity: 3 }],
    }]),
    ingredientSources: [{ kind: "stack", locationId: "airship.ingredients" }],
    eventBus: bus,
  });
  const customers = new CustomerModule({
    characters,
    employment,
    orders,
    venues: new StaticCustomerVenueCatalog([{
      sceneId: "scene.ground",
      waitingArea: { id: "waiting.ground", slotIds: ["waiting.1"] },
      tables: [{ id: "table.1", seatIds: ["table.1.seat.1"] }],
    }]),
    menu: new StaticCustomerMenuCatalog([{ sceneId: "scene.ground", items: [{ recipeId, baseUnitPriceCopper: 30 }] }]),
    mealDurationMs: 10,
    eventBus: bus,
  });
  const tasks = new TaskModule();
  const bridge = new DishwareServiceSupplyBridge();
  const service = new ServiceModule({
    customers,
    orders,
    tasks,
    mealPickup: { isReadyAtGroundPickup: () => true },
    dishwareSupply: bridge,
    eventBus: bus,
  });
  const logistics = new LogisticsDemandModule({ inventory, eventBus: bus });
  const carrierLocations = new StaticTrayCarrierLocations([{ characterId: waiterId, locationId: "waiter.dishware" }]);
  const mealPlateBindings = new Map<string, typeof usedPlate.value.id>();
  const flow = new DishwareServiceModule({
    customers,
    dishware,
    inventory,
    logistics,
    orders,
    mealPlates: { getPlateId: (mealId) => mealPlateBindings.get(mealId) ?? null },
    service,
    carrierLocations,
    tables: [{ tableId: "table.1", dirtyPlateLocationId: "table.1.dirty", cabinetId: "cabinet.main" }],
    supplyTargets: [{
      id: "target.airship.plates",
      sourceCleanStorageLocationId: "cabinet.clean",
      handoffLocationId: "ground.exchange.plates",
      targetCleanStorageLocationId: "airship.exchange.plates",
      targetQuantity: 2,
      plateItemId,
    }],
    orderBlock: { isTargetOrderBlocking: () => orderBlocking },
    eventBus: bus,
    ...(saved === undefined ? {} : { initialState: saved }),
  });
  bridge.connect(flow);
  const candidate: TaskCandidate = {
    characterId: waiterId,
    available: true,
    tags: ["employee"],
    learnedJobIds: ["job.waiter"],
    primaryJobId: "job.waiter",
    skills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
  };
  return { candidate, customers, dishware, eventTypes, flow, inventory, logistics, mealPlateBindings, orders, service, tasks, usedPlateId: usedPlate.value.id };
}

function task(service: ServiceModule, type: string) {
  const value = service.createTaskSourceSnapshot().waitingTasks.find((entry) => entry.taskType === type);
  if (value === undefined) throw new Error(`Missing task: ${type}`);
  return value;
}

function prepareConsumedVisit(target: ReturnType<typeof fixture>) {
  target.customers.arriveGroup("arrive", {
    visitId: "visit.main",
    sceneId: "scene.ground",
    memberCharacterIds: [customerId],
    minuteOfDay: 100,
    arrivedAtUtcMs: 10,
  });
  const reception = task(target.service, "service.reception");
  target.service.startTask("start-reception", reception.taskId, target.candidate, 11);
  target.service.completeReception("complete-reception", reception.taskId, 12);
  const ordering = task(target.service, "service.take-order");
  target.service.startTask("start-order", ordering.taskId, target.candidate, 13);
  target.service.recordOrderAtTable("record-order", ordering.taskId, {
    pendingOrderId: "pending.main",
    ingredientReservationId: "reservation.ingredients",
    lines: [{ id: "line.main", recipeId, quantity: 1, dinerCharacterIds: [customerId] }],
    occurredAtUtcMs: 14,
  });
  target.service.submitRecordedOrder("submit-order", ordering.taskId, {
    orderId: "order.main",
    linePrices: [{ lineId: "line.main", baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
    occurredAtUtcMs: 15,
  });
  target.customers.advanceTo("observe-order", 15);
  const mealId = target.orders.getOrder("order.main")!.meals[0]!.id;
  target.mealPlateBindings.set(mealId, target.usedPlateId);
  target.orders.advanceMeal("production", mealId, "in-production", 16);
  target.orders.advanceMeal("plated", mealId, "awaiting-pickup", 17);
  target.orders.advanceMeal("pickup", mealId, "in-transit", 18);
  target.orders.advanceMeal("served", mealId, "served", 19, new LinearTrayTipPolicy(1_000).calculateTipCopper(3, 30));
  target.customers.advanceTo("begin-eating", 19);
  target.customers.advanceTo("finish-eating", 29);
  expect(target.orders.getMeal(mealId)?.status).toBe("consumed");
  return mealId;
}

function settleAndDepart(target: ReturnType<typeof fixture>) {
  const checkout = task(target.service, "service.checkout");
  target.service.startTask("start-checkout", checkout.taskId, target.candidate, 30);
  target.service.completeCheckout("complete-checkout", checkout.taskId, {
    settlementBatchId: "settlement.main",
    regionId: "region.demo",
    occurredAtUtcMs: 31,
  });
  target.customers.advanceTo("observe-checkout", 31);
  target.customers.confirmDeparted("depart", "visit.main", 32);
}

function deliverAllSupply(target: ReturnType<typeof fixture>, startAt: number) {
  for (let index = 0; index < 2; index += 1) {
    const supply = task(target.service, "service.supply-plate");
    target.service.startTask(`start-supply-${index}`, supply.taskId, target.candidate, startAt + index * 5);
    const handed = target.flow.handoffSupplyPlate(`handoff-supply-${index}`, supply.taskId, startAt + index * 5 + 1);
    expect(handed).toMatchObject({ accepted: true, value: { status: "handed-to-logistics" } });
    const claim = target.logistics.claimNextUnit(`claim-supply-${index}`, `claim.supply.${index}`, startAt + index * 5 + 2);
    if (!claim.accepted) throw new Error(claim.message);
    const moved = target.inventory.transferInstance(
      `move-supply-${index}`,
      claim.value.inventoryInstanceId!,
      claim.value.targetLocationId,
      startAt + index * 5 + 3,
      claim.value.capacityReservationId,
    );
    if (!moved.accepted) throw new Error(moved.message);
    const completed = target.logistics.completeClaim(`complete-supply-${index}`, claim.value.id, startAt + index * 5 + 4);
    if (!completed.accepted) throw new Error(completed.message);
  }
}

describe("DishwareServiceModule", () => {
  it("returns a consumed plate through cleanup and restores the two-and-two supply target without changing total count", () => {
    const target = fixture();
    const mealId = prepareConsumedVisit(target);
    expect(target.flow.synchronizeConsumedMeals("sync-consumed", 29)).toMatchObject({ accepted: true, value: [mealId] });
    expect(target.dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 0, dirty: 1, washing: 0 });
    expect(target.inventory.getLocationSnapshot("table.1.dirty")?.instances.map((entry) => entry.id)).toEqual([target.usedPlateId]);
    settleAndDepart(target);

    expect(target.flow.refreshSupplyJobs("refresh-supply", 33)).toMatchObject({ accepted: true, value: [{ status: "waiting-service" }, { status: "waiting-service" }] });
    const cleanup = task(target.service, "service.clean-table");
    target.service.startTask("start-cleanup", cleanup.taskId, target.candidate, 34);
    expect(target.flow.pickupDirtyTable("pickup-dirty", cleanup.taskId, 35)).toMatchObject({ accepted: true, value: { plateIds: [target.usedPlateId] } });
    expect(target.customers.createReadModel().tables[0]?.cleanliness).toBe("dirty");
    expect(target.flow.deliverDirtyToCabinet("deliver-dirty", cleanup.taskId, 36)).toMatchObject({ accepted: true, value: { completedAtUtcMs: 36 } });
    expect(target.customers.createReadModel().tables[0]?.cleanliness).toBe("clean");
    expect(target.tasks.getTask(cleanup.taskId)?.status).toBe("completed");
    expect(target.dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 0, dirty: 0, washing: 1 });

    deliverAllSupply(target, 40);
    target.flow.advanceWashing("finish-washing", 60);
    expect(target.dishware.getSnapshot()).toMatchObject({ totalPlateCount: 4, counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 } });
    expect(target.inventory.getLocationSnapshot("airship.exchange.plates")?.instances).toHaveLength(2);
    expect(target.inventory.getLocationSnapshot("cabinet.clean")?.instances).toHaveLength(2);
    expect(target.inventory.getSnapshot().locations.flatMap((entry) => entry.instances)).toHaveLength(4);
    expect(target.eventTypes).toContain("dishware-service.table-cleanup-completed");
    expect(target.eventTypes).toContain("dishware.washing-completed");
    expect(target.eventTypes).toContain("logistics.unit-delivered");
  });

  it("raises an order-blocking supply task and releases obsolete waiting reservations when the target is filled", () => {
    const target = fixture(undefined, true);
    target.flow.refreshSupplyJobs("refresh-blocking", 10);
    target.service.synchronizeTasks("sync-blocking", 10);
    const supplyTasks = target.service.createTaskSourceSnapshot().waitingTasks.filter((entry) => entry.taskType === "service.supply-plate");
    expect(supplyTasks).toHaveLength(2);
    expect(supplyTasks[0]).toMatchObject({ basePriority: 400, urgency: 20, urgent: true, interruptible: false });
    const jobs = target.flow.exportState().supplyJobs;
    jobs.forEach((job, index) => {
      const moved = target.inventory.transferInstance(`external-fill-${index}`, job.plateId, "airship.exchange.plates", 11 + index);
      if (!moved.accepted) throw new Error(moved.message);
    });
    expect(target.flow.refreshSupplyJobs("refresh-filled", 20)).toMatchObject({ accepted: true, value: [] });
    expect(target.flow.listSupplyNeeds()).toHaveLength(0);
    expect(target.inventory.getSnapshot().reservations.filter((entry) => entry.ownerType === "dishware-supply")).toHaveLength(0);
    expect(target.eventTypes.filter((entry) => entry === "dishware-service.supply-job-cancelled")).toHaveLength(2);

    target.service.synchronizeTasks("sync-cancelled", 20);
    expect(target.tasks.createReadModel().waiting.filter((entry) => entry.taskType === "service.supply-plate")).toHaveLength(0);
    jobs.forEach((job, index) => {
      const returned = target.inventory.transferInstance(`external-return-${index}`, job.plateId, "cabinet.clean", 21 + index);
      if (!returned.accepted) throw new Error(returned.message);
    });
    const repeated = target.flow.refreshSupplyJobs("refresh-repeated", 30);
    expect(repeated).toMatchObject({ accepted: true, value: [{ status: "waiting-service" }, { status: "waiting-service" }] });
    if (!repeated.accepted) throw new Error(repeated.message);
    expect(repeated.value.every((job) => !jobs.some((previous) => previous.id === job.id))).toBe(true);
    target.service.synchronizeTasks("sync-repeated", 30);
    expect(target.tasks.createReadModel().waiting.filter((entry) => entry.taskType === "service.supply-plate")).toHaveLength(2);
  });

  it("restores reserved supply jobs without duplicating their plate instances or service needs", () => {
    const target = fixture();
    target.flow.refreshSupplyJobs("refresh-before-save", 10);
    const saved = target.flow.exportState();
    const restoredFlow = new DishwareServiceModule({
      customers: target.customers,
      dishware: target.dishware,
      inventory: target.inventory,
      logistics: target.logistics,
      orders: target.orders,
      mealPlates: { getPlateId: (mealId) => target.mealPlateBindings.get(mealId) ?? null },
      service: target.service,
      carrierLocations: new StaticTrayCarrierLocations([{ characterId: waiterId, locationId: "waiter.dishware" }]),
      tables: [{ tableId: "table.1", dirtyPlateLocationId: "table.1.dirty", cabinetId: "cabinet.main" }],
      supplyTargets: [{ id: "target.airship.plates", sourceCleanStorageLocationId: "cabinet.clean", handoffLocationId: "ground.exchange.plates", targetCleanStorageLocationId: "airship.exchange.plates", targetQuantity: 2, plateItemId }],
      initialState: saved,
    });
    expect(restoredFlow.listSupplyNeeds()).toHaveLength(2);
    expect(restoredFlow.refreshSupplyJobs("refresh-after-save", 11)).toMatchObject({ accepted: true, value: [] });
    expect(target.inventory.getSnapshot().reservations.filter((entry) => entry.ownerType === "dishware-supply")).toHaveLength(2);
    expect(target.inventory.getSnapshot().locations.flatMap((entry) => entry.instances)).toHaveLength(4);
  });
});