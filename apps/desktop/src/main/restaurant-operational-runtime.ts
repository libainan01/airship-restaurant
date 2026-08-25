import type { ContentQuantity, ContentRegistry } from "@airship-restaurant/content";
import {
  EmploymentRestaurantTaskCandidateProvider,
  RestaurantApplicationRuntime,
  RestaurantDishwareWorkProcess,
  RestaurantFreightRepairProcess,
  RestaurantInventoryReplenishmentProcess,
  RestaurantKitchenWorkProcess,
  RestaurantMealLogisticsProcess,
  RestaurantOrderRecipeProcess,
  RestaurantPersonnelElevatorProcess,
  RestaurantProcurementProcess,
  RestaurantServiceWorkProcess,
  instanceId,
  type AutomaticProcurementModule,
  type CharacterModule,
  type EmploymentModule,
  type FleetModule,
  type LocalProcurementModule,
  type RestaurantApplicationRuntimeState,
  type RestaurantOperationalInitialStates,
} from "@airship-restaurant/core";
import { DesktopCustomerArrivalRuntime } from "./customer-arrival-runtime";
import { R4_RESIDENT_CHARACTER_INSTANCE_IDS } from "./r4-runtime";
import {
  DESKTOP_RESTAURANT_IDS,
  type DesktopRestaurantOperationalModules,
} from "./restaurant-operational-modules";

export interface DesktopRestaurantOperationalRuntimeOptions {
  readonly content: ContentRegistry;
  readonly startUtcMs: number;
  readonly modules: DesktopRestaurantOperationalModules;
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly localProcurement: LocalProcurementModule;
  readonly automaticProcurement: AutomaticProcurementModule;
  readonly fleet: FleetModule;
  readonly ingredientTargets: readonly ContentQuantity[];
  readonly activeRegionId: string;
  readonly initialState?: RestaurantOperationalInitialStates;
}

export interface DesktopRestaurantOperationalRuntime
extends DesktopRestaurantOperationalModules {
  readonly applicationRuntime: RestaurantApplicationRuntime;
  readonly customerArrivals: DesktopCustomerArrivalRuntime;
  exportState(): RestaurantOperationalInitialStates;
}

function serviceTarget(
  phase: string,
  logicalTarget: { readonly type: string; readonly id: string },
) {
  if (logicalTarget.type === "table") {
    return Object.freeze({ type: "table", id: logicalTarget.id });
  }
  const buildingId = phase === "dishware-source"
    ? instanceId("instance.building.dish_cabinet")
    : instanceId("instance.building.ground_exchange");
  return Object.freeze({ type: "building", id: buildingId });
}

const FREIGHT_REPAIR_PROCESS_ID = "35-freight-repair";

