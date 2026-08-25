import type { BuildingDefinition } from "@airship-restaurant/content";
import {
  SceneLayoutModule,
  instanceId,
  type BuildingRuntimeDefinition,
  type SceneLayoutState,
  type SceneLayoutDefinition,
} from "@airship-restaurant/core";

const SCENE_WIDTH = 1_920;
const SCENE_HEIGHT = 1_080;
const FOOTPRINT_UNIT = 64;
const DESKTOP_SCENE: SceneLayoutDefinition = Object.freeze({
  id: "scene.desktop",
  placementRegions: Object.freeze([
    Object.freeze({
      id: "region.desktop.airship",
      tag: "zone.airship",
      bounds: Object.freeze({ x: 0, y: 0, width: SCENE_WIDTH, height: 448 }),
    }),
    Object.freeze({
      id: "region.desktop.edge",
      tag: "zone.edge",
      bounds: Object.freeze({ x: 0, y: 448, width: SCENE_WIDTH, height: 192 }),
    }),
    Object.freeze({
      id: "region.desktop.ground",
      tag: "zone.ground",
      bounds: Object.freeze({ x: 0, y: 640, width: SCENE_WIDTH, height: SCENE_HEIGHT - 640 }),
    }),
  ]),
});

function runtimeBuildingDefinition(
  building: BuildingDefinition,
): BuildingRuntimeDefinition {
  return Object.freeze({
    id: building.id,
    buildCostCopper: building.buildCostCopper,
    allowedRegionTags: Object.freeze([...building.placementZoneTags]),
    styleIds: Object.freeze([...building.styleIds]),
    defaultStyleId: building.defaultStyleId,
    defaultOrientation: "front",
    necessary: building.necessary,
    movable: building.movable,
    storable: building.storable,
    removable: building.removable,
    levels: Object.freeze(building.levels.map((level) => {
      const width = level.footprint.width * FOOTPRINT_UNIT;
      const height = level.footprint.height * FOOTPRINT_UNIT;
      const workstationCount = level.capabilityValues["kitchen.workstation-count"] ?? 0;
      const workstationWidth = width / Math.max(1, workstationCount);
      return Object.freeze({
        level: level.level,
        layouts: Object.freeze({
          front: Object.freeze({
            hardFootprints: Object.freeze([
              Object.freeze({ x: 0, y: 0, width, height }),
            ]),
            visualBounds: Object.freeze({ x: 0, y: 0, width, height }),
            interactionAreas: Object.freeze(Array.from(
              { length: workstationCount },
              (_, index) => Object.freeze({
                id: `interaction.workstation.${index + 1}`,
                bounds: Object.freeze({
                  x: workstationWidth * index,
                  y: height * 0.75,
                  width: workstationWidth,
                  height: height * 0.25,
                }),
                required: false,
              }),
            )),
          }),
        }),
        components: Object.freeze(
          (building.componentSlots ?? []).map((slot) => Object.freeze({
            slotId: slot.slotId,
            capabilityId: slot.capabilityId,
          })),
        ),
        upgradeCostCopper: level.upgradeCostCopper,
        maxDurability: level.maxDurability,
        capabilityValues: Object.freeze({ ...level.capabilityValues }),
      });
    })),
  });
}

const DEFAULT_BUILDING_INSTANCES = Object.freeze([
  ["ground_exchange", "building.ground_exchange_station", 128, 800],
  ["airship_exchange", "building.airship_exchange_station", 128, 128],
  ["dish_cabinet", "building.dish_cabinet", 400, 800],
  ["waiting_area", "building.waiting_area", 600, 850],
  ["prep_station", "building.prep_station", 320, 128],
  ["pan_fry_station", "building.pan_fry_station", 512, 128],
  ["steam_boil_station", "building.steam_boil_station", 704, 128],
  ["baking_station", "building.baking_station", 896, 128],
  ["plating_station", "building.plating_station", 1088, 128],
  ["personnel_elevator", "building.personnel_elevator", 1450, 500],
  ["cargo_lift_1", "building.cargo_lift", 1550, 500],
  ["cargo_lift_2", "building.cargo_lift", 1620, 500],
  ["cargo_lift_3", "building.cargo_lift", 1690, 500],
  ["cargo_lift_4", "building.cargo_lift", 1760, 500],
] as const);
export function createR3SceneLayout(
  buildings: readonly BuildingDefinition[],
  initialState?: SceneLayoutState,
): SceneLayoutModule {
  const layout = new SceneLayoutModule(
    [DESKTOP_SCENE],
    buildings.map(runtimeBuildingDefinition),
    undefined,
    initialState,
  );
  if (initialState !== undefined) return layout;
  for (const [seedId, definitionId, x, y] of DEFAULT_BUILDING_INSTANCES) {
    const placed = layout.placeBuilding(`seed-layout-${seedId}`, {
      instanceId: instanceId(`instance.building.${seedId}`),
      definitionId,
      sceneId: DESKTOP_SCENE.id,
      transform: { x, y, orientation: "front" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 0,
    });
    if (!placed.accepted) {
      throw new Error(`Unable to seed ${definitionId}: ${placed.message}`);
    }
  }
  return layout;
}