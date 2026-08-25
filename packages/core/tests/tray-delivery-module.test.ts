import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  CustomerModule,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  InventoryModule,
  LinearTrayTipPolicy,
  OrderModule,
  ServiceModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticTrayCarrierLocations,
  StaticTrayRouteCosts,
  TaskModule,
  TrayDeliveryModule,
  instanceId,
  type CharacterDefinition,
  type TaskCandidate,
  type TrayCapacityPort,
} from "../src";

class MutableTrayCapacity implements TrayCapacityPort {
  constructor(public value: number) {}
  getCapacity(): number { return this.value; }
}

const recipeId = "recipe.tomato_egg";
const mealItemId = "meal.tomato_egg";
const groundLocationId = "storage.ground.exchange.meals";
const carrierLocationId = "storage.character.waiter.tray";
const waiterId = instanceId("instance.character.tray_waiter");
const dinerId = instanceId("instance.character.tray_diner");
const definitions: readonly CharacterDefinition[] = [{
  id: "character.waiter",
  name: "服务员",
  baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
  defaultTalentIds: [],
}];

function fixture(carrierCapacity = 4) {
  const bus = new DomainEventBus();
  const eventTypes: string[] = [];
  bus.subscribe("*", (event) => eventTypes.push(event.type));
  const characters = new CharacterModule(definitions, []);
  const createdCharacter = characters.createCharacter("create-waiter", {
    instanceId: waiterId,
    definitionId: "character.waiter",
    coreMember: true,
    occurredAtUtcMs: 0,
  });
  if (!createdCharacter.accepted) throw new Error(createdCharacter.message);
  const employment = new EmploymentModule(characters);
  const inventory = new InventoryModule([
    { id: "ingredient.egg", category: "ingredient", storageMode: "stack" },
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
    { id: mealItemId, category: "meal", storageMode: "instance" },
  ], new StaticInventoryStorageDefinitions([
    {
      id: "storage.airship.ingredients",
      compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }],
    },
    {
      id: groundLocationId,
      compartments: [{ id: "meals", capacity: 100, acceptedCategories: ["meal"] }],
    },
    {
      id: carrierLocationId,
      compartments: [{ id: "tray", capacity: carrierCapacity, acceptedCategories: ["meal"] }],
    },
  ]));
  const seeded = inventory.depositStack("seed-ingredients", "storage.airship.ingredients", [
    { itemId: "ingredient.egg", quantity: 20 },
    { itemId: "ingredient.tomato", quantity: 30 },
  ], 1);
  if (!seeded.accepted) throw new Error(seeded.message);
  const orders = new OrderModule({
    finance: new FinanceModule(0),
    inventory,
    recipeCatalog: new StaticOrderRecipeCatalog([{
      id: recipeId,
      ingredients: [
        { itemId: "ingredient.egg", quantity: 2 },
        { itemId: "ingredient.tomato", quantity: 3 },
      ],
    }]),
    ingredientSources: [{ kind: "stack", locationId: "storage.airship.ingredients" }],
    eventBus: bus,
  });
  const customers = new CustomerModule({
    characters,
    employment,
    orders,
    venues: new StaticCustomerVenueCatalog([{
      sceneId: "scene.ground",
      waitingArea: { id: "waiting.ground", slotIds: ["waiting.1"] },
      tables: [
        { id: "table.1", seatIds: ["table.1.seat.1"] },
        { id: "table.2", seatIds: ["table.2.seat.1"] },
      ],
    }]),
    menu: new StaticCustomerMenuCatalog([{
      sceneId: "scene.ground",
      items: [{ recipeId, baseUnitPriceCopper: 30 }],
    }]),
    mealDurationMs: 100,
    eventBus: bus,
  });
  const mealIds: string[] = [];
  for (let index = 1; index <= 2; index += 1) {
    const pending = orders.createPendingOrder({
      operationId: `pending-${index}`,
      pendingOrderId: `pending.${index}`,
      tableId: `table.${index}`,
      customerGroupId: `group.${index}`,
      lines: [{ id: `line.${index}`, recipeId, quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: `reservation.${index}`,
      createdAtUtcMs: 10 + index,
    });
    if (!pending.accepted) throw new Error(pending.message);
    const submitted = orders.submitPendingOrder({
      operationId: `submit-${index}`,
      pendingOrderId: `pending.${index}`,
      orderId: `order.${index}`,
      linePrices: [{ lineId: `line.${index}`, baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
      submittedAtUtcMs: 20 + index,
    });
    if (!submitted.accepted) throw new Error(submitted.message);
    const mealId = submitted.value.meals[0]!.id;
    mealIds.push(mealId);
    const production = orders.advanceMeal(`production-${index}`, mealId, "in-production", 30 + index);
    const plated = orders.advanceMeal(`plated-${index}`, mealId, "awaiting-pickup", 40 + index);
    if (!production.accepted || !plated.accepted) throw new Error("Meal progression failed.");
    const mealInstanceId = instanceId(`instance.meal.tray_${index}`);
    const mealCreated = inventory.createInstance(`meal-instance-${index}`, {
      instanceId: mealInstanceId,
      itemId: mealItemId,
      locationId: groundLocationId,
      attributes: { mealId, orderId: `order.${index}` },
      occurredAtUtcMs: 50 + index,
    });
    if (!mealCreated.accepted) throw new Error(mealCreated.message);
  }
  const tasks = new TaskModule();
  const service = new ServiceModule({
    customers,
    orders,
    tasks,
    mealPickup: {
      isReadyAtGroundPickup: (mealId) => inventory.getSnapshot().locations
        .find((entry) => entry.id === groundLocationId)?.instances
        .some((entry) => entry.attributes.mealId === mealId) ?? false,
    },
    eventBus: bus,
  });
  const candidate: TaskCandidate = {
    characterId: waiterId,
    available: true,
    tags: ["employee"],
    learnedJobIds: ["job.waiter"],
    primaryJobId: "job.waiter",
    skills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
  };
  const initialDeliveryTasks = service.createTaskSourceSnapshot().waitingTasks;
  const synchronized = service.synchronizeTasks("sync-delivery-tasks", 59);
  if (!synchronized.accepted) throw new Error(synchronized.message);
  const leadTask = initialDeliveryTasks.find((entry) => entry.source.id === mealIds[0]);
  if (leadTask === undefined) throw new Error("Missing lead delivery task.");
  const started = service.startTask("start-lead-delivery", leadTask.taskId, candidate, 60);
  if (!started.accepted) throw new Error(started.message);
  const capacity = new MutableTrayCapacity(2);
  const options = {
    characters,
    inventory,
    orders,
    service,
    capacity,
    carrierLocations: new StaticTrayCarrierLocations([{ characterId: waiterId, locationId: carrierLocationId }]),
    routeCosts: new StaticTrayRouteCosts([
      { fromLocationId: groundLocationId, tableId: "table.1", cost: 5 },
      { fromLocationId: groundLocationId, tableId: "table.2", cost: 2 },
      { fromLocationId: "table.1", tableId: "table.2", cost: 1 },
      { fromLocationId: "table.2", tableId: "table.1", cost: 1 },
    ]),
    tips: new LinearTrayTipPolicy(1_000),
    groundPickupLocationId: groundLocationId,
    eventBus: bus,
  } as const;
  return { candidate, capacity, eventTypes, inventory, leadTask, mealIds, options, orders, service, tasks };
}

describe("TrayDeliveryModule", () => {
  it("snapshots capacity, batches meals across tables and delivers the nearest table first", () => {
    const target = fixture();
    const trays = new TrayDeliveryModule(target.options);
    const pickup = trays.pickupBatch("pickup-batch", "batch.1", target.leadTask.taskId, 70);
    expect(pickup).toMatchObject({
      accepted: true,
      value: { capacitySnapshot: 2, status: "delivering" },
    });
    if (!pickup.accepted) throw new Error(pickup.message);
    expect(pickup.value.meals).toHaveLength(2);
    expect(target.mealIds.map((mealId) => target.orders.getMeal(mealId)?.status)).toEqual(["in-transit", "in-transit"]);
    expect(target.inventory.getSnapshot().locations.find((entry) => entry.id === carrierLocationId)?.instances).toHaveLength(2);
    expect(target.tasks.getTask(target.leadTask.taskId)).toMatchObject({ status: "in-progress", interruptible: false });
    const joinedTask = target.service.createTaskSourceSnapshot().waitingTasks.find((entry) => entry.source.id === target.mealIds[1]);
    expect(joinedTask).toBeUndefined();
    const staleJoinedTask = target.tasks.createReadModel().recentTerminal.find((entry) => entry.source.id === target.mealIds[1]);
    expect(staleJoinedTask).toMatchObject({ status: "cancelled", result: { reason: "service-source-advanced" } });

    target.capacity.value = 1;
    const firstTable = trays.deliverNextTable("deliver-first-table", "batch.1", 80);
    expect(firstTable).toMatchObject({ accepted: true, value: { status: "delivering", currentLocationId: "table.2", capacitySnapshot: 2 } });
    expect(target.orders.getOrder("order.2")?.meals[0]).toMatchObject({ status: "served", tipCopper: 9 });
    expect(target.orders.getOrder("order.1")?.meals[0]?.status).toBe("in-transit");

    const saved = trays.exportState();
    const restored = new TrayDeliveryModule({ ...target.options, initialState: saved });
    const completed = restored.deliverNextTable("deliver-second-table", "batch.1", 90);
    expect(completed).toMatchObject({ accepted: true, value: { status: "completed", capacitySnapshot: 2 } });
    expect(target.orders.getOrder("order.1")?.meals[0]).toMatchObject({ status: "served", tipCopper: 9 });
    expect(target.tasks.getTask(target.leadTask.taskId)?.status).toBe("completed");
    expect(target.eventTypes).toContain("tray-delivery.meal-delivered");
    expect(target.eventTypes).toContain("tray-delivery.batch-completed");
    expect(target.eventTypes).toContain("task.completed");

    const pending = target.orders.createPendingOrder({
      operationId: "pending-3",
      pendingOrderId: "pending.3",
      tableId: "table.3",
      customerGroupId: "group.3",
      lines: [{ id: "line.3", recipeId, quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: "reservation.3",
      createdAtUtcMs: 100,
    });
    expect(pending.accepted).toBe(true);
    const submitted = target.orders.submitPendingOrder({
      operationId: "submit-3",
      pendingOrderId: "pending.3",
      orderId: "order.3",
      linePrices: [{ lineId: "line.3", baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
      submittedAtUtcMs: 101,
    });
    if (!submitted.accepted) throw new Error(submitted.message);
    const nextMealId = submitted.value.meals[0]!.id;
    target.orders.advanceMeal("production-3", nextMealId, "in-production", 102);
    target.orders.advanceMeal("plated-3", nextMealId, "awaiting-pickup", 103);
    const nextMealInstanceId = instanceId("instance.meal.tray_3");
    target.inventory.createInstance("meal-instance-3", {
      instanceId: nextMealInstanceId,
      itemId: mealItemId,
      locationId: groundLocationId,
      attributes: { mealId: nextMealId, orderId: "order.3" },
      occurredAtUtcMs: 104,
    });
    const nextTask = target.service.createTaskSourceSnapshot().waitingTasks
      .find((entry) => entry.source.id === nextMealId)!;
    expect(target.service.startTask("start-next-delivery", nextTask.taskId, target.candidate, 105)).toMatchObject({ accepted: true });
    const nextPickup = restored.pickupBatch("pickup-next-batch", "batch.2", nextTask.taskId, 106);
    expect(nextPickup).toMatchObject({ accepted: true, value: { capacitySnapshot: 1 } });
    if (!nextPickup.accepted) throw new Error(nextPickup.message);
    expect(nextPickup.value.meals).toHaveLength(1);
  });

  it("rolls back every meal when the carrier cannot accept the whole pickup batch", () => {
    const target = fixture(1);
    const trays = new TrayDeliveryModule(target.options);
    expect(trays.pickupBatch("pickup-over-capacity", "batch.rollback", target.leadTask.taskId, 70)).toMatchObject({
      accepted: false,
      code: "DEPENDENCY_REJECTED",
    });
    expect(target.mealIds.map((mealId) => target.orders.getMeal(mealId)?.status)).toEqual(["awaiting-pickup", "awaiting-pickup"]);
    expect(target.inventory.getSnapshot().locations.find((entry) => entry.id === groundLocationId)?.instances).toHaveLength(2);
    expect(target.inventory.getSnapshot().locations.find((entry) => entry.id === carrierLocationId)?.instances).toHaveLength(0);
    expect(trays.createReadModel().activeBatches).toHaveLength(0);
  });
});