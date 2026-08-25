import { describe, expect, it } from "vitest";
import {
  BuildingUpgradeModule,
  DomainEventBus,
  FinanceModule,
  SceneLayoutModule,
  instanceId,
  type BuildingRuntimeDefinition,
  type BuildingTransitionConstraintPort,
} from "../src";

const scene = {
  id: "scene.upgrade",
  placementRegions: [{
    id: "region.ground",
    tag: "zone.ground",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  }],
} as const;

function variant(width: number) {
  return {
    hardFootprints: [{ x: 0, y: 0, width, height: 10 }],
    visualBounds: { x: 0, y: 0, width, height: 10 },
    interactionAreas: [{ id: "front", bounds: { x: width, y: 2, width: 4, height: 4 }, required: true }],
  };
}

const building: BuildingRuntimeDefinition = {
  id: "building.upgradeable",
  buildCostCopper: 500,
  allowedRegionTags: ["zone.ground"],
  styleIds: ["style.default"],
  defaultStyleId: "style.default",
  defaultOrientation: "normal",
  necessary: false,
  movable: true,
  storable: true,
  removable: true,
  levels: [
    {
      level: 1,
      upgradeCostCopper: 0,
      maxDurability: 100,
      components: [{ slotId: "slot.work", capabilityId: "capability.work" }],
      layouts: { normal: variant(10) },
    },
    {
      level: 2,
      upgradeCostCopper: 200,
      maxDurability: 120,
      components: [{ slotId: "slot.work", capabilityId: "capability.work" }],
      layouts: { normal: variant(10) },
    },
    {
      level: 3,
      upgradeCostCopper: 300,
      maxDurability: 150,
      components: [
        { slotId: "slot.work", capabilityId: "capability.work" },
        { slotId: "slot.work_extra", capabilityId: "capability.work" },
      ],
      layouts: { normal: variant(25) },
    },
  ],
};

function setup(options: { balance?: number; constraint?: BuildingTransitionConstraintPort } = {}) {
  const finance = new FinanceModule(options.balance ?? 1_000);
  const layout = new SceneLayoutModule([scene], [building], options.constraint);
  const placed = layout.placeBuilding("place", {
    instanceId: instanceId("instance.building.upgrade_1"),
    definitionId: building.id,
    sceneId: scene.id,
    transform: { x: 0, y: 10, orientation: "normal" },
    totalInvestmentCopper: 500,
    occurredAtUtcMs: 1,
  });
  if (!placed.accepted) throw new Error(placed.message);
  let editMode = true;
  const events: string[] = [];
  const eventBus = new DomainEventBus();
  eventBus.subscribe("*", (event) => events.push(event.type));
  const upgrades = new BuildingUpgradeModule({
    finance,
    layout,
    eventBus,
    editMode: { isEditModeActive: () => editMode },
  });
  return {
    finance,
    layout,
    upgrades,
    events,
    buildingId: placed.value.id,
    setEditMode(value: boolean) { editMode = value; },
  };
}

