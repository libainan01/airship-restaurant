import type { ContentQuantity, ContentRegistry } from "@airship-restaurant/content";
import {
  CustomerModule,
  DishwareModule,
  DishwareServiceModule,
  DishwareServiceSupplyBridge,
  DomainEventBus,
  FixedTrayCapacity,
  FreightElevatorModule,
  InventoryModule,
  KitchenFacilityAdapter,
  KitchenFacilityModule,
  KitchenProductMealPlateLookup,
  KitchenProductModule,
  KitchenStepExecutionModule,
  LinearTrayTipPolicy,
  LogisticsDemandModule,
  MovementModule,
  OrderModule,
  PersonnelElevatorModule,
  RecipeExecutionModule,
  ServiceModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticRecipeExecutionCatalog,
  StaticTrayCarrierLocations,
  StaticTrayRouteCosts,
  TaskModule,
  TrayDeliveryModule,
  instanceId,
  type CharacterModule,
  type EmploymentModule,
  type FinanceModule,
  type InteractionTargetResolver,
  type InventoryItemDefinition,
  type InventoryLocationDefinition,
  type KitchenFacilityLevelDefinition,
  type RecipeExecutionDefinition,
  type RestaurantOperationalInitialStates,
  type SceneLayoutModule,
} from "@airship-restaurant/core";

export const DESKTOP_RESTAURANT_IDS = Object.freeze({
  sceneId: "scene.desktop",
  tableId: "table.ground.1",
  plateItemId: "dishware.plate",
  cabinetId: "cabinet.ground.1",
  cabinetSupplyComponentId: "component.dish-cabinet.ground.1",
  locations: Object.freeze({
    groundExchange: "storage.ground-exchange",
    airshipExchange: "storage.airship-exchange",
    cabinetClean: "storage.dish-cabinet.clean",
    cabinetDirty: "storage.dish-cabinet.dirty",
    cabinetWashing: "storage.dish-cabinet.washing",
    tableDirty: "storage.table.ground.1.dirty",
  }),
  personnelElevatorId: "personnel-elevator.restaurant-airship",
  personnelGroundStationId: "personnel-station.ground",
  personnelAirshipStationId: "personnel-station.airship",
  freightGroupId: "freight.restaurant-airship",
});

const ALL_CATEGORIES = ["ingredient", "dishware", "intermediate", "meal"] as const;
const KITCHEN_CONFIGS = Object.freeze([
  { buildingId: "building.prep_station", capabilityId: "station.prep", cachePrefix: "prep" },
  { buildingId: "building.pan_fry_station", capabilityId: "station.pan_fry", cachePrefix: "pan-fry" },
  { buildingId: "building.steam_boil_station", capabilityId: "station.steam_boil", cachePrefix: "steam-boil" },
  { buildingId: "building.baking_station", capabilityId: "station.baking", cachePrefix: "baking" },
  { buildingId: "building.plating_station", capabilityId: "station.plating", cachePrefix: "plating" },
]);

function accepted(result: { readonly accepted: boolean; readonly message?: string }, context: string): void {
  if (!result.accepted) throw new Error(`${context}: ${result.message ?? "operation rejected"}`);
}

function intermediateItemId(recipeId: string, stepId: string): string {
  return `intermediate.${recipeId.replace(/^recipe\./, "")}.${stepId.replace(/^step\./, "")}`;
}

function createRecipeDefinitions(content: ContentRegistry): readonly RecipeExecutionDefinition[] {
  return Object.freeze(content.listRecipes().map((recipe) => {
    if (recipe.productionSteps.length === 0) {
      throw new Error(`Recipe has no production steps: ${recipe.id}`);
    }
    const firstRootStepId = recipe.productionSteps.find(
      (step) => step.prerequisiteStepIds.length === 0,
    )?.id;
    return Object.freeze({
      id: recipe.id,
      version: recipe.version,
      outputItemId: recipe.outputItemId,
      ingredients: Object.freeze(recipe.ingredients.map((entry) => Object.freeze({ ...entry }))),
      steps: Object.freeze(recipe.productionSteps.map((step, index) => Object.freeze({
        id: step.id,
        name: step.name,
        durationMs: step.durationMs,
        requiredCapabilityIds: Object.freeze([...step.stationTags]),
        attendance: step.attendance,
        prerequisiteStepIds: Object.freeze([...step.prerequisiteStepIds]),
        ingredientInputs: Object.freeze(step.id === firstRootStepId
          ? recipe.ingredients.map((entry) => Object.freeze({ ...entry }))
          : []),
        outputItemId: index === recipe.productionSteps.length - 1
          ? recipe.outputItemId
          : intermediateItemId(recipe.id, step.id),
        outputQuantity: index === recipe.productionSteps.length - 1
          ? Math.max(1, recipe.outputQuantity)
          : 1,
        qualityWeight: 1,
      }))),
    });
  }));
}

