import { DomainEventBus, instanceId } from "../kernel";
import { SceneLayoutInteractionTargetResolver } from "../projections";
import { R6DemoMealDispatchCoordinator } from "./r6-demo-meal-dispatch-coordinator";
import { R6DemoStackSupplyCoordinator } from "./r6-demo-stack-supply-coordinator";
import {
  CharacterModule,
  CustomerModule,
  DishwareModule,
  DishwareServiceModule,
  DishwareServiceSupplyBridge,
  EmploymentModule,
  FinanceModule,
  FixedTrayCapacity,
  FreightElevatorModule,
  InventoryModule,
  KitchenFacilityAdapter,
  KitchenFacilityModule,
  KitchenProductMealPlateLookup,
  KitchenProductModule,
  KitchenStepExecutionModule,
  LinearTrayTipPolicy,
  LocalProcurementModule,
  LogisticsDemandModule,
  MovementModule,
  OrderModule,
  RecipeExecutionModule,
  SceneLayoutModule,
  ServiceModule,
  StaticCustomerMenuCatalog,
  StaticCustomerVenueCatalog,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticRecipeExecutionCatalog,
  StaticTrayCarrierLocations,
  StaticTrayRouteCosts,
  TrayDeliveryModule,
  TaskModule,
  type BuildingRuntimeDefinition,
  type CharacterDefinition,
  type CustomerVenueDefinition,
  type FreightElevatorGroupDefinition,
  type InventoryItemDefinition,
  type InventoryLocationDefinition,
  type KitchenFacilityLevelDefinition,
  type RecipeExecutionDefinition,
  type SceneLayoutDefinition,
} from "../modules";
export const R6_DEMO_STARTED_AT_UTC_MS = 0;
export const R6_DEMO_CURRENT_MINUTE = 600;

export const R6_DEMO_IDS = Object.freeze({
  characters: Object.freeze({
    baiyecheng: instanceId("instance.character.r6_baiyecheng"),
    otto: instanceId("instance.character.r6_otto"),
    customer: instanceId("instance.character.r6_customer"),
  }),
  items: Object.freeze({
    egg: "ingredient.egg",
    tomato: "ingredient.tomato",
    cleanPlate: "dishware.plate",
    meal: "dish.tomato_scrambled_egg",
  }),
  locations: Object.freeze({
    groundExchange: "storage.ground_exchange",
    airshipExchange: "storage.airship_exchange",
    cabinetClean: "storage.cabinet.clean",
    cabinetDirty: "storage.cabinet.dirty",
    cabinetWashing: "storage.cabinet.washing",
    prepCache: "storage.kitchen.prep_cache",
    panCache: "storage.kitchen.pan_cache",
    platingCache: "storage.kitchen.plating_cache",
    chefCarrier: "carrier.baiyecheng",
    ottoCarrier: "carrier.otto",
    tableDirty: "storage.table.demo_dirty",
  }),
  scenes: Object.freeze({ ground: "scene.greyfeather_ground", airship: "scene.kitchen_airship" }),
  recipe: "recipe.tomato_scrambled_egg",
  cabinetSupply: "component.cabinet.demo_supply",
  freightGroup: "freight.r6_demo",
});

export const R6_DEMO_TECHNOLOGY_LEVELS = Object.freeze({
  freightDriveEfficiency: 0,
  parallelFreightElevators: 0,
  organizationManagement: 0,
  trayImprovement: 0,
  recruitmentNetwork: 0,
});

export const R6_DEMO_ECONOMY = Object.freeze({
  startingCopper: 200,
  ingredientUnitPriceCopper: Object.freeze({
    [R6_DEMO_IDS.items.egg]: 4,
    [R6_DEMO_IDS.items.tomato]: 3,
  }),
  ingredientCostPerPortionCopper: 17,
  fivePortionIngredientCostCopper: 85,
  localProcurementCarryCapacity: 5,
});

