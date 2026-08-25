import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  M2_INITIAL_INGREDIENTS,
  M2_INITIAL_PROCUREMENT_AIRSHIPS,
  M2_PROCUREMENT_AIRSHIPS,
  createM2ContentRegistry,
} from "@airship-restaurant/content";
import {
  DomainEventBus,
  FinanceModule,
  FleetModule,
  instanceId,
  RestaurantApplicationRuntime,
  RESTAURANT_OPERATIONAL_SAVE_MANIFEST,
  exportRestaurantOperationalSaveModules,
  readRestaurantOperationalInitialStates,
  type RestaurantOperationalInitialStates,
} from "@airship-restaurant/core";
import { createR3SceneLayout } from "../src/main/r3-runtime";
import { GameSaveService } from "../src/main/game-save-service";
import { RestaurantGameplayReadProjection } from "../src/main/restaurant-gameplay-read-projection";
import { createDesktopAutomaticProcurementRuntime } from "../src/main/automatic-procurement-runtime";
import { createDesktopLocalProcurementRuntime } from "../src/main/local-procurement-runtime";
import { createR4PeopleModules } from "../src/main/r4-people-runtime";
import { DesktopRestaurantInteractionTargetResolver } from "../src/main/restaurant-interaction-target-resolver";
import { createDesktopRestaurantOperationalRuntime } from "../src/main/restaurant-operational-runtime";
import {
  DESKTOP_RESTAURANT_IDS,
  createDesktopRestaurantOperationalModules,
} from "../src/main/restaurant-operational-modules";

function createProcess() {
  return {
    id: "process.restaurant-test",
    advance: () => ({ changed: false, nextTransitionUtcMs: null }),
  } as const;
}

function createDependencies() {
  const content = createM2ContentRegistry();
  const people = createR4PeopleModules(content);
  return {
    content,
    people,
    layout: createR3SceneLayout(content.listBuildings()),
    finance: new FinanceModule(500),
  };
}

function exportStates(
  modules: ReturnType<typeof createDesktopRestaurantOperationalModules>,
  applicationRuntime: RestaurantApplicationRuntime,
): RestaurantOperationalInitialStates {
  const saved = exportRestaurantOperationalSaveModules({
    applicationRuntime,
    inventory: modules.inventory,
    tasks: modules.tasks,
    orders: modules.orders,
    customers: modules.customers,
    service: modules.service,
    dishware: modules.dishware,
    dishwareService: modules.dishwareService,
    recipeExecutions: modules.recipeExecutions,
    movement: modules.movement,
    kitchenFacilities: modules.kitchenFacilities,
    kitchenProducts: modules.kitchenProducts,
    kitchenSteps: modules.kitchenSteps,
    trayDelivery: modules.trayDelivery,
    logistics: modules.logistics,
    freightElevators: modules.freightElevators,
    personnelElevator: modules.personnelElevator,
  });
  const restored = readRestaurantOperationalInitialStates(Object.fromEntries(
    saved.map((entry) => [entry.moduleId, {
      schemaVersion: entry.schemaVersion,
      payload: entry.payload,
    }]),
  ));
  if (restored.status !== "ready") throw new Error(restored.diagnostics.join("; "));
  return restored.initialStates;
}

function createFleet(dependencies: ReturnType<typeof createDependencies>): FleetModule {
  return new FleetModule({
    definitions: M2_PROCUREMENT_AIRSHIPS,
    initialShips: M2_INITIAL_PROCUREMENT_AIRSHIPS,
    captains: {
      getCaptainSnapshot: (characterId) => {
        const character = dependencies.people.characters.getCharacter(characterId);
        const employment = dependencies.people.employment.getRecord(characterId);
        if (character === null) return null;
        return {
          eligible: employment !== null && employment.learnedJobIds.includes("job.captain"),
          pilotingLevel: character.skills.piloting.level,
        };
      },
    },
    routes: { isRouteUnlocked: () => true },
    policy: {
      calculateVoyageDurationMs: () => 1_000,
      calculateDurabilityLoss: () => 1,
      calculateCooldownDurationMs: () => 1_000,
    },
    eventBus: new DomainEventBus(),
    finance: dependencies.finance,
  });
}

