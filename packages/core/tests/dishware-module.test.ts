import { describe, expect, it } from "vitest";
import {
  DishwareModule,
  DomainEventBus,
  InventoryModule,
  StaticInventoryStorageDefinitions,
  instanceId,
  type DishwareCabinetDefinition,
  type DishwareCabinetDefinitionPort,
  type DishwareState,
  type InventoryState,
} from "../src";

const PLATE_ITEM = "dishware.plate";

const cabinet: DishwareCabinetDefinition = {
  id: "cabinet.main",
  supplyComponentId: "component.cabinet-supply",
  cleanStorageLocationId: "cabinet.clean",
  dirtyStorageLocationId: "cabinet.dirty",
  washingLocationId: "cabinet.washing",
  suppliedPlateCount: 4,
  washDurationMs: 10,
  parallelWashCount: 2,
};

function createFixture(initialState?: DishwareState, inventoryState?: InventoryState, cabinetDefinitions?: DishwareCabinetDefinitionPort) {
  const inventory = new InventoryModule(
    [{ id: PLATE_ITEM, category: "dishware", storageMode: "instance" }],
    new StaticInventoryStorageDefinitions([
      { id: "cabinet.clean", compartments: [{ id: "clean", capacity: 6, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.dirty", compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "cabinet.washing", compartments: [{ id: "washing", capacity: 3, acceptedCategories: ["dishware"] }] },
      { id: "airship.plates", compartments: [{ id: "plates", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "meal.binding", compartments: [{ id: "meal", capacity: 4, acceptedCategories: ["dishware"] }] },
      { id: "table.dirty", compartments: [{ id: "table", capacity: 4, acceptedCategories: ["dishware"] }] },
    ]),
    inventoryState,
  );
  const eventBus = new DomainEventBus();
  const events: string[] = [];
  eventBus.subscribe("*", (event) => events.push(event.type));
  const dishware = new DishwareModule({
    inventory,
    eventBus,
    plateItemId: PLATE_ITEM,
    ...(cabinetDefinitions === undefined ? { cabinets: [cabinet] } : { cabinetDefinitions }),
    initialState,
  });
  return { inventory, dishware, events };
}

const plateIds = [1, 2, 3, 4].map((value) =>
  instanceId(`instance.dishware.demo_${value}`),
);

function initializedFixture() {
  const fixture = createFixture();
  const result = fixture.dishware.initializeSupply(
    "initialize",
    cabinet.supplyComponentId,
    plateIds,
    1,
  );
  if (!result.accepted) throw new Error(result.message);
  return fixture;
}

function usePlate(
  dishware: DishwareModule,
  index: number,
  atUtcMs: number,
) {
  const reservationId = `reservation.plate-${index}`;
  const reserved = dishware.reserveCleanPlate(
    `reserve-${index}`,
    reservationId,
    "recipe-step",
    `step-${index}`,
    [cabinet.cleanStorageLocationId],
    atUtcMs,
  );
  if (!reserved.accepted) throw new Error(reserved.message);
  const begun = dishware.beginUse(
    `use-${index}`,
    reservationId,
    "meal.binding",
    atUtcMs + 1,
  );
  if (!begun.accepted) throw new Error(begun.message);
  return begun.value.id;
}

describe("DishwareModule", () => {
  it("creates exactly four initial clean plate instances from the cabinet supply capability", () => {
    const { dishware, inventory, events } = initializedFixture();
    expect(dishware.getSnapshot()).toMatchObject({
      totalPlateCount: 4,
      counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 },
      initializedSupplyComponentIds: [cabinet.supplyComponentId],
    });
    expect(inventory.getLocationSnapshot("cabinet.clean")?.instances.map((entry) => entry.id)).toEqual(plateIds);
    expect(events.filter((type) => type === "dishware.plate-created")).toHaveLength(4);
    expect(dishware.initializeSupply(
      "initialize-again",
      cabinet.supplyComponentId,
      plateIds,
      2,
    )).toMatchObject({ accepted: false, code: "SUPPLY_ALREADY_INITIALIZED" });
  });

  it("reserves one clean plate and atomically changes its unique location when use begins", () => {
    const { dishware, inventory } = initializedFixture();
    const plateId = usePlate(dishware, 1, 2);
    expect(dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 1, dirty: 0, washing: 0 });
    expect(inventory.getLocationSnapshot("meal.binding")?.instances[0]).toMatchObject({
      id: plateId,
      reservationId: null,
    });
    expect(inventory.getSnapshot().reservations).toHaveLength(0);
  });

  it("runs automatic washing with a fixed parallel limit and never creates or consumes plates", () => {
    const { dishware, inventory, events } = initializedFixture();
    const used = [0, 1, 2].map((index) => usePlate(dishware, index, 2 + index * 2));
    for (const [index, plateId] of used.entries()) {
      dishware.markDirty(`dirty-${index}`, plateId, "table.dirty", 10 + index);
      dishware.returnDirtyToCabinet(`return-${index}`, plateId, cabinet.id, 13 + index);
    }

    dishware.advanceTo("advance-start", 15);
    expect(dishware.getSnapshot()).toMatchObject({
      totalPlateCount: 4,
      counts: { clean: 1, in_use: 0, dirty: 1, washing: 2 },
    });
    expect(inventory.getLocationSnapshot("cabinet.washing")?.instances).toHaveLength(2);

    dishware.advanceTo("advance-two-complete", 26);
    expect(dishware.getSnapshot()).toMatchObject({
      totalPlateCount: 4,
      counts: { clean: 3, in_use: 0, dirty: 0, washing: 1 },
    });
    dishware.advanceTo("advance-all-complete", 40);
    expect(dishware.getSnapshot()).toMatchObject({
      totalPlateCount: 4,
      counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 },
    });
    expect(inventory.getSnapshot().locations.flatMap((location) => location.instances)).toHaveLength(4);
    expect(events.filter((type) => type === "dishware.washing-started")).toHaveLength(3);
    expect(events.filter((type) => type === "dishware.washing-completed")).toHaveLength(3);
  });

  it("rolls back plate state and inventory location together when a target cannot accept the plate", () => {
    const { dishware, inventory } = initializedFixture();
    const plateId = usePlate(dishware, 1, 2);
    const beforeDishware = dishware.exportState();
    const beforeInventory = inventory.exportState();
    expect(dishware.markDirty("bad-dirty", plateId, "missing.location", 5)).toMatchObject({
      accepted: false,
      code: "INVENTORY_REJECTED",
    });
    expect(dishware.exportState()).toEqual(beforeDishware);
    expect(inventory.exportState()).toEqual(beforeInventory);
  });

  it("restores an active cleaning queue against the same Inventory revision and continues deterministically", () => {
    const source = initializedFixture();
    const plateId = usePlate(source.dishware, 0, 2);
    source.dishware.markDirty("dirty", plateId, "table.dirty", 4);
    source.dishware.returnDirtyToCabinet("return", plateId, cabinet.id, 5);
    source.dishware.advanceTo("start-wash", 6);
    const dishwareState = source.dishware.exportState();
    const inventoryState = source.inventory.exportState();
    const restored = createFixture(dishwareState, inventoryState);
    expect(restored.dishware.getSnapshot()).toEqual(source.dishware.getSnapshot());
    expect(restored.inventory.getSnapshot()).toEqual(source.inventory.getSnapshot());
    restored.dishware.advanceTo("finish-restored", 20);
    source.dishware.advanceTo("finish-source", 20);
    expect(restored.dishware.getSnapshot().counts).toEqual(source.dishware.getSnapshot().counts);
    expect(restored.dishware.getSnapshot()).toMatchObject({
      totalPlateCount: 4,
      counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 },
    });
  });
  it("rejects restored state when a tracked plate is absent from the authoritative Inventory ledger", () => {
    const { dishware } = initializedFixture();
    const saved = dishware.exportState();
    expect(() => createFixture(saved)).toThrow(/plate invariant/i);
  });
  it("uses upgraded cabinet values for new plates and wash jobs while preserving active completion snapshots", () => {
    let currentCabinet: DishwareCabinetDefinition = cabinet;
    const definitions: DishwareCabinetDefinitionPort = { listCabinets: () => [currentCabinet] };
    const fixture = createFixture(undefined, undefined, definitions);
    expect(fixture.dishware.initializeSupply("initialize-dynamic", cabinet.supplyComponentId, plateIds, 1)).toMatchObject({ accepted: true });
    const used = [0, 1, 2].map((index) => usePlate(fixture.dishware, index, 2 + index * 2));
    for (const [index, plateId] of used.entries()) {
      fixture.dishware.markDirty(`dynamic-dirty-${index}`, plateId, "table.dirty", 10 + index);
      fixture.dishware.returnDirtyToCabinet(`dynamic-return-${index}`, plateId, cabinet.id, 13 + index);
    }
    fixture.dishware.advanceTo("start-old-washes", 15);
    expect(fixture.dishware.exportState().washJobs.map((job) => job.completesAtUtcMs)).toEqual([25, 25]);

    currentCabinet = { ...cabinet, suppliedPlateCount: 6, washDurationMs: 4, parallelWashCount: 3 };
    const addedPlateIds = [5, 6].map((value) => instanceId(`instance.dishware.demo_${value}`));
    expect(fixture.dishware.expandSupply("expand-dynamic", cabinet.supplyComponentId, addedPlateIds, 16)).toMatchObject({
      accepted: true,
      value: [{ status: "clean" }, { status: "clean" }],
    });
    fixture.dishware.advanceTo("start-upgraded-wash", 16);
    expect(fixture.dishware.exportState().washJobs.map((job) => job.completesAtUtcMs).sort((left, right) => left - right)).toEqual([20, 25, 25]);
    expect(fixture.dishware.getSnapshot()).toMatchObject({ totalPlateCount: 6, counts: { clean: 3, in_use: 0, dirty: 0, washing: 3 } });

    fixture.dishware.advanceTo("complete-new-duration", 21);
    expect(fixture.dishware.getSnapshot().counts).toEqual({ clean: 4, in_use: 0, dirty: 0, washing: 2 });
    expect(fixture.events).toContain("dishware.supply-expanded");
  });
});
