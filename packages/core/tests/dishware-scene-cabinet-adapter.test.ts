import { describe, expect, it } from "vitest";
import {
  DishwareModule,
  InventoryModule,
  SceneDishwareCabinetAdapter,
  SceneLayoutModule,
  StaticInventoryStorageDefinitions,
  instanceId,
  type BuildingRuntimeDefinition,
} from "../src";

const scene = {
  id: "scene.dishware",
  placementRegions: [{ id: "region.ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 100, height: 100 } }],
} as const;

const slots = [
  { slotId: "slot.dish_supply", capabilityId: "capability.dish_supply" },
  { slotId: "slot.clean", capabilityId: "capability.clean_dish_storage" },
  { slotId: "slot.dirty", capabilityId: "capability.dirty_dish_storage" },
  { slotId: "slot.washing", capabilityId: "capability.dish_washing" },
] as const;

const cabinetBuilding: BuildingRuntimeDefinition = {
  id: "building.dish_cabinet",
  buildCostCopper: 100,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["default"],
  defaultStyleId: "default",
  defaultOrientation: "front",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [1, 2].map((level) => ({
    level,
    upgradeCostCopper: level === 1 ? 0 : 100,
    maxDurability: level === 1 ? 100 : 120,
    components: slots,
    capabilityValues: {
      "dishware.plate-count": level === 1 ? 4 : 6,
      "dishware.parallel-wash-count": level === 1 ? 2 : 3,
      "dishware.wash-duration-ms": level === 1 ? 10 : 8,
    },
    layouts: {
      front: {
        hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
        visualBounds: { x: 0, y: 0, width: 10, height: 10 },
        interactionAreas: [],
      },
    },
  })),
};

describe("SceneDishwareCabinetAdapter", () => {
  it("projects current level values, reports expansion needs and protects owned plates", () => {
    const adapter = new SceneDishwareCabinetAdapter([{
      buildingDefinitionId: cabinetBuilding.id,
      supplySlotId: "slot.dish_supply",
      cleanStorageSlotId: "slot.clean",
      dirtyStorageSlotId: "slot.dirty",
      washingSlotId: "slot.washing",
      plateCountValueKey: "dishware.plate-count",
      washDurationValueKey: "dishware.wash-duration-ms",
      parallelWashCountValueKey: "dishware.parallel-wash-count",
    }]);
    const layout = new SceneLayoutModule([scene], [cabinetBuilding], adapter);
    adapter.attachLayout(layout);
    const placed = layout.placeBuilding("place-cabinet", {
      instanceId: instanceId("instance.building.dish_cabinet"),
      definitionId: cabinetBuilding.id,
      sceneId: scene.id,
      transform: { x: 10, y: 10, orientation: "front" },
      totalInvestmentCopper: 100,
      occurredAtUtcMs: 1,
    });
    if (!placed.accepted) throw new Error(placed.message);
    const initial = adapter.listCabinets()[0]!;
    const inventory = new InventoryModule(
      [{ id: "dishware.plate", category: "dishware", storageMode: "instance" }],
      new StaticInventoryStorageDefinitions([
        { id: initial.cleanStorageLocationId, compartments: [{ id: "clean", capacity: 6, acceptedCategories: ["dishware"] }] },
        { id: initial.dirtyStorageLocationId, compartments: [{ id: "dirty", capacity: 6, acceptedCategories: ["dishware"] }] },
        { id: initial.washingLocationId, compartments: [{ id: "washing", capacity: 3, acceptedCategories: ["dishware"] }] },
      ]),
    );
    const dishware = new DishwareModule({
      inventory,
      plateItemId: "dishware.plate",
      cabinetDefinitions: adapter,
    });
    adapter.attachRuntime(dishware);
    const initialPlateIds = [1, 2, 3, 4].map((value) =>
      instanceId("instance.dishware.scene_" + value)
    );
    expect(dishware.initializeSupply("initialize-scene", initial.supplyComponentId, initialPlateIds, 2)).toMatchObject({ accepted: true });
    expect(adapter.listSupplyExpansionNeeds()).toEqual([]);

    const componentIds = placed.value.components.map((component) => component.componentId);
    expect(layout.upgradeBuilding("upgrade-cabinet", placed.value.id, 2, 100, 3)).toMatchObject({ accepted: true });
    expect(layout.getBuilding(placed.value.id)?.components.map((component) => component.componentId)).toEqual(componentIds);
    expect(adapter.listCabinets()[0]).toMatchObject({
      suppliedPlateCount: 6,
      washDurationMs: 8,
      parallelWashCount: 3,
    });
    expect(adapter.listSupplyExpansionNeeds()).toMatchObject([{
      currentPlateCount: 4,
      targetPlateCount: 6,
      missingPlateCount: 2,
    }]);

    const addedPlateIds = [5, 6].map((value) => instanceId("instance.dishware.scene_" + value));
    expect(dishware.expandSupply("expand-scene", initial.supplyComponentId, addedPlateIds, 4)).toMatchObject({ accepted: true });
    expect(adapter.listSupplyExpansionNeeds()).toEqual([]);
    expect(layout.removeBuilding("remove-owned-cabinet", placed.value.id, 5)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });
  });
});