describe("desktop restaurant operational modules", () => {
  it("assembles the nine formal restaurant processes over one module set", () => {
    const dependencies = createDependencies();
    const resolver = new DesktopRestaurantInteractionTargetResolver(
      dependencies.content,
      dependencies.layout,
    );
    const modules = createDesktopRestaurantOperationalModules({
      content: dependencies.content,
      layout: dependencies.layout,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      finance: dependencies.finance,
      targetResolver: resolver,
      initialIngredients: M2_INITIAL_INGREDIENTS,
    });
    const fleet = createFleet(dependencies);
    const localProcurement = createDesktopLocalProcurementRuntime({
      content: dependencies.content,
      finance: dependencies.finance,
      inventory: modules.inventory,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      tasks: modules.tasks,
      fleet,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
    });
    const automaticProcurement = createDesktopAutomaticProcurementRuntime({
      procurement: localProcurement,
      inventory: modules.inventory,
      finance: dependencies.finance,
      employment: dependencies.people.employment,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
    });
    const runtime = createDesktopRestaurantOperationalRuntime({
      content: dependencies.content,
      startUtcMs: 1_000,
      modules,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      localProcurement,
      automaticProcurement,
      fleet,
      ingredientTargets: M2_INITIAL_INGREDIENTS.map((entry) => ({
        itemId: entry.itemId,
        quantity: Math.max(1, Math.floor(entry.quantity / 2)),
      })),
      activeRegionId: "region.greyfeather",
    });

    runtime.applicationRuntime.advanceTo(1_000);
    expect(runtime.applicationRuntime.getSnapshot().processes.map((process) => process.id)).toEqual([
      "10-order-recipe",
      "20-kitchen-work",
      "25-inventory-replenishment",
      "30-meal-logistics",
      "35-freight-repair",
      "40-service-work",
      "50-dishware-work",
      "60-personnel-elevator",
      "70-procurement",
    ]);
    expect(runtime.exportState().inventory).toEqual(modules.inventory.exportState());
    const projection = new RestaurantGameplayReadProjection({
      content: dependencies.content,
      operational: runtime,
      finance: dependencies.finance,
    });
    expect(projection.getSnapshot().inventory.kitchenIngredients.entries.length).toBeGreaterThan(0);
    expect(projection.advanceTo(2_000).snapshot.currentUtcMs).toBe(2_000);
  });

  it("writes a new operational save without the retired five gameplay slices", async () => {
    const dependencies = createDependencies();
    const modules = createDesktopRestaurantOperationalModules({
      content: dependencies.content,
      layout: dependencies.layout,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      finance: dependencies.finance,
      targetResolver: { resolve: () => null },
      initialIngredients: M2_INITIAL_INGREDIENTS,
    });
    const states = exportStates(modules, new RestaurantApplicationRuntime({
      startUtcMs: 1_000,
      processes: [createProcess()],
    }));
    const directory = await mkdtemp(path.join(tmpdir(), "airship-operational-save-"));
    try {
      const service = new GameSaveService(directory, () => 2_000);
      await service.saveAndFlush({ restaurantOperational: states });
      const document = JSON.parse(await readFile(path.join(directory, "save.json"), "utf8"));
      const savedModules = document.payload.modules as Record<string, unknown>;
      for (const retiredId of [
        "module.gameplay-runtime",
        "module.gameplay-inventory",
        "module.cooking",
        "module.logistics",
        "module.restaurant",
      ]) {
        expect(savedModules[retiredId]).toBeUndefined();
      }
      expect(Object.keys(savedModules)).toEqual(expect.arrayContaining(
        RESTAURANT_OPERATIONAL_SAVE_MANIFEST.map((entry) => entry.moduleId),
      ));
      const loaded = await service.load();
      expect(loaded.status).toBe("loaded");
      expect(loaded.envelope?.payload.restaurantOperational).toEqual(states);
      expect(loaded.envelope?.payload.gameplayRuntime).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("creates resident visits and keeps the formal loop healthy across two accelerated days", () => {
    const dependencies = createDependencies();
    const modules = createDesktopRestaurantOperationalModules({
      content: dependencies.content,
      layout: dependencies.layout,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      finance: dependencies.finance,
      targetResolver: new DesktopRestaurantInteractionTargetResolver(
        dependencies.content,
        dependencies.layout,
      ),
      initialIngredients: M2_INITIAL_INGREDIENTS,
    });
    const fleet = createFleet(dependencies);
    const localProcurement = createDesktopLocalProcurementRuntime({
      content: dependencies.content,
      finance: dependencies.finance,
      inventory: modules.inventory,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      tasks: modules.tasks,
      fleet,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
    });
    const automaticProcurement = createDesktopAutomaticProcurementRuntime({
      procurement: localProcurement,
      inventory: modules.inventory,
      finance: dependencies.finance,
      employment: dependencies.people.employment,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
    });
    const shiftStartUtcMs = 480 * 60_000;
    const runtime = createDesktopRestaurantOperationalRuntime({
      content: dependencies.content,
      startUtcMs: shiftStartUtcMs,
      modules,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      localProcurement,
      automaticProcurement,
      fleet,
      ingredientTargets: M2_INITIAL_INGREDIENTS,
      activeRegionId: "region.greyfeather",
    });

    for (let nowUtcMs = shiftStartUtcMs; nowUtcMs <= shiftStartUtcMs + 15 * 60_000; nowUtcMs += 1_000) {
      try {
        runtime.applicationRuntime.advanceTo(nowUtcMs);
      } catch (error) {
        throw new Error(`Formal customer loop failed at ${nowUtcMs - shiftStartUtcMs}ms ${JSON.stringify({
          visits: runtime.customers.exportState().visits.map((visit) => ({ id: visit.id, phase: visit.phase })),
          workflows: runtime.service.exportState().workflows.map((workflow) => ({ taskId: workflow.taskId, kind: workflow.kind, stage: workflow.stage })),
          desiredServiceTasks: runtime.service.createTaskSourceSnapshot().waitingTasks.map((task) => ({ id: task.taskId, type: task.taskType, source: task.sourceId })),
          supplyJobs: runtime.dishwareService.exportState().supplyJobs.map((job) => ({ id: job.id, plateId: job.plateId, status: job.status, demandId: job.logisticsDemandId })),
          logistics: runtime.logistics.exportState().groups.map((group) => ({ id: group.id, status: group.status, claimed: group.claimedQuantity, remaining: group.remainingQuantity, delivered: group.deliveredQuantity })),
          waitingTasks: runtime.tasks.createReadModel().waiting.map((task) => task.taskId),
          supplyTaskStates: runtime.tasks.exportState().tasks.filter((task) => task.taskType === "service.supply-plate").map((task) => ({ id: task.taskId, status: task.status, characterId: task.assignedCharacterId })),
          inProgressTasks: runtime.tasks.createReadModel().inProgress.map((task) => ({ id: task.taskId, characterId: task.assignedCharacterId })),
          movement: runtime.movement.exportState().characters.map((character) => ({ id: character.characterId, phase: character.plan?.phase ?? null, target: character.plan?.target ?? null })),
        })}`, { cause: error });
      }
    }

    expect(runtime.customers.exportState().visits.length).toBeGreaterThan(0);
    expect(runtime.customers.exportState().visits[0]?.memberCharacterIds).toEqual([
      instanceId("instance.character.martha_bell_resident"),
    ]);
    expect(runtime.orders.exportState().orders.some((order) => order.status === "settled")).toBe(true);
    expect(dependencies.finance.exportState().ledger.some((entry) => entry.category === "dish-sales")).toBe(true);

    for (let nowUtcMs = shiftStartUtcMs + 16 * 60_000;
      nowUtcMs <= shiftStartUtcMs + 2 * 24 * 60 * 60_000;
      nowUtcMs += 60_000) {
      runtime.applicationRuntime.advanceTo(nowUtcMs);
    }
    const visits = runtime.customers.exportState().visits;
    const visitIds = visits.map((visit) => visit.id);
    expect(visits.length).toBeGreaterThan(2);
    expect(new Set(visitIds).size).toBe(visitIds.length);
    expect(visits.every((visit) => {
      const arrivalMinute = Math.floor(visit.arrivedAtUtcMs / 60_000) % 1_440;
      return arrivalMinute >= 480 && arrivalMinute < 1_020;
    })).toBe(true);
    expect(runtime.orders.exportState().orders.filter((order) => order.status === "settled").length)
      .toBeGreaterThan(1);
    expect(runtime.applicationRuntime.getSnapshot().revision).toBeGreaterThan(1);
  }, 60_000);

  it("resolves building targets from the live 2D layout after an edit", () => {
    const dependencies = createDependencies();
    const resolver = new DesktopRestaurantInteractionTargetResolver(
      dependencies.content,
      dependencies.layout,
    );
    const target = {
      type: "building",
      id: instanceId("instance.building.ground_exchange"),
    };
    const before = resolver.resolve(target)!;

    const moved = dependencies.layout.moveBuilding(
      "test:move-ground-exchange",
      target.id,
      "scene.desktop",
      { x: 900, y: 800, orientation: "front" },
      1_000,
    );
    if (!moved.accepted) throw new Error(moved.message);
    const after = resolver.resolve(target)!;

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.candidates[0]?.bounds.x).not.toBe(before.candidates[0]?.bounds.x);
    expect(after.candidates[0]?.navigationAreaId).toBe("area.restaurant.ground");
  });
  it("constructs all formal modules from product content and restores their exported state", () => {
    const dependencies = createDependencies();
    const modules = createDesktopRestaurantOperationalModules({
      content: dependencies.content,
      layout: dependencies.layout,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      finance: dependencies.finance,
      targetResolver: { resolve: () => null },
      initialIngredients: M2_INITIAL_INGREDIENTS,
    });
    const applicationRuntime = new RestaurantApplicationRuntime({
      startUtcMs: 1_000,
      processes: [createProcess()],
    });
    const states = exportStates(modules, applicationRuntime);

    expect(modules.inventory.getLocationSnapshot(
      DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
    )?.stacks).not.toHaveLength(0);
    expect(modules.dishware.getSnapshot().plates).toHaveLength(4);
    expect(modules.freightElevators.exportState().elevators).toHaveLength(4);
    expect(modules.kitchenFacilities.createReadModel().facilities.length).toBeGreaterThan(0);

    const restoredDependencies = createDependencies();
    const restored = createDesktopRestaurantOperationalModules({
      content: restoredDependencies.content,
      layout: restoredDependencies.layout,
      characters: restoredDependencies.people.characters,
      employment: restoredDependencies.people.employment,
      finance: restoredDependencies.finance,
      targetResolver: { resolve: () => null },
      initialIngredients: M2_INITIAL_INGREDIENTS,
      initialStates: states,
    });
    const restoredRuntime = new RestaurantApplicationRuntime({
      startUtcMs: states.applicationRuntime.currentUtcMs,
      processes: [createProcess()],
      initialState: states.applicationRuntime,
    });

    expect(exportStates(restored, restoredRuntime)).toEqual(states);
  });

  it("rejects a deeply invalid domain state after the manifest header check", () => {
    const dependencies = createDependencies();
    const modules = createDesktopRestaurantOperationalModules({
      content: dependencies.content,
      layout: dependencies.layout,
      characters: dependencies.people.characters,
      employment: dependencies.people.employment,
      finance: dependencies.finance,
      targetResolver: { resolve: () => null },
      initialIngredients: M2_INITIAL_INGREDIENTS,
    });
    const states = exportStates(modules, new RestaurantApplicationRuntime({
      startUtcMs: 1_000,
      processes: [createProcess()],
    }));
    const firstCharacter = states.movement.characters[0]!;
    const invalidStates = {
      ...states,
      movement: {
        ...states.movement,
        characters: [...states.movement.characters, firstCharacter],
      },
    } as RestaurantOperationalInitialStates;
    const restoredDependencies = createDependencies();

    expect(() => createDesktopRestaurantOperationalModules({
      content: restoredDependencies.content,
      layout: restoredDependencies.layout,
      characters: restoredDependencies.people.characters,
      employment: restoredDependencies.people.employment,
      finance: restoredDependencies.finance,
      targetResolver: { resolve: () => null },
      initialIngredients: M2_INITIAL_INGREDIENTS,
      initialStates: invalidStates,
    })).toThrow();
  });
});