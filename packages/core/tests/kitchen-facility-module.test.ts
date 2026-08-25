import { describe, expect, it } from "vitest";
import {
  Direct2DNavigationPlanner,
  DomainEventBus,
  KitchenFacilityAdapter,
  KitchenFacilityModule,
  MovementModule,
  SceneLayoutInteractionTargetResolver,
  SceneLayoutModule,
  instanceId,
  type BuildingRuntimeDefinition,
  type DomainEvent,
  type KitchenFacilityLevelDefinition,
  type ReserveKitchenStepResourcesRequest,
} from "../src";

const scene = Object.freeze({
  id: "scene.airship",
  placementRegions: Object.freeze([
    Object.freeze({
      id: "region.airship",
      tag: "zone.airship",
      bounds: Object.freeze({ x: 0, y: 0, width: 400, height: 120 }),
    }),
  ]),
});

function building(
  id: string,
  interactionIds: readonly string[],
): BuildingRuntimeDefinition {
  return Object.freeze({
    id,
    buildCostCopper: 100,
    allowedRegionTags: Object.freeze(["zone.airship"]),
    styleIds: Object.freeze(["style.default", "style.brass"]),
    defaultStyleId: "style.default",
    defaultOrientation: "front",
    necessary: false,
    movable: true,
    storable: true,
    removable: true,
    levels: Object.freeze([
      Object.freeze({
        level: 1,
        upgradeCostCopper: 0,
        maxDurability: 100,
        components: Object.freeze([]),
        layouts: Object.freeze({
          front: Object.freeze({
            hardFootprints: Object.freeze([
              Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
            ]),
            visualBounds: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
            interactionAreas: Object.freeze(interactionIds.map((id, index) => Object.freeze({
              id,
              required: true,
              bounds: Object.freeze({ x: 10, y: index * 4, width: 4, height: 3 }),
            }))),
          }),
        }),
      }),
    ]),
  });
}

const panLevelOne = building("building.pan", ["interaction.main", "interaction.side"]);
const panBuilding: BuildingRuntimeDefinition = Object.freeze({
  ...panLevelOne,
  levels: Object.freeze([
    panLevelOne.levels[0]!,
    Object.freeze({
      ...panLevelOne.levels[0]!,
      level: 2,
      upgradeCostCopper: 50,
    }),
  ]),
});
const prepBuilding = building("building.prep", ["interaction.main"]);

const facilityDefinitions: readonly KitchenFacilityLevelDefinition[] = Object.freeze([
  Object.freeze({
    buildingDefinitionId: panBuilding.id,
    level: 1,
    workstations: Object.freeze([
      Object.freeze({
        id: "main",
        capabilityIds: Object.freeze(["station.pan_fry"]),
        interactionId: "interaction.main",
      }),
      Object.freeze({
        id: "side",
        capabilityIds: Object.freeze(["station.pan_fry", "station.mix"]),
        interactionId: "interaction.side",
      }),
    ]),
    cacheSlotIds: Object.freeze([]),
  }),
  Object.freeze({
    buildingDefinitionId: panBuilding.id,
    level: 2,
    workstations: Object.freeze([
      Object.freeze({
        id: "main",
        capabilityIds: Object.freeze(["station.steam_boil"]),
        interactionId: "interaction.main",
      }),
      Object.freeze({
        id: "side",
        capabilityIds: Object.freeze(["station.pan_fry", "station.mix"]),
        interactionId: "interaction.side",
      }),
    ]),
    cacheSlotIds: Object.freeze([]),
  }),
  Object.freeze({
    buildingDefinitionId: prepBuilding.id,
    level: 1,
    workstations: Object.freeze([
      Object.freeze({
        id: "main",
        capabilityIds: Object.freeze(["station.prep"]),
        interactionId: "interaction.main",
      }),
    ]),
    cacheSlotIds: Object.freeze(["slot_a"]),
  }),
]);

const chefA = instanceId("instance.character.chef_a");
const chefB = instanceId("instance.character.chef_b");
const missingChef = instanceId("instance.character.missing");
const panId = instanceId("instance.building.pan_a");
const prepId = instanceId("instance.building.prep_a");

