import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  InventoryModule,
  StaticInventoryStorageDefinitions,
  TransactionScope,
  instanceId,
  type InventoryItemDefinition,
} from "../src";

const TOMATO = "ingredient.tomato";
const EGG = "ingredient.egg";
const PLATE = "dishware.plate";
const MEAL = "meal.tomato_egg";

const items: readonly InventoryItemDefinition[] = [
  { id: TOMATO, category: "ingredient", storageMode: "stack" },
  { id: EGG, category: "ingredient", storageMode: "stack" },
  { id: PLATE, category: "dishware", storageMode: "instance" },
  { id: MEAL, category: "meal", storageMode: "instance" },
];

function createStorage() {
  return new StaticInventoryStorageDefinitions([
    {
      id: "storage.ground",
      compartments: [{
        id: "mixed",
        capacity: 100,
        acceptedCategories: ["ingredient", "dishware", "meal"],
      }],
    },
    {
      id: "storage.airship",
      compartments: [
        { id: "ingredients", capacity: 4, acceptedCategories: ["ingredient"] },
        { id: "plates", capacity: 2, acceptedCategories: ["dishware"] },
        { id: "meals", capacity: 1, acceptedCategories: ["meal"] },
      ],
    },
    {
      id: "transport.lift-1",
      compartments: [{
        id: "cargo",
        capacity: 1,
        acceptedCategories: ["ingredient", "dishware", "meal"],
      }],
    },
    {
      id: "holder.chef",
      compartments: [{ id: "hands", capacity: 2, acceptedCategories: ["dishware", "meal"] }],
    },
  ]);
}

function createInventory() {
  return new InventoryModule(items, createStorage());
}

