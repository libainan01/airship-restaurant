import {
  CUSTOMER_MODULE_ID,
  CUSTOMER_SCHEMA_VERSION,
  DISHWARE_MODULE_ID,
  DISHWARE_SCHEMA_VERSION,
  DISHWARE_SERVICE_MODULE_ID,
  DISHWARE_SERVICE_SCHEMA_VERSION,
  FREIGHT_ELEVATOR_MODULE_ID,
  FREIGHT_ELEVATOR_SCHEMA_VERSION,
  INVENTORY_MODULE_ID,
  INVENTORY_SCHEMA_VERSION,
  KITCHEN_FACILITY_MODULE_ID,
  KITCHEN_FACILITY_SCHEMA_VERSION,
  KITCHEN_PRODUCT_MODULE_ID,
  KITCHEN_PRODUCT_SCHEMA_VERSION,
  KITCHEN_STEP_EXECUTION_MODULE_ID,
  KITCHEN_STEP_EXECUTION_SCHEMA_VERSION,
  LOGISTICS_DEMAND_MODULE_ID,
  LOGISTICS_DEMAND_SCHEMA_VERSION,
  MOVEMENT_MODULE_ID,
  MOVEMENT_SCHEMA_VERSION,
  ORDER_MODULE_ID,
  ORDER_SCHEMA_VERSION,
  PERSONNEL_ELEVATOR_MODULE_ID,
  PERSONNEL_ELEVATOR_SCHEMA_VERSION,
  RECIPE_EXECUTION_MODULE_ID,
  RECIPE_EXECUTION_SCHEMA_VERSION,
  SERVICE_MODULE_ID,
  SERVICE_SCHEMA_VERSION,
  TASK_MODULE_ID,
  TASK_SCHEMA_VERSION,
  TRAY_DELIVERY_MODULE_ID,
  TRAY_DELIVERY_SCHEMA_VERSION,
  type CustomerModule,
  type CustomerModuleState,
  type DishwareModule,
  type DishwareServiceModule,
  type DishwareServiceState,
  type DishwareState,
  type FreightElevatorModule,
  type FreightElevatorState,
  type InventoryModule,
  type InventoryState,
  type KitchenFacilityModule,
  type KitchenFacilityModuleState,
  type KitchenProductModule,
  type KitchenProductState,
  type KitchenStepExecutionModule,
  type KitchenStepExecutionState,
  type LogisticsDemandModule,
  type LogisticsDemandState,
  type MovementModule,
  type MovementState,
  type OrderModule,
  type OrderModuleState,
  type PersonnelElevatorModule,
  type PersonnelElevatorState,
  type RecipeExecutionModule,
  type RecipeExecutionModuleState,
  type ServiceModule,
  type ServiceModuleState,
  type TaskModule,
  type TaskModuleState,
  type TrayDeliveryModule,
  type TrayDeliveryState,
} from "../modules";
import {
  RESTAURANT_APPLICATION_RUNTIME_MODULE_ID,
  RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION,
  isRestaurantApplicationRuntimeState,
  type RestaurantApplicationRuntime,
  type RestaurantApplicationRuntimeState,
} from "./restaurant-application-runtime";

