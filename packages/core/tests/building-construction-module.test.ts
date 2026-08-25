import { describe, expect, it, vi } from "vitest";
import {
  BuildingConstructionModule,
  DomainEventBus,
  FinanceModule,
  ProgressionModule,
  SceneLayoutModule,
  SequentialInstanceIdGenerator,
  instanceId,
  type BuildingRuntimeDefinition,
} from "../src";

const scene = {
  id: "scene.test",
  placementRegions: [{
    id: "region.ground",
    tag: "zone.ground",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  }],
} as const;

const building: BuildingRuntimeDefinition = {
  id: "building.test",
  buildCostCopper: 800,
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
    components: [{ slotId: "slot.storage", capabilityId: "capability.storage" }],
    layouts: {
      normal: {
        hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }],
        visualBounds: { x: 0, y: 0, width: 10, height: 10 },
        interactionAreas: [{ id: "interaction.front", bounds: { x: 10, y: 2, width: 4, height: 5 }, required: true }],
      },
    },
  }],
};

function setup(balance = 1_000) {
  const finance = new FinanceModule(balance);
  const layout = new SceneLayoutModule([scene], [building]);
  const bus = new DomainEventBus();
  const pause = vi.fn(() => "pause.edit-mode");
  const resume = vi.fn();
  let unlocked = true;
  const construction = new BuildingConstructionModule({
    finance,
    layout,
    eventBus: bus,
    instanceIds: new SequentialInstanceIdGenerator("construction"),
    unlocks: { isBuildingUnlocked: () => unlocked },
    pausePort: { pause, resume },
  });
  return {
    finance,
    layout,
    bus,
    pause,
    resume,
    construction,
    setUnlocked(value: boolean) { unlocked = value; },
  };
}

