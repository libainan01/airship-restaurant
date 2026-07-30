import { describe, expect, it } from "vitest";
import {
  InventorySystem,
  RestaurantSystem,
  SeededRandom,
} from "../src";

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

describe("RestaurantSystem", () => {
  it("sells one dish, records the quantity and adds copper", () => {
    const inventory = createInventory(2);
    const restaurant = createRestaurant(inventory);
    expect(
      restaurant.selectMenuItem("select-menu", RECIPE, 1_000),
    ).toMatchObject({
      accepted: true,
      snapshot: { nextCustomerAtUtcMs: 21_000 },
    });

    expect(restaurant.advanceTo(20_999).events).toHaveLength(0);
    expect(restaurant.advanceTo(21_000)).toMatchObject({
      snapshot: {
        activeCustomer: null,
        totalSoldQuantity: 1,
        copperBalance: 4,
        nextCustomerAtUtcMs: 41_000,
        soldByDish: [{ dishItemId: DISH, quantity: 1 }],
        recentSales: [
          {
            recipeId: RECIPE,
            dishItemId: DISH,
            quantity: 1,
            copperEarned: 4,
            soldAtUtcMs: 21_000,
          },
        ],
      },
      events: [
        { type: "customer.arrived" },
        { type: "order.fulfilled" },
        {
          type: "currency.changed",
          deltaCopper: 4,
          copperBalance: 4,
        },
      ],
    });
    expect(
      inventory.getContainerSnapshot("restaurant.storage")
        .totalQuantity,
    ).toBe(1);
  });

  it("waits for stock and sells when a shipment arrives", () => {
    const inventory = createInventory(0);
    const restaurant = createRestaurant(inventory);
    restaurant.selectMenuItem("select-menu", RECIPE, 0);
    expect(restaurant.advanceTo(20_000)).toMatchObject({
      snapshot: {
        activeCustomer: {
          arrivedAtUtcMs: 20_000,
          leaveAtUtcMs: 110_000,
        },
        totalSoldQuantity: 0,
      },
      events: [{ type: "customer.arrived" }],
    });

    restaurant.advanceTo(25_000);
    expect(restaurant.exportState().activeCustomer?.fulfillmentAttempt).toBe(1);

    inventory.deposit("shipment", "restaurant.storage", [
      { itemId: DISH, quantity: 1 },
    ]);
    expect(restaurant.advanceTo(30_000)).toMatchObject({
      snapshot: {
        activeCustomer: null,
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
    restaurant.advanceTo(20_000);

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

  it("sells legacy stock before the newly selected menu item", () => {
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
        "restaurant.storage": [
          { itemId: legacyDish, quantity: 1 },
        ],
      },
    );
    const restaurant = new RestaurantSystem({
      inventory,
      restaurantContainerId: "restaurant.storage",
      menuItems: [
        {
          recipeId: RECIPE,
          dishItemId: DISH,
          unitPriceCopper: 4,
        },
        {
          recipeId: legacyRecipe,
          dishItemId: legacyDish,
          unitPriceCopper: 9,
        },
      ],
      random: { nextFloat: () => 0 },
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
    });
    restaurant.selectMenuItem("select-legacy", legacyRecipe, 0);
    restaurant.selectMenuItem("select-current", RECIPE, 1_000);

    expect(restaurant.advanceTo(20_000)).toMatchObject({
      snapshot: {
        selectedRecipeId: RECIPE,
        totalSoldQuantity: 1,
        copperBalance: 9,
        soldByDish: [
          { dishItemId: legacyDish, quantity: 1 },
        ],
      },
      events: [
        {
          type: "customer.arrived",
          customer: { recipeId: legacyRecipe },
        },
        {
          type: "order.fulfilled",
          sale: { dishItemId: legacyDish },
        },
        { type: "currency.changed", deltaCopper: 9 },
      ],
    });
  });

  it("rejects duplicate menu commands without rescheduling customers", () => {
    const restaurant = createRestaurant(createInventory(0));
    const first = restaurant.selectMenuItem(
      "select-menu",
      RECIPE,
      1_000,
    );
    const duplicate = restaurant.selectMenuItem(
      "select-menu",
      RECIPE,
      9_000,
    );

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
});
