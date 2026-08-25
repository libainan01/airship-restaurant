import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  FleetModule,
  InventoryModule,
  LocalProcurementModule,
  RestaurantApplicationRuntime,
  RestaurantProcurementProcess,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  TaskModule,
  instanceId,
  type TaskCandidate,
} from "../src";

const captainId = instanceId("instance.character.remote_captain");
const shipId = "instance.airship.procurement_test";

function captainCandidate(): TaskCandidate {
  return {
    characterId: captainId,
    available: true,
    tags: [],
    learnedJobIds: ["job.captain", "job.local_procurer"],
    primaryJobId: "job.captain",
    skills: { cooking: 1, charm: 4, movement: 2, repair: 1, piloting: 2 },
  };
}

function fixture(routeUnlocked = true) {
  const eventBus = new DomainEventBus();
  const eventTypes: string[] = [];
  eventBus.subscribe("*", (event) => { eventTypes.push(event.type); });
  const characters = new CharacterModule([{
    id: "character.remote_captain",
    name: "试航船长",
    baseSkills: { cooking: 1, charm: 4, movement: 2, repair: 1, piloting: 2 },
    defaultTalentIds: [],
  }], []);
  characters.createCharacter("create-captain", {
    instanceId: captainId,
    definitionId: "character.remote_captain",
    coreMember: true,
    occurredAtUtcMs: 0,
  });
  const employment = new EmploymentModule(characters);
  employment.addEmployee("employ-captain", {
    characterId: captainId,
    kind: "core",
    learnedJobIds: ["job.captain", "job.local_procurer"],
    primaryJobId: "job.captain",
    dailyShift: null,
    occurredAtUtcMs: 0,
  });
  const finance = new FinanceModule(100);
  const inventory = new InventoryModule([
    { id: "ingredient.wind_root", category: "ingredient", storageMode: "stack" },
  ], new StaticInventoryStorageDefinitions([
    { id: "station.ground", compartments: [{ id: "ingredients", capacity: 100, acceptedCategories: ["ingredient"] }] },
  ]));
  const tasks = new TaskModule();
  const fleet = new FleetModule({
    definitions: [{
      id: "airship.procurement.test",
      name: "试验采购艇",
      purchaseCostCopper: 0,
      defaultStyleId: "style.test",
      styleIds: ["style.test"],
      levels: [{ level: 1, upgradeCostCopper: 0, cargoCapacity: 3, speedUnitsPerSecond: 100, maxDurability: 10, cooldownEfficiency: 1 }],
    }],
    initialShips: [{ id: shipId, definitionId: "airship.procurement.test" }],
    captains: {
      getCaptainSnapshot: (characterId) => characterId === captainId ? { eligible: true, pilotingLevel: 2 } : null,
    },
    routes: { isRouteUnlocked: () => routeUnlocked },
    policy: {
      calculateVoyageDurationMs: () => 1_000,
      calculateDurabilityLoss: () => 1,
      calculateCooldownDurationMs: () => 500,
    },
    eventBus,
  });
  const procurement = new LocalProcurementModule({
    finance,
    inventory,
    characters,
    employment,
    tasks,
    recipes: new StaticOrderRecipeCatalog([{ id: "recipe.wind_root_test", ingredients: [{ itemId: "ingredient.wind_root", quantity: 1 }] }]),
    pricing: { calculateUnitPriceCopper: (base, charm) => Math.max(1, base - Math.floor(charm / 2)) },
    destinationLocationId: "station.ground",
    suppliers: [{
      id: "supplier.remote.windroot",
      sourceRegionId: "region.windroot",
      preparationDurationMs: 100,
      roundTripDistanceUnits: 200,
      transportMode: "remote",
      routeId: "route.greyfeather_windroot",
      items: [{ itemId: "ingredient.wind_root", baseUnitPriceCopper: 4 }],
    }],
    carts: [{ id: "cart.local_fallback", capacity: 2, speedUnitsPerSecond: 10 }],
    fleet,
    eventBus,
  });
  return { eventTypes, finance, fleet, inventory, procurement, tasks };
}