describe("BuildingConstructionModule", () => {
  it("pauses simulation, reserves preview funds immediately, and prevents multiple previews from overspending", () => {
    const target = setup();
    expect(target.construction.enterEditMode("enter", scene.id, 1)).toMatchObject({ accepted: true });
    expect(target.pause).toHaveBeenCalledWith("scene-edit-mode");
    expect(target.construction.startPreview("start-a", "preview.a", building.id, {
      occurredAtUtcMs: 2,
    })).toMatchObject({ accepted: true, value: { costCopper: 800 } });
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: 1_000,
      reservedCopper: 800,
      availableCopper: 200,
    });
    expect(target.construction.startPreview("start-b", "preview.b", building.id, {
      occurredAtUtcMs: 3,
    })).toMatchObject({ accepted: false, code: "INSUFFICIENT_FUNDS" });
    expect(target.construction.startPreview("start-free", "preview.free", building.id, {
      occurredAtUtcMs: 4,
      free: true,
    })).toMatchObject({ accepted: true, value: { costCopper: 0, reservationId: null } });
    expect(target.construction.getSnapshot().previews).toHaveLength(2);
  });

  it("atomically converts a reservation to expense and creates one stable building on confirmation", () => {
    const target = setup();
    target.construction.enterEditMode("enter", scene.id, 1);
    const started = target.construction.startPreview("start", "preview.confirm", building.id, {
      occurredAtUtcMs: 2,
    });
    if (!started.accepted) throw new Error(started.message);
    expect(target.construction.updatePreviewPlacement(
      "position",
      started.value.id,
      { x: 20, y: 20, orientation: "normal" },
      3,
    )).toMatchObject({ accepted: true, value: { placement: { valid: true } } });
    const confirmed = target.construction.confirmPreview("confirm", started.value.id, 4);
    expect(confirmed).toMatchObject({
      accepted: true,
      value: {
        id: started.value.buildingInstanceId,
        totalInvestmentCopper: 800,
      },
    });
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: 200,
      reservedCopper: 0,
      ledger: [{ category: "building-purchase", amountCopper: -800 }],
    });
    expect(target.layout.getSnapshot().buildings).toHaveLength(1);
    expect(target.construction.getSnapshot().previews).toHaveLength(0);
  });

  it("revalidates at confirmation and releases the reservation when another building took the location", () => {
    const target = setup();
    target.construction.enterEditMode("enter", scene.id, 1);
    const started = target.construction.startPreview("start", "preview.race", building.id, {
      occurredAtUtcMs: 2,
    });
    if (!started.accepted) throw new Error(started.message);
    target.construction.updatePreviewPlacement(
      "position",
      started.value.id,
      { x: 30, y: 30, orientation: "normal" },
      3,
    );
    expect(target.layout.placeBuilding("external-place", {
      instanceId: instanceId("instance.building.external_1"),
      definitionId: building.id,
      sceneId: scene.id,
      transform: { x: 30, y: 30, orientation: "normal" },
      totalInvestmentCopper: 0,
      occurredAtUtcMs: 4,
    })).toMatchObject({ accepted: true });

    expect(target.construction.confirmPreview("confirm-race", started.value.id, 5)).toMatchObject({
      accepted: false,
      code: "PLACEMENT_INVALID",
    });
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: 1_000,
      reservedCopper: 0,
      ledger: [],
    });
    expect(target.layout.getSnapshot().buildings).toHaveLength(1);
    expect(target.construction.getSnapshot().previews).toHaveLength(0);
  });

  it("cancels every pending preview before resuming simulation on edit-mode exit", () => {
    const target = setup(2_000);
    target.construction.enterEditMode("enter", scene.id, 1);
    target.construction.startPreview("start-a", "preview.a", building.id, { occurredAtUtcMs: 2 });
    target.construction.startPreview("start-b", "preview.b", building.id, { occurredAtUtcMs: 3 });
    expect(target.finance.getSnapshot().reservedCopper).toBe(1_600);

    expect(target.construction.exitEditMode("exit", 4)).toMatchObject({ accepted: true });
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: 2_000,
      reservedCopper: 0,
      ledger: [],
    });
    expect(target.construction.getSnapshot()).toMatchObject({
      editModeSceneId: null,
      previews: [],
    });
    expect(target.resume).toHaveBeenCalledWith("pause.edit-mode");
  });

  it("does not create a preview when the building is locked and discards one if it becomes locked before confirmation", () => {
    const target = setup();
    target.construction.enterEditMode("enter", scene.id, 1);
    target.setUnlocked(false);
    expect(target.construction.startPreview("locked", "preview.locked", building.id, {
      occurredAtUtcMs: 2,
    })).toMatchObject({ accepted: false, code: "BUILDING_LOCKED" });

    target.setUnlocked(true);
    const started = target.construction.startPreview("start", "preview.relocked", building.id, {
      occurredAtUtcMs: 3,
    });
    if (!started.accepted) throw new Error(started.message);
    target.construction.updatePreviewPlacement(
      "position",
      started.value.id,
      { x: 50, y: 50, orientation: "normal" },
      4,
    );
    target.setUnlocked(false);
    expect(target.construction.confirmPreview("confirm", started.value.id, 5)).toMatchObject({
      accepted: false,
      code: "BUILDING_LOCKED",
    });
    expect(target.finance.getSnapshot().reservedCopper).toBe(0);
    expect(target.construction.getSnapshot().previews).toHaveLength(0);
  });
  it("uses the shared progression module as the building unlock authority", () => {
    const finance = new FinanceModule(1_000);
    const layout = new SceneLayoutModule([scene], [building]);
    const progression = new ProgressionModule({
      definitions: [{
        id: building.id,
        kind: "building",
        name: "测试建筑",
        spoilerSensitive: false,
        initiallyRevealed: true,
        initiallyUnlocked: false,
        revealSources: [],
        unlockSources: [{
          id: "source.story_reward",
          requirements: [{ kind: "fact", factId: "story.reward.received" }],
        }],
      }],
      facts: { getFactValue: () => null },
    });
    const construction = new BuildingConstructionModule({
      finance,
      layout,
      eventBus: new DomainEventBus(),
      instanceIds: new SequentialInstanceIdGenerator("progression"),
      unlocks: progression,
      pausePort: { pause: () => "pause.progression", resume: () => undefined },
    });

    construction.enterEditMode("enter-progression", scene.id, 1);
    expect(construction.startPreview(
      "locked-progression",
      "preview.progression.locked",
      building.id,
      { occurredAtUtcMs: 2 },
    )).toMatchObject({ accepted: false, code: "BUILDING_LOCKED" });

    expect(progression.grantUnlocks(
      "unlock-building",
      [building.id],
      "story.reward",
      3,
    )).toMatchObject({ accepted: true, unlockedContentIds: [building.id] });
    expect(construction.startPreview(
      "unlocked-progression",
      "preview.progression.unlocked",
      building.id,
      { occurredAtUtcMs: 4 },
    )).toMatchObject({ accepted: true });
  });
});
