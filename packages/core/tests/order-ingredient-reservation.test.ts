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
} from "../src";

const TOMATO = "ingredient.tomato";
const EGG = "ingredient.egg";
const dinerId = instanceId("instance.character.order_diner");

const ingredientSources: readonly OrderIngredientSourceDefinition[] = [
  { kind: "stack", locationId: "storage.airship" },
  { kind: "inbound-stack-cargo", locationId: "transport.inbound" },
  { kind: "stack", locationId: "storage.ground" },
];

function createSubject() {
  const inventory = new InventoryModule(
    [
      { id: TOMATO, category: "ingredient", storageMode: "stack" },
      { id: EGG, category: "ingredient", storageMode: "stack" },
    ],
    new StaticInventoryStorageDefinitions([
      {
        id: "storage.airship",
        compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }],
      },
      {
        id: "transport.inbound",
        compartments: [{ id: "cargo", capacity: 10, acceptedCategories: ["ingredient"] }],
      },
      {
        id: "storage.ground",
        compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }],
      },
      {
        id: "procurement.not-arrived",
        compartments: [{ id: "cargo", capacity: 100, acceptedCategories: ["ingredient"] }],
      },
    ]),
  );
  const eventBus = new DomainEventBus();
  const orders = new OrderModule({
    finance: new FinanceModule(1_000),
    inventory,
    recipeCatalog: new StaticOrderRecipeCatalog([
      {
        id: "recipe.tomato-eggs",
        ingredients: [
          { itemId: EGG, quantity: 2 },
          { itemId: TOMATO, quantity: 3 },
        ],
      },
      {
        id: "recipe.tomato-soup",
        ingredients: [{ itemId: TOMATO, quantity: 2 }],
      },
    ]),
    ingredientSources,
    eventBus,
  });
  return { eventBus, inventory, orders };
}

function createPending(orders: OrderModule, suffix: string, tableId = `table-${suffix}`) {
  return orders.createPendingOrder({
    operationId: `create-${suffix}`,
    pendingOrderId: `pending-${suffix}`,
    tableId,
    customerGroupId: `group-${suffix}`,
    lines: [{ id: `line-${suffix}`, recipeId: "recipe.tomato-eggs", quantity: 1, dinerCharacterIds: [dinerId] }],
    ingredientReservationId: `reservation-${suffix}`,
    createdAtUtcMs: 20,
  });
}