export const R6_DEMO_CHARACTER_DEFINITIONS = Object.freeze([
  { id: "character.baiyecheng", name: "白夜城", baseSkills: { cooking: 8, charm: 3, movement: 5, repair: 3, piloting: 2 }, defaultTalentIds: [] },
  { id: "character.otto", name: "奥拓", baseSkills: { cooking: 2, charm: 7, movement: 6, repair: 3, piloting: 2 }, defaultTalentIds: [] },
  { id: "character.demo_customer", name: "普通顾客", baseSkills: { cooking: 1, charm: 2, movement: 4, repair: 1, piloting: 1 }, defaultTalentIds: [] },
] as const satisfies readonly CharacterDefinition[]);

export const R6_DEMO_RECIPE = Object.freeze({
  id: R6_DEMO_IDS.recipe,
  version: 1,
  outputItemId: R6_DEMO_IDS.items.meal,
  ingredients: Object.freeze([
    { itemId: R6_DEMO_IDS.items.egg, quantity: 2 },
    { itemId: R6_DEMO_IDS.items.tomato, quantity: 3 },
  ]),
  steps: Object.freeze([
    { id: "step.process_tomato", name: "处理西红柿", durationMs: 8_000, requiredCapabilityIds: ["station.prep"], attendance: "required", prerequisiteStepIds: [], ingredientInputs: [{ itemId: R6_DEMO_IDS.items.tomato, quantity: 3 }], outputItemId: "intermediate.processed_tomato", outputQuantity: 1, qualityWeight: 1 },
    { id: "step.whisk_egg", name: "打散鸡蛋", durationMs: 7_000, requiredCapabilityIds: ["station.prep"], attendance: "required", prerequisiteStepIds: [], ingredientInputs: [{ itemId: R6_DEMO_IDS.items.egg, quantity: 2 }], outputItemId: "intermediate.whisked_egg", outputQuantity: 1, qualityWeight: 1 },
    { id: "step.fry_tomato", name: "炒西红柿", durationMs: 12_000, requiredCapabilityIds: ["station.pan_fry"], attendance: "required", prerequisiteStepIds: ["step.process_tomato"], ingredientInputs: [], outputItemId: "intermediate.fried_tomato", outputQuantity: 1, qualityWeight: 2 },
    { id: "step.fry_egg", name: "炒鸡蛋", durationMs: 10_000, requiredCapabilityIds: ["station.pan_fry"], attendance: "required", prerequisiteStepIds: ["step.whisk_egg"], ingredientInputs: [], outputItemId: "intermediate.fried_egg", outputQuantity: 1, qualityWeight: 2 },
    { id: "step.combine", name: "合炒", durationMs: 9_000, requiredCapabilityIds: ["station.pan_fry"], attendance: "required", prerequisiteStepIds: ["step.fry_tomato", "step.fry_egg"], ingredientInputs: [], outputItemId: "intermediate.tomato_egg", outputQuantity: 1, qualityWeight: 3 },
    { id: "step.plate", name: "装盘", durationMs: 5_000, requiredCapabilityIds: ["station.plating"], attendance: "required", prerequisiteStepIds: ["step.combine"], ingredientInputs: [], outputItemId: R6_DEMO_IDS.items.meal, outputQuantity: 1, qualityWeight: 1 },
  ]),
} satisfies RecipeExecutionDefinition);

const intermediateIds = R6_DEMO_RECIPE.steps.slice(0, -1).map((step) => step.outputItemId);
export const R6_DEMO_ITEM_DEFINITIONS: readonly InventoryItemDefinition[] = Object.freeze([
  { id: R6_DEMO_IDS.items.egg, category: "ingredient", storageMode: "stack" },
  { id: R6_DEMO_IDS.items.tomato, category: "ingredient", storageMode: "stack" },
  { id: R6_DEMO_IDS.items.cleanPlate, category: "dishware", storageMode: "instance" },
  ...intermediateIds.map((id) => ({ id, category: "intermediate" as const, storageMode: "instance" as const })),
  { id: R6_DEMO_IDS.items.meal, category: "meal", storageMode: "instance" },
]);

