import { describe, expect, it } from "vitest";
import {
  DishwareModule,
  DishwareSupplyDemandProjector,
  InventoryModule,
  StaticInventoryStorageDefinitions,
  instanceId,
} from "../src";

function setup() {
  const inventory = new InventoryModule(
    [{ id: "dishware.plate", category: "dishware", storageMode: "instance" }],
    new StaticInventoryStorageDefinitions([
      { id: "cabinet.clean", compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.washing", compartments: [{ id: "washing", capacity: 1, acceptedCategories: ["dishware"] }] },
      { id: "airship.plates", compartments: [{ id: "plates", capacity: 2, acceptedCategories: ["dishware"] }] },
    ]),
  );
  const dishware = new DishwareModule({
    inventory,
    plateItemId: "dishware.plate",
    cabinets: [{
      id: "cabinet.main",
      supplyComponentId: "component.supply",
      cleanStorageLocationId: "cabinet.clean",
      dirtyStorageLocationId: "cabinet.dirty",
      washingLocationId: "cabinet.washing",
      suppliedPlateCount: 4,
      washDurationMs: 10,
      parallelWashCount: 1,
    }],
  });
  const plateIds = [1, 2, 3, 4].map((value) => instanceId(`instance.dishware.supply_${value}`));
  dishware.initializeSupply("initialize", "component.supply", plateIds, 1);
  const projector = new DishwareSupplyDemandProjector({
    dishware,
    inventory,
    targets: [{
      id: "target.airship-plates",
      sourceCleanStorageLocationId: "cabinet.clean",
      targetCleanStorageLocationId: "airship.plates",
      targetQuantity: 2,
    }],
  });
  return { dishware, inventory, projector, plateIds };
}

describe("DishwareSupplyDemandProjector", () => {
  it("derives a target shortage from the same plate instances without creating a second count", () => {
    const { projector, plateIds } = setup();
    expect(projector.getSnapshot()[0]).toEqual({
      targetId: "target.airship-plates",
      sourceLocationId: "cabinet.clean",
      targetLocationId: "airship.plates",
      targetQuantity: 2,
      currentTargetQuantity: 0,
      arrangedIncomingQuantity: 0,
      missingQuantity: 2,
      availableSourcePlateIds: plateIds,
      requestableQuantity: 2,
      blockReason: "NONE",
    });
  });

  it("counts arrived plates and one-at-a-time destination reservations before requesting more", () => {
    const { inventory, projector, plateIds } = setup();
    inventory.transferInstance("arrived", plateIds[0]!, "airship.plates", 2);
    inventory.reserveCapacity(
      "arranged",
      "capacity.plate-supply-1",
      "dishware-supply",
      "target.airship-plates",
      "airship.plates",
      "dishware.plate",
      1,
      3,
    );
    expect(projector.getSnapshot()[0]).toMatchObject({
      currentTargetQuantity: 1,
      arrangedIncomingQuantity: 1,
      missingQuantity: 0,
      requestableQuantity: 0,
    });
  });

  it("reports a stable blocking reason when every clean source plate is already reserved", () => {
    const { inventory, projector, plateIds } = setup();
    inventory.createReservation("reserve-all", {
      reservationId: "reservation.all-plates",
      ownerType: "test",
      ownerId: "all",
      instanceIds: plateIds,
      createdAtUtcMs: 2,
    });
    expect(projector.getSnapshot()[0]).toMatchObject({
      missingQuantity: 2,
      availableSourcePlateIds: [],
      requestableQuantity: 0,
      blockReason: "NO_CLEAN_SOURCE",
    });
  });
});
