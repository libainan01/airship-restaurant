import { describe, expect, it, vi } from "vitest";
import { InventorySystem } from "../src/inventory-system";
import {
  ProcurementSystem,
  type ProcurementRegionConfig,
} from "../src/procurement-system";

const WHEAT = "ingredient.wheat";
const MILK = "ingredient.milk";
const PANTRY = "kitchen.pantry";
const START = 1_000;

const REGIONS: readonly ProcurementRegionConfig[] = [
  {
    id: "region.local",
    name: "本地港",
    deliveryDurationMs: 100,
    freightCostCopper: 1,
    cargoCapacity: 3,
    minimumTransportLevel: 0,
    items: [{ itemId: WHEAT, unitPriceCopper: 2 }],
  },
  {
    id: "region.remote",
    name: "远方港",
    deliveryDurationMs: 200,
    freightCostCopper: 2,
    cargoCapacity: 4,
    minimumTransportLevel: 1,
    items: [{ itemId: MILK, unitPriceCopper: 4 }],
  },
];

function createInventory(capacity = 20): InventorySystem {
  return new InventorySystem([
    {
      id: PANTRY,
      capacity,
      acceptedItemIds: [WHEAT, MILK],
      itemCapacities: { [WHEAT]: capacity, [MILK]: capacity },
    },
  ]);
}

function createSystem(
  inventory = createInventory(),
  initialState?: ConstructorParameters<typeof ProcurementSystem>[0]["initialState"],
): ProcurementSystem {
  return new ProcurementSystem({
    inventory,
    ingredientContainerId: PANTRY,
    ingredientCapacities: new Map([
      [WHEAT, inventory.getContainerSnapshot(PANTRY).capacity],
      [MILK, inventory.getContainerSnapshot(PANTRY).capacity],
    ]),
    regions: REGIONS,
    ...(initialState === undefined ? {} : { initialState }),
  });
}

describe("ProcurementSystem", () => {
  it("validates a joint plan before spending any copper", () => {
    const system = createSystem();
    const spendCopper = vi.fn(() => true);

    const result = system.placeOrder(
      [
        { itemId: WHEAT, quantity: 2 },
        { itemId: MILK, quantity: 1 },
      ],
      START,
      spendCopper,
    );

    expect(result).toMatchObject({
      accepted: false,
      changed: false,
      message: "Ingredient is unavailable: " + MILK,
    });
    expect(spendCopper).not.toHaveBeenCalled();
    expect(system.getSnapshot().orders).toHaveLength(0);
  });

  it("splits cargo by region, runs regions in parallel, and queues within a region", () => {
    const inventory = createInventory();
    const system = createSystem(inventory);
    system.setUnlocks(1, false);
    let copper = 100;

    const result = system.placeOrder(
      [
        { itemId: WHEAT, quantity: 5 },
        { itemId: MILK, quantity: 2 },
      ],
      START,
      (amount) => {
        if (amount > copper) return false;
        copper -= amount;
        return true;
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      totalCostCopper: 22,
    });
    expect(copper).toBe(78);
    expect(system.getSnapshot().orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: "region.local",
          status: "in-transit",
          arriveAtUtcMs: START + 100,
        }),
        expect.objectContaining({
          regionId: "region.local",
          status: "queued",
          arriveAtUtcMs: null,
        }),
        expect.objectContaining({
          regionId: "region.remote",
          status: "in-transit",
          arriveAtUtcMs: START + 200,
        }),
      ]),
    );

    expect(system.advanceTo(START + 100).arrivals).toHaveLength(1);
    expect(system.getSnapshot().orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: "region.local",
          status: "in-transit",
          arriveAtUtcMs: START + 200,
        }),
        expect.objectContaining({
          regionId: "region.remote",
          status: "in-transit",
          arriveAtUtcMs: START + 200,
        }),
      ]),
    );

    expect(system.advanceTo(START + 200).arrivals).toHaveLength(2);
    expect(system.getSnapshot().orders).toHaveLength(0);
    expect(system.getSnapshot().arrivalRevision).toBe(3);
    expect(inventory.getContainerSnapshot(PANTRY)).toMatchObject({
      totalQuantity: 7,
      entries: expect.arrayContaining([
        expect.objectContaining({ itemId: WHEAT, quantity: 5 }),
        expect.objectContaining({ itemId: MILK, quantity: 2 }),
      ]),
    });
  });

  it("reserves pantry capacity for goods already in transit", () => {
    const system = createSystem(createInventory(6));
    const spendCopper = vi.fn(() => true);

    expect(
      system.placeOrder(
        [{ itemId: WHEAT, quantity: 5 }],
        START,
        spendCopper,
      ).accepted,
    ).toBe(true);
    expect(
      system.placeOrder(
        [{ itemId: WHEAT, quantity: 2 }],
        START,
        spendCopper,
      ),
    ).toMatchObject({
      accepted: false,
      message: "The kitchen pantry does not have enough unreserved space.",
    });
    expect(spendCopper).toHaveBeenCalledTimes(1);
  });

  it("unlocks automation through technology and honors the copper reserve", () => {
    const system = createSystem();

    expect(
      system.configureAutomation(20, [
        { itemId: WHEAT, threshold: 2, target: 5 },
      ]),
    ).toMatchObject({ accepted: false });

    system.setUnlocks(1, true);
    expect(
      system.configureAutomation(20, [
        { itemId: WHEAT, threshold: 2, target: 5 },
      ]),
    ).toMatchObject({ accepted: true });

    const spendCopper = vi.fn(() => true);
    expect(system.tryAutomaticOrder(START, 30, spendCopper)).toBeNull();
    expect(spendCopper).not.toHaveBeenCalled();

    expect(system.tryAutomaticOrder(START, 40, spendCopper)).toMatchObject({
      accepted: true,
      totalCostCopper: 12,
    });
    expect(spendCopper).toHaveBeenCalledWith(12);
  });

  it("restores queued procurement state and finishes it after loading", () => {
    const first = createSystem();
    first.setUnlocks(1, false);
    expect(
      first.placeOrder(
        [{ itemId: WHEAT, quantity: 5 }],
        START,
        () => true,
      ).accepted,
    ).toBe(true);

    const restoredInventory = createInventory();
    const restored = createSystem(restoredInventory, first.exportState());
    restored.setUnlocks(1, false);

    expect(restored.getSnapshot().orders).toEqual(
      first.getSnapshot().orders,
    );
    restored.advanceTo(START + 100);
    restored.advanceTo(START + 200);
    expect(restoredInventory.getContainerSnapshot(PANTRY).totalQuantity).toBe(5);
    expect(restored.getSnapshot().orders).toHaveLength(0);
  });
});