function createItemDefinitions(
  content: ContentRegistry,
  recipes: readonly RecipeExecutionDefinition[],
): readonly InventoryItemDefinition[] {
  const definitions = new Map<string, InventoryItemDefinition>();
  for (const ingredient of content.listIngredients()) {
    definitions.set(ingredient.id, Object.freeze({
      id: ingredient.id,
      category: "ingredient",
      storageMode: "stack",
    }));
  }
  definitions.set(DESKTOP_RESTAURANT_IDS.plateItemId, Object.freeze({
    id: DESKTOP_RESTAURANT_IDS.plateItemId,
    category: "dishware",
    storageMode: "instance",
  }));
  for (const recipe of recipes) {
    definitions.set(recipe.outputItemId, Object.freeze({
      id: recipe.outputItemId,
      category: "meal",
      storageMode: "instance",
    }));
    for (const step of recipe.steps.slice(0, -1)) {
      definitions.set(step.outputItemId, Object.freeze({
        id: step.outputItemId,
        category: "intermediate",
        storageMode: "instance",
      }));
    }
  }
  return Object.freeze([...definitions.values()]);
}

function carrierLocationId(characterId: string): string {
  return `carrier.${characterId}`;
}

function kitchenCacheLocationId(cachePrefix: string): string {
  return `storage.kitchen.${cachePrefix}-cache`;
}