describe("unified remote procurement and Fleet", () => {
  it("uses the same paid order, fixed batches, inventory arrival and task-completion path", () => {
    const target = fixture();
    const request = {
      recipeSelections: [],
      freeItems: [{ itemId: "ingredient.wind_root", quantity: 5 }],
      minuteOfDay: 100,
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs: 0,
    } as const;

    expect(target.procurement.previewDraft(request)).toMatchObject({
      accepted: true,
      value: {
        batchCapacitySnapshot: 3,
        expectedBatchCount: 2,
        totalPriceCopper: 20,
        supplierPlans: [{
          supplierId: "supplier.remote.windroot",
          transportMode: "remote",
          routeId: "route.greyfeather_windroot",
          capacitySnapshot: 3,
          expectedBatchCount: 2,
        }],
      },
    });
    expect(target.procurement.placeOrder("remote-place", request)).toMatchObject({
      accepted: true,
      value: [{ transportMode: "remote", routeId: "route.greyfeather_windroot", totalQuantity: 5 }],
    });
    expect(target.finance.getSnapshot()).toMatchObject({ balanceCopper: 80 });
    target.procurement.advanceTo("remote-ready", 100);
    const [first, second] = target.procurement.exportState().batches;
    expect(target.tasks.createReadModel().waiting).toHaveLength(2);

    expect(target.procurement.startRemoteBatch("remote-start-1", {
      batchId: first!.id,
      airshipId: shipId,
      candidate: captainCandidate(),
      occurredAtUtcMs: 100,
    })).toMatchObject({ accepted: true, value: { status: "in-transit", airshipId: shipId, arrivesAtUtcMs: 1_100 } });
    expect(target.fleet.advanceTo("fleet-return-1", 1_100)).toMatchObject({ accepted: true, changed: true });
    expect(target.procurement.advanceTo("remote-arrive-1", 1_100)).toMatchObject({ accepted: true });
    expect(target.inventory.getStackQuantity("station.ground", "ingredient.wind_root")).toBe(3);
    expect(target.procurement.getOrder(first!.orderId)).toMatchObject({ status: "partial", deliveredQuantity: 3 });
    expect(target.fleet.getVoyage(`procurement-voyage-${first!.id}`)).toMatchObject({ status: "completed" });

    expect(target.procurement.startRemoteBatch("remote-start-too-soon", {
      batchId: second!.id,
      airshipId: shipId,
      candidate: captainCandidate(),
      occurredAtUtcMs: 1_100,
    })).toMatchObject({ accepted: false, code: "REMOTE_UNAVAILABLE" });
    expect(target.tasks.getTask(second!.taskId)).toMatchObject({ status: "waiting", assignedCharacterId: null });

    expect(target.procurement.startRemoteBatch("remote-start-2", {
      batchId: second!.id,
      airshipId: shipId,
      candidate: captainCandidate(),
      occurredAtUtcMs: 1_600,
    })).toMatchObject({ accepted: true, value: { totalQuantity: 2, arrivesAtUtcMs: 2_600 } });
    target.fleet.advanceTo("fleet-return-2", 2_600);
    target.procurement.advanceTo("remote-arrive-2", 2_600);
    expect(target.inventory.getStackQuantity("station.ground", "ingredient.wind_root")).toBe(5);
    expect(target.procurement.getOrder(first!.orderId)).toMatchObject({ status: "completed", deliveredQuantity: 5, completedAtUtcMs: 2_600 });
    expect(target.eventTypes.filter((type) => type === "task.completed")).toHaveLength(2);
    expect(target.eventTypes).toContain("remote-procurement.order-completed");
  });

  it("lets the production process wait for ship cooldown before dispatching the next remote batch", () => {
    const target = fixture();
    expect(target.procurement.placeOrder("process-remote-place", {
      recipeSelections: [],
      freeItems: [{ itemId: "ingredient.wind_root", quantity: 5 }],
      minuteOfDay: 100,
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs: 0,
    })).toMatchObject({ accepted: true });
    const automaticState = {
      schemaVersion: 1 as const,
      revision: 0,
      reserveCopper: 0,
      regions: [],
      lastReconciledAtUtcMs: 0,
      processedOperationIds: [],
    };
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      processes: [new RestaurantProcurementProcess({
        procurement: target.procurement,
        automatic: {
          exportState: () => automaticState,
          reconcile: () => { throw new Error("Disabled automation must not reconcile."); },
        },
        fleet: target.fleet,
        candidates: { listCandidates: () => [captainCandidate()] },
        activeRegionId: "region.greyfeather",
        minuteOfDayAt: () => 100,
      })],
    });

    let nowUtcMs = 0;
    for (let guard = 0; guard < 20; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      if (target.procurement.exportState().orders.every((order) => order.status === "completed")) break;
      const next = runtime.getSnapshot().nextTransitionUtcMs;
      nowUtcMs = next === null ? nowUtcMs + 1 : Math.max(nowUtcMs + 1, next);
    }

    expect(target.procurement.exportState().orders).toEqual([
      expect.objectContaining({ status: "completed", deliveredQuantity: 5 }),
    ]);
    expect(target.inventory.getStackQuantity("station.ground", "ingredient.wind_root")).toBe(5);
    expect(target.finance.getSnapshot().availableCopper).toBe(80);
    expect(target.fleet.exportState().voyages).toHaveLength(2);
    expect(target.fleet.exportState().voyages[1]).toMatchObject({
      status: "completed",
      departedAtUtcMs: 1_600,
      returnedAtUtcMs: 2_600,
    });
    expect(target.fleet.createReadModel(2_600).ships[0]).toMatchObject({
      available: false,
      unavailableReason: "COOLDOWN",
      cooldownEndsAtUtcMs: 3_100,
      durability: 8,
    });
  });
  it("keeps a locked route separate from temporary Fleet availability", () => {
    const locked = fixture(false);
    expect(locked.procurement.previewDraft({
      recipeSelections: [],
      freeItems: [{ itemId: "ingredient.wind_root", quantity: 1 }],
      minuteOfDay: 100,
    })).toMatchObject({ accepted: false, code: "UNKNOWN_SUPPLIER" });
  });
});