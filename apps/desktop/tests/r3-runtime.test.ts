import { createM2ContentRegistry } from "@airship-restaurant/content";
import { instanceId, type SceneLayoutState } from "@airship-restaurant/core";
import { describe, expect, it } from "vitest";
import { createR3SceneLayout } from "../src/main/r3-runtime";

const EMPTY_LAYOUT: SceneLayoutState = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  buildings: Object.freeze([]),
  processedOperationIds: Object.freeze([]),
});

describe("R3 desktop composition", () => {
  it("builds runtime layout definitions from the validated building catalog", () => {
    const content = createM2ContentRegistry();
    const layout = createR3SceneLayout(content.listBuildings(), EMPTY_LAYOUT);
    const buildingId = instanceId("instance.building.r3_test");
    expect(layout.getDefinition("building.ground_exchange_station")?.levels).toHaveLength(1);
    expect(layout.getDefinition("building.airship_exchange_station")?.levels[1]).toMatchObject({
      level: 2,
      upgradeCostCopper: 120,
      maxDurability: 120,
      layouts: { front: { visualBounds: { width: 128, height: 128 } } },
    });
    expect(layout.getDefinition("building.waiting_area")?.levels).toHaveLength(2);
    expect(layout.getDefinition("building.pan_fry_station")?.levels[0]?.layouts.front.interactionAreas).toEqual([
      expect.objectContaining({ id: "interaction.workstation.1", required: false }),
    ]);

    expect(layout.placeBuilding("reject-ground-on-airship", {
      instanceId: instanceId("instance.building.invalid_ground"),
      definitionId: "building.ground_exchange_station",
      sceneId: "scene.desktop",
      transform: { x: 100, y: 100, orientation: "front" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 0,
    }).accepted).toBe(false);
    expect(layout.placeBuilding("reject-airship-on-ground", {
      instanceId: instanceId("instance.building.invalid_airship"),
      definitionId: "building.airship_exchange_station",
      sceneId: "scene.desktop",
      transform: { x: 100, y: 700, orientation: "front" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 0,
    }).accepted).toBe(false);

    expect(layout.placeBuilding("place-r3-test", {
      instanceId: buildingId,
      definitionId: "building.ground_exchange_station",
      sceneId: "scene.desktop",
      transform: { x: 100, y: 700, orientation: "front" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 0,
    }).accepted).toBe(true);

    expect(layout.getSnapshot().buildings[0]).toMatchObject({
      id: buildingId,
      sceneId: "scene.desktop",
      capabilityValues: { "storage.total-capacity": 9999 },
      worldGeometry: {
        hardFootprints: [{ width: 192, height: 128 }],
      },
    });
  });

  it("seeds a stable starter layout with four cargo lifts and restores it without reseeding", () => {
    const content = createM2ContentRegistry();
    const seeded = createR3SceneLayout(content.listBuildings());
    expect(seeded.getSnapshot().buildings).toHaveLength(14);
    expect(seeded.getSnapshot().buildings.filter((entry) => entry.definitionId === "building.cargo_lift")).toHaveLength(4);
    expect(seeded.getBuilding("instance.building.waiting_area")).toMatchObject({ level: 1 });

    const restored = createR3SceneLayout(content.listBuildings(), seeded.exportState());
    expect(restored.exportState()).toEqual(seeded.exportState());
  });
});