describe("InventoryModule mixed ledger", () => {
  it("merges stack deposits and atomically rejects a transfer that exceeds category capacity", () => {
    const inventory = createInventory();
    inventory.depositStack("seed-1", "storage.ground", [{ itemId: TOMATO, quantity: 3 }], 1);
    inventory.depositStack("seed-2", "storage.ground", [{ itemId: TOMATO, quantity: 2 }], 2);
    expect(inventory.getLocationSnapshot("storage.ground")?.stacks[0]).toMatchObject({
      quantity: 5,
      availableQuantity: 5,
    });

    expect(inventory.transferStack(
      "too-large",
      "storage.ground",
      "storage.airship",
      [{ itemId: TOMATO, quantity: 5 }],
      3,
    )).toMatchObject({ accepted: false, code: "CAPACITY_EXCEEDED" });
    expect(inventory.getLocationSnapshot("storage.ground")?.stacks[0]?.quantity).toBe(5);
    expect(inventory.getLocationSnapshot("storage.airship")?.stacks).toHaveLength(0);
  });

  it("reserves exact stack locations atomically and never auto-rebinds to later stock", () => {
    const inventory = createInventory();
    inventory.depositStack("ground", "storage.ground", [{ itemId: TOMATO, quantity: 3 }], 1);
    inventory.depositStack("air", "storage.airship", [{ itemId: TOMATO, quantity: 1 }], 2);
    expect(inventory.createReservation("reserve", {
      reservationId: "reservation.order-1",
      ownerType: "order",
      ownerId: "order-1",
      stacks: [
        { locationId: "storage.airship", itemId: TOMATO, quantity: 1 },
        { locationId: "storage.ground", itemId: TOMATO, quantity: 2 },
      ],
      createdAtUtcMs: 3,
    })).toMatchObject({ accepted: true });
    expect(inventory.getLocationSnapshot("storage.airship")?.stacks[0]).toMatchObject({
      reservedQuantity: 1,
      availableQuantity: 0,
    });
    expect(inventory.getLocationSnapshot("storage.ground")?.stacks[0]).toMatchObject({
      reservedQuantity: 2,
      availableQuantity: 1,
    });

    inventory.depositStack("later", "storage.airship", [{ itemId: TOMATO, quantity: 1 }], 4);
    expect(inventory.getSnapshot().reservations[0]?.stackAllocations).toContainEqual({
      locationId: "storage.ground",
      itemId: TOMATO,
      quantity: 2,
    });
    expect(inventory.getLocationSnapshot("storage.airship")?.stacks[0]).toMatchObject({
      quantity: 2,
      reservedQuantity: 1,
    });
  });

  it("splits one reserved stack unit into transit cargo and migrates the binding at arrival", () => {
    const inventory = createInventory();
    inventory.depositStack("ground", "storage.ground", [{ itemId: TOMATO, quantity: 2 }], 1);
    inventory.createReservation("reserve", {
      reservationId: "reservation.order-1",
      ownerType: "order",
      ownerId: "order-1",
      stacks: [{ locationId: "storage.ground", itemId: TOMATO, quantity: 2 }],
      createdAtUtcMs: 2,
    });
    const cargoId = instanceId("instance.cargo.tomato_1");
    expect(inventory.beginStackUnitTransit(
      "load",
      cargoId,
      TOMATO,
      "storage.ground",
      "transport.lift-1",
      3,
      "reservation.order-1",
    )).toMatchObject({ accepted: true, value: { reservationId: "reservation.order-1" } });
    expect(inventory.getLocationSnapshot("storage.ground")?.stacks[0]).toMatchObject({
      quantity: 1,
      reservedQuantity: 1,
    });
    expect(inventory.getSnapshot().reservations[0]).toMatchObject({ stackCargoIds: [cargoId] });
    expect(inventory.beginStackUnitTransit(
      "second-cargo",
      instanceId("instance.cargo.tomato_2"),
      TOMATO,
      "storage.ground",
      "transport.lift-1",
      4,
      "reservation.order-1",
    )).toMatchObject({ accepted: false, code: "CAPACITY_EXCEEDED" });

    inventory.reserveCapacity(
      "cap",
      "capacity.order-1",
      "logistics",
      "run-1",
      "storage.airship",
      TOMATO,
      1,
      5,
    );
    expect(inventory.completeStackUnitTransit(
      "unload",
      cargoId,
      "storage.airship",
      6,
      "capacity.order-1",
    )).toMatchObject({ accepted: true });
    expect(inventory.getLocationSnapshot("transport.lift-1")?.stackCargo).toHaveLength(0);
    expect(inventory.getSnapshot().reservations[0]).toMatchObject({
      stackCargoIds: [],
      stackAllocations: [
        { locationId: "storage.ground", itemId: TOMATO, quantity: 1 },
        { locationId: "storage.airship", itemId: TOMATO, quantity: 1 },
      ],
    });
  });

  it("keeps dishware and meals unique while their reservations follow explicit transfers", () => {
    const inventory = createInventory();
    const plateId = instanceId("instance.dishware.plate_1");
    const mealId = instanceId("instance.meal.order_1");
    inventory.createInstance("plate", {
      instanceId: plateId,
      itemId: PLATE,
      locationId: "storage.ground",
      occurredAtUtcMs: 1,
    });
    inventory.createInstance("meal", {
      instanceId: mealId,
      itemId: MEAL,
      locationId: "storage.airship",
      occurredAtUtcMs: 2,
      attributes: { orderId: "order-1", quality: 87 },
    });
    inventory.createReservation("reserve-meal", {
      reservationId: "reservation.service-1",
      ownerType: "service",
      ownerId: "task-1",
      instanceIds: [mealId],
      createdAtUtcMs: 3,
    });
    expect(inventory.transferInstance("carry", mealId, "holder.chef", 4)).toMatchObject({ accepted: true });
    expect(inventory.getLocationSnapshot("holder.chef")?.instances[0]).toMatchObject({
      id: mealId,
      reservationId: "reservation.service-1",
      attributes: { orderId: "order-1", quality: 87 },
    });
    expect(inventory.removeInstance("blocked", mealId, 5)).toMatchObject({
      accepted: false,
      code: "INSTANCE_RESERVED",
    });
    expect(inventory.getSnapshot().reservations[0]?.instanceIds).toEqual([mealId]);
  });

  it("keeps ingredient, plate, and meal compartments independent", () => {
    const inventory = createInventory();
    inventory.depositStack("ingredients", "storage.airship", [{ itemId: TOMATO, quantity: 4 }], 1);
    inventory.createInstance("plate-1", {
      instanceId: instanceId("instance.dishware.plate_1"),
      itemId: PLATE,
      locationId: "storage.airship",
      occurredAtUtcMs: 2,
    });
    inventory.createInstance("plate-2", {
      instanceId: instanceId("instance.dishware.plate_2"),
      itemId: PLATE,
      locationId: "storage.airship",
      occurredAtUtcMs: 3,
    });
    inventory.reserveCapacity(
      "meal-cap",
      "capacity.meal-1",
      "recipe",
      "step-1",
      "storage.airship",
      MEAL,
      1,
      4,
    );
    expect(inventory.createInstance("meal", {
      instanceId: instanceId("instance.meal.first_1"),
      itemId: MEAL,
      locationId: "storage.airship",
      capacityReservationId: "capacity.meal-1",
      occurredAtUtcMs: 5,
    })).toMatchObject({ accepted: true });
    expect(inventory.getLocationSnapshot("storage.airship")?.compartments).toEqual([
      expect.objectContaining({ id: "ingredients", occupied: 4, availableCapacity: 0 }),
      expect.objectContaining({ id: "plates", occupied: 2, availableCapacity: 0 }),
      expect.objectContaining({ id: "meals", occupied: 1, reservedCapacity: 0, availableCapacity: 0 }),
    ]);
  });

  it("restores deterministically and rolls back without duplicating resources", () => {
    const inventory = createInventory();
    inventory.depositStack("seed", "storage.ground", [{ itemId: EGG, quantity: 3 }], 1);
    const before = inventory.exportState();
    const transaction = new TransactionScope(new DomainEventBus());
    expect(() => transaction.run([inventory], () => {
      const result = inventory.transferStack(
        "inside-transaction",
        "storage.ground",
        "storage.airship",
        [{ itemId: EGG, quantity: 2 }],
        2,
      );
      if (!result.accepted) throw new Error(result.message);
      throw new Error("downstream failed");
    })).toThrow("downstream failed");
    expect(inventory.exportState()).toEqual(before);

    const restored = new InventoryModule(items, createStorage(), before);
    expect(restored.getSnapshot()).toEqual(inventory.getSnapshot());
    expect(() => new InventoryModule(items, createStorage(), {
      ...before,
      stacks: [...before.stacks, { locationId: "storage.ground", itemId: EGG, quantity: 1 }],
    })).toThrow(/invalid inventory stack/i);
  });
});
