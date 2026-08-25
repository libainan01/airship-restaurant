import {
  M2_LOCAL_PROCUREMENT_CARTS,
  M2_LOCAL_PROCUREMENT_SUPPLIERS,
  M2_PROCUREMENT_REGIONS,
  M2_REMOTE_PROCUREMENT_ROUTES,
  type ContentRegistry,
} from "@airship-restaurant/content";
import {
  DomainEventBus,
  LocalProcurementModule,
  StaticOrderRecipeCatalog,
  type CharacterModule,
  type EmploymentModule,
  type FleetModule,
  type InventoryModule,
  type LocalProcurementState,
  type TaskModule,
  type TransactionalFinancePort,
} from "@airship-restaurant/core";

export interface DesktopLocalProcurementDependencies {
  readonly content: ContentRegistry;
  readonly finance: TransactionalFinancePort;
  readonly inventory: InventoryModule;
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly tasks: TaskModule;
  readonly fleet: FleetModule;
  readonly destinationLocationId?: string;
  readonly initialState?: LocalProcurementState;
}

export function createDesktopLocalProcurementRuntime(
  dependencies: DesktopLocalProcurementDependencies,
): LocalProcurementModule {
  return new LocalProcurementModule({
    finance: dependencies.finance,
    inventory: dependencies.inventory,
    characters: dependencies.characters,
    employment: dependencies.employment,
    tasks: dependencies.tasks,
    recipes: new StaticOrderRecipeCatalog(
      dependencies.content.listRecipes().map((recipe) => ({
        id: recipe.id,
        ingredients: recipe.ingredients,
      })),
    ),
    pricing: {
      calculateUnitPriceCopper: (baseUnitPriceCopper, charmLevel) =>
        Math.max(1, baseUnitPriceCopper - Math.floor(Math.max(0, charmLevel - 1) / 3)),
    },
    destinationLocationId: dependencies.destinationLocationId ?? "kitchen.ingredients",
    suppliers: [
      ...M2_LOCAL_PROCUREMENT_SUPPLIERS,
      ...M2_REMOTE_PROCUREMENT_ROUTES
        .filter((route) => route.originRegionId === "region.greyfeather")
        .map((route) => {
          const region = M2_PROCUREMENT_REGIONS.find((entry) => entry.id === route.destinationRegionId);
          if (region === undefined) throw new Error(`Remote procurement route has no destination catalog: ${route.id}`);
          return Object.freeze({
            id: `supplier.remote.${region.id.slice("region.".length)}`,
            sourceRegionId: region.id,
            preparationDurationMs: region.deliveryDurationMs,
            roundTripDistanceUnits: route.roundTripDistanceUnits,
            transportMode: "remote" as const,
            routeId: route.id,
            items: Object.freeze(region.items.map((item) => Object.freeze({ itemId: item.itemId, baseUnitPriceCopper: item.unitPriceCopper }))),
          });
        }),
    ],
    carts: M2_LOCAL_PROCUREMENT_CARTS,
    fleet: dependencies.fleet,
    eventBus: new DomainEventBus(),
    ...(dependencies.initialState === undefined
      ? {}
      : { initialState: dependencies.initialState }),
  });
}