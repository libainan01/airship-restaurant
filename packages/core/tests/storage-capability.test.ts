import { describe, expect, it } from "vitest";
import {
  InventoryModule,
  SceneLayoutModule,
  StorageCapabilityAdapter,
  instanceId,
  type BuildingRuntimeDefinition,
  type InventoryItemDefinition,
  type StorageCapabilityLevelDefinition,
} from "../src";

const scene = {
  id: "scene.demo",
  placementRegions: [
    { id: "region.ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "region.airship", tag: "zone.airship", bounds: { x: 120, y: 0, width: 100, height: 100 } },
  ],
} as const;

const items: readonly InventoryItemDefinition[] = [
  { id: "ingredient.tomato", category: "ingredient", storageMode: "stack" },
  { id: "dishware.plate", category: "dishware", storageMode: "instance" },
  { id: "meal.tomato_egg", category: "meal", storageMode: "instance" },
];

function layoutVariant() {
  return {
    hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
    visualBounds: { x: 0, y: 0, width: 10, height: 10 },
    interactionAreas: [{ id: "front", bounds: { x: 10, y: 2, width: 4, height: 4 }, required: true }],
  };
}

const groundDefinition: BuildingRuntimeDefinition = {
  id: "building.ground_exchange",
  buildCostCopper: 0,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["style.default"],
  defaultStyleId: "style.default",
  defaultOrientation: "normal",
  necessary: true,
  movable: true,
  storable: false,
  removable: false,
  levels: [{
    level: 1,
    upgradeCostCopper: 0,
    maxDurability: 100,
    components: [{ slotId: "slot.storage", capabilityId: "capability.storage" }],
    layouts: { normal: layoutVariant() },
  }],
};

const airshipDefinition: BuildingRuntimeDefinition = {
  id: "building.airship_exchange",
  buildCostCopper: 0,
  allowedRegionTags: ["zone.airship"],
  styleIds: ["style.default"],
  defaultStyleId: "style.default",
  defaultOrientation: "normal",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [1, 2].map((level) => ({
    level,
    upgradeCostCopper: level === 1 ? 0 : 100,
    maxDurability: 100,
    capabilityValues: {
      "storage.ingredient-capacity": level === 1 ? 4 : 2,
      "storage.dishware-capacity": level === 1 ? 2 : 4,
      "storage.meal-capacity": level === 1 ? 1 : 2,
    },
    components: [
      { slotId: "slot.ingredients", capabilityId: "capability.storage" },
      { slotId: "slot.plates", capabilityId: "capability.storage" },
      { slotId: "slot.meals", capabilityId: "capability.storage" },
    ],
    layouts: { normal: layoutVariant() },
  })),
};

const cabinetDefinition: BuildingRuntimeDefinition = {
  id: "building.cabinet",
  buildCostCopper: 0,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["style.default"],
  defaultStyleId: "style.default",
  defaultOrientation: "normal",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [{
    level: 1,
    upgradeCostCopper: 0,
    maxDurability: 100,
    components: [
      { slotId: "slot.clean_plates", capabilityId: "capability.storage" },
      { slotId: "slot.dirty_plates", capabilityId: "capability.storage" },
    ],
    layouts: { normal: layoutVariant() },
  }],
};

const storageDefinitions: readonly StorageCapabilityLevelDefinition[] = [
  {
    buildingDefinitionId: groundDefinition.id,
    level: 1,
    slotId: "slot.storage",
    compartments: [{
      id: "mixed",
      capacity: 10_000,
      acceptedCategories: ["ingredient", "dishware", "meal"],
    }],
  },
  ...[1, 2].flatMap((level): StorageCapabilityLevelDefinition[] => [
    {
      buildingDefinitionId: airshipDefinition.id,
      level,
      slotId: "slot.ingredients",
      compartments: [{ id: "ingredients", capacity: 0, capacityValueKey: "storage.ingredient-capacity", acceptedCategories: ["ingredient"] }],
    },
    {
      buildingDefinitionId: airshipDefinition.id,
      level,
      slotId: "slot.plates",
      compartments: [{ id: "plates", capacity: 0, capacityValueKey: "storage.dishware-capacity", acceptedCategories: ["dishware"] }],
    },
    {
      buildingDefinitionId: airshipDefinition.id,
      level,
      slotId: "slot.meals",
      compartments: [{ id: "meals", capacity: 0, capacityValueKey: "storage.meal-capacity", acceptedCategories: ["meal"] }],
    },
  ]),
  {
    buildingDefinitionId: cabinetDefinition.id,
    level: 1,
    slotId: "slot.clean_plates",
    compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }],
  },
  {
    buildingDefinitionId: cabinetDefinition.id,
    level: 1,
    slotId: "slot.dirty_plates",
    compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }],
  },
];

