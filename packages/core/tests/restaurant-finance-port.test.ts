import { describe, expect, it } from "vitest";
import { FinanceModule, FinanceRestaurantRevenuePort } from "../src";
import { InventorySystem } from "../src/inventory-system";
import { RestaurantSystem } from "../src/restaurant-system";

const RECIPE = "recipe.hearth_flatbread";
const DISH = "dish.hearth_flatbread";

describe("FinanceRestaurantRevenuePort", () => {
  it("records a fulfilled restaurant order directly in the authoritative ledger", () => {
    const inventory = new InventorySystem(
      [{
        id: "restaurant.storage",
        capacity: 18,
        acceptedItemIds: [DISH],
      }],
      { "restaurant.storage": [{ itemId: DISH, quantity: 1 }] },
    );
    const finance = new FinanceModule(10);
    const restaurant = new RestaurantSystem({
      inventory,
      restaurantContainerId: "restaurant.storage",
      menuItems: [{
        recipeId: RECIPE,
        dishItemId: DISH,
        unitPriceCopper: 4,
      }],
      random: { nextFloat: () => 0 },
      minimumArrivalIntervalMs: 20_000,
      maximumArrivalIntervalMs: 40_000,
      maximumWaitMs: 90_000,
      finance: new FinanceRestaurantRevenuePort(finance, () => 2_000),
    });

    restaurant.selectMenuItem("select-menu", RECIPE, 0);
    restaurant.advanceTo(20_000);
    restaurant.advanceTo(39_500);

    expect(finance.getSnapshot(39_500)).toMatchObject({
      balanceCopper: 15,
      currentDay: {
        totalIncomeCopper: 5,
        incomeByCategory: { "dish-sales": 4, "focus-bonus": 1 },
      },
      ledger: [{
        id: "ledger:restaurant-sale:customer-1",
        amountCopper: 4,
        category: "dish-sales",
        sourceType: "order",
        sourceId: "customer-1",
      }, {
        id: "ledger:restaurant-sale:customer-1:focus-bonus",
        amountCopper: 1,
        category: "focus-bonus",
        sourceType: "order",
        sourceId: "customer-1",
      }],
      settlementBatches: [{
        id: "batch:restaurant-sale:customer-1",
        settlementKey: "restaurant-sale:customer-1",
      }],
    });
    expect(restaurant.getSnapshot()).toMatchObject({
      copperBalance: 15,
      totalCopperSpent: 0,
      totalSoldQuantity: 1,
    });
  });
});