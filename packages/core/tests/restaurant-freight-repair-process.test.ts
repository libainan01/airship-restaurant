import { describe, expect, it } from "vitest";
import {
  FreightElevatorModule,
  InventoryModule,
  LogisticsDemandModule,
  RestaurantFreightRepairProcess,
  StaticInventoryStorageDefinitions,
  TaskModule,
  instanceId,
  type RestaurantApplicationProcessContext,
  type TaskCandidate,
} from "../src";

function context(targetUtcMs: number, cycle: number): RestaurantApplicationProcessContext {
  return Object.freeze({
    operationId: `repair-cycle-${cycle}`,
    previousUtcMs: Math.max(0, targetUtcMs - 1_000),
    targetUtcMs,
    cycle,
    round: 0,
  });
}

function fixture() {
  const inventory = new InventoryModule(
    [{ id: "ingredient.tomato", category: "ingredient", storageMode: "stack" }],
    new StaticInventoryStorageDefinitions([
      { id: "station.ground", compartments: [{ id: "cargo", capacity: 10, acceptedCategories: ["ingredient"] }] },
      { id: "station.airship", compartments: [{ id: "cargo", capacity: 10, acceptedCategories: ["ingredient"] }] },
      { id: "station.transit", compartments: [{ id: "cargo", capacity: 1, acceptedCategories: ["ingredient"] }] },
    ]),
  );
  inventory.depositStack("seed", "station.ground", [{ itemId: "ingredient.tomato", quantity: 1 }], 0);
  const logistics = new LogisticsDemandModule({ inventory, agingIntervalMs: 100 });
  const elevators = new FreightElevatorModule({
    definition: {
      id: "freight.repair-test",
      stationIds: ["station.ground", "station.airship"],
      routeLengthUnits: 100,
      elevators: [{
        id: "freight-1",
        transitLocationId: "station.transit",
        initialStationId: "station.ground",
        speedUnitsPerSecond: 100,
        maxDurability: 1,
        durabilityLossPerTrip: 1,
      }],
    },
    inventory,
    logistics,
  });
  const tasks = new TaskModule();
  const candidate: TaskCandidate = Object.freeze({
    characterId: instanceId("instance.character.repairer_1"),
    available: true,
    tags: Object.freeze(["employee"]),
    learnedJobIds: Object.freeze(["job.repairer"]),
    primaryJobId: "job.repairer",
    skills: Object.freeze({ cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 }),
  });
  const process = new RestaurantFreightRepairProcess({
    freightElevators: elevators,
    tasks,
    candidates: { listCandidates: () => Object.freeze([candidate]) },
  });
  return { inventory, logistics, elevators, tasks, process };
}

function createDemand(
  logistics: LogisticsDemandModule,
  id: string,
  sourceLocationId: string,
  targetLocationId: string,
  occurredAtUtcMs: number,
): void {
  const result = logistics.createDemand(`create-${id}`, {
    id,
    kind: "manual",
    sourceLocationId,
    targetLocationId,
    itemId: "ingredient.tomato",
    ownerType: "manual",
    ownerId: id,
    quantity: 1,
    occurredAtUtcMs,
  });
  if (!result.accepted) throw new Error(result.message);
}

describe("RestaurantFreightRepairProcess", () => {
  it("assigns repairs by skill, completes the task and creates a fresh lifecycle id after later wear", () => {
    const { logistics, elevators, tasks, process } = fixture();
    createDemand(logistics, "outbound", "station.ground", "station.airship", 0);
    elevators.advanceTo("dispatch-outbound", 0);
    elevators.advanceTo("arrive-outbound", 1_000);
    expect(elevators.getElevator("freight-1")).toMatchObject({ durability: 0, repair: null });

    expect(process.advance(context(1_000, 1))).toMatchObject({ changed: true, nextTransitionUtcMs: 2_000 });
    const firstTask = tasks.createReadModel().inProgress[0]!;
    expect(firstTask).toMatchObject({ taskType: "equipment.repair", assignedCharacterId: instanceId("instance.character.repairer_1") });
    expect(elevators.getElevator("freight-1")?.repair).toMatchObject({ taskId: firstTask.taskId, endsAtUtcMs: 2_000 });

    elevators.advanceTo("complete-first-repair", 2_000);
    process.advance(context(2_000, 2));
    expect(tasks.getTask(firstTask.taskId)).toMatchObject({ status: "completed" });
    expect(elevators.getElevator("freight-1")).toMatchObject({ durability: 1, repair: null });

    createDemand(logistics, "return", "station.airship", "station.ground", 2_000);
    elevators.advanceTo("dispatch-return", 2_000);
    elevators.advanceTo("arrive-return", 3_000);
    process.advance(context(3_000, 3));
    const secondTask = tasks.createReadModel().inProgress[0]!;
    expect(secondTask.taskId).not.toBe(firstTask.taskId);
    expect(tasks.getTask(firstTask.taskId)).toMatchObject({ status: "completed" });
    expect(elevators.getElevator("freight-1")?.repair).toMatchObject({ taskId: secondTask.taskId, endsAtUtcMs: 4_000 });
  });
});