function createModules() {
  const adapter = new StorageCapabilityAdapter(storageDefinitions);
  const layout = new SceneLayoutModule(
    [scene],
    [groundDefinition, airshipDefinition, cabinetDefinition],
    adapter,
  );
  adapter.attachLayout(layout);
  const ground = layout.placeBuilding("place-ground", {
    instanceId: instanceId("instance.building.ground_1"),
    definitionId: groundDefinition.id,
    sceneId: scene.id,
    transform: { x: 10, y: 10, orientation: "normal" },
    totalInvestmentCopper: 0,
    occurredAtUtcMs: 1,
  });
  const airship = layout.placeBuilding("place-airship", {
    instanceId: instanceId("instance.building.airship_1"),
    definitionId: airshipDefinition.id,
    sceneId: scene.id,
    transform: { x: 130, y: 10, orientation: "normal" },
    totalInvestmentCopper: 0,
    occurredAtUtcMs: 2,
  });
  const cabinet = layout.placeBuilding("place-cabinet", {
    instanceId: instanceId("instance.building.cabinet_1"),
    definitionId: cabinetDefinition.id,
    sceneId: scene.id,
    transform: { x: 40, y: 10, orientation: "normal" },
    totalInvestmentCopper: 0,
    occurredAtUtcMs: 3,
  });
  if (!ground.accepted || !airship.accepted || !cabinet.accepted) throw new Error("Fixture placement failed.");
  const inventory = new InventoryModule(items, adapter);
  adapter.attachInventory(inventory);
  return { adapter, layout, inventory, ground: ground.value, airship: airship.value, cabinet: cabinet.value };
}

describe("StorageCapabilityAdapter", () => {
  it("projects ground, airship, and cabinet component parameters without owning inventory", () => {
    const { adapter, airship, cabinet, ground } = createModules();
    const byId = new Map(adapter.listLocations().map((location) => [location.id, location]));
    expect(byId.get(ground.components[0]!.componentId)?.compartments[0]).toMatchObject({
      id: "mixed",
      capacity: 10_000,
      acceptedCategories: ["ingredient", "dishware", "meal"],
    });
    expect(airship.components.map((component) => byId.get(component.componentId)?.compartments[0]?.id)).toEqual([
      "ingredients",
      "plates",
      "meals",
    ]);
    expect(cabinet.components.map((component) => byId.get(component.componentId)?.compartments[0]?.id)).toEqual([
      "clean",
      "dirty",
    ]);
  });

  it("keeps a component-backed inventory location stable when its building moves", () => {
    const { adapter, layout, airship } = createModules();
    const before = airship.components[0]!.componentId;
    expect(layout.moveBuilding(
      "move-airship",
      airship.id,
      scene.id,
      { x: 160, y: 30, orientation: "normal" },
      4,
    )).toMatchObject({ accepted: true });
    expect(adapter.getLocation(before)?.id).toBe(before);
  });

  it("blocks storage removal while the component still owns inventory", () => {
    const { layout, inventory, airship } = createModules();
    const ingredientStorageId = airship.components[0]!.componentId;
    inventory.depositStack("stock", ingredientStorageId, [{ itemId: "ingredient.tomato", quantity: 1 }], 4);
    expect(layout.storeBuilding("store-airship", airship.id, 5)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });
    expect(layout.removeBuilding("remove-airship", airship.id, 6)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });
  });

  it("blocks an upgrade that would shrink below current occupancy or capacity reservations", () => {
    const { layout, inventory, airship } = createModules();
    const ingredientStorageId = airship.components[0]!.componentId;
    inventory.depositStack("stock", ingredientStorageId, [{ itemId: "ingredient.tomato", quantity: 3 }], 4);
    expect(layout.upgradeBuilding("upgrade", airship.id, 2, 100, 5)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });
    expect(layout.getBuilding(airship.id)?.level).toBe(1);
  });
  it("reads compartment capacities from the current building level capability values", () => {
    const { adapter, layout, airship } = createModules();
    const [ingredientComponent, plateComponent, mealComponent] = airship.components;
    expect(adapter.getLocation(ingredientComponent!.componentId)?.compartments[0]?.capacity).toBe(4);

    expect(layout.upgradeBuilding("upgrade-empty-storage", airship.id, 2, 100, 5)).toMatchObject({ accepted: true });
    expect(adapter.getLocation(ingredientComponent!.componentId)?.compartments[0]?.capacity).toBe(2);
    expect(adapter.getLocation(plateComponent!.componentId)?.compartments[0]?.capacity).toBe(4);
    expect(adapter.getLocation(mealComponent!.componentId)?.compartments[0]?.capacity).toBe(2);
  });
});
