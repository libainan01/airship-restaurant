import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  FinanceModule,
  InventoryModule,
  OrderModule,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  instanceId,
  type OrderIngredientSourceDefinition,
  type OrderMealStatus,
} from "../src";

const mealProgression: readonly OrderMealStatus[] = [
  "in-production",
  "awaiting-pickup",
  "in-transit",
  "served",
  "consumed",
];

const recipeIds = [
  "recipe-omelet",
  "recipe-a",
  "recipe-b",
  "recipe-c",
  "recipe-new",
  "recipe-other",
] as const;

const dinerId = instanceId("instance.character.order_diner");

const ingredientSources: readonly OrderIngredientSourceDefinition[] = [
  { kind: "stack", locationId: "storage.airship" },
  { kind: "inbound-stack-cargo", locationId: "transport.inbound" },
  { kind: "stack", locationId: "storage.ground" },
];

function createSubject(eventBus = new DomainEventBus()) {
  const finance = new FinanceModule(1_000);
  const inventory = new InventoryModule(
    [{ id: "ingredient.tomato", category: "ingredient", storageMode: "stack" }],
    new StaticInventoryStorageDefinitions([
      {
        id: "storage.airship",
        compartments: [{ id: "ingredients", capacity: 200, acceptedCategories: ["ingredient"] }],
      },
      {
        id: "transport.inbound",
        compartments: [{ id: "cargo", capacity: 20, acceptedCategories: ["ingredient"] }],
      },
      {
        id: "storage.ground",
        compartments: [{ id: "ingredients", capacity: 200, acceptedCategories: ["ingredient"] }],
      },
    ]),
  );
  const seeded = inventory.depositStack(
    "seed-order-tests",
    "storage.ground",
    [{ itemId: "ingredient.tomato", quantity: 100 }],
    1,
  );
  if (!seeded.accepted) throw new Error(seeded.message);
  const recipeCatalog = new StaticOrderRecipeCatalog(recipeIds.map((id) => ({
    id,
    ingredients: [{ itemId: "ingredient.tomato", quantity: 1 }],
  })));
  const orders = new OrderModule({
    finance,
    inventory,
    recipeCatalog,
    ingredientSources,
    eventBus,
  });
  return { eventBus, finance, ingredientSources, inventory, orders, recipeCatalog };
}

function createAndSubmit(
  orders: OrderModule,
  options: { readonly quantity?: number; readonly orderId?: string } = {},
) {
  const orderId = options.orderId ?? "order-1";
  const pending = orders.createPendingOrder({
    operationId: `create-${orderId}`,
    pendingOrderId: `pending-${orderId}`,
    tableId: `table-${orderId}`,
    customerGroupId: `group-${orderId}`,
    lines: [{ id: "line-main", recipeId: "recipe-omelet", quantity: options.quantity ?? 1, dinerCharacterIds: Array.from({ length: options.quantity ?? 1 }, () => dinerId) }],
    ingredientReservationId: `reservation-${orderId}`,
    createdAtUtcMs: 10,
  });
  expect(pending.accepted).toBe(true);
  const submitted = orders.submitPendingOrder({
    operationId: `submit-${orderId}`,
    pendingOrderId: `pending-${orderId}`,
    orderId,
    linePrices: [{
      lineId: "line-main",
      baseUnitPriceCopper: 120,
      businessAdjustmentCopper: -20,
      transactionUnitPriceCopper: 100,
    }],
    focusBonusRateBasisPoints: 1_000,
    submittedAtUtcMs: 20,
  });
  expect(submitted.accepted).toBe(true);
  if (!submitted.accepted) throw new Error(submitted.message);
  return submitted.value;
}

function consumeMeal(
  orders: OrderModule,
  mealId: string,
  operationPrefix: string,
  startAt = 100,
  tipCopper = 0,
) {
  mealProgression.forEach((status, index) => {
    const result = orders.advanceMeal(
      `${operationPrefix}-${status}`,
      mealId,
      status,
      startAt + index,
      status === "served" ? tipCopper : undefined,
    );
    expect(result.accepted).toBe(true);
  });
}

