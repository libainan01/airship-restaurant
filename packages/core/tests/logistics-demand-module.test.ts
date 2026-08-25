import { describe, expect, it } from "vitest";
import {
  InventoryModule,
  LogisticsDemandModule,
  StaticInventoryStorageDefinitions,
  instanceId,
} from "../src";

function fixture(airshipCapacity = 6) {
  const inventory = new InventoryModule([
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
    { id: "dishware.plate", category: "dishware", storageMode: "instance" },
    { id: "dish.breakfast", category: "meal", storageMode: "instance" },
  ], new StaticInventoryStorageDefinitions([
    { id: "station.ground", compartments: [{ id: "all", capacity: 1_000_000, acceptedCategories: ["ingredient", "dishware", "meal"] }] },
    { id: "station.airship", compartments: [{ id: "ingredients", capacity: airshipCapacity, acceptedCategories: ["ingredient"] }, { id: "plates", capacity: 4, acceptedCategories: ["dishware"] }, { id: "meals", capacity: 4, acceptedCategories: ["meal"] }] },
  ]));
  inventory.depositStack("seed", "station.ground", [{ itemId: "ingredient.tomato", quantity: 3 }], 1);
  inventory.createInstance("seed-meal", { instanceId: instanceId("instance.meal.ready_1"), itemId: "dish.breakfast", locationId: "station.airship", occurredAtUtcMs: 1 });
  const logistics = new LogisticsDemandModule({ inventory, agingIntervalMs: 100 });
  return { inventory, logistics };
}

function create(logistics: LogisticsDemandModule, id: string, kind: "finished-meal" | "order-blocking" | "manual" | "replenishment", source = "station.ground", target = "station.airship", time = 10) {
  return logistics.createDemand(`create-${id}`, {
    id, kind, sourceLocationId: source, targetLocationId: target,
    itemId: kind === "finished-meal" ? "dish.breakfast" : "ingredient.tomato",
    ...(kind === "finished-meal" ? { instanceId: instanceId("instance.meal.ready_1") } : {}),
    ownerType: kind, ownerId: id, quantity: kind === "finished-meal" ? 1 : 2,
    replenishmentCoverageBasisPoints: kind === "replenishment" ? 2_000 : undefined,
    occurredAtUtcMs: time,
  });
}

describe("LogisticsDemandModule", () => {
  it("orders finished meals, blocked orders, manual groups and replenishment while aging never overtakes meals", () => {
    const { logistics } = fixture();
    create(logistics, "replenish", "replenishment", "station.ground", "station.airship", 0);
    create(logistics, "manual", "manual", "station.ground", "station.airship", 249_900);
    create(logistics, "blocked", "order-blocking", "station.ground", "station.airship", 249_900);
    create(logistics, "meal", "finished-meal", "station.airship", "station.ground", 249_900);
    expect(logistics.listCandidates(250_000).map((entry) => entry.id)).toEqual([
      "meal", "replenish", "blocked", "manual",
    ]);
    expect(logistics.listCandidates(1_000_000)[0]?.id).toBe("meal");
  });

  it("claims exactly one source unit and one destination slot without reserving the whole group", () => {
    const { inventory, logistics } = fixture();
    create(logistics, "manual", "manual");
    expect(logistics.claimNextUnit("claim-one", "claim.one", 20)).toMatchObject({
      accepted: true,
      value: { groupId: "manual", inventoryMode: "stack", ownsSourceReservation: true },
    });
    expect(logistics.getGroup("manual")).toMatchObject({
      requestedQuantity: 2, claimedQuantity: 1, remainingQuantity: 1,
    });
    expect(inventory.getSnapshot().reservations).toHaveLength(1);
    expect(inventory.getSnapshot().capacityReservations).toHaveLength(1);
    expect(inventory.getStackQuantity("station.ground", "ingredient.tomato")).toBe(3);
  });

  it("keeps groups waiting when source or destination capacity is unavailable and releases partial reservations", () => {
    const target = fixture(1);
    target.inventory.depositStack("fill-airship", "station.airship", [{ itemId: "ingredient.tomato", quantity: 1 }], 2);
    create(target.logistics, "manual", "manual");
    expect(target.logistics.claimNextUnit("claim-full", "claim.full", 20)).toMatchObject({
      accepted: false, code: "WAITING_CAPACITY",
    });
    expect(target.logistics.getGroup("manual")).toMatchObject({ blockReason: "WAITING_CAPACITY", remainingQuantity: 2 });
    expect(target.inventory.getSnapshot().reservations).toHaveLength(0);

    const empty = fixture();
    create(empty.logistics, "missing", "manual", "station.airship", "station.ground");
    expect(empty.logistics.claimNextUnit("claim-missing", "claim.missing", 20)).toMatchObject({ accepted: false, code: "WAITING_SOURCE" });
    expect(empty.logistics.getGroup("missing")).toMatchObject({ blockReason: "WAITING_SOURCE" });
  });

  it("keeps identical and reverse manual groups independent and restores active claims without duplication", () => {
    const { inventory, logistics } = fixture();
    create(logistics, "manual-a", "manual");
    create(logistics, "manual-b", "manual");
    create(logistics, "manual-reverse", "manual", "station.airship", "station.ground");
    expect(logistics.exportState().groups).toHaveLength(3);
    expect(logistics.claimNextUnit("claim", "claim.saved", 20)).toMatchObject({ accepted: true });
    const saved = logistics.exportState();
    const restored = new LogisticsDemandModule({ inventory, agingIntervalMs: 100, initialState: saved });
    expect(restored.exportState()).toEqual(saved);
    expect(restored.getClaim("claim.saved")).toMatchObject({ groupId: "manual-a" });
    expect(restored.stopDemand("stop-b", "manual-b", 30)).toMatchObject({ accepted: true, value: { status: "stopped" } });
    expect(restored.getGroup("manual-a")).toMatchObject({ status: "in-progress", claimedQuantity: 1 });
  });

  it("adjusts only unclaimed manual quantity and manual queue order", () => {
    const { logistics } = fixture();
    create(logistics, "manual-a", "manual");
    create(logistics, "manual-b", "manual");
    expect(logistics.updateManualDemand("move-a", "manual-a", { manualOrder: 5, occurredAtUtcMs: 20 })).toMatchObject({
      accepted: true,
      value: { requestedQuantity: 2, remainingQuantity: 2, manualOrder: 5 },
    });
    expect(logistics.listCandidates(20).filter((entry) => entry.kind === "manual").map((entry) => entry.id)).toEqual(["manual-b", "manual-a"]);

    expect(logistics.claimNextUnit("claim-b", "claim.b", 21)).toMatchObject({ accepted: true, value: { groupId: "manual-b" } });
    expect(logistics.updateManualDemand("resize-b", "manual-b", { remainingQuantity: 0, occurredAtUtcMs: 22 })).toMatchObject({
      accepted: true,
      value: { requestedQuantity: 1, claimedQuantity: 1, remainingQuantity: 0, status: "stopped" },
    });
    expect(logistics.getClaim("claim.b")).not.toBeNull();
  });
});
