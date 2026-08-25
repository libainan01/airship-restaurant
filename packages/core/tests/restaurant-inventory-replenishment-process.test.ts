import { describe, expect, it } from "vitest";
import {
  RestaurantApplicationRuntime,
  RestaurantInventoryReplenishmentProcess,
  RestaurantMealLogisticsProcess,
} from "../src";
import {
  R6_DEMO_IDS,
  createR6DemoFixture,
} from "../src/demo/r6-demo-fixture";

function requireAccepted(result: { readonly accepted: boolean; readonly message?: string }): void {
  if (!result.accepted) throw new Error(result.message ?? "Operation rejected.");
}

describe("RestaurantInventoryReplenishmentProcess", () => {
  it("creates only the deficit and lets the four freight elevators deliver it", () => {
    const fixture = createR6DemoFixture();
    requireAccepted(fixture.inventory.depositStack(
      "replenishment-test:ground-stock",
      R6_DEMO_IDS.locations.groundExchange,
      [{ itemId: R6_DEMO_IDS.items.egg, quantity: 3 }],
      0,
    ));
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      processes: [
        new RestaurantInventoryReplenishmentProcess({
          inventory: fixture.inventory,
          logistics: fixture.logistics,
          sourceLocationId: R6_DEMO_IDS.locations.groundExchange,
          targetLocationId: R6_DEMO_IDS.locations.airshipExchange,
          targets: [{ itemId: R6_DEMO_IDS.items.egg, targetQuantity: 2 }],
        }),
        new RestaurantMealLogisticsProcess({
          products: fixture.kitchenProducts,
          logistics: fixture.logistics,
          freightElevators: fixture.freightElevators,
          groundMealLocationId: R6_DEMO_IDS.locations.groundExchange,
        }),
      ],
    });

    let nowUtcMs = 0;
    for (let guard = 0; guard < 30; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      const quantity = fixture.inventory
        .getLocationSnapshot(R6_DEMO_IDS.locations.airshipExchange)?.stacks
        .find((entry) => entry.itemId === R6_DEMO_IDS.items.egg)?.quantity ?? 0;
      if (quantity === 2) break;
      nowUtcMs = Math.max(
        nowUtcMs + 1,
        runtime.getSnapshot().nextTransitionUtcMs ?? nowUtcMs + 1,
      );
    }

    expect(fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.airshipExchange)?.stacks
      .find((entry) => entry.itemId === R6_DEMO_IDS.items.egg)?.quantity).toBe(2);
    expect(fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)?.stacks
      .find((entry) => entry.itemId === R6_DEMO_IDS.items.egg)?.quantity).toBe(1);
    expect(fixture.logistics.exportState().groups).toEqual([
      expect.objectContaining({
        kind: "replenishment",
        requestedQuantity: 2,
        deliveredQuantity: 2,
        status: "completed",
      }),
    ]);
  });
});