describe("OrderModule", () => {
  it("keeps table-side selection pending and submits one aggregated order exactly once", () => {
    const { orders } = createSubject();
    const pending = orders.createPendingOrder({
      operationId: "create-pending",
      pendingOrderId: "pending-1",
      tableId: "table-1",
      customerGroupId: "group-1",
      lines: [
        { id: "line-a", recipeId: "recipe-a", quantity: 2, dinerCharacterIds: [dinerId, dinerId] },
        { id: "line-b", recipeId: "recipe-b", quantity: 1, dinerCharacterIds: [dinerId] },
      ],
      ingredientReservationId: "reservation-table-1",
      createdAtUtcMs: 10,
    });
    expect(pending.accepted).toBe(true);
    expect(orders.getReadModel().openOrders).toHaveLength(0);
    expect(orders.getReadModel().pendingSubmissions).toHaveLength(1);

    const sameTable = orders.createPendingOrder({
      operationId: "create-pending-again",
      pendingOrderId: "pending-2",
      tableId: "table-1",
      customerGroupId: "group-2",
      lines: [{ id: "line-c", recipeId: "recipe-c", quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: "reservation-same-table",
      createdAtUtcMs: 11,
    });
    expect(sameTable).toMatchObject({
      accepted: false,
      code: "TABLE_ALREADY_HAS_PENDING_ORDER",
    });

    const submitted = orders.submitPendingOrder({
      operationId: "submit-order",
      pendingOrderId: "pending-1",
      orderId: "order-1",
      linePrices: [
        {
          lineId: "line-a",
          baseUnitPriceCopper: 100,
          businessAdjustmentCopper: 20,
          transactionUnitPriceCopper: 120,
        },
        {
          lineId: "line-b",
          baseUnitPriceCopper: 80,
          businessAdjustmentCopper: 0,
          transactionUnitPriceCopper: 80,
        },
      ],
      submittedAtUtcMs: 20,
    });
    expect(submitted.accepted).toBe(true);
    if (!submitted.accepted) throw new Error(submitted.message);
    expect(submitted.value).toMatchObject({
      status: "submitted",
      ingredientReservationIds: ["reservation-table-1"],
    });
    expect(submitted.value.meals).toHaveLength(3);
    expect(submitted.value.meals.every((meal) => meal.status === "pending-production")).toBe(true);
    expect(submitted.committedEventIds).toEqual(expect.arrayContaining([
      "order.created:submit-order",
      "order.kitchen-notified:submit-order",
    ]));

    const whileOpen = orders.createPendingOrder({
      operationId: "create-while-table-open",
      pendingOrderId: "pending-while-open",
      tableId: "table-1",
      customerGroupId: "group-1",
      lines: [{ id: "line-new", recipeId: "recipe-new", quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: "reservation-while-open",
      createdAtUtcMs: 21,
    });
    expect(whileOpen).toMatchObject({
      accepted: false,
      code: "TABLE_ALREADY_HAS_PENDING_ORDER",
    });
    const repeated = orders.submitPendingOrder({
      operationId: "submit-order-repeat",
      pendingOrderId: "pending-1",
      orderId: "order-1",
      linePrices: [],
      submittedAtUtcMs: 999,
    });
    expect(repeated).toMatchObject({ accepted: true, changed: false });
    expect(orders.exportState().orders).toHaveLength(1);
    expect(orders.getReadModel().pendingSubmissions).toHaveLength(0);
  });

  it("tracks each serving independently, broadcasts every transition, and derives aggregate status", () => {
    const eventBus = new DomainEventBus();
    const events: string[] = [];
    eventBus.subscribe("*", (event) => events.push(event.id));
    const { orders } = createSubject(eventBus);
    const order = createAndSubmit(orders, { quantity: 2 });
    const [firstMeal, secondMeal] = order.meals;
    expect(firstMeal).toBeDefined();
    expect(secondMeal).toBeDefined();

    const blocked = orders.setMealBlocked("block-second", secondMeal!.id, "waiting for a pan", 30);
    expect(blocked.accepted).toBe(true);
    expect(orders.advanceMeal("blocked-transition", secondMeal!.id, "in-production", 31))
      .toMatchObject({ accepted: false, code: "MEAL_BLOCKED" });
    expect(orders.setMealBlocked("restore-second", secondMeal!.id, null, 32).accepted).toBe(true);

    const started = orders.advanceMeal("start-first", firstMeal!.id, "in-production", 40);
    expect(started.accepted).toBe(true);
    if (!started.accepted) throw new Error(started.message);
    expect(started.value.status).toBe("fulfilling");
    expect(orders.advanceMeal("skip-step", secondMeal!.id, "awaiting-pickup", 41))
      .toMatchObject({ accepted: false, code: "INVALID_MEAL_TRANSITION" });

    for (const status of mealProgression.slice(1)) {
      expect(orders.advanceMeal(`first-${status}`, firstMeal!.id, status, 50).accepted).toBe(true);
    }
    expect(orders.exportState().orders[0]!.status).toBe("fulfilling");
    consumeMeal(orders, secondMeal!.id, "second", 60);
    expect(orders.exportState().orders[0]!.status).toBe("awaiting-payment");
    expect(events).toContain(`order.meal-status-changed:${secondMeal!.id}:in-production`);
    expect(events).toContain(`order.meal-status-changed:${secondMeal!.id}:consumed`);
    expect(events).toContain("order.awaiting-payment:order-1");
  });

  it("settles immutable dish prices with separate tips and focus bonus exactly once", () => {
    const { finance, orders } = createSubject();
    const order = createAndSubmit(orders, { quantity: 2 });
    order.meals.forEach((meal, index) => consumeMeal(
      orders,
      meal.id,
      `consume-${index}`,
      100 + index * 10,
      15,
    ));

    const settled = orders.settleOrder({
      operationId: "settle-order",
      orderId: order.id,
      settlementBatchId: "batch-order-1",
      regionId: "region-local",
      settledAtUtcMs: 200,
    });
    expect(settled.accepted).toBe(true);
    if (!settled.accepted) throw new Error(settled.message);
    expect(settled.value.status).toBe("settled");
    expect(settled.committedEventIds).toContain("order.settled:order-1");

    const snapshot = finance.getSnapshot();
    expect(snapshot.balanceCopper).toBe(1_250);
    expect(snapshot.ledger.map((entry) => [entry.category, entry.amountCopper])).toEqual([
      ["dish-sales", 200],
      ["tips", 30],
      ["focus-bonus", 20],
    ]);
    expect(snapshot.settlementBatches).toHaveLength(1);
    expect(snapshot.settlementBatches[0]!.settlementKey).toBe("order:order-1");

    const repeated = orders.settleOrder({
      operationId: "settle-order-repeat",
      orderId: order.id,
      settlementBatchId: "ignored-new-batch",
      regionId: "region-local",
      settledAtUtcMs: 999,
    });
    expect(repeated).toMatchObject({ accepted: true, changed: false });
    expect(finance.getSnapshot().balanceCopper).toBe(1_250);
    expect(finance.getSnapshot().settlementBatches).toHaveLength(1);
  });

  it("rolls back order and finance together when finance rejects settlement", () => {
    const { finance, orders } = createSubject();
    const order = createAndSubmit(orders);
    consumeMeal(orders, order.meals[0]!.id, "consume", 50);
    const seeded = finance.settleBatch(
      "seed-finance-operation",
      "occupied-batch-id",
      "unrelated:settlement",
      [{
        entryId: "seed-income",
        amountCopper: 5,
        category: "other-income",
        occurredAtUtcMs: 80,
        sourceType: "test",
        sourceId: "seed",
        regionId: "region-local",
      }],
      80,
      "test",
      "seed",
    );
    expect(seeded.accepted).toBe(true);

    const rejected = orders.settleOrder({
      operationId: "settle-rejected",
      orderId: order.id,
      settlementBatchId: "occupied-batch-id",
      regionId: "region-local",
      settledAtUtcMs: 90,
    });
    expect(rejected).toMatchObject({ accepted: false, code: "FINANCE_REJECTED" });
    expect(orders.exportState().orders[0]!.status).toBe("awaiting-payment");
    expect(orders.exportState().processedOperationIds).not.toContain("settle-rejected");
    expect(finance.getSnapshot().balanceCopper).toBe(1_005);
    expect(finance.getSnapshot().settlementBatches).toHaveLength(1);

    const retry = orders.settleOrder({
      operationId: "settle-retry",
      orderId: order.id,
      settlementBatchId: "valid-order-batch",
      regionId: "region-local",
      settledAtUtcMs: 91,
    });
    expect(retry.accepted).toBe(true);
    expect(finance.getSnapshot().balanceCopper).toBe(1_115);
  });

  it("restores pending and open orders without replaying domain events", () => {
    const eventBus = new DomainEventBus();
    const { finance, ingredientSources, inventory, orders, recipeCatalog } = createSubject(eventBus);
    const order = createAndSubmit(orders);
    expect(orders.advanceMeal("start-meal", order.meals[0]!.id, "in-production", 30).accepted).toBe(true);
    expect(orders.setMealBlocked("block-meal", order.meals[0]!.id, "station unavailable", 31).accepted).toBe(true);
    expect(orders.createPendingOrder({
      operationId: "create-other-pending",
      pendingOrderId: "pending-other",
      tableId: "table-other",
      customerGroupId: "group-other",
      lines: [{ id: "line-other", recipeId: "recipe-other", quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: "reservation-other",
      createdAtUtcMs: 40,
    }).accepted).toBe(true);
    const saved = orders.exportState();

    const replayed: string[] = [];
    const restoreBus = new DomainEventBus();
    restoreBus.subscribe("*", (event) => replayed.push(event.id));
    const restored = new OrderModule({
      finance,
      inventory,
      recipeCatalog,
      ingredientSources,
      eventBus: restoreBus,
      initialState: saved,
    });

    expect(restored.exportState()).toEqual(saved);
    expect(restored.getReadModel().pendingSubmissions.map((entry) => entry.id)).toEqual(["pending-other"]);
    expect(restored.getReadModel().openOrders[0]).toMatchObject({ status: "fulfilling" });
    expect(restored.getReadModel().openOrders[0]!.meals[0]).toMatchObject({
      status: "in-production",
      blockedReason: "station unavailable",
    });
    expect(replayed).toEqual([]);
  });
});