const allCategories = ["ingredient", "dishware", "intermediate", "meal"] as const;
const transitLocationIds = Object.freeze(Array.from({ length: 4 }, (_, index) => `storage.freight_${index + 1}`));
export const R6_DEMO_INVENTORY_LOCATIONS: readonly InventoryLocationDefinition[] = Object.freeze([
  { id: R6_DEMO_IDS.locations.groundExchange, compartments: [{ id: "mixed", capacity: 10_000, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.airshipExchange, compartments: [
    { id: "ingredients", capacity: 20, acceptedCategories: ["ingredient"] },
    { id: "plates", capacity: 4, acceptedCategories: ["dishware"] },
    { id: "meals", capacity: 4, acceptedCategories: ["meal"] },
  ] },
  { id: R6_DEMO_IDS.locations.cabinetClean, compartments: [{ id: "clean", capacity: 4, acceptedCategories: ["dishware"] }] },
  { id: R6_DEMO_IDS.locations.cabinetDirty, compartments: [{ id: "dirty", capacity: 4, acceptedCategories: ["dishware"] }] },
  { id: R6_DEMO_IDS.locations.cabinetWashing, compartments: [{ id: "washing", capacity: 2, acceptedCategories: ["dishware"] }] },
  { id: R6_DEMO_IDS.locations.prepCache, compartments: [{ id: "work", capacity: 2, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.panCache, compartments: [{ id: "work", capacity: 4, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.platingCache, compartments: [{ id: "work", capacity: 3, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.chefCarrier, compartments: [{ id: "carried", capacity: 1, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.ottoCarrier, compartments: [{ id: "carried", capacity: 1, acceptedCategories: allCategories }] },
  { id: R6_DEMO_IDS.locations.tableDirty, compartments: [{ id: "dirty", capacity: 2, acceptedCategories: ["dishware"] }] },
  ...transitLocationIds.map((id) => ({ id, compartments: [{ id: "cargo", capacity: 1, acceptedCategories: allCategories }] })),
]);

export const R6_DEMO_SUPPLY_TARGETS = Object.freeze([
  { locationId: R6_DEMO_IDS.locations.airshipExchange, itemId: R6_DEMO_IDS.items.egg, targetQuantity: 2 },
  { locationId: R6_DEMO_IDS.locations.airshipExchange, itemId: R6_DEMO_IDS.items.tomato, targetQuantity: 3 },
  { locationId: R6_DEMO_IDS.locations.airshipExchange, itemId: R6_DEMO_IDS.items.cleanPlate, targetQuantity: 2 },
]);

export const R6_DEMO_CUSTOMER_VENUES = Object.freeze([{
  sceneId: R6_DEMO_IDS.scenes.ground,
  waitingArea: { id: "waiting.default", slotIds: ["waiting.slot.1", "waiting.slot.2", "waiting.slot.3", "waiting.slot.4"] },
  tables: [{ id: "table.demo", seatIds: ["table.demo.seat.1", "table.demo.seat.2"] }],
}] as const satisfies readonly CustomerVenueDefinition[]);

export const R6_DEMO_SCENES = Object.freeze([
  { id: R6_DEMO_IDS.scenes.ground, placementRegions: [{ id: "region.ground", tag: "zone.ground", bounds: { x: 0, y: 0, width: 160, height: 80 } }] },
  { id: R6_DEMO_IDS.scenes.airship, placementRegions: [{ id: "region.airship", tag: "zone.airship", bounds: { x: 0, y: 0, width: 160, height: 80 } }] },
] as const satisfies readonly SceneLayoutDefinition[]);

function building(id: string, region: "zone.ground" | "zone.airship", capabilityId: string): BuildingRuntimeDefinition {
  return { id, buildCostCopper: 0, allowedRegionTags: [region], styleIds: ["style.default"], defaultStyleId: "style.default", defaultOrientation: "normal", necessary: true, movable: true, storable: false, removable: false, levels: [{ level: 1, upgradeCostCopper: 0, maxDurability: 100, components: [{ slotId: "slot.main", capabilityId }], layouts: { normal: { hardFootprints: [{ x: 0, y: 0, width: 10, height: 10 }], visualBounds: { x: 0, y: 0, width: 10, height: 10 }, interactionAreas: [{ id: "interaction.front", bounds: { x: 11, y: 2, width: 4, height: 6 }, required: true }] } } }] };
}

export const R6_DEMO_BUILDING_DEFINITIONS = Object.freeze([
  building("building.ground_exchange", "zone.ground", "capability.storage.exchange"),
  building("building.employee_center", "zone.ground", "capability.employee_management"),
  building("building.cabinet", "zone.ground", "capability.dishware"),
  building("building.order_transfer", "zone.ground", "capability.order_transfer"),
  building("building.table_two_seat", "zone.ground", "capability.table"),
  building("building.airship_exchange", "zone.airship", "capability.storage.exchange"),
  building("building.prep_station", "zone.airship", "station.prep"),
  building("building.pan_station", "zone.airship", "station.pan_fry"),
  building("building.plating_station", "zone.airship", "station.plating"),
]);

export const R6_DEMO_KITCHEN_FACILITIES = Object.freeze([
  { buildingDefinitionId: "building.prep_station", level: 1, workstations: [{ id: "main", capabilityIds: ["station.prep"], interactionId: "interaction.front" }], cacheSlotIds: ["prep_a", "prep_b"] },
  { buildingDefinitionId: "building.pan_station", level: 1, workstations: [{ id: "main", capabilityIds: ["station.pan_fry"], interactionId: "interaction.front" }], cacheSlotIds: ["pan_a", "pan_b", "pan_c"] },
  { buildingDefinitionId: "building.plating_station", level: 1, workstations: [{ id: "main", capabilityIds: ["station.plating"], interactionId: "interaction.front" }], cacheSlotIds: [] },
] as const satisfies readonly KitchenFacilityLevelDefinition[]);
export const R6_DEMO_FREIGHT_ELEVATORS: FreightElevatorGroupDefinition = Object.freeze({
  id: R6_DEMO_IDS.freightGroup,
  stationIds: [R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.locations.airshipExchange] as const,
  routeLengthUnits: 100,
  elevators: Object.freeze(transitLocationIds.map((transitLocationId, index) => ({ id: `freight.demo.${index + 1}`, transitLocationId, initialStationId: R6_DEMO_IDS.locations.groundExchange, speedUnitsPerSecond: 25, maxDurability: 100, durabilityLossPerTrip: 1 }))),
});

export interface R6DemoFixture {
  readonly eventBus: DomainEventBus;
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly layout: SceneLayoutModule;
  readonly inventory: InventoryModule;
  readonly dishware: DishwareModule;
  readonly tasks: TaskModule;
  readonly localProcurement: LocalProcurementModule;
  readonly orders: OrderModule;
  readonly customers: CustomerModule;
  readonly service: ServiceModule;
  readonly dishwareService: DishwareServiceModule;
  readonly recipeExecutions: RecipeExecutionModule;
  readonly movement: MovementModule;
  readonly kitchenFacilities: KitchenFacilityModule;
  readonly kitchenProducts: KitchenProductModule;
  readonly kitchenSteps: KitchenStepExecutionModule;
  readonly mealDispatch: R6DemoMealDispatchCoordinator;
  readonly trayDelivery: TrayDeliveryModule;
  readonly stackSupply: R6DemoStackSupplyCoordinator;
  readonly logistics: LogisticsDemandModule;
  readonly freightElevators: FreightElevatorModule;
  readonly finance: FinanceModule;
  readonly recipeCatalog: StaticRecipeExecutionCatalog;
  readonly customerVenues: StaticCustomerVenueCatalog;
  readonly technologyLevels: typeof R6_DEMO_TECHNOLOGY_LEVELS;
  readonly supplyTargets: typeof R6_DEMO_SUPPLY_TARGETS;
}

function assertAccepted(result: { readonly accepted: boolean; readonly message?: string }): void {
  if (!result.accepted) throw new Error(result.message ?? "R6 Demo fixture initialization failed.");
}

export function createR6DemoFixture(): R6DemoFixture {
  const eventBus = new DomainEventBus();
  const characters = new CharacterModule(R6_DEMO_CHARACTER_DEFINITIONS, []);
  assertAccepted(characters.createCharacter("r6:create:baiyecheng", { instanceId: R6_DEMO_IDS.characters.baiyecheng, definitionId: "character.baiyecheng", coreMember: true, occurredAtUtcMs: 0 }));
  assertAccepted(characters.createCharacter("r6:create:otto", { instanceId: R6_DEMO_IDS.characters.otto, definitionId: "character.otto", coreMember: true, occurredAtUtcMs: 0 }));
  assertAccepted(characters.createCharacter("r6:create:customer", { instanceId: R6_DEMO_IDS.characters.customer, definitionId: "character.demo_customer", coreMember: false, occurredAtUtcMs: 0 }));

  const employment = new EmploymentModule(characters);
  const shift = { startMinuteInclusive: 0, endMinuteExclusive: 1_439 };
  assertAccepted(employment.addEmployee("r6:employ:baiyecheng", { characterId: R6_DEMO_IDS.characters.baiyecheng, kind: "core", learnedJobIds: ["job.chef"], primaryJobId: "job.chef", dailyShift: shift, occurredAtUtcMs: 0 }));
  assertAccepted(employment.addEmployee("r6:employ:otto", { characterId: R6_DEMO_IDS.characters.otto, kind: "core", learnedJobIds: ["job.waiter", "job.local_procurer"], primaryJobId: "job.waiter", dailyShift: shift, occurredAtUtcMs: 0 }));

  const kitchenFacilityAdapter = new KitchenFacilityAdapter(R6_DEMO_KITCHEN_FACILITIES);
  const layout = new SceneLayoutModule(R6_DEMO_SCENES, R6_DEMO_BUILDING_DEFINITIONS, kitchenFacilityAdapter);
  kitchenFacilityAdapter.attachLayout(layout);
  const groundIds = ["building.ground_exchange", "building.employee_center", "building.cabinet", "building.order_transfer", "building.table_two_seat"];
  const airshipIds = ["building.airship_exchange", "building.prep_station", "building.pan_station", "building.plating_station"];
  for (const [index, definitionId] of groundIds.entries()) assertAccepted(layout.placeBuilding(`r6:place:ground:${index}`, { instanceId: instanceId(`instance.${definitionId}`), definitionId, sceneId: R6_DEMO_IDS.scenes.ground, transform: { x: index * 24, y: 10, orientation: "normal" }, totalInvestmentCopper: 0, occurredAtUtcMs: 0 }));
  for (const [index, definitionId] of airshipIds.entries()) assertAccepted(layout.placeBuilding(`r6:place:airship:${index}`, { instanceId: instanceId(`instance.${definitionId}`), definitionId, sceneId: R6_DEMO_IDS.scenes.airship, transform: { x: index * 24, y: 10, orientation: "normal" }, totalInvestmentCopper: 0, occurredAtUtcMs: 0 }));

  const inventory = new InventoryModule(R6_DEMO_ITEM_DEFINITIONS, new StaticInventoryStorageDefinitions(R6_DEMO_INVENTORY_LOCATIONS));
  const dishware = new DishwareModule({ inventory, eventBus, plateItemId: R6_DEMO_IDS.items.cleanPlate, cabinets: [{ id: "cabinet.demo", supplyComponentId: R6_DEMO_IDS.cabinetSupply, cleanStorageLocationId: R6_DEMO_IDS.locations.cabinetClean, dirtyStorageLocationId: R6_DEMO_IDS.locations.cabinetDirty, washingLocationId: R6_DEMO_IDS.locations.cabinetWashing, suppliedPlateCount: 4, washDurationMs: 10_000, parallelWashCount: 2 }] });
  assertAccepted(dishware.initializeSupply("r6:plates:initialize", R6_DEMO_IDS.cabinetSupply, Array.from({ length: 4 }, (_, index) => instanceId(`instance.dishware.r6_plate_${index + 1}`)), 0));
  const tasks = new TaskModule();
  const finance = new FinanceModule(R6_DEMO_ECONOMY.startingCopper);
  const orderRecipes = new StaticOrderRecipeCatalog([{ id: R6_DEMO_RECIPE.id, ingredients: R6_DEMO_RECIPE.ingredients }]);
  const localProcurement = new LocalProcurementModule({
    finance,
    inventory,
    characters,
    employment,
    tasks,
    recipes: orderRecipes,
    eventBus,
    pricing: { calculateUnitPriceCopper: (baseUnitPriceCopper, charmLevel) => Math.max(1, baseUnitPriceCopper - Math.floor(Math.max(0, charmLevel - 1) / 3)) },
    destinationLocationId: R6_DEMO_IDS.locations.groundExchange,
    suppliers: [{
      id: "supplier.greyfeather_market",
      sourceRegionId: "region.greyfeather",
      preparationDurationMs: 500,
      roundTripDistanceUnits: 100,
      items: [
        { itemId: R6_DEMO_IDS.items.egg, baseUnitPriceCopper: R6_DEMO_ECONOMY.ingredientUnitPriceCopper[R6_DEMO_IDS.items.egg] },
        { itemId: R6_DEMO_IDS.items.tomato, baseUnitPriceCopper: R6_DEMO_ECONOMY.ingredientUnitPriceCopper[R6_DEMO_IDS.items.tomato] },
      ],
    }],
    carts: [{ id: "cart.otto", capacity: R6_DEMO_ECONOMY.localProcurementCarryCapacity, speedUnitsPerSecond: 20 }],
  });
  const orders = new OrderModule({ finance, inventory, recipeCatalog: orderRecipes, ingredientSources: [{ kind: "stack", locationId: R6_DEMO_IDS.locations.airshipExchange }], eventBus });
  const customers = new CustomerModule({
    characters,
    employment,
    orders,
    venues: new StaticCustomerVenueCatalog(R6_DEMO_CUSTOMER_VENUES),
    menu: new StaticCustomerMenuCatalog([{ sceneId: R6_DEMO_IDS.scenes.ground, items: [{ recipeId: R6_DEMO_IDS.recipe, baseUnitPriceCopper: 30 }] }]),
    mealDurationMs: 1_000,
    eventBus,
  });
  const dishwareSupplyBridge = new DishwareServiceSupplyBridge();
  const service = new ServiceModule({
    customers,
    orders,
    tasks,
    mealPickup: { isReadyAtGroundPickup: (mealId) => inventory.getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)?.instances.some((entry) => entry.attributes.mealId === mealId) ?? false },
    dishwareSupply: dishwareSupplyBridge,
    eventBus,
  });
  const recipeCatalog = new StaticRecipeExecutionCatalog([R6_DEMO_RECIPE]);
  const recipeExecutions = new RecipeExecutionModule({ catalog: recipeCatalog, eventBus });
  const movement = new MovementModule({ targetResolver: new SceneLayoutInteractionTargetResolver(layout, (building) => building.sceneId), reservationTtlMs: 120_000 });
  assertAccepted(movement.registerCharacter("r6:movement:baiyecheng", R6_DEMO_IDS.characters.baiyecheng, R6_DEMO_IDS.scenes.airship, { x: 35, y: 12 }));
  assertAccepted(movement.registerCharacter("r6:movement:otto", R6_DEMO_IDS.characters.otto, R6_DEMO_IDS.scenes.ground, { x: 0, y: 70 }));
  const kitchenFacilities = new KitchenFacilityModule({ facilities: kitchenFacilityAdapter, movement, eventBus });
  kitchenFacilityAdapter.attachRuntime(kitchenFacilities);
  const kitchenProducts = new KitchenProductModule({ recipes: recipeExecutions, inventory, dishware, cleanPlateLocationIds: [R6_DEMO_IDS.locations.airshipExchange], platedMealLocationId: R6_DEMO_IDS.locations.airshipExchange, eventBus });
  const kitchenSteps = new KitchenStepExecutionModule({ recipes: recipeExecutions, facilities: kitchenFacilities, inventory, orders, characters, tasks, movement, products: kitchenProducts, eventBus });
  const logistics = new LogisticsDemandModule({ inventory, eventBus });
  const dishwareService = new DishwareServiceModule({
    customers,
    dishware,
    inventory,
    logistics,
    orders,
    mealPlates: new KitchenProductMealPlateLookup(kitchenProducts),
    service,
    carrierLocations: new StaticTrayCarrierLocations([{ characterId: R6_DEMO_IDS.characters.otto, locationId: R6_DEMO_IDS.locations.ottoCarrier }]),
    tables: [{ tableId: "table.demo", dirtyPlateLocationId: R6_DEMO_IDS.locations.tableDirty, cabinetId: "cabinet.demo" }],
    supplyTargets: [{ id: "target.airship.plates", sourceCleanStorageLocationId: R6_DEMO_IDS.locations.cabinetClean, handoffLocationId: R6_DEMO_IDS.locations.groundExchange, targetCleanStorageLocationId: R6_DEMO_IDS.locations.airshipExchange, targetQuantity: 2, plateItemId: R6_DEMO_IDS.items.cleanPlate }],
    eventBus,
  });
  dishwareSupplyBridge.connect(dishwareService);
  const mealDispatch = new R6DemoMealDispatchCoordinator({ products: kitchenProducts, logistics, groundLocationId: R6_DEMO_IDS.locations.groundExchange });
  const trayDelivery = new TrayDeliveryModule({ characters, inventory, orders, service, capacity: new FixedTrayCapacity(1), carrierLocations: new StaticTrayCarrierLocations([{ characterId: R6_DEMO_IDS.characters.otto, locationId: R6_DEMO_IDS.locations.ottoCarrier }]), routeCosts: new StaticTrayRouteCosts([{ fromLocationId: R6_DEMO_IDS.locations.groundExchange, tableId: "table.demo", cost: 1 }]), tips: new LinearTrayTipPolicy(100), groundPickupLocationId: R6_DEMO_IDS.locations.groundExchange, eventBus });
  const stackSupply = new R6DemoStackSupplyCoordinator({ inventory, logistics, targets: R6_DEMO_SUPPLY_TARGETS.filter((target) => target.itemId !== R6_DEMO_IDS.items.cleanPlate).map((target) => ({ id: `target.${target.itemId}`, sourceLocationId: R6_DEMO_IDS.locations.groundExchange, targetLocationId: target.locationId, itemId: target.itemId, targetQuantity: target.targetQuantity })) });
  const freightElevators = new FreightElevatorModule({ definition: R6_DEMO_FREIGHT_ELEVATORS, inventory, logistics, eventBus });

  return Object.freeze({ eventBus, characters, employment, layout, inventory, dishware, tasks, localProcurement, orders, customers, service, dishwareService, recipeExecutions, movement, kitchenFacilities, kitchenProducts, kitchenSteps, mealDispatch, trayDelivery, stackSupply, logistics, freightElevators, finance, recipeCatalog, customerVenues: new StaticCustomerVenueCatalog(R6_DEMO_CUSTOMER_VENUES), technologyLevels: R6_DEMO_TECHNOLOGY_LEVELS, supplyTargets: R6_DEMO_SUPPLY_TARGETS });
}