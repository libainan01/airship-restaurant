import {
  AutomaticProcurementModule,
  EmploymentRestaurantManagerAvailabilityPort,
  type AutomaticProcurementOrderPort,
  type AutomaticProcurementState,
  type AutomaticProcurementStockPort,
  type EmploymentModule,
  type InventoryModule,
  type LocalProcurementModule,
  type TransactionalFinancePort,
} from "@airship-restaurant/core";

export interface DesktopAutomaticProcurementDependencies {
  readonly procurement: LocalProcurementModule;
  readonly inventory: InventoryModule;
  readonly finance: TransactionalFinancePort;
  readonly employment: EmploymentModule;
  readonly destinationLocationId: string;
  readonly initialState?: AutomaticProcurementState;
}

export function createDesktopAutomaticProcurementRuntime(
  dependencies: DesktopAutomaticProcurementDependencies,
): AutomaticProcurementModule {
  const stock: AutomaticProcurementStockPort = {
    getAvailableQuantity: (_regionId, itemId) =>
      dependencies.inventory.getLocationSnapshot(dependencies.destinationLocationId)
        ?.stacks.find((entry) => entry.itemId === itemId)?.availableQuantity ?? 0,
    getIncomingQuantity: (regionId, itemId) => {
      const state = dependencies.procurement.exportState();
      const orderIds = new Set(state.orders
        .filter((order) => order.destinationRegionId === regionId)
        .map((order) => order.id));
      return state.batches
        .filter((batch) => orderIds.has(batch.orderId) && batch.status !== "arrived")
        .flatMap((batch) => batch.items)
        .filter((item) => item.itemId === itemId)
        .reduce((sum, item) => sum + item.quantity, 0);
    },
  };
  const orders: AutomaticProcurementOrderPort = {
    getAvailableCopper: () => dependencies.finance.getSnapshot().availableCopper,
    preview: (request) => {
      const result = dependencies.procurement.previewDraft({
        recipeSelections: [],
        freeItems: [{ itemId: request.itemId, quantity: request.quantity }],
        minuteOfDay: request.minuteOfDay,
      });
      return result.accepted
        ? Object.freeze({ accepted: true, totalPriceCopper: result.value.totalPriceCopper })
        : Object.freeze({ accepted: false, message: result.message });
    },
    place: (operationId, request) => {
      const result = dependencies.procurement.placeOrder(operationId, {
        recipeSelections: [],
        freeItems: [{ itemId: request.itemId, quantity: request.quantity }],
        minuteOfDay: request.minuteOfDay,
        destinationRegionId: request.regionId,
        occurredAtUtcMs: request.occurredAtUtcMs,
        origin: "automatic",
      });
      return result.accepted
        ? Object.freeze({ accepted: true, orderIds: Object.freeze(result.value.map((order) => order.id)) })
        : Object.freeze({ accepted: false, message: result.message });
    },
  };
  return new AutomaticProcurementModule(
    new EmploymentRestaurantManagerAvailabilityPort(dependencies.employment),
    stock,
    orders,
    dependencies.initialState,
  );
}