function createInventoryLocations(
  characterIds: readonly string[],
): readonly InventoryLocationDefinition[] {
  const freightTransitLocations = Array.from({ length: 4 }, (_, index) =>
    `storage.freight.${index + 1}`,
  );
  return Object.freeze([
    {
      id: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      compartments: [{ id: "mixed", capacity: 9_999, acceptedCategories: ALL_CATEGORIES }],
    },
    {
      id: DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
      compartments: [
        { id: "ingredients", capacity: 24, acceptedCategories: ["ingredient"] },
        { id: "dishware", capacity: 8, acceptedCategories: ["dishware"] },
        { id: "meals", capacity: 8, acceptedCategories: ["meal"] },
      ],
    },
    { id: DESKTOP_RESTAURANT_IDS.locations.cabinetClean, compartments: [{ id: "clean", capacity: 8, acceptedCategories: ["dishware"] }] },
    { id: DESKTOP_RESTAURANT_IDS.locations.cabinetDirty, compartments: [{ id: "dirty", capacity: 8, acceptedCategories: ["dishware"] }] },
    { id: DESKTOP_RESTAURANT_IDS.locations.cabinetWashing, compartments: [{ id: "washing", capacity: 4, acceptedCategories: ["dishware"] }] },
    { id: DESKTOP_RESTAURANT_IDS.locations.tableDirty, compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
    ...KITCHEN_CONFIGS.map((config) => ({
      id: kitchenCacheLocationId(config.cachePrefix),
      compartments: [{ id: "work", capacity: 8, acceptedCategories: ALL_CATEGORIES }],
    })),
    ...characterIds.map((characterId) => ({
      id: carrierLocationId(characterId),
      compartments: [{ id: "carried", capacity: 1, acceptedCategories: ALL_CATEGORIES }],
    })),
    ...freightTransitLocations.map((id) => ({
      id,
      compartments: [{ id: "cargo", capacity: 1, acceptedCategories: ALL_CATEGORIES }],
    })),
  ]);
}

function createKitchenFacilityDefinitions(
  content: ContentRegistry,
): readonly KitchenFacilityLevelDefinition[] {
  const buildings = new Map(content.listBuildings().map((building) => [building.id, building]));
  return Object.freeze(KITCHEN_CONFIGS.flatMap((config) => {
    const building = buildings.get(config.buildingId);
    if (building === undefined) throw new Error(`Kitchen building is missing: ${config.buildingId}`);
    const maximumWorkstations = Math.max(...building.levels.map(
      (level) => level.capabilityValues["kitchen.workstation-count"] ?? 1,
    ));
    const maximumCacheSlots = Math.max(...building.levels.map(
      (level) => level.capabilityValues["kitchen.cache-slot-count"] ?? 0,
    ));
    const workstations = Array.from({ length: maximumWorkstations }, (_, index) => Object.freeze({
      id: `workstation_${index + 1}`,
      capabilityIds: Object.freeze([config.capabilityId]),
      interactionId: `interaction.workstation.${index + 1}`,
    }));
    const cacheSlotIds = Array.from({ length: maximumCacheSlots }, (_, index) =>
      `${config.cachePrefix}_cache_${index + 1}`,
    );
    return building.levels.map((level) => Object.freeze({
      buildingDefinitionId: building.id,
      level: level.level,
      workstations: Object.freeze(workstations),
      cacheSlotIds: Object.freeze(cacheSlotIds),
      workstationCountValueKey: "kitchen.workstation-count",
      ...(maximumCacheSlots === 0 ? {} : {
        cacheSlotCountValueKey: "kitchen.cache-slot-count",
      }),
    }));
  }));
}

export interface DesktopRestaurantOperationalModuleOptions {
  readonly content: ContentRegistry;
  readonly layout: SceneLayoutModule;
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly finance: FinanceModule;
  readonly targetResolver: InteractionTargetResolver;
  readonly initialIngredients: readonly ContentQuantity[];
  readonly initialStates?: RestaurantOperationalInitialStates;
}

export interface DesktopRestaurantOperationalModules {
  readonly eventBus: DomainEventBus;
  readonly inventory: InventoryModule;
  readonly tasks: TaskModule;
  readonly orders: OrderModule;
  readonly customers: CustomerModule;
  readonly service: ServiceModule;
  readonly dishware: DishwareModule;
  readonly dishwareService: DishwareServiceModule;
  readonly recipeExecutions: RecipeExecutionModule;
  readonly movement: MovementModule;
  readonly kitchenFacilities: KitchenFacilityModule;
  readonly kitchenProducts: KitchenProductModule;
  readonly kitchenSteps: KitchenStepExecutionModule;
  readonly trayDelivery: TrayDeliveryModule;
  readonly logistics: LogisticsDemandModule;
  readonly freightElevators: FreightElevatorModule;
  readonly personnelElevator: PersonnelElevatorModule;
  readonly facilityAdapter: KitchenFacilityAdapter;
  readonly carrierLocations: StaticTrayCarrierLocations;
}

export function createDesktopRestaurantOperationalModules(
  options: DesktopRestaurantOperationalModuleOptions,
): DesktopRestaurantOperationalModules {
  const eventBus = new DomainEventBus();
  const recipes = createRecipeDefinitions(options.content);
  const orderRecipes = new StaticOrderRecipeCatalog(recipes.map((recipe) => ({
    id: recipe.id,
    ingredients: recipe.ingredients,
  })));
  const characterIds = options.characters.createReadModel().characters.map((character) => character.id);
  const inventory = new InventoryModule(
    createItemDefinitions(options.content, recipes),
    new StaticInventoryStorageDefinitions(createInventoryLocations(characterIds)),
    options.initialStates?.inventory,
  );
  if (options.initialStates === undefined && options.initialIngredients.length > 0) {
    const airshipIngredients = options.initialIngredients.map((entry) => Object.freeze({
      itemId: entry.itemId,
      quantity: Math.max(1, Math.floor(entry.quantity / 2)),
    }));
    const groundIngredients = options.initialIngredients
      .map((entry, index) => Object.freeze({
        itemId: entry.itemId,
        quantity: entry.quantity - airshipIngredients[index]!.quantity,
      }))
      .filter((entry) => entry.quantity > 0);
    accepted(inventory.depositStack(
      "bootstrap:restaurant-operational:ingredients:airship",
      DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
      airshipIngredients,
      0,
    ), "Unable to seed airship restaurant ingredients");
    if (groundIngredients.length > 0) {
      accepted(inventory.depositStack(
        "bootstrap:restaurant-operational:ingredients:ground",
        DESKTOP_RESTAURANT_IDS.locations.groundExchange,
        groundIngredients,
        0,
      ), "Unable to seed ground restaurant ingredients");
    }
  }

  const tasks = new TaskModule(undefined, options.initialStates?.tasks);
  const movement = new MovementModule({
    targetResolver: options.targetResolver,
    reservationTtlMs: 120_000,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.movement }),
  });
  if (options.initialStates === undefined) {
    for (const [index, characterId] of characterIds.entries()) {
      const isChef = characterId === instanceId("instance.character.baiyecheng_core");
      accepted(movement.registerCharacter(
        `bootstrap:restaurant-operational:movement:${characterId}`,
        characterId,
        isChef ? "area.airship.kitchen" : "area.restaurant.ground",
        isChef ? { x: 0.21, y: 0.3 } : { x: 0.82 - index * 0.04, y: 0.765 },
      ), `Unable to register movement for ${characterId}`);
    }
  }

  const dishware = new DishwareModule({
    inventory,
    eventBus,
    plateItemId: DESKTOP_RESTAURANT_IDS.plateItemId,
    cabinets: [{
      id: DESKTOP_RESTAURANT_IDS.cabinetId,
      supplyComponentId: DESKTOP_RESTAURANT_IDS.cabinetSupplyComponentId,
      cleanStorageLocationId: DESKTOP_RESTAURANT_IDS.locations.cabinetClean,
      dirtyStorageLocationId: DESKTOP_RESTAURANT_IDS.locations.cabinetDirty,
      washingLocationId: DESKTOP_RESTAURANT_IDS.locations.cabinetWashing,
      suppliedPlateCount: 4,
      washDurationMs: 20_000,
      parallelWashCount: 2,
    }],
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.dishware }),
  });
  if (options.initialStates === undefined) {
    accepted(dishware.initializeSupply(
      "bootstrap:restaurant-operational:plates",
      DESKTOP_RESTAURANT_IDS.cabinetSupplyComponentId,
      Array.from({ length: 4 }, (_, index) => instanceId(`instance.dishware.plate_${index + 1}`)),
      0,
    ), "Unable to initialize plate supply");
  }

  const orders = new OrderModule({
    finance: options.finance,
    inventory,
    recipeCatalog: orderRecipes,
    ingredientSources: [{ kind: "stack", locationId: DESKTOP_RESTAURANT_IDS.locations.airshipExchange }],
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.orders }),
  });
  const customers = new CustomerModule({
    characters: options.characters,
    employment: options.employment,
    orders,
    venues: new StaticCustomerVenueCatalog([{
      sceneId: DESKTOP_RESTAURANT_IDS.sceneId,
      waitingArea: {
        id: "waiting.desktop.default",
        slotIds: ["waiting.desktop.1", "waiting.desktop.2", "waiting.desktop.3", "waiting.desktop.4"],
      },
      tables: [{
        id: DESKTOP_RESTAURANT_IDS.tableId,
        seatIds: ["table.ground.1.seat.1", "table.ground.1.seat.2"],
      }],
    }]),
    menu: new StaticCustomerMenuCatalog([{
      sceneId: DESKTOP_RESTAURANT_IDS.sceneId,
      items: options.content.listRecipes().map((recipe) => ({
        recipeId: recipe.id,
        baseUnitPriceCopper: recipe.unitPriceCopper,
      })),
    }]),
    mealDurationMs: 60_000,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.customers }),
  });

  const dishwareSupply = new DishwareServiceSupplyBridge();
  const service = new ServiceModule({
    customers,
    orders,
    tasks,
    mealPickup: {
      isReadyAtGroundPickup: (mealId) =>
        inventory.getLocationSnapshot(DESKTOP_RESTAURANT_IDS.locations.groundExchange)
          ?.instances.some((entry) => entry.attributes.mealId === mealId) ?? false,
    },
    dishwareSupply,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.service }),
  });

  const recipeExecutions = new RecipeExecutionModule({
    catalog: new StaticRecipeExecutionCatalog(recipes),
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.recipeExecutions }),
  });
  const facilityAdapter = new KitchenFacilityAdapter(createKitchenFacilityDefinitions(options.content));
  facilityAdapter.attachLayout(options.layout);
  const kitchenFacilities = new KitchenFacilityModule({
    facilities: facilityAdapter,
    movement,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.kitchenFacilities }),
  });
  facilityAdapter.attachRuntime(kitchenFacilities);
  const kitchenProducts = new KitchenProductModule({
    recipes: recipeExecutions,
    inventory,
    dishware,
    cleanPlateLocationIds: [DESKTOP_RESTAURANT_IDS.locations.airshipExchange],
    platedMealLocationId: DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.kitchenProducts }),
  });
  const kitchenSteps = new KitchenStepExecutionModule({
    recipes: recipeExecutions,
    facilities: kitchenFacilities,
    inventory,
    orders,
    characters: options.characters,
    tasks,
    movement,
    products: kitchenProducts,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.kitchenSteps }),
  });
  const logistics = new LogisticsDemandModule({
    inventory,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.logistics }),
  });

  const carrierLocations = new StaticTrayCarrierLocations(characterIds.map((characterId) => ({
    characterId,
    locationId: carrierLocationId(characterId),
  })));
  const dishwareService = new DishwareServiceModule({
    customers,
    dishware,
    inventory,
    logistics,
    orders,
    mealPlates: new KitchenProductMealPlateLookup(kitchenProducts),
    service,
    carrierLocations,
    tables: [{
      tableId: DESKTOP_RESTAURANT_IDS.tableId,
      dirtyPlateLocationId: DESKTOP_RESTAURANT_IDS.locations.tableDirty,
      cabinetId: DESKTOP_RESTAURANT_IDS.cabinetId,
    }],
    supplyTargets: [{
      id: "dishware-supply.airship",
      sourceCleanStorageLocationId: DESKTOP_RESTAURANT_IDS.locations.cabinetClean,
      handoffLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      targetCleanStorageLocationId: DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
      targetQuantity: 2,
      plateItemId: DESKTOP_RESTAURANT_IDS.plateItemId,
    }],
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.dishwareService }),
  });
  dishwareSupply.connect(dishwareService);

  const trayDelivery = new TrayDeliveryModule({
    characters: options.characters,
    inventory,
    orders,
    service,
    capacity: new FixedTrayCapacity(1),
    carrierLocations,
    routeCosts: new StaticTrayRouteCosts([{
      fromLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      tableId: DESKTOP_RESTAURANT_IDS.tableId,
      cost: 1,
    }]),
    tips: new LinearTrayTipPolicy(100),
    groundPickupLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.trayDelivery }),
  });
  const freightElevators = new FreightElevatorModule({
    definition: {
      id: DESKTOP_RESTAURANT_IDS.freightGroupId,
      stationIds: [
        DESKTOP_RESTAURANT_IDS.locations.groundExchange,
        DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
      ],
      routeLengthUnits: 100,
      elevators: Array.from({ length: 4 }, (_, index) => ({
        id: `freight-elevator.${index + 1}`,
        transitLocationId: `storage.freight.${index + 1}`,
        initialStationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
        speedUnitsPerSecond: 25,
        maxDurability: 100,
        durabilityLossPerTrip: 1,
      })),
    },
    inventory,
    logistics,
    eventBus,
    ...(options.initialStates === undefined ? {} : { initialState: options.initialStates.freightElevators }),
  });
  const personnelElevator = new PersonnelElevatorModule({
    id: DESKTOP_RESTAURANT_IDS.personnelElevatorId,
    stations: [
      {
        id: DESKTOP_RESTAURANT_IDS.personnelGroundStationId,
        navigationAreaId: "area.restaurant.ground",
        waitingPoint: { x: 0.94, y: 0.765 },
        exitPoint: { x: 0.91, y: 0.765 },
      },
      {
        id: DESKTOP_RESTAURANT_IDS.personnelAirshipStationId,
        navigationAreaId: "area.airship.kitchen",
        waitingPoint: { x: 0.08, y: 0.3 },
        exitPoint: { x: 0.12, y: 0.3 },
      },
    ],
    travelDurationMs: 4_000,
    boardingDurationMs: 600,
    alightingDurationMs: 600,
  }, options.initialStates?.personnelElevator);

  return Object.freeze({
    eventBus,
    inventory,
    tasks,
    orders,
    customers,
    service,
    dishware,
    dishwareService,
    recipeExecutions,
    movement,
    kitchenFacilities,
    kitchenProducts,
    kitchenSteps,
    trayDelivery,
    logistics,
    freightElevators,
    personnelElevator,
    facilityAdapter,
    carrierLocations,
  });
}