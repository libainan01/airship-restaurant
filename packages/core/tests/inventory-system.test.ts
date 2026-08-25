import { describe, expect, it } from "vitest";
import { InventorySystem } from "../src/inventory-system";

const INGREDIENT = "ingredient.cloud_wheat";
const MEAL = "meal.hearth_flatbread";

function createInventory(): InventorySystem {
  return new InventorySystem(
    [
      {
        id: "kitchen.pantry",
        capacity: 10,
        acceptedItemIds: [INGREDIENT],
        itemCapacities: { [INGREDIENT]: 8 },
      },
      {
        id: "kitchen.pass",
        capacity: 4,
        acceptedItemIds: [MEAL],
      },
      {
        id: "cable.cargo",
        capacity: 2,
        acceptedItemIds: [MEAL],
      },
      {
        id: "restaurant.storage",
        capacity: 3,
        acceptedItemIds: [MEAL],
      },
    ],
    {
      "kitchen.pantry": [{ itemId: INGREDIENT, quantity: 6 }],
      "kitchen.pass": [{ itemId: MEAL, quantity: 2 }],
    },
  );
}

function getEntry(
  inventory: InventorySystem,
  containerId: string,
  itemId: string,
) {
  return inventory
    .getContainerSnapshot(containerId)
    .entries.find((entry) => entry.itemId === itemId);
}

describe("InventorySystem configuration", () => {
  it("creates immutable-style snapshots from initial contents", () => {
    const inventory = createInventory();
    expect(
      inventory.getContainerSnapshot("kitchen.pantry"),
    ).toMatchObject({
      id: "kitchen.pantry",
      capacity: 10,
      totalQuantity: 6,
      availableCapacity: 4,
      entries: [
        {
          itemId: INGREDIENT,
          quantity: 6,
          reservedQuantity: 0,
          availableQuantity: 6,
        },
      ],
    });
  });

  it("rejects invalid initial content before exposing the system", () => {
    expect(
      () =>
        new InventorySystem(
          [
            {
              id: "small",
              capacity: 1,
              acceptedItemIds: [INGREDIENT],
            },
          ],
          {
            small: [{ itemId: INGREDIENT, quantity: 2 }],
          },
        ),
    ).toThrow(/capacity exceeded/i);
  });
});

describe("InventorySystem atomic mutations", () => {
  it("deposits items and enforces per-item capacity", () => {
    const inventory = createInventory();
    expect(
      inventory.deposit("supply-1", "kitchen.pantry", [
        { itemId: INGREDIENT, quantity: 2 },
      ]),
    ).toMatchObject({ accepted: true });
    expect(
      getEntry(inventory, "kitchen.pantry", INGREDIENT)?.quantity,
    ).toBe(8);

    expect(
      inventory.deposit("supply-2", "kitchen.pantry", [
        { itemId: INGREDIENT, quantity: 1 },
      ]),
    ).toMatchObject({
      accepted: false,
      code: "TARGET_CAPACITY_EXCEEDED",
    });
    expect(
      getEntry(inventory, "kitchen.pantry", INGREDIENT)?.quantity,
    ).toBe(8);
  });

  it("rolls back the entire transfer when the target cannot fit it", () => {
    const inventory = createInventory();
    inventory.deposit("add-meals", "kitchen.pass", [
      { itemId: MEAL, quantity: 2 },
    ]);

    const result = inventory.transfer(
      "shipment-too-large",
      "kitchen.pass",
      "cable.cargo",
      [{ itemId: MEAL, quantity: 3 }],
    );

    expect(result).toMatchObject({
      accepted: false,
      code: "TARGET_CAPACITY_EXCEEDED",
    });
    expect(getEntry(inventory, "kitchen.pass", MEAL)?.quantity).toBe(4);
    expect(
      inventory.getContainerSnapshot("cable.cargo").totalQuantity,
    ).toBe(0);
  });

  it("moves an accepted transfer exactly once", () => {
    const inventory = createInventory();
    const first = inventory.transfer(
      "shipment-1",
      "kitchen.pass",
      "cable.cargo",
      [{ itemId: MEAL, quantity: 2 }],
    );
    const duplicate = inventory.transfer(
      "shipment-1",
      "kitchen.pass",
      "cable.cargo",
      [{ itemId: MEAL, quantity: 2 }],
    );

    expect(first.accepted).toBe(true);
    expect(duplicate).toMatchObject({
      accepted: false,
      code: "DUPLICATE_OPERATION",
    });
    expect(
      inventory.getContainerSnapshot("kitchen.pass").totalQuantity,
    ).toBe(0);
    expect(getEntry(inventory, "cable.cargo", MEAL)?.quantity).toBe(2);
  });

  it("rejects items a container does not accept", () => {
    const inventory = createInventory();
    expect(
      inventory.deposit("wrong-item", "cable.cargo", [
        { itemId: INGREDIENT, quantity: 1 },
      ]),
    ).toMatchObject({
      accepted: false,
      code: "ITEM_NOT_ACCEPTED",
    });
  });
});

describe("InventorySystem reservations", () => {
  it("reserves ingredients without removing physical quantity", () => {
    const inventory = createInventory();
    expect(
      inventory.createReservation(
        "reserve-op",
        "cook-job-1",
        "kitchen.pantry",
        [{ itemId: INGREDIENT, quantity: 4 }],
      ),
    ).toMatchObject({ accepted: true });

    expect(getEntry(inventory, "kitchen.pantry", INGREDIENT)).toEqual({
      itemId: INGREDIENT,
      quantity: 6,
      reservedQuantity: 4,
      availableQuantity: 2,
    });
    expect(
      inventory.withdraw("blocked-withdraw", "kitchen.pantry", [
        { itemId: INGREDIENT, quantity: 3 },
      ]),
    ).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_AVAILABLE",
    });
  });

  it("consumes or releases a reservation atomically", () => {
    const inventory = createInventory();
    inventory.createReservation(
      "reserve-1",
      "cook-job-1",
      "kitchen.pantry",
      [{ itemId: INGREDIENT, quantity: 2 }],
    );
    expect(
      inventory.consumeReservation("consume-1", "cook-job-1"),
    ).toMatchObject({ accepted: true });
    expect(getEntry(inventory, "kitchen.pantry", INGREDIENT)).toEqual({
      itemId: INGREDIENT,
      quantity: 4,
      reservedQuantity: 0,
      availableQuantity: 4,
    });

    inventory.createReservation(
      "reserve-2",
      "cook-job-2",
      "kitchen.pantry",
      [{ itemId: INGREDIENT, quantity: 2 }],
    );
    expect(
      inventory.releaseReservation("release-2", "cook-job-2"),
    ).toMatchObject({ accepted: true });
    expect(getEntry(inventory, "kitchen.pantry", INGREDIENT)).toEqual({
      itemId: INGREDIENT,
      quantity: 4,
      reservedQuantity: 0,
      availableQuantity: 4,
    });
  });
});
