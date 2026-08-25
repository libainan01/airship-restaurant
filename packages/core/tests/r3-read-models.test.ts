import { describe, expect, it } from "vitest";
import {
  createSubresourceId,
  instanceId,
  projectInventoryReadModel,
  projectLayoutReadModel,
  projectProgressionReadModel,
  R3ReadModelPublisher,
  type DishwareSnapshot,
  type InventorySnapshot,
  type RecruitmentReadModel,
  type SceneLayoutSnapshot,
} from "../src";

function layoutSnapshot(revision = 3): SceneLayoutSnapshot {
  const buildingId = instanceId("instance.building.cabinet_1");
  return Object.freeze({
    schemaVersion: 1,
    revision,
    buildings: Object.freeze([
      Object.freeze({
        id: buildingId,
        definitionId: "building.cabinet",
        sceneId: "scene.ground",
        transform: Object.freeze({ x: 40, y: 70, orientation: "front" }),
        styleId: "brass",
        level: 1,
        durability: 100,
        enabled: true,
        stored: false,
        totalInvestmentCopper: 800,
        components: Object.freeze([
          Object.freeze({
            slotId: "storage",
            capabilityId: "capability.storage",
            componentId: createSubresourceId(buildingId, "storage"),
          }),
        ]),
        worldGeometry: Object.freeze({
          hardFootprints: Object.freeze([
            Object.freeze({ x: 40, y: 70, width: 20, height: 10 }),
          ]),
          visualBounds: Object.freeze({ x: 36, y: 45, width: 28, height: 35 }),
          interactionAreas: Object.freeze([
            Object.freeze({
              id: "front",
              required: true,
              bounds: Object.freeze({ x: 38, y: 82, width: 24, height: 8 }),
            }),
          ]),
        }),
        renderSortY: 80,
      }),
      Object.freeze({
        id: instanceId("instance.building.exchange_2"),
        definitionId: "building.exchange",
        sceneId: null,
        transform: Object.freeze({ x: 0, y: 0, orientation: "front" }),
        styleId: "brass",
        level: 1,
        durability: 100,
        enabled: false,
        stored: true,
        totalInvestmentCopper: 500,
        components: Object.freeze([]),
        worldGeometry: null,
        renderSortY: 0,
      }),
    ]),
  });
}

function inventorySnapshot(revision = 5): InventorySnapshot {
  return Object.freeze({
    schemaVersion: 1,
    revision,
    locations: Object.freeze([
      Object.freeze({
        id: "storage.airship",
        stacks: Object.freeze([
          Object.freeze({
            itemId: "ingredient.tomato",
            locationId: "storage.airship",
            quantity: 7,
            category: "ingredient" as const,
            reservedQuantity: 2,
            availableQuantity: 5,
          }),
        ]),
        instances: Object.freeze([
          Object.freeze({
            id: instanceId("instance.plate.test_1"),
            itemId: "dishware.plate",
            locationId: "storage.airship",
            attributes: Object.freeze({ quality: "clean" }),
            category: "dishware" as const,
            reservationId: null,
          }),
        ]),
        stackCargo: Object.freeze([
          Object.freeze({
            id: instanceId("instance.cargo.tomato_1"),
            itemId: "ingredient.tomato",
            locationId: "storage.airship",
            reservationId: "reservation.order.1",
            category: "ingredient" as const,
          }),
        ]),
        compartments: Object.freeze([
          Object.freeze({
            id: "ingredients",
            capacity: 20,
            occupied: 8,
            reservedCapacity: 2,
            availableCapacity: 10,
          }),
        ]),
      }),
    ]),
    reservations: Object.freeze([]),
    capacityReservations: Object.freeze([]),
  });
}

function dishwareSnapshot(revision = 2): DishwareSnapshot {
  return Object.freeze({
    schemaVersion: 1,
    revision,
    currentUtcMs: 10,
    plates: Object.freeze([]),
    washJobs: Object.freeze([
      Object.freeze({
        id: "wash.1",
        cabinetId: "cabinet.1",
        plateId: instanceId("instance.plate.test_2"),
        startedAtUtcMs: 0,
        completesAtUtcMs: 20,
      }),
    ]),
    initializedSupplyComponentIds: Object.freeze([]),
    processedOperationIds: Object.freeze([]),
    counts: Object.freeze({ clean: 1, in_use: 1, dirty: 1, washing: 1 }),
    totalPlateCount: 4,
  });
}

