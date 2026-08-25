import { describe, expect, it } from "vitest";
import {
  FreightElevatorModule,
  InventoryModule,
  LogisticsDemandModule,
  StaticInventoryStorageDefinitions,
  instanceId,
  type FreightElevatorGroupDefinition,
} from "../src";

function fixture(count = 4, maxDurability = 10) {
  const transitLocations = Array.from({ length: count }, (_, index) => `station.freight_${index + 1}`);
  const inventory = new InventoryModule([
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
    { id: "dish.breakfast", category: "meal", storageMode: "instance" },
  ], new StaticInventoryStorageDefinitions([
    { id: "station.ground", compartments: [{ id: "ingredients", capacity: 1_000, acceptedCategories: ["ingredient", "meal"] }] },
    { id: "station.airship", compartments: [{ id: "ingredients", capacity: 20, acceptedCategories: ["ingredient", "meal"] }] },
    ...transitLocations.map((id) => ({ id, compartments: [{ id: "cargo", capacity: 1, acceptedCategories: ["ingredient" as const, "meal" as const] }] })),
  ]));
  inventory.depositStack("seed", "station.ground", [{ itemId: "ingredient.tomato", quantity: 8 }], 0);
  const logistics = new LogisticsDemandModule({ inventory, agingIntervalMs: 100 });
  const definition: FreightElevatorGroupDefinition = {
    id: "freight.demo",
    stationIds: ["station.ground", "station.airship"],
    routeLengthUnits: 100,
    elevators: transitLocations.map((transitLocationId, index) => ({
      id: `freight-${index + 1}`,
      transitLocationId,
      initialStationId: "station.ground",
      speedUnitsPerSecond: 100,
      maxDurability,
      durabilityLossPerTrip: 1,
    })),
  };
  const elevators = new FreightElevatorModule({ definition, inventory, logistics });
  return { definition, inventory, logistics, elevators };
}

function demand(logistics: LogisticsDemandModule, id: string, quantity: number, source = "station.ground", target = "station.airship", time = 0) {
  return logistics.createDemand(`create-${id}`, {
    id,
    kind: "manual",
    sourceLocationId: source,
    targetLocationId: target,
    itemId: "ingredient.tomato",
    ownerType: "manual",
    ownerId: id,
    quantity,
    occurredAtUtcMs: time,
  });
}

