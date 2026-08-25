import { describe, expect, it } from "vitest";
import {
  MovementModule,
  SceneLayoutInteractionTargetResolver,
  SceneLayoutModule,
  instanceId,
  type BuildingRuntimeDefinition,
} from "../src";

const building: BuildingRuntimeDefinition = {
  id: "building.movement_target",
  buildCostCopper: 0,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["default"],
  defaultStyleId: "default",
  defaultOrientation: "front",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [{
    level: 1,
    layouts: {
      front: {
        hardFootprints: [{ x: 0, y: 0, width: 5, height: 5 }],
        visualBounds: { x: 0, y: 0, width: 5, height: 5 },
        interactionAreas: [{ id: "work", bounds: { x: -2, y: 1, width: 2, height: 2 }, required: true }],
      },
    },
    components: [],
    upgradeCostCopper: 0,
    maxDurability: 100,
  }],
};

describe("SceneLayout movement target projection", () => {
  it("resolves the latest interaction area after a building is moved", () => {
    const layout = new SceneLayoutModule([{
      id: "scene.desktop",
      placementRegions: [{ id: "ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 100, height: 100 } }],
    }], [building]);
    const buildingId = instanceId("instance.building.movement_target");
    layout.placeBuilding("place", {
      instanceId: buildingId,
      definitionId: building.id,
      sceneId: "scene.desktop",
      transform: { x: 10, y: 10, orientation: "front" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 0,
    });
    const movement = new MovementModule({
      targetResolver: new SceneLayoutInteractionTargetResolver(layout, () => "area.ground"),
    });
    const characterId = instanceId("instance.character.layout_target");
    movement.registerCharacter("register", characterId, "area.ground", { x: 0, y: 11 });
    movement.beginMovement("begin", {
      characterId,
      taskId: "task.layout-target",
      target: { type: "building", id: buildingId, interactionId: "work" },
      speedUnitsPerSecond: 2,
      occurredAtUtcMs: 0,
    });
    expect(movement.getCharacter(characterId)?.plan?.destination).toEqual({ x: 8, y: 11 });
    layout.moveBuilding("move-building", buildingId, "scene.desktop", { x: 30, y: 10, orientation: "front" }, 500);
    movement.advanceCharacter("advance", characterId, 1_000);
    expect(movement.getCharacter(characterId)).toMatchObject({
      position: { x: 2, y: 11 },
      plan: { destination: { x: 28, y: 11 }, targetRevision: 2 },
    });
  });
});