describe("R3 read models", () => {
  it("projects world geometry without carrying layout occupancy state", () => {
    const model = projectLayoutReadModel(layoutSnapshot());

    expect(model.sourceRevision).toBe(3);
    expect(model.scenes[0]?.sceneId).toBe("scene.ground");
    expect(model.scenes[0]?.buildings[0]).toMatchObject({
      id: "instance.building.cabinet_1",
      x: 40,
      y: 70,
      renderSortY: 80,
    });
    expect(model.scenes[0]?.buildings[0]?.components[0]?.componentId).toBe(
      "subresource.building_cabinet_1.storage",
    );
    expect(model.storedBuildings).toHaveLength(1);
    expect(model).not.toHaveProperty("reservations");
  });

  it("stacks presentation totals while retaining stable instances and transit", () => {
    const model = projectInventoryReadModel(
      inventorySnapshot(),
      dishwareSnapshot(),
    );

    expect(model.locations[0]?.items).toEqual([
      expect.objectContaining({
        itemId: "dishware.plate",
        quantity: 1,
        availableQuantity: 1,
      }),
      expect.objectContaining({
        itemId: "ingredient.tomato",
        quantity: 8,
        reservedQuantity: 3,
        availableQuantity: 5,
        inTransitQuantity: 1,
      }),
    ]);
    expect(model.locations[0]?.instances[0]?.id).toBe("instance.plate.test_1");
    expect(model.dishware).toMatchObject({
      sourceRevision: 2,
      totalPlateCount: 4,
      activeWashJobs: 1,
    });
  });

  it("publishes each functional slice only when its source revision changes", () => {
    let layout = layoutSnapshot(1);
    let inventory = inventorySnapshot(1);
    let dishware = dishwareSnapshot(1);
    const publisher = new R3ReadModelPublisher({
      layout: { getSnapshot: () => layout },
      inventory: { getSnapshot: () => inventory },
      dishware: { getSnapshot: () => dishware },
    });
    const observed: string[] = [];
    const stopLayout = publisher.subscribe("layout", (slice) => {
      observed.push(`${slice.key}:${slice.revision}`);
    });
    const stopInventory = publisher.subscribe("inventory", (slice) => {
      observed.push(`${slice.key}:${slice.revision}`);
    });

    expect(publisher.refresh()).toHaveLength(0);
    inventory = inventorySnapshot(2);
    expect(publisher.refresh().map((slice) => slice.key)).toEqual([
      "inventory",
    ]);
    dishware = dishwareSnapshot(2);
    layout = layoutSnapshot(2);
    expect(publisher.refresh().map((slice) => slice.key)).toEqual([
      "layout",
      "inventory",
    ]);
    expect(observed).toEqual(["inventory:1", "layout:1", "inventory:2"]);

    stopInventory();
    stopLayout();
    publisher.dispose();
  });
  it("publishes recruitment independently when its source revision changes", () => {
    let recruitment: RecruitmentReadModel = {
      sourceRevision: 1,
      currentUtcMs: 0,
      nextFreeRefreshAtUtcMs: 1_000,
      freeRefreshAvailable: false,
      manualRefreshCostCopper: 10,
      recruitedEmployeeCount: 0,
      employeeLimit: 3,
      commandsAvailable: true,
      candidates: [],
      employees: [],
    };
    const publisher = new R3ReadModelPublisher({
      layout: { getSnapshot: () => layoutSnapshot(1) },
      inventory: { getSnapshot: () => inventorySnapshot(1) },
      recruitment: { getSnapshot: () => recruitment },
    });
    const observed: string[] = [];
    const stop = publisher.subscribe("recruitment", (slice) => {
      observed.push(`${slice.key}:${slice.revision}`);
    });

    expect(publisher.get("recruitment")).toMatchObject({
      key: "recruitment",
      value: { sourceRevision: 1, employeeLimit: 3 },
    });
    recruitment = { ...recruitment, sourceRevision: 2, freeRefreshAvailable: true };
    expect(publisher.refresh().map((slice) => slice.key)).toEqual(["recruitment"]);
    expect(observed).toEqual(["recruitment:1"]);
    stop();
    publisher.dispose();
  });
  it("hides spoiler entries and explains permanent versus temporary availability", () => {
    const projected = projectProgressionReadModel({
      revision: 4,
      revealedCount: 2,
      unlockedCount: 1,
      contents: [
        {
          id: "recipe.visible",
          kind: "recipe",
          name: "已知菜品",
          spoilerSensitive: false,
          status: "unlocked",
          unlockSourceIds: ["source.test"],
        },
        {
          id: "route.locked",
          kind: "route",
          name: "已知航线",
          spoilerSensitive: false,
          status: "locked",
          unlockSourceIds: ["source.route"],
        },
        {
          id: "recipe.secret",
          kind: "recipe",
          name: null,
          spoilerSensitive: true,
          status: "hidden",
          unlockSourceIds: [],
        },
      ],
    }, {
      getUnavailableReasons: (_kind, contentId) => contentId === "recipe.visible"
        ? [{ code: "MISSING_DEVICE", message: "缺少所需设备。" }]
        : [],
    });

    expect(projected.sourceRevision).toBe(4);
    expect(projected.contents.map((content) => content.id)).toEqual([
      "recipe.visible",
      "route.locked",
    ]);
    expect(projected.contents[0]).toMatchObject({
      status: "unlocked",
      currentlyUsable: false,
      unavailableReasons: [{ code: "MISSING_DEVICE" }],
    });
    expect(projected.contents[1]).toMatchObject({
      status: "locked",
      currentlyUsable: false,
      unavailableReasons: [{ code: "CONTENT_LOCKED" }],
    });
  });

  it("publishes progression independently when its source revision changes", () => {
    let progression = {
      sourceRevision: 1,
      revealedCount: 1,
      unlockedCount: 1,
      contents: [],
    };
    const publisher = new R3ReadModelPublisher({
      layout: { getSnapshot: () => layoutSnapshot(1) },
      inventory: { getSnapshot: () => inventorySnapshot(1) },
      progression: { getSnapshot: () => progression },
    });
    const observed: string[] = [];
    const stop = publisher.subscribe("progression", (slice) => {
      observed.push(`${slice.key}:${slice.revision}`);
    });

    expect(publisher.get("progression")).toMatchObject({
      key: "progression",
      value: { sourceRevision: 1, unlockedCount: 1 },
    });
    progression = { ...progression, sourceRevision: 2, revealedCount: 2 };
    expect(publisher.refresh().map((slice) => slice.key)).toEqual(["progression"]);
    expect(observed).toEqual(["progression:1"]);
    stop();
    publisher.dispose();
  });
});
