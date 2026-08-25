import { describe, expect, it } from "vitest";
import { SeededRandom } from "../src";
import { InventorySystem } from "../src/inventory-system";
import { RestaurantSystem } from "../src/restaurant-system";

const RECIPE = "recipe.hearth_flatbread";
const DISH = "dish.hearth_flatbread";

function createInventory(quantity: number): InventorySystem {
  return new InventorySystem(
    [
      {
        id: "restaurant.storage",
        capacity: 18,
        acceptedItemIds: [DISH],
      },
    ],
    quantity === 0
      ? {}
      : {
          "restaurant.storage": [
            { itemId: DISH, quantity },
          ],
        },
  );
}

function createRestaurant(
  inventory: InventorySystem,
  seatCapacity = 3,
  diningDurationMs = 12_000,
): RestaurantSystem {
  return new RestaurantSystem({
    inventory,
    restaurantContainerId: "restaurant.storage",
    menuItems: [
      {
        recipeId: RECIPE,
        dishItemId: DISH,
        unitPriceCopper: 4,
      },
    ],
    random: { nextFloat: () => 0 },
    minimumArrivalIntervalMs: 20_000,
    maximumArrivalIntervalMs: 40_000,
    maximumWaitMs: 90_000,
    seatCapacity,
    diningDurationMs,
  });
}

describe("SeededRandom", () => {
  it("restores the exact deterministic sequence from saved state", () => {
    const first = new SeededRandom(42);
    first.nextFloat();
    const savedState = first.getState();
    const expectedNext = first.nextFloat();

    const restored = new SeededRandom(savedState);
    expect(restored.nextFloat()).toBe(expectedNext);
  });
});

const ORDER_DECISION_MS = 8_000;
const OTTO_APPROACH_MS = 3_200;
const ORDER_CONFIRMATION_MS = 1_800;
const KITCHEN_NOTIFICATION_MS = 1_500;
const MINIMUM_PREPARATION_MS = 5_000;

function lifecycleTimes(arrivedAtUtcMs: number) {
  const requestedAtUtcMs = arrivedAtUtcMs + ORDER_DECISION_MS;
  const confirmationStartedAtUtcMs = requestedAtUtcMs + OTTO_APPROACH_MS;
  const confirmedAtUtcMs = confirmationStartedAtUtcMs + ORDER_CONFIRMATION_MS;
  const kitchenReceivedAtUtcMs = confirmedAtUtcMs + KITCHEN_NOTIFICATION_MS;
  const fulfillmentAtUtcMs = kitchenReceivedAtUtcMs + MINIMUM_PREPARATION_MS;
  return {
    requestedAtUtcMs,
    confirmationStartedAtUtcMs,
    confirmedAtUtcMs,
    kitchenReceivedAtUtcMs,
    fulfillmentAtUtcMs,
  };
}