describe("FreightElevatorModule", () => {
  it("keeps four elevators docked without meaningful demand and moves no inventory", () => {
    const { inventory, elevators } = fixture();
    expect(elevators.advanceTo("idle", 10_000)).toMatchObject({ accepted: true });
    expect(elevators.exportState().elevators).toHaveLength(4);
    expect(elevators.exportState().elevators.every((entry) => entry.phase === "idle" && entry.dockedStationId === "station.ground")).toBe(true);
    expect(inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(8);
  });

  it("does not consume claim identities or report changes while every remaining demand is source-blocked", () => {
    const { logistics, elevators } = fixture();
    demand(logistics, "source-blocked", 9);
    expect(elevators.advanceTo("exhaust-source", 10_000)).toMatchObject({ accepted: true, changed: true });
    expect(logistics.getGroup("source-blocked")).toMatchObject({ deliveredQuantity: 8, remainingQuantity: 1, blockReason: "WAITING_SOURCE" });
    const sequence = elevators.exportState().nextClaimSequence;

    expect(elevators.advanceTo("source-still-blocked", 10_000)).toMatchObject({ accepted: true, changed: false });
    expect(elevators.exportState().nextClaimSequence).toBe(sequence);
  });

  it("dispatches four single-unit elevators in parallel and completes each claim once", () => {
    const { inventory, logistics, elevators } = fixture();
    demand(logistics, "manual-four", 4);
    expect(elevators.advanceTo("dispatch", 0)).toMatchObject({ accepted: true });
    expect(elevators.exportState().elevators.every((entry) => entry.phase === "moving-loaded" && entry.cargoInstanceId !== null)).toBe(true);
    expect(logistics.exportState().claims).toHaveLength(4);
    expect(inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(4);

    expect(elevators.advanceTo("arrive", 1_000)).toMatchObject({ accepted: true });
    expect(inventory.getStackQuantity("station.airship", "ingredient.tomato")).toBe(4);
    expect(logistics.getGroup("manual-four")).toMatchObject({ status: "completed", deliveredQuantity: 4, claimedQuantity: 0, remainingQuantity: 0 });
    expect(logistics.exportState().claims).toHaveLength(0);
    expect(inventory.getSnapshot().capacityReservations).toHaveLength(0);
    expect(elevators.exportState().elevators.every((entry) => entry.phase === "idle" && entry.dockedStationId === "station.airship" && entry.durability === 9)).toBe(true);
  });

  it("uses empty relocation only to pick up a claim, completes it at zero durability, then repairs by skill speed", () => {
    const { definition, inventory, logistics, elevators } = fixture(1, 2);
    demand(logistics, "first", 1);
    elevators.advanceTo("first-dispatch", 0);
    elevators.advanceTo("first-arrive", 1_000);
    demand(logistics, "second", 1, "station.ground", "station.airship", 1_000);

    elevators.advanceTo("empty-start", 1_000);
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-empty", cargoInstanceId: null, durability: 1 });
    elevators.advanceTo("empty-arrive", 2_000);
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-loaded", durability: 0 });
    elevators.advanceTo("loaded-arrive", 3_000);
    expect(logistics.getGroup("second")).toMatchObject({ status: "completed", deliveredQuantity: 1 });
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "idle", durability: 0, dockedStationId: "station.airship" });
    expect(elevators.createRepairTaskSources()).toEqual([expect.objectContaining({ elevatorId: "freight-1", createdAtUtcMs: 1_000, missingDurability: 2 })]);

    const repairTask = elevators.createTaskSourceSnapshot().waitingTasks[0]!;
    expect(repairTask).toMatchObject({ taskType: "equipment.repair", eligibleJobIds: ["job.repairer"], urgent: true, createdAtUtcMs: 1_000 });
    expect(elevators.startRepair("repair", { elevatorId: "freight-1", taskId: repairTask.taskId, characterId: instanceId("instance.character.repairer_1"), repairUnitsPerSecond: 1, occurredAtUtcMs: 3_000 })).toMatchObject({ accepted: true, value: { repair: { endsAtUtcMs: 5_000 } } });
    expect(elevators.createTaskSourceSnapshot().activeTasks).toEqual([expect.objectContaining({ assignedCharacterId: instanceId("instance.character.repairer_1") })]);
    elevators.advanceTo("repair-mid", 4_000);
    const restored = new FreightElevatorModule({ definition, inventory, logistics, initialState: elevators.exportState() });
    expect(restored.createTaskSourceSnapshot().activeTasks).toHaveLength(1);
    restored.advanceTo("repair-done", 5_000);
    expect(restored.getElevator("freight-1")).toMatchObject({ durability: 2, repair: null, repairNeededAtUtcMs: null });
  });

  it("moves a finished meal instance without recreating or losing its identity", () => {
    const { inventory, logistics, elevators } = fixture(1);
    const mealId = instanceId("instance.meal.finished_1");
    inventory.createInstance("meal", { instanceId: mealId, itemId: "dish.breakfast", locationId: "station.airship", attributes: { orderId: "order.1", quality: 87 }, occurredAtUtcMs: 0 });
    logistics.createDemand("meal-demand", {
      id: "finished-meal",
      kind: "finished-meal",
      sourceLocationId: "station.airship",
      targetLocationId: "station.ground",
      itemId: "dish.breakfast",
      instanceId: mealId,
      ownerType: "order",
      ownerId: "order.1",
      quantity: 1,
      occurredAtUtcMs: 0,
    });

    elevators.advanceTo("meal-empty", 0);
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-empty", cargoInstanceId: null });
    elevators.advanceTo("meal-loaded", 1_000);
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-loaded", cargoInstanceId: mealId });
    elevators.advanceTo("meal-delivered", 2_000);
    expect(inventory.getLocationSnapshot("station.ground")?.instances).toEqual([
      expect.objectContaining({ id: mealId, itemId: "dish.breakfast", attributes: { orderId: "order.1", quality: 87 } }),
    ]);
    expect(inventory.getSnapshot().locations.flatMap((entry) => entry.instances).filter((entry) => entry.id === mealId)).toHaveLength(1);
    expect(logistics.getGroup("finished-meal")).toMatchObject({ status: "completed", deliveredQuantity: 1 });
  });
  it("restores a loaded trip and finishes without duplicating cargo or delivery", () => {
    const { definition, inventory, logistics, elevators } = fixture(1);
    demand(logistics, "restore", 1);
    elevators.advanceTo("dispatch", 0);
    elevators.advanceTo("partial", 400);
    const saved = elevators.exportState();
    const restored = new FreightElevatorModule({ definition, inventory, logistics, initialState: saved });
    expect(restored.exportState()).toEqual(saved);
    expect(inventory.getLocationSnapshot("station.freight_1")?.stackCargo).toHaveLength(1);

    restored.advanceTo("finish", 1_000);
    expect(inventory.getLocationSnapshot("station.freight_1")?.stackCargo).toHaveLength(0);
    expect(inventory.getStackQuantity("station.airship", "ingredient.tomato")).toBe(1);
    expect(logistics.getGroup("restore")).toMatchObject({ deliveredQuantity: 1 });
  });

  it("freezes edit mode, remaps normalized progress, and applies speed changes only to the next segment", () => {
    const { logistics, elevators } = fixture(1);
    demand(logistics, "route", 1);
    elevators.advanceTo("dispatch", 0);
    elevators.advanceTo("partial", 400);
    elevators.enterEditMode("edit", 400);
    expect(elevators.advanceTo("frozen", 1_400)).toMatchObject({ accepted: false, code: "EDIT_MODE_ACTIVE" });
    elevators.confirmRoute("confirm", 200, 1_400);
    expect(elevators.getElevator("freight-1")).toMatchObject({ motionPathLengthUnits: 200, motionSpeedUnitsPerSecond: 100, motionEndsAtUtcMs: 2_600 });
    elevators.updateSpeed("speed", "freight-1", 200, 1_400);
    expect(elevators.getElevator("freight-1")).toMatchObject({ speedUnitsPerSecond: 200, motionSpeedUnitsPerSecond: 100, motionEndsAtUtcMs: 2_600 });

    elevators.advanceTo("arrive", 2_600);
    demand(logistics, "reverse", 1, "station.airship", "station.ground", 2_600);
    elevators.advanceTo("reverse-dispatch", 2_600);
    expect(elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-loaded", motionSpeedUnitsPerSecond: 200, motionEndsAtUtcMs: 3_600 });
  });

  it("produces the same business outcome with coarse and fine simulation ticks", () => {
    const coarse = fixture(1);
    const fine = fixture(1);
    demand(coarse.logistics, "deterministic", 3);
    demand(fine.logistics, "deterministic", 3);

    coarse.elevators.advanceTo("coarse", 3_000);
    fine.elevators.advanceTo("fine-0", 0);
    fine.elevators.advanceTo("fine-1", 1_000);
    fine.elevators.advanceTo("fine-2", 2_000);
    fine.elevators.advanceTo("fine-3", 3_000);

    expect(coarse.inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(fine.inventory.getStackQuantity("station.ground", "ingredient.tomato"));
    expect(coarse.inventory.getStackQuantity("station.airship", "ingredient.tomato")).toBe(fine.inventory.getStackQuantity("station.airship", "ingredient.tomato"));
    expect(coarse.logistics.getGroup("deterministic")).toMatchObject({ deliveredQuantity: 2, claimedQuantity: 1, remainingQuantity: 0 });
    expect(fine.logistics.getGroup("deterministic")).toMatchObject({ deliveredQuantity: 2, claimedQuantity: 1, remainingQuantity: 0 });
    expect(coarse.elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-empty", dockedStationId: null, motionStartedAtUtcMs: 3_000, motionEndsAtUtcMs: 4_000, durability: 7 });
    expect(fine.elevators.getElevator("freight-1")).toMatchObject({ phase: "moving-empty", dockedStationId: null, motionStartedAtUtcMs: 3_000, motionEndsAtUtcMs: 4_000, durability: 7 });
  });});