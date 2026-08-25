import { describe, expect, it } from "vitest";
import { PersonnelElevatorModule } from "../src/modules/personnel-elevator";
import { createR6DemoFixture } from "../src/demo/r6-demo-fixture";
import { RestaurantApplicationRuntime } from "../src/runtime/restaurant-application-runtime";
import {
  RESTAURANT_OPERATIONAL_SAVE_MANIFEST,
  exportRestaurantOperationalSaveModules,
  readRestaurantOperationalInitialStates,
  type RestaurantOperationalSaveModuleTable,
} from "../src/runtime/restaurant-operational-save-manifest";

function createSources() {
  const fixture = createR6DemoFixture();
  const applicationRuntime = new RestaurantApplicationRuntime({
    startUtcMs: 0,
    processes: [{
      id: "operational-save-test",
      advance: () => ({ changed: false, nextTransitionUtcMs: null }),
    }],
  });
  applicationRuntime.advanceTo(10);
  const personnelElevator = new PersonnelElevatorModule({
    id: "personnel.test",
    stations: [
      { id: "station.ground", navigationAreaId: "scene.ground", waitingPoint: { x: 0, y: 0 }, exitPoint: { x: 1, y: 0 } },
      { id: "station.airship", navigationAreaId: "scene.airship", waitingPoint: { x: 0, y: 0 }, exitPoint: { x: 1, y: 0 } },
    ],
    travelDurationMs: 1_000,
    boardingDurationMs: 100,
    alightingDurationMs: 100,
  });
  return {
    applicationRuntime,
    inventory: fixture.inventory,
    tasks: fixture.tasks,
    orders: fixture.orders,
    customers: fixture.customers,
    service: fixture.service,
    dishware: fixture.dishware,
    dishwareService: fixture.dishwareService,
    recipeExecutions: fixture.recipeExecutions,
    movement: fixture.movement,
    kitchenFacilities: fixture.kitchenFacilities,
    kitchenProducts: fixture.kitchenProducts,
    kitchenSteps: fixture.kitchenSteps,
    trayDelivery: fixture.trayDelivery,
    logistics: fixture.logistics,
    freightElevators: fixture.freightElevators,
    personnelElevator,
  };
}

function toModuleTable(
  modules: ReturnType<typeof exportRestaurantOperationalSaveModules>,
): RestaurantOperationalSaveModuleTable {
  return Object.fromEntries(modules.map((entry) => [entry.moduleId, {
    schemaVersion: entry.schemaVersion,
    payload: entry.payload,
  }]));
}

describe("restaurant operational save manifest", () => {
  it("exports every operational module once and survives a JSON round-trip", () => {
    const sources = createSources();
    const exported = exportRestaurantOperationalSaveModules(sources);
    expect(exported).toHaveLength(17);
    expect(new Set(exported.map((entry) => entry.moduleId)).size).toBe(exported.length);
    expect(exported.map((entry) => entry.moduleId)).toEqual(
      RESTAURANT_OPERATIONAL_SAVE_MANIFEST.map((entry) => entry.moduleId),
    );

    const table = JSON.parse(JSON.stringify(toModuleTable(exported))) as RestaurantOperationalSaveModuleTable;
    const restored = readRestaurantOperationalInitialStates(table);
    expect(restored).toMatchObject({ status: "ready" });
    if (restored.status !== "ready") throw new Error("Expected ready operational restore state.");
    expect(restored.initialStates.applicationRuntime).toEqual(sources.applicationRuntime.exportState());
    expect(restored.initialStates.inventory).toEqual(sources.inventory.exportState());
    expect(restored.initialStates.orders).toEqual(sources.orders.exportState());
    expect(restored.initialStates.kitchenSteps).toEqual(sources.kitchenSteps.exportState());
    expect(restored.initialStates.freightElevators).toEqual(sources.freightElevators.exportState());
  });

  it("distinguishes a legacy save from an incomplete or corrupt operational set", () => {
    expect(readRestaurantOperationalInitialStates({})).toMatchObject({ status: "missing" });

    const exported = exportRestaurantOperationalSaveModules(createSources());
    const partial = toModuleTable(exported.slice(1));
    expect(readRestaurantOperationalInitialStates(partial)).toMatchObject({
      status: "invalid",
      diagnostics: [expect.stringContaining("incomplete")],
    });

    const table = { ...toModuleTable(exported) };
    const inventoryId = RESTAURANT_OPERATIONAL_SAVE_MANIFEST.find((entry) => entry.key === "inventory")!.moduleId;
    table[inventoryId] = { ...table[inventoryId]!, schemaVersion: 999 };
    expect(readRestaurantOperationalInitialStates(table)).toMatchObject({
      status: "invalid",
      diagnostics: [expect.stringContaining(inventoryId)],
    });
  });

  it("uses the strong application runtime validator before domain restore", () => {
    const exported = exportRestaurantOperationalSaveModules(createSources());
    const table = { ...toModuleTable(exported) };
    const runtimeId = RESTAURANT_OPERATIONAL_SAVE_MANIFEST[0].moduleId;
    const runtimeModule = table[runtimeId]!;
    table[runtimeId] = {
      ...runtimeModule,
      payload: { ...(runtimeModule.payload as object), currentUtcMs: -1 },
    };
    expect(readRestaurantOperationalInitialStates(table)).toMatchObject({
      status: "invalid",
      diagnostics: [expect.stringContaining(runtimeId)],
    });
  });
});