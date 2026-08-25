import { describe, expect, it } from "vitest";
import {
  SceneLayoutModule,
  instanceId,
  type BuildingRuntimeDefinition,
  type BuildingTransitionConstraintPort,
} from "../src";

const scene = {
  id: "scene.greyfeather",
  placementRegions: [
    { id: "region.ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "region.airship", tag: "zone.airship", bounds: { x: 120, y: 0, width: 80, height: 100 } },
  ],
} as const;

function definition(
  id = "building.test",
  necessary = false,
): BuildingRuntimeDefinition {
  return {
    id,
    buildCostCopper: 800,
    allowedRegionTags: ["zone.ground"],
    styleIds: ["style.default", "style.blue"],
    defaultStyleId: "style.default",
    defaultOrientation: "normal",
    necessary,
    movable: true,
    storable: !necessary,
    removable: !necessary,
    levels: [
      {
        level: 1,
        upgradeCostCopper: 0,
        maxDurability: 100,
        components: [{ slotId: "slot.storage", capabilityId: "capability.storage" }],
        layouts: {
          normal: {
            hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
            visualBounds: { x: -1, y: -3, width: 12, height: 13 },
            interactionAreas: [{ id: "interaction.front", bounds: { x: 10, y: 2, width: 5, height: 6 }, required: true }],
          },
          mirrored: {
            hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
            visualBounds: { x: -1, y: -3, width: 12, height: 13 },
            interactionAreas: [{ id: "interaction.front", bounds: { x: -5, y: 2, width: 5, height: 6 }, required: true }],
          },
        },
      },
      {
        level: 2,
        upgradeCostCopper: 400,
        maxDurability: 120,
        components: [
          { slotId: "slot.storage", capabilityId: "capability.storage" },
          { slotId: "slot.washing", capabilityId: "capability.dish_washing" },
        ],
        layouts: {
          normal: {
            hardFootprints: [{ x: 0, y: 0, width: 14, height: 10 }],
            visualBounds: { x: -1, y: -3, width: 16, height: 13 },
            interactionAreas: [{ id: "interaction.front", bounds: { x: 14, y: 2, width: 5, height: 6 }, required: true }],
          },
          mirrored: {
            hardFootprints: [{ x: 0, y: 0, width: 14, height: 10 }],
            visualBounds: { x: -1, y: -3, width: 16, height: 13 },
            interactionAreas: [{ id: "interaction.front", bounds: { x: -5, y: 2, width: 5, height: 6 }, required: true }],
          },
        },
      },
    ],
  };
}

function place(
  layout: SceneLayoutModule,
  operationId: string,
  id: string,
  x: number,
  y = 10,
  definitionId = "building.test",
) {
  return layout.placeBuilding(operationId, {
    instanceId: instanceId(id),
    definitionId,
    sceneId: scene.id,
    transform: { x, y, orientation: "normal" },
    totalInvestmentCopper: 800,
    occurredAtUtcMs: 10,
  });
}

describe("SceneLayoutModule", () => {
  it("validates 2D region, hard footprint, and required interaction areas without creating navigation obstacles", () => {
    const layout = new SceneLayoutModule([scene], [definition()]);
    expect(place(layout, "place-a", "instance.building.test_a", 0)).toMatchObject({ accepted: true });
    expect(place(layout, "place-overlap", "instance.building.test_b", 5)).toMatchObject({
      accepted: false,
      code: "HARD_FOOTPRINT_OVERLAP",
    });
    expect(place(layout, "place-block-interaction", "instance.building.test_c", 12)).toMatchObject({
      accepted: false,
      code: "INTERACTION_AREA_BLOCKED",
    });
    expect(place(layout, "place-outside", "instance.building.test_d", 95)).toMatchObject({
      accepted: false,
      code: "OUTSIDE_ALLOWED_REGION",
    });
    expect(place(layout, "place-valid", "instance.building.test_e", 20)).toMatchObject({ accepted: true });
  });

  it("moves and restyles the same instance while component ids remain stable", () => {
    const layout = new SceneLayoutModule([scene], [definition()]);
    const placed = place(layout, "place", "instance.building.movable_1", 0);
    if (!placed.accepted) throw new Error(placed.message);
    const componentId = placed.value.components[0]?.componentId;
    const moved = layout.moveBuilding(
      "move",
      placed.value.id,
      scene.id,
      { x: 40, y: 30, orientation: "mirrored" },
      20,
    );
    expect(moved).toMatchObject({
      accepted: true,
      value: { id: placed.value.id, transform: { x: 40, y: 30, orientation: "mirrored" } },
    });
    expect(moved.accepted && moved.value.components[0]?.componentId).toBe(componentId);
    expect(layout.changeStyle("style", placed.value.id, "style.blue", 21)).toMatchObject({
      accepted: true,
      value: { id: placed.value.id, styleId: "style.blue" },
    });
  });

  it("upgrades layout and capabilities but retains component ids for unchanged definition slots", () => {
    const layout = new SceneLayoutModule([scene], [definition()]);
    const placed = place(layout, "place", "instance.building.upgrade_1", 30);
    if (!placed.accepted) throw new Error(placed.message);
    const storageId = placed.value.components[0]?.componentId;
    const upgraded = layout.upgradeBuilding("upgrade", placed.value.id, 2, 400, 30);
    expect(upgraded).toMatchObject({
      accepted: true,
      value: { level: 2, totalInvestmentCopper: 1_200 },
    });
    expect(upgraded.accepted && upgraded.value.components).toHaveLength(2);
    expect(upgraded.accepted && upgraded.value.components[0]?.componentId).toBe(storageId);
    expect(layout.getSnapshot().buildings[0]?.worldGeometry?.hardFootprints[0]?.width).toBe(14);
  });

  it("uses capability-module constraints to block busy upgrades, storage, removal, and disabling", () => {
    let reason: string | null = "device is busy";
    const constraints: BuildingTransitionConstraintPort = {
      validate: () => reason === null ? [] : [reason],
    };
    const layout = new SceneLayoutModule([scene], [definition()], constraints);
    const placed = place(layout, "place", "instance.building.busy_1", 30);
    if (!placed.accepted) throw new Error(placed.message);
    expect(layout.upgradeBuilding("upgrade-busy", placed.value.id, 2, 400, 40)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
      issues: ["device is busy"],
    });
    expect(layout.storeBuilding("store-busy", placed.value.id, 41)).toMatchObject({ accepted: false });
    expect(layout.removeBuilding("remove-busy", placed.value.id, 42)).toMatchObject({ accepted: false });
    expect(layout.setEnabled("disable-busy", placed.value.id, false, 43)).toMatchObject({ accepted: false });

    reason = null;
    const stored = layout.storeBuilding("store", placed.value.id, 44);
    expect(stored).toMatchObject({ accepted: true, value: { stored: true, sceneId: null } });
    expect(layout.getSnapshot().buildings[0]?.worldGeometry).toBeNull();
    expect(layout.moveBuilding(
      "replace",
      placed.value.id,
      scene.id,
      { x: 50, y: 50, orientation: "normal" },
      45,
    )).toMatchObject({ accepted: true, value: { stored: false, id: placed.value.id } });
  });

  it("never stores or removes necessary facilities and restores saved geometry deterministically", () => {
    const necessary = definition("building.exchange", true);
    const layout = new SceneLayoutModule([scene], [necessary]);
    const placed = place(
      layout,
      "place",
      "instance.building.exchange_1",
      40,
      10,
      necessary.id,
    );
    if (!placed.accepted) throw new Error(placed.message);
    expect(layout.storeBuilding("store", placed.value.id, 50)).toMatchObject({
      accepted: false,
      code: "BUILDING_IS_NECESSARY",
    });
    expect(layout.removeBuilding("remove", placed.value.id, 51)).toMatchObject({
      accepted: false,
      code: "BUILDING_IS_NECESSARY",
    });

    const restored = new SceneLayoutModule([scene], [necessary], undefined, layout.exportState());
    expect(restored.getSnapshot()).toEqual(layout.getSnapshot());
  });
});