function createFixture() {
  const adapter = new KitchenFacilityAdapter(facilityDefinitions);
  const layout = new SceneLayoutModule([scene], [panBuilding, prepBuilding], adapter);
  adapter.attachLayout(layout);
  expect(layout.placeBuilding("place-pan", {
    instanceId: panId,
    definitionId: panBuilding.id,
    sceneId: scene.id,
    transform: { x: 20, y: 20, orientation: "front" },
    totalInvestmentCopper: 100,
    occurredAtUtcMs: 1,
  })).toMatchObject({ accepted: true });
  expect(layout.placeBuilding("place-prep", {
    instanceId: prepId,
    definitionId: prepBuilding.id,
    sceneId: scene.id,
    transform: { x: 60, y: 20, orientation: "front" },
    totalInvestmentCopper: 100,
    occurredAtUtcMs: 2,
  })).toMatchObject({ accepted: true });
  const targets = new SceneLayoutInteractionTargetResolver(layout, (value) => value.sceneId);
  const movement = new MovementModule({
    targetResolver: targets,
    navigationPlanner: new Direct2DNavigationPlanner(),
    reservationTtlMs: 50,
    maximumReplanAttempts: 3,
  });
  expect(movement.registerCharacter("register-a", chefA, scene.id, { x: 30, y: 20 })).toMatchObject({ accepted: true });
  expect(movement.registerCharacter("register-b", chefB, scene.id, { x: 30, y: 24 })).toMatchObject({ accepted: true });
  const eventBus = new DomainEventBus();
  const events: DomainEvent[] = [];
  eventBus.subscribe("*", (event) => events.push(event));
  const kitchen = new KitchenFacilityModule({ facilities: adapter, movement, eventBus });
  adapter.attachRuntime(kitchen);
  return { adapter, layout, movement, kitchen, eventBus, events };
}

function request(
  stepInstanceId: string,
  characterId = chefA,
  overrides: Partial<ReserveKitchenStepResourcesRequest> = {},
): ReserveKitchenStepResourcesRequest {
  return {
    stepInstanceId,
    executionId: "execution.meal_a",
    taskId: `task.${stepInstanceId}`,
    characterId,
    requiredCapabilityIds: ["station.pan_fry"],
    attendance: "required",
    speedUnitsPerSecond: 20,
    occurredAtUtcMs: 10,
    reservationExpiresAtUtcMs: 100,
    ...overrides,
  };
}

