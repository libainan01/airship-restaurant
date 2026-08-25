import { describe, expect, it, vi } from "vitest";
import {
  BuildingConstructionModule,
  BuildingUpgradeModule,
  DomainEventBus,
  FinanceModule,
  FleetModule,
  GameRuntime,
  InstanceUpgradeRuntime,
  RuntimeReadModelFacade,
  SceneEditModeController,
  SceneLayoutModule,
  SequentialInstanceIdGenerator,
  instanceId,
  type BuildingRuntimeDefinition,
} from "../src";

const definition: BuildingRuntimeDefinition = {
  id: "building.runtime-upgrade",
  buildCostCopper: 100,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["default", "brass"],
  defaultStyleId: "default",
  defaultOrientation: "front",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [
    {
      level: 1,
      upgradeCostCopper: 0,
      maxDurability: 100,
      capabilityValues: { capacity: 2 },
      components: [],
      layouts: {
        front: {
          hardFootprints: [{ x: 0, y: 0, width: 10, height: 8 }],
          visualBounds: { x: 0, y: 0, width: 10, height: 8 },
          interactionAreas: [],
        },
      },
    },
    {
      level: 2,
      upgradeCostCopper: 200,
      maxDurability: 120,
      capabilityValues: { capacity: 4 },
      components: [],
      layouts: {
        front: {
          hardFootprints: [{ x: 0, y: 0, width: 14, height: 8 }],
          visualBounds: { x: 0, y: 0, width: 14, height: 8 },
          interactionAreas: [],
        },
      },
    },
  ],
};

function setup() {
  const layout = new SceneLayoutModule([{
    id: "scene.runtime-upgrade",
    placementRegions: [{
      id: "region.ground",
      tag: "zone.ground",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    }],
  }], [definition]);
  const placed = layout.placeBuilding("place-runtime-upgrade", {
    instanceId: instanceId("instance.building.runtime_upgrade_1"),
    definitionId: definition.id,
    sceneId: "scene.runtime-upgrade",
    transform: { x: 1, y: 1, orientation: "front" },
    totalInvestmentCopper: 100,
    occurredAtUtcMs: 1,
  });
  if (!placed.accepted) throw new Error(placed.message);
  const finance = new FinanceModule(1_000);
  let now = 2;
  let paused = false;
  const clock = {
    nowUtcMs: () => now,
    isPaused: () => paused,
    pause: () => { paused = true; return true; },
    resume: () => { paused = false; return true; },
  };
  const editMode = new SceneEditModeController(clock);
  const buildingUpgrades = new BuildingUpgradeModule({
    finance,
    layout,
    eventBus: new DomainEventBus(),
    editMode,
  });
  const buildingConstruction = new BuildingConstructionModule({
    finance,
    layout,
    eventBus: new DomainEventBus(),
    instanceIds: new SequentialInstanceIdGenerator("construction-test", 2),
    unlocks: { isBuildingUnlocked: () => true },
    pausePort: { pause: () => "construction-edit", resume: () => undefined },
  });
  const fleet = new FleetModule({
    definitions: [{
      id: "airship.procurement.test",
      name: "测试采购艇",
      purchaseCostCopper: 300,
      defaultStyleId: "style.test",
      styleIds: ["style.test"],
      levels: [
        { level: 1, upgradeCostCopper: 0, cargoCapacity: 4, speedUnitsPerSecond: 20, maxDurability: 100, cooldownEfficiency: 1 },
        { level: 2, upgradeCostCopper: 100, cargoCapacity: 7, speedUnitsPerSecond: 30, maxDurability: 120, cooldownEfficiency: 1.5 },
      ],
    }],
    initialShips: [{ id: "instance.airship.test_1", definitionId: "airship.procurement.test" }],
    captains: { getCaptainSnapshot: () => null },
    routes: { isRouteUnlocked: () => false },
    policy: {
      calculateVoyageDurationMs: () => 1,
      calculateDurabilityLoss: () => 0,
      calculateCooldownDurationMs: () => 0,
    },
    finance,
  });
  const changed = vi.fn();
  const upgrades = new InstanceUpgradeRuntime({
    layout,
    editMode,
    buildingUpgrades,
    buildingConstruction,
    buildingCatalog: [{ definitionId: definition.id, name: "测试设施", unlocked: true }],
    fleet,
    clock,
    onChanged: changed,
  });
  return {
    layout,
    finance,
    upgrades,
    fleet,
    changed,
    buildingId: placed.value.id,
    setNow(value: number) { now = value; },
  };
}