describe("BuildingUpgradeModule", () => {
  it("requires paused edit mode and sufficient currently available funds before creating a preview", () => {
    const target = setup();
    target.setEditMode(false);
    expect(target.upgrades.prepareUpgrade("not-paused", "preview-1", target.buildingId, 2)).toMatchObject({
      accepted: false,
      code: "EDIT_MODE_REQUIRED",
    });
    const poor = setup({ balance: 100 });
    expect(poor.upgrades.prepareUpgrade("poor", "preview-2", poor.buildingId, 2)).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_FUNDS",
    });
    expect(poor.upgrades.getSnapshot().previews).toHaveLength(0);
  });

  it("detects when geometry preview is unnecessary and atomically pays for the immediate upgrade", () => {
    const target = setup();
    expect(target.upgrades.prepareUpgrade("prepare", "preview-1", target.buildingId, 2)).toMatchObject({
      accepted: true,
      value: { sourceLevel: 1, targetLevel: 2, costCopper: 200, requiresLayoutPreview: false },
    });
    expect(target.upgrades.confirmUpgrade("confirm", "preview-1", 3)).toMatchObject({
      accepted: true,
      value: { level: 2, totalInvestmentCopper: 700 },
    });
    expect(target.finance.getSnapshot().balanceCopper).toBe(800);
    expect(target.finance.getSnapshot().ledger[0]).toMatchObject({
      amountCopper: -200,
      category: "building-purchase",
      sourceType: "building-upgrade",
    });
    expect(target.events).toContain("building-upgrade.completed");
  });

  it("requires a geometry preview for changed footprint and refuses an overlapping target without charging", () => {
    const target = setup();
    target.upgrades.prepareUpgrade("prepare-2", "preview-2", target.buildingId, 2);
    target.upgrades.confirmUpgrade("confirm-2", "preview-2", 3);
    const blocker = target.layout.placeBuilding("blocker", {
      instanceId: instanceId("instance.building.blocker_1"),
      definitionId: building.id,
      sceneId: scene.id,
      transform: { x: 20, y: 10, orientation: "normal" },
      totalInvestmentCopper: 500,
      occurredAtUtcMs: 4,
    });
    if (!blocker.accepted) throw new Error(blocker.message);
    expect(target.upgrades.prepareUpgrade("prepare-3", "preview-3", target.buildingId, 5)).toMatchObject({
      accepted: true,
      value: { targetLevel: 3, requiresLayoutPreview: true, placement: { valid: false } },
    });
    expect(target.upgrades.confirmUpgrade("confirm-3", "preview-3", 6)).toMatchObject({
      accepted: false,
      code: "PLACEMENT_INVALID",
    });
    expect(target.layout.getBuilding(target.buildingId)?.level).toBe(2);
    expect(target.finance.getSnapshot().balanceCopper).toBe(800);
  });

  it("uses capability constraints to block busy devices before any upgrade expense commits", () => {
    const constraint: BuildingTransitionConstraintPort = {
      validate: (request) => request.kind === "upgrade" ? ["device is busy"] : [],
    };
    const target = setup({ constraint });
    target.upgrades.prepareUpgrade("prepare", "preview", target.buildingId, 2);
    expect(target.upgrades.confirmUpgrade("confirm", "preview", 3)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
      issues: ["device is busy"],
    });
    expect(target.layout.getBuilding(target.buildingId)?.level).toBe(1);
    expect(target.finance.getSnapshot().balanceCopper).toBe(1_000);
  });

  it("rechecks funds inside the transaction and rolls back the layout if money was spent after preview", () => {
    const target = setup({ balance: 250 });
    target.upgrades.prepareUpgrade("prepare", "preview", target.buildingId, 2);
    target.finance.payExpense("other-payment", {
      entryId: "ledger.other",
      amountCopper: 100,
      category: "other-expense",
      occurredAtUtcMs: 3,
      sourceType: "test",
      sourceId: "other",
      regionId: scene.id,
    });
    expect(target.upgrades.confirmUpgrade("confirm", "preview", 4)).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_FUNDS",
    });
    expect(target.layout.getBuilding(target.buildingId)?.level).toBe(1);
    expect(target.finance.getSnapshot().balanceCopper).toBe(150);
    expect(target.finance.getSnapshot().ledger).toHaveLength(1);
  });

  it("persists previews and revalidates building level, price and placement when restoring", () => {
    const target = setup();
    expect(target.upgrades.prepareUpgrade("prepare-save", "preview-save", target.buildingId, 2)).toMatchObject({ accepted: true });
    const saved = JSON.parse(JSON.stringify(target.upgrades.exportState()));
    const restored = new BuildingUpgradeModule({
      finance: target.finance,
      layout: target.layout,
      eventBus: new DomainEventBus(),
      editMode: { isEditModeActive: () => true },
      initialState: saved,
    });
    expect(restored.exportState()).toEqual(target.upgrades.exportState());

    expect(() => new BuildingUpgradeModule({
      finance: target.finance,
      layout: target.layout,
      eventBus: new DomainEventBus(),
      editMode: { isEditModeActive: () => true },
      initialState: {
        ...saved,
        previews: saved.previews.map((preview: { costCopper: number }) => ({
          ...preview,
          costCopper: preview.costCopper + 1,
        })),
      },
    })).toThrow("Building upgrade preview is stale");

    expect(restored.confirmUpgrade("confirm-restored", "preview-save", 3)).toMatchObject({
      accepted: true,
      value: { level: 2 },
    });
    expect(target.finance.getSnapshot().balanceCopper).toBe(800);
  });
});