describe("KitchenFacilityModule", () => {
  it("atomically reserves a capable workstation, interaction point, and concrete prep cache slot", () => {
    const { kitchen, movement } = createFixture();
    const first = kitchen.reserveStepResources("reserve-a", request("step.a", chefA, {
      outputCache: { allowedConsumerStepInstanceIds: ["step.join"] },
    }));
    expect(first).toMatchObject({
      accepted: true,
      value: {
        stepInstanceId: "step.a",
        facilityId: panId,
        interactionId: "interaction.main",
        phase: "reserved",
      },
    });
    expect(kitchen.createReadModel().cacheClaims).toMatchObject([
      {
        facilityId: prepId,
        sourceStepInstanceId: "step.a",
        status: "reserved",
      },
    ]);
    expect(movement.getCharacter(chefA)).toMatchObject({
      status: "arrived",
      plan: {
        taskId: "task.step.a",
        target: { type: "building", id: panId, interactionId: "interaction.main" },
      },
    });

    expect(kitchen.reserveStepResources("reserve-b-no-cache", request("step.b", chefB, {
      outputCache: { allowedConsumerStepInstanceIds: ["step.join"] },
    }))).toMatchObject({ accepted: false, code: "NO_CACHE_SLOT" });
    expect(movement.getCharacter(chefB)).toMatchObject({ status: "idle", plan: null });
    expect(kitchen.createReadModel().bindings).toHaveLength(1);

    expect(kitchen.reserveStepResources("reserve-b", request("step.b", chefB))).toMatchObject({
      accepted: true,
      value: { interactionId: "interaction.side" },
    });
    expect(kitchen.reserveStepResources("reserve-c", request("step.c", missingChef))).toMatchObject({
      accepted: false,
      code: "WORKSTATION_BUSY",
    });
  });

  it("rolls back every facility allocation when movement cannot reserve the interaction point", () => {
    const { kitchen } = createFixture();
    expect(kitchen.reserveStepResources("reserve-missing", request("step.missing", missingChef))).toMatchObject({
      accepted: false,
      code: "MOVEMENT_REJECTED",
    });
    expect(kitchen.createReadModel()).toMatchObject({ bindings: [], cacheClaims: [] });
    expect(kitchen.reserveStepResources("reserve-after-rollback", request("step.valid"))).toMatchObject({
      accepted: true,
    });
  });

  it("releases the chef and interaction for unattended work while retaining the workstation until completion", () => {
    const { kitchen, movement, events } = createFixture();
    expect(kitchen.reserveStepResources("reserve", request("step.auto", chefA, {
      attendance: "unattended",
      outputCache: { allowedConsumerStepInstanceIds: ["step.finish"] },
    }))).toMatchObject({ accepted: true });
    expect(kitchen.startStep("start", "step.auto", 11)).toMatchObject({
      accepted: true,
      value: { phase: "running" },
    });
    expect(movement.getCharacter(chefA)).toMatchObject({ status: "idle", plan: null });
    expect(kitchen.reserveStepResources("reserve-other", request("step.other", chefB, {
      requiredCapabilityIds: ["station.pan_fry", "station.mix"],
    }))).toMatchObject({ accepted: true });
    expect(kitchen.reserveStepResources("reserve-full", request("step.full", missingChef))).toMatchObject({
      accepted: false,
      code: "WORKSTATION_BUSY",
    });

    const completed = kitchen.completeStep("complete", "step.auto", 20);
    expect(completed).toMatchObject({ accepted: true, value: { status: "occupied" } });
    const claim = completed.accepted ? completed.value : null;
    if (claim === null) throw new Error("Expected an occupied intermediate cache claim.");
    expect(kitchen.takeCachedIntermediate("take-wrong", claim.id, "execution.other", "step.finish", 21)).toMatchObject({
      accepted: false,
      code: "CACHE_CONSUMER_NOT_ALLOWED",
    });
    expect(kitchen.takeCachedIntermediate("take", claim.id, "execution.meal_a", "step.finish", 22)).toMatchObject({
      accepted: true,
    });
    expect(kitchen.createReadModel().cacheClaims).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "kitchen.interaction-released",
      "kitchen.workstation-released",
      "kitchen.cache-slot-occupied",
      "kitchen.cached-intermediate-taken",
    ]));
  });

  it("keeps stable resource identity while a reserved or running device moves and Movement replans to current geometry", () => {
    const { kitchen, movement, layout } = createFixture();
    const reserved = kitchen.reserveStepResources("reserve", request("step.move", chefA));
    if (!reserved.accepted) throw new Error(reserved.message);
    const workstation = reserved.value.workstationId;
    expect(layout.moveBuilding(
      "move-before-start",
      panId,
      scene.id,
      { x: 100, y: 20, orientation: "front" },
      12,
    )).toMatchObject({ accepted: true });
    const replanned = movement.advanceCharacter("advance-to-moved", chefA, 20);
    expect(replanned).toMatchObject({
      accepted: true,
      value: { status: "moving", plan: { destination: { x: 110, y: 20 } } },
    });
    expect(movement.advanceCharacter("arrive-moved", chefA, 30_000)).toMatchObject({
      accepted: true,
      value: { status: "arrived" },
    });
    expect(kitchen.startStep("start", "step.move", 30_001)).toMatchObject({
      accepted: false,
      code: "INVALID_REQUEST",
    });
    // Kitchen reservation time is authoritative and does not silently extend with path replans.
    expect(kitchen.releaseStepReservation("release-expired", "step.move", "arrival-too-late", 30_001)).toMatchObject({
      accepted: true,
    });

    const second = kitchen.reserveStepResources("reserve-second", request("step.move2", chefA, {
      occurredAtUtcMs: 30_002,
      reservationExpiresAtUtcMs: 60_000,
    }));
    if (!second.accepted) throw new Error(second.message);
    expect(second.value.workstationId).toBe(workstation);
    expect(movement.advanceCharacter("arrive-second", chefA, 40_000)).toMatchObject({
      accepted: true,
      value: { status: "arrived" },
    });
    expect(kitchen.startStep("start-second", "step.move2", 40_001)).toMatchObject({ accepted: true });
    expect(layout.moveBuilding(
      "move-running",
      panId,
      scene.id,
      { x: 140, y: 20, orientation: "front" },
      40_002,
    )).toMatchObject({ accepted: true });
    expect(kitchen.getBinding("step.move2")).toMatchObject({
      phase: "running",
      workstationId: workstation,
    });
    expect(movement.advanceCharacter("replan-running", chefA, 40_003)).toMatchObject({
      accepted: true,
      value: { plan: { destination: { x: 150, y: 20 } } },
    });
    expect(movement.advanceCharacter("arrive-running", chefA, 50_000)).toMatchObject({
      accepted: true,
      value: { status: "arrived" },
    });
    expect(kitchen.completeStep("complete", "step.move2", 50_001)).toMatchObject({ accepted: true });
    expect(movement.getCharacter(chefA)).toMatchObject({ status: "idle", plan: null });
  });

  it("expires reservations without leaks, blocks destructive building transitions, and restores saved ownership", () => {
    const { adapter, kitchen, layout, movement } = createFixture();
    expect(kitchen.reserveStepResources("reserve", request("step.timeout", chefA, {
      reservationExpiresAtUtcMs: 15,
      outputCache: { allowedConsumerStepInstanceIds: ["step.next"] },
    }))).toMatchObject({ accepted: true });
    expect(layout.removeBuilding("remove-busy", panId, 12)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });
    expect(layout.changeStyle("style-busy", panId, "style.brass", 13)).toMatchObject({ accepted: true });
    expect(layout.upgradeBuilding("upgrade-capability-busy", panId, 2, 50, 14)).toMatchObject({
      accepted: false,
      code: "TRANSITION_BLOCKED",
    });

    const savedKitchen = kitchen.exportState();
    const savedMovement = movement.exportState();
    const restoredMovement = new MovementModule({
      targetResolver: new SceneLayoutInteractionTargetResolver(layout, (value) => value.sceneId),
      initialState: savedMovement,
    });
    const restored = new KitchenFacilityModule({
      facilities: adapter,
      movement: restoredMovement,
      initialState: savedKitchen,
    });
    expect(restored.exportState()).toEqual(savedKitchen);
    expect(restored.expireReservations("expire", 16)).toMatchObject({
      accepted: true,
      value: [{ stepInstanceId: "step.timeout" }],
    });
    expect(restored.createReadModel()).toMatchObject({ bindings: [], cacheClaims: [] });
    expect(restoredMovement.getCharacter(chefA)).toMatchObject({ status: "idle", plan: null });
  });
  it("projects workstation and cache counts from the current building level capability values", () => {
    const base = building("building.scalable_kitchen", ["interaction.main", "interaction.side"]);
    const scalable: BuildingRuntimeDefinition = {
      ...base,
      levels: [
        { ...base.levels[0]!, capabilityValues: { "kitchen.workstation-count": 1, "kitchen.cache-slot-count": 1 } },
        { ...base.levels[0]!, level: 2, upgradeCostCopper: 50, capabilityValues: { "kitchen.workstation-count": 2, "kitchen.cache-slot-count": 3 } },
      ],
    };
    const definitions: readonly KitchenFacilityLevelDefinition[] = [1, 2].map((level) => ({
      buildingDefinitionId: scalable.id,
      level,
      workstations: [
        { id: "main", capabilityIds: ["station.prep"], interactionId: "interaction.main" },
        { id: "side", capabilityIds: ["station.prep"], interactionId: "interaction.side" },
      ],
      cacheSlotIds: ["slot_a", "slot_b", "slot_c"],
      workstationCountValueKey: "kitchen.workstation-count",
      cacheSlotCountValueKey: "kitchen.cache-slot-count",
    }));
    const adapter = new KitchenFacilityAdapter(definitions);
    const layout = new SceneLayoutModule([scene], [scalable], adapter);
    adapter.attachLayout(layout);
    const placed = layout.placeBuilding("place-scalable", {
      instanceId: instanceId("instance.building.scalable_kitchen"),
      definitionId: scalable.id,
      sceneId: scene.id,
      transform: { x: 20, y: 20, orientation: "front" },
      totalInvestmentCopper: 100,
      occurredAtUtcMs: 1,
    });
    if (!placed.accepted) throw new Error(placed.message);

    expect(adapter.getFacility(placed.value.id)).toMatchObject({ workstations: [{ localId: "main" }], cacheSlots: [{ localId: "slot_a" }] });
    expect(layout.upgradeBuilding("upgrade-scalable", placed.value.id, 2, 50, 2)).toMatchObject({ accepted: true });
    expect(adapter.getFacility(placed.value.id)).toMatchObject({
      workstations: [{ localId: "main" }, { localId: "side" }],
      cacheSlots: [{ localId: "slot_a" }, { localId: "slot_b" }, { localId: "slot_c" }],
    });
  });
});