export const RESTAURANT_OPERATIONAL_SAVE_MANIFEST = Object.freeze([
  { key: "applicationRuntime", moduleId: RESTAURANT_APPLICATION_RUNTIME_MODULE_ID, schemaVersion: RESTAURANT_APPLICATION_RUNTIME_SCHEMA_VERSION },
  { key: "inventory", moduleId: INVENTORY_MODULE_ID, schemaVersion: INVENTORY_SCHEMA_VERSION },
  { key: "tasks", moduleId: TASK_MODULE_ID, schemaVersion: TASK_SCHEMA_VERSION },
  { key: "orders", moduleId: ORDER_MODULE_ID, schemaVersion: ORDER_SCHEMA_VERSION },
  { key: "customers", moduleId: CUSTOMER_MODULE_ID, schemaVersion: CUSTOMER_SCHEMA_VERSION },
  { key: "service", moduleId: SERVICE_MODULE_ID, schemaVersion: SERVICE_SCHEMA_VERSION },
  { key: "dishware", moduleId: DISHWARE_MODULE_ID, schemaVersion: DISHWARE_SCHEMA_VERSION },
  { key: "dishwareService", moduleId: DISHWARE_SERVICE_MODULE_ID, schemaVersion: DISHWARE_SERVICE_SCHEMA_VERSION },
  { key: "recipeExecutions", moduleId: RECIPE_EXECUTION_MODULE_ID, schemaVersion: RECIPE_EXECUTION_SCHEMA_VERSION },
  { key: "movement", moduleId: MOVEMENT_MODULE_ID, schemaVersion: MOVEMENT_SCHEMA_VERSION },
  { key: "kitchenFacilities", moduleId: KITCHEN_FACILITY_MODULE_ID, schemaVersion: KITCHEN_FACILITY_SCHEMA_VERSION },
  { key: "kitchenProducts", moduleId: KITCHEN_PRODUCT_MODULE_ID, schemaVersion: KITCHEN_PRODUCT_SCHEMA_VERSION },
  { key: "kitchenSteps", moduleId: KITCHEN_STEP_EXECUTION_MODULE_ID, schemaVersion: KITCHEN_STEP_EXECUTION_SCHEMA_VERSION },
  { key: "trayDelivery", moduleId: TRAY_DELIVERY_MODULE_ID, schemaVersion: TRAY_DELIVERY_SCHEMA_VERSION },
  { key: "logistics", moduleId: LOGISTICS_DEMAND_MODULE_ID, schemaVersion: LOGISTICS_DEMAND_SCHEMA_VERSION },
  { key: "freightElevators", moduleId: FREIGHT_ELEVATOR_MODULE_ID, schemaVersion: FREIGHT_ELEVATOR_SCHEMA_VERSION },
  { key: "personnelElevator", moduleId: PERSONNEL_ELEVATOR_MODULE_ID, schemaVersion: PERSONNEL_ELEVATOR_SCHEMA_VERSION },
] as const);

export type RestaurantOperationalSaveKey = typeof RESTAURANT_OPERATIONAL_SAVE_MANIFEST[number]["key"];
export type RestaurantOperationalModuleId = typeof RESTAURANT_OPERATIONAL_SAVE_MANIFEST[number]["moduleId"];

export interface RestaurantOperationalInitialStates {
  readonly applicationRuntime: RestaurantApplicationRuntimeState;
  readonly inventory: InventoryState;
  readonly tasks: TaskModuleState;
  readonly orders: OrderModuleState;
  readonly customers: CustomerModuleState;
  readonly service: ServiceModuleState;
  readonly dishware: DishwareState;
  readonly dishwareService: DishwareServiceState;
  readonly recipeExecutions: RecipeExecutionModuleState;
  readonly movement: MovementState;
  readonly kitchenFacilities: KitchenFacilityModuleState;
  readonly kitchenProducts: KitchenProductState;
  readonly kitchenSteps: KitchenStepExecutionState;
  readonly trayDelivery: TrayDeliveryState;
  readonly logistics: LogisticsDemandState;
  readonly freightElevators: FreightElevatorState;
  readonly personnelElevator: PersonnelElevatorState;
}

export interface RestaurantOperationalStateSources {
  readonly applicationRuntime: Pick<RestaurantApplicationRuntime, "exportState">;
  readonly inventory: Pick<InventoryModule, "exportState">;
  readonly tasks: Pick<TaskModule, "exportState">;
  readonly orders: Pick<OrderModule, "exportState">;
  readonly customers: Pick<CustomerModule, "exportState">;
  readonly service: Pick<ServiceModule, "exportState">;
  readonly dishware: Pick<DishwareModule, "exportState">;
  readonly dishwareService: Pick<DishwareServiceModule, "exportState">;
  readonly recipeExecutions: Pick<RecipeExecutionModule, "exportState">;
  readonly movement: Pick<MovementModule, "exportState">;
  readonly kitchenFacilities: Pick<KitchenFacilityModule, "exportState">;
  readonly kitchenProducts: Pick<KitchenProductModule, "exportState">;
  readonly kitchenSteps: Pick<KitchenStepExecutionModule, "exportState">;
  readonly trayDelivery: Pick<TrayDeliveryModule, "exportState">;
  readonly logistics: Pick<LogisticsDemandModule, "exportState">;
  readonly freightElevators: Pick<FreightElevatorModule, "exportState">;
  readonly personnelElevator: Pick<PersonnelElevatorModule, "exportState">;
}

