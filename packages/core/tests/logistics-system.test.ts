import { describe, expect, it } from "vitest";
import { InventorySystem } from "../src/inventory-system";
import { LogisticsSystem } from "../src/logistics-system";

const DISH = "dish.hearth_flatbread";

function createInventory(
  kitchenQuantity: number,
  restaurantQuantity = 0,
  restaurantCapacity = 18,
): InventorySystem {
  const initialContents: Record<
    string,
    readonly { itemId: string; quantity: number }[]
  > = {};
  if (kitchenQuantity > 0) {
    initialContents["kitchen.output"] = [
      { itemId: DISH, quantity: kitchenQuantity },
    ];
  }
  if (restaurantQuantity > 0) {
    initialContents["restaurant.storage"] = [
      { itemId: DISH, quantity: restaurantQuantity },
    ];
  }

  return new InventorySystem(
    [
      {
        id: "kitchen.output",
        capacity: 12,
        acceptedItemIds: [DISH],
      },
      {
        id: "cable.cargo",
        capacity: 6,
        acceptedItemIds: [DISH],
      },
      {
        id: "restaurant.storage",
        capacity: restaurantCapacity,
        acceptedItemIds: [DISH],
      },
    ],
    initialContents,
  );
}

function createLogistics(inventory: InventorySystem): LogisticsSystem {
  return new LogisticsSystem({
    inventory,
    kitchenOutputContainerId: "kitchen.output",
    cargoContainerId: "cable.cargo",
    restaurantContainerId: "restaurant.storage",
    cargoCapacity: 6,
    dispatchThreshold: 2,
    maximumWaitMs: 60_000,
    outboundDurationMs: 20_000,
    returnDurationMs: 20_000,
  });
}

describe("LogisticsSystem", () => {
  it("dispatches two dishes immediately and completes a round trip", () => {
    const inventory = createInventory(2);
    const logistics = createLogistics(inventory);

    expect(logistics.advanceTo(1_000)).toMatchObject({
      snapshot: {
        phase: "outbound",
        cargoQuantity: 2,
        kitchenWaitingQuantity: 0,
        arriveAtUtcMs: 21_000,
      },
      events: [
        {
          type: "shipment.departed",
          items: [{ itemId: DISH, quantity: 2 }],
        },
      ],
    });
    expect(logistics.advanceTo(21_000)).toMatchObject({
      snapshot: {
        phase: "returning",
        cargoQuantity: 0,
        totalDeliveredQuantity: 2,
        returnAtUtcMs: 41_000,
      },
      events: [
        {
          type: "shipment.arrived",
          items: [{ itemId: DISH, quantity: 2 }],
        },
      ],
    });
    expect(logistics.advanceTo(41_000)).toMatchObject({
      snapshot: {
        phase: "idle",
        shipmentId: null,
      },
      events: [{ type: "shipment.returned" }],
    });
    expect(
      inventory.getContainerSnapshot("restaurant.storage")
        .totalQuantity,
    ).toBe(2);
  });

  it("waits up to sixty seconds when only one dish is ready", () => {
    const logistics = createLogistics(createInventory(1));

    expect(logistics.advanceTo(5_000).snapshot).toMatchObject({
      phase: "idle",
      kitchenWaitingSinceUtcMs: 5_000,
      nextTransitionUtcMs: 65_000,
    });
    expect(logistics.advanceTo(64_999).snapshot.phase).toBe("idle");
    expect(logistics.advanceTo(65_000).snapshot).toMatchObject({
      phase: "outbound",
      cargoQuantity: 1,
    });
  });

  it("loads at most six dishes and leaves overflow in the kitchen", () => {
    const logistics = createLogistics(createInventory(8));

    expect(logistics.advanceTo(0).snapshot).toMatchObject({
      phase: "outbound",
      cargoQuantity: 6,
      kitchenWaitingQuantity: 2,
      kitchenWaitingSinceUtcMs: 0,
    });
  });

  it("partially unloads, waits for capacity and resumes later", () => {
    const inventory = createInventory(4, 2, 3);
    const logistics = createLogistics(inventory);
    logistics.advanceTo(0);

    expect(logistics.advanceTo(20_000)).toMatchObject({
      snapshot: {
        phase: "waiting-unload",
        cargoQuantity: 3,
        totalDeliveredQuantity: 1,
      },
      events: [
        { type: "shipment.arrived" },
        {
          type: "shipment.blocked",
          reason: "restaurant-capacity",
        },
      ],
    });
    expect(logistics.advanceTo(21_000).events).toHaveLength(0);

    inventory.withdraw("restaurant-sales", "restaurant.storage", [
      { itemId: DISH, quantity: 3 },
    ]);
    expect(logistics.advanceTo(22_000)).toMatchObject({
      snapshot: {
        phase: "returning",
        cargoQuantity: 0,
        totalDeliveredQuantity: 4,
      },
      events: [
        {
          type: "shipment.arrived",
          items: [{ itemId: DISH, quantity: 3 }],
        },
      ],
    });
  });
});
