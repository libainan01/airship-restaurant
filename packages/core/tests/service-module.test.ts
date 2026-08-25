import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  CustomerModule,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  InventoryModule,
  OrderModule,
  ServiceModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  TaskModule,
  instanceId,
  restoreTaskModuleFromSources,
  type CharacterDefinition,
  type TaskCandidate,
} from "../src";

const sceneId = "scene.restaurant.ground";
const recipeId = "recipe.tomato_egg";
const definitions: readonly CharacterDefinition[] = [
  {
    id: "character.customer_one",
    name: "顾客一",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.customer_two",
    name: "顾客二",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.waiter",
    name: "服务员",
    baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
];

function fixture() {
  const bus = new DomainEventBus();
  const eventTypes: string[] = [];
  bus.subscribe("*", (event) => eventTypes.push(event.type));
  const characters = new CharacterModule(definitions, []);
  const customerOne = instanceId("instance.character.service_customer_one");
  const customerTwo = instanceId("instance.character.service_customer_two");
  const waiter = instanceId("instance.character.service_waiter");
  [customerOne, customerTwo, waiter].forEach((id, index) => {
    const created = characters.createCharacter(`create-service-character-${index}`, {
      instanceId: id,
      definitionId: definitions[index]!.id,
      coreMember: index === 2,
      occurredAtUtcMs: 0,
    });
    if (!created.accepted) throw new Error(created.message);
  });
  const employment = new EmploymentModule(characters);
  const inventory = new InventoryModule(
    [
      { id: "ingredient.egg", category: "ingredient", storageMode: "stack" },
      { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
    ],
    new StaticInventoryStorageDefinitions([{
      id: "storage.airship.ingredients",
      compartments: [{ id: "ingredients", capacity: 50, acceptedCategories: ["ingredient"] }],
    }]),
  );
  const seeded = inventory.depositStack("seed-service", "storage.airship.ingredients", [
    { itemId: "ingredient.egg", quantity: 4 },
    { itemId: "ingredient.tomato", quantity: 6 },
  ], 1);
  if (!seeded.accepted) throw new Error(seeded.message);
  const finance = new FinanceModule(100);
  const recipes = new StaticOrderRecipeCatalog([{
    id: recipeId,
    ingredients: [
      { itemId: "ingredient.egg", quantity: 2 },
      { itemId: "ingredient.tomato", quantity: 3 },
    ],
  }]);
  const orders = new OrderModule({
    finance,
    inventory,
    recipeCatalog: recipes,
    ingredientSources: [{ kind: "stack", locationId: "storage.airship.ingredients" }],
    eventBus: bus,
  });
  const customers = new CustomerModule({
    characters,
    employment,
    orders,
    venues: new StaticCustomerVenueCatalog([{
      sceneId,
      waitingArea: { id: "waiting.ground", slotIds: ["waiting.1", "waiting.2"] },
      tables: [{ id: "table.1", seatIds: ["table.1.seat.1"] }],
    }]),
    menu: new StaticCustomerMenuCatalog([{
      sceneId,
      items: [{ recipeId, baseUnitPriceCopper: 30 }],
    }]),
    mealDurationMs: 100,
    eventBus: bus,
  });
  const tasks = new TaskModule();
  const service = new ServiceModule({
    customers,
    orders,
    tasks,
    mealPickup: { isReadyAtGroundPickup: () => true },
    eventBus: bus,
  });
  const candidate: TaskCandidate = {
    characterId: waiter,
    available: true,
    tags: ["employee"],
    learnedJobIds: ["job.waiter"],
    primaryJobId: "job.waiter",
    skills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
  };
  return { candidate, customerOne, customerTwo, customers, eventTypes, finance, orders, service, tasks };
}

function onlyTask(service: ServiceModule, type: string) {
  const task = service.createTaskSourceSnapshot().waitingTasks.find((entry) => entry.taskType === type);
  if (task === undefined) throw new Error(`Missing task: ${type}`);
  return task;
}

describe("ServiceModule", () => {
  it("drives reception and the non-interruptible one-table order transmission workflow", () => {
    const target = fixture();
    target.customers.arriveGroup("arrive-main", {
      visitId: "visit.main",
      sceneId,
      memberCharacterIds: [target.customerOne],
      minuteOfDay: 100,
      arrivedAtUtcMs: 10,
    });
    const reception = onlyTask(target.service, "service.reception");
    expect(reception).toMatchObject({ basePriority: 250, interruptible: true });
    expect(target.service.synchronizeTasks("sync-reception", 10)).toMatchObject({ accepted: true });
    expect(target.service.startTask("start-reception", reception.taskId, target.candidate, 11)).toMatchObject({ accepted: true });
    expect(target.service.completeReception("finish-reception", reception.taskId, 20)).toMatchObject({ accepted: true });
    expect(target.customers.getVisit("visit.main")?.phase).toBe("awaiting-order");

    target.service.synchronizeTasks("sync-order", 20);
    const takeOrder = onlyTask(target.service, "service.take-order");
    target.service.startTask("start-order", takeOrder.taskId, target.candidate, 21);
    const recorded = target.service.recordOrderAtTable("record-order", takeOrder.taskId, {
      pendingOrderId: "pending.main",
      ingredientReservationId: "reservation.main",
      lines: [{ id: "line.main", recipeId, quantity: 1, dinerCharacterIds: [target.customerOne] }],
      occurredAtUtcMs: 30,
    });
    expect(recorded).toMatchObject({
      accepted: true,
      value: { stage: "transmitting-order", pendingOrderId: "pending.main", request: { interruptible: false } },
    });
    expect(target.tasks.getTask(takeOrder.taskId)).toMatchObject({ status: "in-progress", interruptible: false });
    expect(target.service.submitRecordedOrder("transmit-order", takeOrder.taskId, {
      orderId: "order.main",
      linePrices: [{
        lineId: "line.main",
        baseUnitPriceCopper: 30,
        businessAdjustmentCopper: 0,
        transactionUnitPriceCopper: 30,
      }],
      occurredAtUtcMs: 40,
    })).toMatchObject({ accepted: true, value: { status: "submitted" } });
    expect(target.tasks.getTask(takeOrder.taskId)?.status).toBe("completed");
    expect(target.eventTypes).toContain("task.completed");
    expect(target.eventTypes).toContain("service.order-transmitted");
  });

  it("projects delivery above checkout and raises dirty-table cleanup when guests are queued", () => {
    const target = fixture();
    target.customers.arriveGroup("arrive-main", {
      visitId: "visit.main",
      sceneId,
      memberCharacterIds: [target.customerOne],
      minuteOfDay: 100,
      arrivedAtUtcMs: 10,
    });
    const reception = onlyTask(target.service, "service.reception");
    target.service.startTask("start-reception", reception.taskId, target.candidate, 11);
    target.service.completeReception("finish-reception", reception.taskId, 20);
    const takeOrder = onlyTask(target.service, "service.take-order");
    target.service.startTask("start-order", takeOrder.taskId, target.candidate, 21);
    target.service.recordOrderAtTable("record-order", takeOrder.taskId, {
      pendingOrderId: "pending.main",
      ingredientReservationId: "reservation.main",
      lines: [{ id: "line.main", recipeId, quantity: 1, dinerCharacterIds: [target.customerOne] }],
      occurredAtUtcMs: 30,
    });
    target.service.submitRecordedOrder("transmit-order", takeOrder.taskId, {
      orderId: "order.main",
      linePrices: [{ lineId: "line.main", baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
      occurredAtUtcMs: 40,
    });
    target.customers.advanceTo("observe-order", 40);
    const mealId = target.orders.getOrder("order.main")!.meals[0]!.id;
    target.orders.advanceMeal("produce", mealId, "in-production", 50);
    target.orders.advanceMeal("plate", mealId, "awaiting-pickup", 60);
    const delivery = onlyTask(target.service, "service.deliver-meal");
    expect(delivery).toMatchObject({ basePriority: 400, urgent: true, interruptible: false });
    target.service.startTask("start-delivery", delivery.taskId, target.candidate, 61);
    expect(target.service.completeExternalHandoff("premature-delivery", delivery.taskId, { mealId }, 62)).toMatchObject({
      accepted: false,
      code: "SOURCE_STILL_ACTIVE",
    });

    target.orders.advanceMeal("pickup", mealId, "in-transit", 70);
    target.orders.advanceMeal("serve", mealId, "served", 80, 5);
    expect(target.service.completeExternalHandoff("finish-delivery", delivery.taskId, { mealId }, 80)).toMatchObject({ accepted: true });
    expect(target.tasks.getTask(delivery.taskId)?.status).toBe("completed");
    target.customers.advanceTo("eat-start", 80);
    target.customers.advanceTo("eat-end", 180);
    const checkout = onlyTask(target.service, "service.checkout");
    expect(checkout.basePriority).toBe(300);
    target.service.startTask("start-checkout", checkout.taskId, target.candidate, 181);
    target.service.completeCheckout("finish-checkout", checkout.taskId, {
      settlementBatchId: "settlement.main",
      regionId: "region.demo",
      occurredAtUtcMs: 190,
    });
    target.customers.advanceTo("observe-checkout", 190);
    target.customers.arriveGroup("arrive-next", {
      visitId: "visit.next",
      sceneId,
      memberCharacterIds: [target.customerTwo],
      minuteOfDay: 100,
      arrivedAtUtcMs: 191,
    });
    target.customers.confirmDeparted("depart-main", "visit.main", 200);
    const cleanup = onlyTask(target.service, "service.clean-table");
    expect(cleanup).toMatchObject({ basePriority: 300, urgent: true, urgency: 20 });

    const restored = restoreTaskModuleFromSources({ persistence: null, sources: [target.service.createTaskSourceSnapshot()] });
    expect(restored.rebuiltWaitingTaskIds).toContain(cleanup.taskId);
    target.service.startTask("start-cleanup", cleanup.taskId, target.candidate, 201);
    target.customers.markTableCleaned("table-cleaned-by-r6-07", "table.1", 210);
    expect(target.service.completeExternalHandoff("finish-cleanup", cleanup.taskId, { tableId: "table.1" }, 210))
      .toMatchObject({ accepted: true });
    expect(target.tasks.getTask(cleanup.taskId)?.status).toBe("completed");
  });
});