export interface RestaurantOperationalSaveModule {
  readonly moduleId: RestaurantOperationalModuleId;
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export type RestaurantOperationalSaveModuleTable = Readonly<Record<string, {
  readonly schemaVersion: number;
  readonly payload: unknown;
}>>;

export type RestaurantOperationalRestoreResult =
  | { readonly status: "missing"; readonly diagnostics: readonly string[] }
  | { readonly status: "invalid"; readonly diagnostics: readonly string[] }
  | { readonly status: "ready"; readonly diagnostics: readonly string[]; readonly initialStates: RestaurantOperationalInitialStates };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDomainStateHeader(value: unknown, schemaVersion: number): boolean {
  return isRecord(value) &&
    value.schemaVersion === schemaVersion &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0;
}

export function exportRestaurantOperationalSaveModules(
  sources: RestaurantOperationalStateSources,
): readonly RestaurantOperationalSaveModule[] {
  const states: RestaurantOperationalInitialStates = Object.freeze({
    applicationRuntime: sources.applicationRuntime.exportState(),
    inventory: sources.inventory.exportState(),
    tasks: sources.tasks.exportState(),
    orders: sources.orders.exportState(),
    customers: sources.customers.exportState(),
    service: sources.service.exportState(),
    dishware: sources.dishware.exportState(),
    dishwareService: sources.dishwareService.exportState(),
    recipeExecutions: sources.recipeExecutions.exportState(),
    movement: sources.movement.exportState(),
    kitchenFacilities: sources.kitchenFacilities.exportState(),
    kitchenProducts: sources.kitchenProducts.exportState(),
    kitchenSteps: sources.kitchenSteps.exportState(),
    trayDelivery: sources.trayDelivery.exportState(),
    logistics: sources.logistics.exportState(),
    freightElevators: sources.freightElevators.exportState(),
    personnelElevator: sources.personnelElevator.exportState(),
  });
  return Object.freeze(RESTAURANT_OPERATIONAL_SAVE_MANIFEST.map((entry) => Object.freeze({
    moduleId: entry.moduleId,
    schemaVersion: entry.schemaVersion,
    payload: states[entry.key],
  })));
}

export function readRestaurantOperationalInitialStates(
  modules: RestaurantOperationalSaveModuleTable,
): RestaurantOperationalRestoreResult {
  const present = RESTAURANT_OPERATIONAL_SAVE_MANIFEST.filter((entry) => modules[entry.moduleId] !== undefined);
  if (present.length === 0) {
    return Object.freeze({ status: "missing", diagnostics: Object.freeze(["Restaurant operational modules are absent; initialize a new operational world."]) });
  }
  if (present.length !== RESTAURANT_OPERATIONAL_SAVE_MANIFEST.length) {
    const missingIds = RESTAURANT_OPERATIONAL_SAVE_MANIFEST
      .filter((entry) => modules[entry.moduleId] === undefined)
      .map((entry) => entry.moduleId);
    return Object.freeze({ status: "invalid", diagnostics: Object.freeze([`Restaurant operational module set is incomplete: ${missingIds.join(", ")}`]) });
  }

  const payloads: Partial<Record<RestaurantOperationalSaveKey, unknown>> = {};
  const diagnostics: string[] = [];
  for (const entry of RESTAURANT_OPERATIONAL_SAVE_MANIFEST) {
    const saved = modules[entry.moduleId]!;
    const validPayload = entry.key === "applicationRuntime"
      ? isRestaurantApplicationRuntimeState(saved.payload)
      : hasDomainStateHeader(saved.payload, entry.schemaVersion);
    if (saved.schemaVersion !== entry.schemaVersion || !validPayload) {
      diagnostics.push(`Restaurant operational module is invalid: ${entry.moduleId}@${saved.schemaVersion}`);
      continue;
    }
    payloads[entry.key] = saved.payload;
  }
  if (diagnostics.length > 0) {
    return Object.freeze({ status: "invalid", diagnostics: Object.freeze(diagnostics) });
  }
  return Object.freeze({
    status: "ready",
    diagnostics: Object.freeze(["Restaurant operational module headers are valid; domain constructors must complete deep restore validation."]),
    initialStates: Object.freeze(payloads as unknown as RestaurantOperationalInitialStates),
  });
}