describe("RestaurantSystem", () => {
  it("keeps a seated customer idle before Otto confirms and notifies the kitchen", () => {
    const inventory = createInventory(2);
    const restaurant = createRestaurant(inventory);
    restaurant.selectMenuItem("select-menu", RECIPE, 1_000);
    const arrivedAtUtcMs = 21_000;
    const times = lifecycleTimes(arrivedAtUtcMs);

    expect(restaurant.advanceTo(arrivedAtUtcMs)).toMatchObject({
      snapshot: {
        activeCustomer: {
          phase: "seated-idle",
          phaseEndsAtUtcMs: times.requestedAtUtcMs,
        },
        totalSoldQuantity: 0,
      },
      events: [{ type: "customer.arrived" }],
    });
    expect(restaurant.advanceTo(times.requestedAtUtcMs)).toMatchObject({
      snapshot: { activeCustomer: { phase: "awaiting-order-confirmation" } },
      events: [{ type: "order.requested" }],
    });
    expect(restaurant.advanceTo(times.confirmationStartedAtUtcMs)).toMatchObject({
      snapshot: { activeCustomer: { phase: "confirming-order" } },
      events: [{ type: "order.confirmation-started" }],
    });
    expect(restaurant.advanceTo(times.confirmedAtUtcMs)).toMatchObject({
      snapshot: { activeCustomer: { phase: "notifying-kitchen" } },
      events: [
        { type: "order.confirmed" },
        {
          type: "kitchen.notification-sent",
          channelId: "fixed-delay-placeholder",
          expectedReceiptAtUtcMs: times.kitchenReceivedAtUtcMs,
        },
      ],
    });
    expect(restaurant.advanceTo(times.kitchenReceivedAtUtcMs)).toMatchObject({
      snapshot: { activeCustomer: { phase: "waiting-meal" } },
      events: [
        {
          type: "kitchen.order-received",
          channelId: "fixed-delay-placeholder",
        },
      ],
    });
    expect(restaurant.advanceTo(times.fulfillmentAtUtcMs)).toMatchObject({
      snapshot: {
        activeCustomer: null,
        diningCustomers: [
          {
            id: "customer-1",
            diningStartedAtUtcMs: times.fulfillmentAtUtcMs,
            departAtUtcMs: times.fulfillmentAtUtcMs + 12_000,
          },
        ],
        seatCapacity: 3,
        totalSoldQuantity: 1,
        copperBalance: 4,
        nextCustomerAtUtcMs: times.fulfillmentAtUtcMs + 20_000,
        soldByDish: [{ dishItemId: DISH, quantity: 1 }],
        recentSales: [
          {
            recipeId: RECIPE,
            dishItemId: DISH,
            quantity: 1,
            copperEarned: 4,
            soldAtUtcMs: times.fulfillmentAtUtcMs,
          },
        ],
      },
      events: [
        { type: "order.fulfilled" },
        { type: "currency.changed", deltaCopper: 4, copperBalance: 4 },
      ],
    });
    expect(inventory.getContainerSnapshot("restaurant.storage").totalQuantity).toBe(1);
  });

  it("holds arrivals until the core-owned seat becomes available", () => {
    const inventory = createInventory(2);
    const restaurant = createRestaurant(inventory, 1, 50_000);
    restaurant.selectMenuItem("select-capacity-menu", RECIPE, 0);
    const firstArrivalAtUtcMs = 20_000;
    const firstTimes = lifecycleTimes(firstArrivalAtUtcMs);
    restaurant.advanceTo(firstArrivalAtUtcMs);
    const fulfilled = restaurant.advanceTo(firstTimes.fulfillmentAtUtcMs);
    const diningCustomer = fulfilled.snapshot.diningCustomers[0];
    expect(diningCustomer).toMatchObject({
      id: "customer-1",
      departAtUtcMs: firstTimes.fulfillmentAtUtcMs + 50_000,
    });

    const originallyScheduledArrival = firstTimes.fulfillmentAtUtcMs + 20_000;
    const held = restaurant.advanceTo(originallyScheduledArrival);
    expect(held).toMatchObject({
      snapshot: {
        activeCustomer: null,
        nextCustomerAtUtcMs: diningCustomer?.departAtUtcMs,
      },
      events: [],
    });

    const admitted = restaurant.advanceTo(diningCustomer?.departAtUtcMs ?? 0);
    expect(admitted).toMatchObject({
      snapshot: {
        activeCustomer: { id: "customer-2", phase: "seated-idle" },
        diningCustomers: [],
      },
      events: [
        { type: "customer.dining-completed" },
        { type: "customer.arrived" },
      ],
    });
  });

  it("waits for stock after the kitchen notification and sells when a shipment arrives", () => {
    const inventory = createInventory(0);
    const restaurant = createRestaurant(inventory);
    restaurant.selectMenuItem("select-menu", RECIPE, 0);
    const times = lifecycleTimes(20_000);
    restaurant.advanceTo(20_000);
    restaurant.advanceTo(times.fulfillmentAtUtcMs);

    expect(restaurant.getSnapshot().activeCustomer).toMatchObject({
      phase: "waiting-meal",
      phaseEndsAtUtcMs: null,
    });
    expect(restaurant.exportState().activeCustomer?.fulfillmentAttempt).toBe(1);

    inventory.deposit("shipment", "restaurant.storage", [
      { itemId: DISH, quantity: 1 },
    ]);
    expect(restaurant.advanceTo(times.fulfillmentAtUtcMs + 500)).toMatchObject({
      snapshot: {
        activeCustomer: null,
        diningCustomers: [
          {
            id: "customer-1",
            diningStartedAtUtcMs: times.fulfillmentAtUtcMs + 500,
            departAtUtcMs: times.fulfillmentAtUtcMs + 12_500,
          },
        ],
        seatCapacity: 3,
        totalSoldQuantity: 1,
        copperBalance: 4,
      },
      events: [
        { type: "order.fulfilled" },
        { type: "currency.changed" },
      ],
    });
  });

  it("lets an unserved customer leave without a financial penalty", () => {
    const restaurant = createRestaurant(createInventory(0));
    restaurant.selectMenuItem("select-menu", RECIPE, 0);
    const times = lifecycleTimes(20_000);
    restaurant.advanceTo(20_000);
    restaurant.advanceTo(times.fulfillmentAtUtcMs);

    expect(restaurant.advanceTo(110_000)).toMatchObject({
      snapshot: {
        activeCustomer: null,
        totalSoldQuantity: 0,
        totalCustomersLeft: 1,
        copperBalance: 0,
        nextCustomerAtUtcMs: 130_000,
      },
      events: [
        {
          type: "customer.left",
          reason: "out-of-stock",
          leftAtUtcMs: 110_000,
        },
      ],
    });
  });

  it("sells legacy stock only after its order passes through confirmation", () => {
    const legacyRecipe = "recipe.legacy";
    const legacyDish = "dish.legacy";
    const inventory = new InventorySystem(
      [
        {
          id: "restaurant.storage",
          capacity: 18,
          acceptedItemIds: [DISH, legacyDish],
        },
      ],
      {
        "restaurant.storage": [{ itemId: legacyDish, quantity: 1 }],
      },
    );
    const restaurant = new RestaurantSystem({
      inventory,
      restaurantContainerId: "restaurant.storage",
      menuItems: [
        { recipeId: RECIPE, dishItemId: DISH, unitPriceCopper: 4 },
        { recipeId: legacyRecipe, dishItemId: legacyDish, unitPriceCopper: 9 },
      ],
      random: { nextFloat: () => 0 },
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
    });
    restaurant.selectMenuItem("select-legacy", legacyRecipe, 0);
    restaurant.selectMenuItem("select-current", RECIPE, 1_000);
    const times = lifecycleTimes(20_000);

    expect(restaurant.advanceTo(20_000)).toMatchObject({
      snapshot: {
        selectedRecipeId: RECIPE,
        activeCustomer: { phase: "seated-idle", recipeId: legacyRecipe },
        totalSoldQuantity: 0,
      },
      events: [{ type: "customer.arrived", customer: { recipeId: legacyRecipe } }],
    });
    const fulfilled = restaurant.advanceTo(times.fulfillmentAtUtcMs);
    expect(fulfilled.snapshot).toMatchObject({
      selectedRecipeId: RECIPE,
      totalSoldQuantity: 1,
      copperBalance: 9,
      soldByDish: [{ dishItemId: legacyDish, quantity: 1 }],
    });
    expect(fulfilled.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "order.fulfilled",
        sale: expect.objectContaining({ dishItemId: legacyDish }),
      }),
      expect.objectContaining({ type: "currency.changed", deltaCopper: 9 }),
    ]));
  });

  it("allows the kitchen notification channel to be replaced", () => {
    const restaurant = new RestaurantSystem({
      inventory: createInventory(1),
      restaurantContainerId: "restaurant.storage",
      menuItems: [{ recipeId: RECIPE, dishItemId: DISH, unitPriceCopper: 4 }],
      random: { nextFloat: () => 0 },
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
      kitchenNotificationChannel: {
        createNotification: (_order, sentAtUtcMs) => ({
          channelId: "magic-relay-test",
          sentAtUtcMs,
          receivedAtUtcMs: sentAtUtcMs + 250,
        }),
      },
    });
    restaurant.selectMenuItem("select-menu", RECIPE, 0);
    const arrivedAtUtcMs = 20_000;
    const confirmedAtUtcMs =
      arrivedAtUtcMs + ORDER_DECISION_MS + OTTO_APPROACH_MS + ORDER_CONFIRMATION_MS;
    restaurant.advanceTo(arrivedAtUtcMs);

    const confirmed = restaurant.advanceTo(confirmedAtUtcMs);
    expect(confirmed.snapshot.activeCustomer).toMatchObject({
      phase: "notifying-kitchen",
      phaseEndsAtUtcMs: confirmedAtUtcMs + 250,
    });
    expect(confirmed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "kitchen.notification-sent",
        channelId: "magic-relay-test",
        expectedReceiptAtUtcMs: confirmedAtUtcMs + 250,
      }),
    ]));
  });
  it("restores legacy active customers as already waiting for their meal", () => {
    const inventory = createInventory(1);
    const original = createRestaurant(inventory);
    original.selectMenuItem("select-menu", RECIPE, 0);
    original.advanceTo(20_000);
    const state = original.exportState();
    const legacyState = {
      ...state,
      activeCustomer: state.activeCustomer === null
        ? null
        : {
            id: state.activeCustomer.id,
            recipeId: state.activeCustomer.recipeId,
            dishItemId: state.activeCustomer.dishItemId,
            arrivedAtUtcMs: state.activeCustomer.arrivedAtUtcMs,
            leaveAtUtcMs: state.activeCustomer.leaveAtUtcMs,
            fulfillmentAttempt: state.activeCustomer.fulfillmentAttempt,
          },
    };
    const restored = new RestaurantSystem({
      inventory,
      restaurantContainerId: "restaurant.storage",
      menuItems: [{ recipeId: RECIPE, dishItemId: DISH, unitPriceCopper: 4 }],
      random: { nextFloat: () => 0 },
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
      initialState: legacyState,
    });

    expect(restored.getSnapshot().activeCustomer).toMatchObject({
      phase: "waiting-meal",
      phaseEndsAtUtcMs: null,
    });
  });

  it("rejects duplicate menu commands without rescheduling customers", () => {
    const restaurant = createRestaurant(createInventory(0));
    const first = restaurant.selectMenuItem("select-menu", RECIPE, 1_000);
    const duplicate = restaurant.selectMenuItem("select-menu", RECIPE, 9_000);

    expect(first).toMatchObject({
      accepted: true,
      snapshot: { nextCustomerAtUtcMs: 21_000 },
    });
    expect(duplicate).toMatchObject({
      accepted: false,
      code: "DUPLICATE_OPERATION",
      snapshot: { nextCustomerAtUtcMs: 21_000 },
    });
  });
  it("shortens newly scheduled customer intervals while focus traffic is active", () => {
    const restaurant = createRestaurant(createInventory(1));

    expect(restaurant.setCustomerArrivalIntervalRateBasisPoints(7_500)).toBe(true);
    expect(restaurant.setCustomerArrivalIntervalRateBasisPoints(7_500)).toBe(false);
    expect(restaurant.selectMenuItem("select-focus-menu", RECIPE, 1_000).accepted).toBe(true);
    expect(restaurant.getSnapshot().nextCustomerAtUtcMs).toBe(16_000);
    expect(() => restaurant.setCustomerArrivalIntervalRateBasisPoints(0)).toThrow(RangeError);
  });

});