describe("InstanceUpgradeRuntime", () => {
  it("projects current and next building values and drives the preview-confirm command flow", () => {
    const target = setup();
    expect(target.upgrades.getSnapshot().buildings[0]).toMatchObject({
      currentLevel: 1,
      currentCapabilityValues: { capacity: 2 },
      nextLevel: {
        level: 2,
        costCopper: 200,
        capabilityValues: { capacity: 4 },
        footprintWidth: 14,
        footprintHeight: 8,
      },
      activePreview: null,
    });

    expect(target.upgrades.getSnapshot().editMode).toEqual({ active: false, sceneId: null });
    expect(target.upgrades.dispatch({
      id: "enter-runtime-edit-mode",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.runtime-upgrade" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.upgrades.getSnapshot().editMode).toEqual({
      active: true,
      sceneId: "scene.runtime-upgrade",
    });

    expect(target.upgrades.dispatch({
      id: "prepare-runtime-upgrade",
      type: "instance-upgrade.prepare-building",
      payload: { buildingId: target.buildingId, previewId: "preview-runtime-upgrade" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.upgrades.getSnapshot().buildings[0]?.activePreview).toMatchObject({
      id: "preview-runtime-upgrade",
      targetLevel: 2,
      placementValid: true,
    });

    target.setNow(3);
    expect(target.upgrades.dispatch({
      id: "confirm-runtime-upgrade",
      type: "instance-upgrade.confirm-building",
      payload: { previewId: "preview-runtime-upgrade" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.layout.getBuilding(target.buildingId)?.level).toBe(2);
    expect(target.finance.getSnapshot().balanceCopper).toBe(800);
    expect(target.changed).toHaveBeenCalledTimes(3);
    expect(target.upgrades.getSnapshot().buildings[0]).toMatchObject({
      currentLevel: 2,
      nextLevel: null,
      activePreview: null,
    });
  });

  it("pre-reserves construction funds, rejects unaffordable previews, and supports placement editing", () => {
    const target = setup();
    expect(target.upgrades.getSnapshot()).toMatchObject({
      constructionCommandsAvailable: true,
      buildingCatalog: [expect.objectContaining({
        definitionId: definition.id,
        buildCostCopper: 100,
        styleIds: ["default", "brass"],
      })],
    });

    const reserved = target.finance.reserveFunds(
      "reserve-most-funds",
      "reservation.test-blocker",
      950,
      { sourceType: "test", sourceId: "test", regionId: "scene.runtime-upgrade" },
      2,
    );
    expect(reserved.accepted).toBe(true);
    expect(target.upgrades.dispatch({
      id: "enter-construction-edit",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.runtime-upgrade" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.upgrades.dispatch({
      id: "unaffordable-construction",
      type: "building-construction.start-preview",
      payload: {
        previewId: "preview.unaffordable",
        definitionId: definition.id,
        styleId: "brass",
        x: 30,
        y: 1,
        orientation: "front",
      },
    })).toMatchObject({ handled: true, accepted: false });
    expect(target.upgrades.getSnapshot().constructionPreviews).toHaveLength(0);

    expect(target.finance.releaseReservation("release-blocker", "reservation.test-blocker", 2)).toMatchObject({ accepted: true });
    expect(target.upgrades.dispatch({
      id: "start-construction",
      type: "building-construction.start-preview",
      payload: {
        previewId: "preview.construction",
        definitionId: definition.id,
        styleId: "brass",
        x: 30,
        y: 1,
        orientation: "front",
      },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.finance.getSnapshot()).toMatchObject({ balanceCopper: 1_000, reservedCopper: 100, availableCopper: 900 });
    expect(target.upgrades.getSnapshot().constructionPreviews[0]).toMatchObject({ placementValid: true, styleId: "brass" });

    expect(target.upgrades.dispatch({
      id: "confirm-construction",
      type: "building-construction.confirm-preview",
      payload: { previewId: "preview.construction" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.finance.getSnapshot()).toMatchObject({ balanceCopper: 900, reservedCopper: 0, availableCopper: 900 });
    const built = target.layout.getSnapshot().buildings.find((entry) => entry.id !== target.buildingId);
    expect(built).toMatchObject({ styleId: "brass", transform: { x: 30, y: 1, orientation: "front" } });

    expect(target.upgrades.dispatch({
      id: "move-construction",
      type: "building-construction.move-building",
      payload: { buildingId: built!.id, sceneId: "scene.runtime-upgrade", x: 50, y: 1, orientation: "front" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.upgrades.dispatch({
      id: "restyle-construction",
      type: "building-construction.change-style",
      payload: { buildingId: built!.id, styleId: "default" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.layout.getBuilding(built!.id)).toMatchObject({ styleId: "default", transform: { x: 50, y: 1 } });
  });

  it("releases construction reservations when scene editing exits", () => {
    const target = setup();
    expect(target.upgrades.dispatch({
      id: "enter-cancel-edit",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.runtime-upgrade" },
    })).toMatchObject({ accepted: true });
    expect(target.upgrades.dispatch({
      id: "start-cancel-preview",
      type: "building-construction.start-preview",
      payload: {
        previewId: "preview.cancel-on-exit",
        definitionId: definition.id,
        styleId: "default",
        x: 30,
        y: 1,
        orientation: "front",
      },
    })).toMatchObject({ accepted: true });
    expect(target.finance.getSnapshot().reservedCopper).toBe(100);
    expect(target.upgrades.dispatch({
      id: "exit-cancel-edit",
      type: "scene-edit.exit",
      payload: {},
    })).toMatchObject({ accepted: true });
    expect(target.finance.getSnapshot()).toMatchObject({ balanceCopper: 1_000, reservedCopper: 0, availableCopper: 1_000 });
    expect(target.upgrades.getSnapshot().constructionPreviews).toHaveLength(0);
  });
  it("projects and upgrades each procurement airship through the shared instance entry", () => {
    const target = setup();
    expect(target.upgrades.getSnapshot().procurementAirships).toEqual([
      expect.objectContaining({
        id: "instance.airship.test_1",
        name: "测试采购艇",
        currentLevel: 1,
        cargoCapacity: 4,
        durability: 100,
        nextLevel: expect.objectContaining({ level: 2, costCopper: 100, cargoCapacity: 7 }),
      }),
    ]);
    expect(target.upgrades.dispatch({
      id: "upgrade-test-airship",
      type: "instance-upgrade.procurement-airship",
      payload: { shipId: "instance.airship.test_1" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.fleet.exportState().ships[0]).toMatchObject({ level: 2, durability: 100 });
    expect(target.finance.getSnapshot().balanceCopper).toBe(900);
    expect(target.upgrades.getSnapshot().procurementAirships[0]).toMatchObject({
      currentLevel: 2,
      cargoCapacity: 7,
      maxDurability: 120,
      nextLevel: null,
    });
  });
  it("routes extension results and delegates base commands to GameRuntime", () => {
    const target = setup();
    const game = new GameRuntime({ nowUtcMs: () => 10 });
    game.markReady();
    const facade = new RuntimeReadModelFacade(game, null, target.upgrades);

    expect(facade.dispatch({
      id: "missing-cart-upgrade",
      type: "instance-upgrade.procurement-cart",
      payload: { cartId: "cart.missing" },
    })).toMatchObject({
      accepted: false,
      code: "INSTANCE_UPGRADE_REJECTED",
      message: "Procurement cart upgrades are unavailable.",
    });
    expect(facade.dispatch({
      id: "legacy-quiet-command",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    })).toMatchObject({ accepted: true });
    expect(game.getSnapshot().settings.quietMode).toBe(true);
  });
});