function migrateApplicationRuntimeState(
  state: RestaurantApplicationRuntimeState | undefined,
): RestaurantApplicationRuntimeState | undefined {
  if (state === undefined || state.processes.some((process) => process.id === FREIGHT_REPAIR_PROCESS_ID)) {
    return state;
  }
  const legacyProcessIds = new Set([
    "10-order-recipe",
    "20-kitchen-work",
    "25-inventory-replenishment",
    "30-meal-logistics",
    "40-service-work",
    "50-dishware-work",
    "60-personnel-elevator",
    "70-procurement",
  ]);
  if (state.processes.length !== legacyProcessIds.size ||
    state.processes.some((process) => !legacyProcessIds.has(process.id))) {
    return state;
  }
  return Object.freeze({
    ...state,
    processes: Object.freeze([
      ...state.processes,
      Object.freeze({ id: FREIGHT_REPAIR_PROCESS_ID, nextTransitionUtcMs: null }),
    ]),
  });
}
export function createDesktopRestaurantOperationalRuntime(
  options: DesktopRestaurantOperationalRuntimeOptions,
): DesktopRestaurantOperationalRuntime {
  const candidates = new EmploymentRestaurantTaskCandidateProvider({
    characters: options.characters,
    employment: options.employment,
    customers: options.modules.customers,
    minuteOfDayAt: (utcMs) => Math.floor(utcMs / 60_000) % 1_440,
  });
  const movement = {
    movement: options.modules.movement,
    defaultSpeedUnitsPerSecond: 0.25,
    targets: {
      resolveTarget: (
        _workflow: unknown,
        phase: string,
        logicalTarget: { readonly type: string; readonly id: string },
      ) => serviceTarget(phase, logicalTarget),
    },
    areaTransfer: {
      elevator: options.modules.personnelElevator,
      stationTarget: (stationId: string) => Object.freeze({
        type: "personnel-elevator-station",
        id: stationId,
      }),
    },
  };
  const customerArrivals = new DesktopCustomerArrivalRuntime({
    customers: options.modules.customers,
    characters: options.characters,
    employment: options.employment,
    candidateIds: R4_RESIDENT_CHARACTER_INSTANCE_IDS,
    sceneId: DESKTOP_RESTAURANT_IDS.sceneId,
  });
  const serviceWork = new RestaurantServiceWorkProcess({
    customers: options.modules.customers,
    orders: options.modules.orders,
    service: options.modules.service,
    trayDelivery: options.modules.trayDelivery,
    tasks: options.modules.tasks,
    candidates,
    settlementRegionId: options.activeRegionId,
    movement,
  });
  const serviceWithArrivals = Object.freeze({
    id: serviceWork.id,
    advance: (context: Parameters<typeof serviceWork.advance>[0]) => {
      const arrival = customerArrivals.advance(context);
      const service = serviceWork.advance(context);
      const transitions = [arrival.nextTransitionUtcMs, service.nextTransitionUtcMs]
        .filter((value): value is number => value !== null);
      return Object.freeze({
        changed: arrival.changed || service.changed,
        nextTransitionUtcMs: transitions.length === 0 ? null : Math.min(...transitions),
      });
    },
  });
  const applicationRuntime = new RestaurantApplicationRuntime({
    startUtcMs: options.startUtcMs,

    processes: [
      new RestaurantOrderRecipeProcess({
        orders: options.modules.orders,
        recipes: options.modules.recipeExecutions,
        kitchenSteps: options.modules.kitchenSteps,
      }),
      new RestaurantKitchenWorkProcess({
        kitchenSteps: options.modules.kitchenSteps,
        tasks: options.modules.tasks,
        movement: options.modules.movement,
        candidates,
      }),
      new RestaurantInventoryReplenishmentProcess({
        inventory: options.modules.inventory,
        logistics: options.modules.logistics,
        sourceLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
        targetLocationId: DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
        targets: options.ingredientTargets.map((entry) => ({
          itemId: entry.itemId,
          targetQuantity: entry.quantity,
        })),
      }),
      new RestaurantMealLogisticsProcess({
        products: options.modules.kitchenProducts,
        logistics: options.modules.logistics,
        freightElevators: options.modules.freightElevators,
        groundMealLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      }),
      new RestaurantFreightRepairProcess({
        freightElevators: options.modules.freightElevators,
        tasks: options.modules.tasks,
        candidates,
      }),
      serviceWithArrivals,
      new RestaurantDishwareWorkProcess({
        dishwareService: options.modules.dishwareService,
        dishware: options.modules.dishware,
        service: options.modules.service,
        movement,
      }),
      new RestaurantPersonnelElevatorProcess({
        elevator: options.modules.personnelElevator,
        movement: options.modules.movement,
      }),
      new RestaurantProcurementProcess({
        procurement: options.localProcurement,
        automatic: options.automaticProcurement,
        fleet: options.fleet,
        candidates,
        activeRegionId: options.activeRegionId,
        minuteOfDayAt: (utcMs) => Math.floor(utcMs / 60_000) % 1_440,
      }),
    ],
    ...(options.initialState === undefined ? {} : {
      initialState: migrateApplicationRuntimeState(options.initialState.applicationRuntime)!,
    }),
  });

  return Object.freeze({
    ...options.modules,
    applicationRuntime,
    customerArrivals,
    exportState: (): RestaurantOperationalInitialStates => Object.freeze({
      applicationRuntime: applicationRuntime.exportState(),
      inventory: options.modules.inventory.exportState(),
      tasks: options.modules.tasks.exportState(),
      orders: options.modules.orders.exportState(),
      customers: options.modules.customers.exportState(),
      service: options.modules.service.exportState(),
      dishware: options.modules.dishware.exportState(),
      dishwareService: options.modules.dishwareService.exportState(),
      recipeExecutions: options.modules.recipeExecutions.exportState(),
      movement: options.modules.movement.exportState(),
      kitchenFacilities: options.modules.kitchenFacilities.exportState(),
      kitchenProducts: options.modules.kitchenProducts.exportState(),
      kitchenSteps: options.modules.kitchenSteps.exportState(),
      trayDelivery: options.modules.trayDelivery.exportState(),
      logistics: options.modules.logistics.exportState(),
      freightElevators: options.modules.freightElevators.exportState(),
      personnelElevator: options.modules.personnelElevator.exportState(),
    }),
  });
}