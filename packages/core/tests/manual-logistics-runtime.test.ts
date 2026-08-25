import { describe, expect, it } from "vitest";
import {
  InventoryModule,
  LogisticsDemandModule,
  ManualLogisticsRuntime,
  StaticInventoryStorageDefinitions,
  projectInventoryReadModel,
} from "../src";

function fixture() {
  const inventory = new InventoryModule([
    { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
  ], new StaticInventoryStorageDefinitions([
    { id: "station.ground", compartments: [{ id: "all", capacity: 100, acceptedCategories: ["ingredient"] }] },
    { id: "station.airship", compartments: [{ id: "all", capacity: 10, acceptedCategories: ["ingredient"] }] },
  ]));
  inventory.depositStack("seed", "station.ground", [{ itemId: "ingredient.tomato", quantity: 6 }], 1);
  const logistics = new LogisticsDemandModule({ inventory });
  let now = 10;
  let changed = 0;
  const runtime = new ManualLogisticsRuntime({
    inventory,
    logistics,
    stationLocationIds: ["station.ground", "station.airship"],
    clock: { nowUtcMs: () => now++ },
    onChanged: () => { changed += 1; },
  });
  return { inventory, logistics, runtime, changed: () => changed };
}

describe("ManualLogisticsRuntime", () => {
  it("keeps identical player queues independent and exposes them through the inventory projection", () => {
    const target = fixture();
    const command = (id: string, groupId: string) => ({
      id,
      type: "logistics.create-manual" as const,
      payload: { groupId, sourceLocationId: "station.ground", targetLocationId: "station.airship", itemId: "ingredient.tomato", quantity: 2 },
    });
    expect(target.runtime.dispatch(command("manual:create:a", "demand.manual.a"))).toMatchObject({ handled: true, accepted: true });
    expect(target.runtime.dispatch(command("manual:create:b", "demand.manual.b"))).toMatchObject({ handled: true, accepted: true });
    expect(target.runtime.getSnapshot().demands).toHaveLength(2);
    expect(target.changed()).toBe(2);
    expect(projectInventoryReadModel(target.inventory.getSnapshot(), null, target.runtime.getSnapshot()).manualLogistics?.demands.map((entry) => entry.id)).toEqual(["demand.manual.a", "demand.manual.b"]);
    expect(target.runtime.dispatch({ id: "manual:stop:a", type: "logistics.stop-manual", payload: { groupId: "demand.manual.a" } })).toMatchObject({ accepted: true });
    expect(target.runtime.getSnapshot().demands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "demand.manual.a", status: "stopped" }),
      expect.objectContaining({ id: "demand.manual.b", status: "in-progress", remainingQuantity: 2 }),
    ]));
  });

  it("rejects routes outside its exchange stations and duplicate command ids", () => {
    const target = fixture();
    const invalid = { id: "manual:invalid", type: "logistics.create-manual" as const, payload: { groupId: "demand.manual.invalid", sourceLocationId: "station.elsewhere", targetLocationId: "station.airship", itemId: "ingredient.tomato", quantity: 1 } };
    expect(target.runtime.dispatch(invalid)).toMatchObject({ accepted: false });
    expect(target.runtime.dispatch(invalid)).toMatchObject({ accepted: false, message: expect.stringContaining("already") });
    expect(target.logistics.exportState().groups).toHaveLength(0);
  });
});