describe("Order whole-table ingredient reservation", () => {
  it("allocates airship, inbound cargo, then ground inventory and carries the reservation into the formal order", () => {
    const { inventory, orders } = createSubject();
    inventory.depositStack("seed-airship", "storage.airship", [
      { itemId: EGG, quantity: 2 },
      { itemId: TOMATO, quantity: 1 },
    ], 1);
    inventory.depositStack("seed-ground", "storage.ground", [{ itemId: TOMATO, quantity: 3 }], 2);
    const cargoId = instanceId("instance.cargo.inbound-tomato");
    expect(inventory.beginStackUnitTransit(
      "start-inbound",
      cargoId,
      TOMATO,
      "storage.ground",
      "transport.inbound",
      3,
    ).accepted).toBe(true);

    const availability = orders.checkIngredientAvailability([
      { id: "line-main", recipeId: "recipe.tomato-eggs", quantity: 1 },
    ]);
    expect(availability).toMatchObject({
      orderable: true,
      reason: null,
      requirements: [
        { itemId: EGG, quantity: 2 },
        { itemId: TOMATO, quantity: 3 },
      ],
      stackAllocations: [
        { locationId: "storage.airship", itemId: EGG, quantity: 2 },
        { locationId: "storage.airship", itemId: TOMATO, quantity: 1 },
        { locationId: "storage.ground", itemId: TOMATO, quantity: 1 },
      ],
      stackCargoIds: [cargoId],
      missing: [],
    });

    const created = createPending(orders, "one");
    expect(created.accepted).toBe(true);
    if (!created.accepted) throw new Error(created.message);
    expect(created.value.ingredientReservationIds).toEqual(["reservation-one"]);
    expect(created.committedEventIds).toEqual(expect.arrayContaining([
      "inventory.resources-reserved:create-one:inventory",
      "order.ingredients-reserved:create-one",
      "order.pending-created:create-one",
    ]));
    expect(inventory.getReservation("reservation-one")).toMatchObject({
      ownerType: "pending-order",
      ownerId: "pending-one",
      stackCargoIds: [cargoId],
    });
    expect(inventory.getLocationSnapshot("transport.inbound")?.stackCargo[0]?.reservationId)
      .toBe("reservation-one");

    const submitted = orders.submitPendingOrder({
      operationId: "submit-one",
      pendingOrderId: "pending-one",
      orderId: "order-one",
      linePrices: [{
        lineId: "line-one",
        baseUnitPriceCopper: 100,
        businessAdjustmentCopper: 0,
        transactionUnitPriceCopper: 100,
      }],
      submittedAtUtcMs: 30,
    });
    expect(submitted.accepted).toBe(true);
    if (!submitted.accepted) throw new Error(submitted.message);
    expect(submitted.value.ingredientReservationIds).toEqual(["reservation-one"]);
    expect(inventory.getSnapshot().reservations).toHaveLength(1);
  });

  it("does not count procurement stock and rolls both modules back when any ingredient is missing", () => {
    const { inventory, orders } = createSubject();
    inventory.depositStack("seed-eggs", "storage.airship", [{ itemId: EGG, quantity: 1 }], 1);
    inventory.depositStack("seed-tomato", "storage.ground", [{ itemId: TOMATO, quantity: 2 }], 2);
    inventory.depositStack(
      "seed-not-arrived",
      "procurement.not-arrived",
      [{ itemId: EGG, quantity: 20 }, { itemId: TOMATO, quantity: 20 }],
      3,
    );

    expect(orders.checkIngredientAvailability([
      { id: "line-main", recipeId: "recipe.tomato-eggs", quantity: 1 },
    ])).toMatchObject({
      orderable: false,
      reason: "ingredients-unavailable",
      missing: [
        { itemId: EGG, quantity: 1 },
        { itemId: TOMATO, quantity: 1 },
      ],
    });

    const beforeInventory = inventory.exportState();
    const rejected = createPending(orders, "missing");
    expect(rejected).toMatchObject({ accepted: false, code: "INGREDIENTS_UNAVAILABLE" });
    expect(orders.exportState().pendingOrders).toEqual([]);
    expect(orders.exportState().processedOperationIds).not.toContain("create-missing");
    expect(inventory.exportState()).toEqual(beforeInventory);
    expect(inventory.hasProcessedOperation("create-missing:inventory")).toBe(false);
  });

  it("rechecks current availability so competing tables cannot oversell the same units", () => {
    const { inventory, orders } = createSubject();
    inventory.depositStack("seed-airship", "storage.airship", [
      { itemId: EGG, quantity: 2 },
      { itemId: TOMATO, quantity: 3 },
    ], 1);

    const firstPreview = orders.checkIngredientAvailability([
      { id: "line-first", recipeId: "recipe.tomato-eggs", quantity: 1 },
    ]);
    const secondPreview = orders.checkIngredientAvailability([
      { id: "line-second", recipeId: "recipe.tomato-eggs", quantity: 1 },
    ]);
    expect(firstPreview.orderable).toBe(true);
    expect(secondPreview.orderable).toBe(true);

    expect(createPending(orders, "first").accepted).toBe(true);
    const second = createPending(orders, "second");
    expect(second).toMatchObject({ accepted: false, code: "INGREDIENTS_UNAVAILABLE" });
    expect(inventory.getSnapshot().reservations.map((entry) => entry.id)).toEqual(["reservation-first"]);
    expect(inventory.getLocationSnapshot("storage.airship")?.stacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: EGG, quantity: 2, reservedQuantity: 2, availableQuantity: 0 }),
      expect.objectContaining({ itemId: TOMATO, quantity: 3, reservedQuantity: 3, availableQuantity: 0 }),
    ]));
    expect(orders.exportState().pendingOrders.map((entry) => entry.id)).toEqual(["pending-first"]);
  });

  it("aggregates every recipe line before creating one all-or-nothing table reservation", () => {
    const { inventory, orders } = createSubject();
    inventory.depositStack("seed", "storage.ground", [
      { itemId: EGG, quantity: 4 },
      { itemId: TOMATO, quantity: 8 },
    ], 1);

    const lines = [
      { id: "line-eggs", recipeId: "recipe.tomato-eggs", quantity: 2, dinerCharacterIds: [dinerId, dinerId] },
      { id: "line-soup", recipeId: "recipe.tomato-soup", quantity: 1, dinerCharacterIds: [dinerId] },
    ] as const;
    expect(orders.checkIngredientAvailability(lines).requirements).toEqual([
      { itemId: EGG, quantity: 4 },
      { itemId: TOMATO, quantity: 8 },
    ]);
    const created = orders.createPendingOrder({
      operationId: "create-combined",
      pendingOrderId: "pending-combined",
      tableId: "table-combined",
      customerGroupId: "group-combined",
      lines,
      ingredientReservationId: "reservation-combined",
      createdAtUtcMs: 10,
    });
    expect(created.accepted).toBe(true);
    expect(inventory.getReservation("reservation-combined")?.stackAllocations).toEqual([
      { locationId: "storage.ground", itemId: EGG, quantity: 4 },
      { locationId: "storage.ground", itemId: TOMATO, quantity: 8 },
    ]);
    expect(inventory.getSnapshot().reservations).toHaveLength(1);
  });
  it("rolls Order back when Inventory rejects after the transaction has started", () => {
    const { inventory, orders } = createSubject();
    inventory.depositStack("seed", "storage.ground", [
      { itemId: EGG, quantity: 2 },
      { itemId: TOMATO, quantity: 4 },
    ], 1);
    expect(inventory.createReservation("seed-reservation", {
      reservationId: "reservation-conflict",
      ownerType: "test",
      ownerId: "existing-owner",
      stacks: [{ locationId: "storage.ground", itemId: TOMATO, quantity: 1 }],
      createdAtUtcMs: 2,
    }).accepted).toBe(true);
    const beforeInventory = inventory.exportState();

    const rejected = orders.createPendingOrder({
      operationId: "create-conflict",
      pendingOrderId: "pending-conflict",
      tableId: "table-conflict",
      customerGroupId: "group-conflict",
      lines: [{ id: "line-conflict", recipeId: "recipe.tomato-eggs", quantity: 1, dinerCharacterIds: [dinerId] }],
      ingredientReservationId: "reservation-conflict",
      createdAtUtcMs: 3,
    });
    expect(rejected).toMatchObject({ accepted: false, code: "INVENTORY_REJECTED" });
    expect(orders.exportState().pendingOrders).toEqual([]);
    expect(orders.exportState().processedOperationIds).not.toContain("create-conflict");
    expect(inventory.exportState()).toEqual(beforeInventory);
    expect(inventory.hasProcessedOperation("create-conflict:inventory")).toBe(false);
  });
});
