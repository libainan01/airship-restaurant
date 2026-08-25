import type {
  GameplayCookingSnapshot,
  GameplayInventoryContainerSnapshot,
  GameplayLogisticsSnapshot,
  GameplayRestaurantCustomerPhase,
  GameplayRestaurantCustomerSnapshot,
  GameplayRestaurantDiningCustomerSnapshot,
  GameplayRestaurantSaleSnapshot,
  GameplayRestaurantSnapshot,
  GameplaySnapshot,
} from "@airship-restaurant/contracts";
import type { ContentRegistry } from "@airship-restaurant/content";
import {
  type FinanceModule,
  type InventoryLocationSnapshot,
  type RuntimeSimulation,
} from "@airship-restaurant/core";
import {
  DESKTOP_RESTAURANT_IDS,
} from "./restaurant-operational-modules";
import type { DesktopRestaurantOperationalRuntime } from "./restaurant-operational-runtime";

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function emptyContainer(id: string): GameplayInventoryContainerSnapshot {
  return freeze({ id, capacity: 0, totalQuantity: 0, availableCapacity: 0, entries: freeze([]) });
}

function projectContainer(
  id: string,
  locations: readonly InventoryLocationSnapshot[],
): GameplayInventoryContainerSnapshot {
  if (locations.length === 0) return emptyContainer(id);
  const quantities = new Map<string, { quantity: number; reserved: number }>();
  let capacity = 0;
  let occupied = 0;
  let availableCapacity = 0;
  for (const location of locations) {
    for (const compartment of location.compartments) {
      capacity += compartment.capacity;
      occupied += compartment.occupied;
      availableCapacity += compartment.availableCapacity;
    }
    for (const stack of location.stacks) {
      const current = quantities.get(stack.itemId) ?? { quantity: 0, reserved: 0 };
      current.quantity += stack.quantity;
      current.reserved += stack.reservedQuantity;
      quantities.set(stack.itemId, current);
    }
    for (const instance of location.instances) {
      const current = quantities.get(instance.itemId) ?? { quantity: 0, reserved: 0 };
      current.quantity += 1;
      current.reserved += instance.reservationId === null ? 0 : 1;
      quantities.set(instance.itemId, current);
    }
    for (const cargo of location.stackCargo) {
      const current = quantities.get(cargo.itemId) ?? { quantity: 0, reserved: 0 };
      current.quantity += 1;
      quantities.set(cargo.itemId, current);
    }
  }
  const entries = freeze([...quantities.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, value]) => freeze({
      itemId,
      quantity: value.quantity,
      reservedQuantity: value.reserved,
      availableQuantity: Math.max(0, value.quantity - value.reserved),
    })));
  return freeze({
    id,
    capacity,
    totalQuantity: occupied,
    availableCapacity,
    entries,
  });
}

function customerPhase(phase: string): GameplayRestaurantCustomerPhase {
  switch (phase) {
    case "awaiting-order": return "awaiting-order-confirmation";
    case "pending-order": return "notifying-kitchen";
    default: return "waiting-meal";
  }
}

export class RestaurantGameplayReadProjection implements RuntimeSimulation {
  readonly #content: ContentRegistry;
  readonly #operational: DesktopRestaurantOperationalRuntime;
  readonly #finance: FinanceModule;

  constructor(options: {
    readonly content: ContentRegistry;
    readonly operational: DesktopRestaurantOperationalRuntime;
    readonly finance: FinanceModule;
  }) {
    this.#content = options.content;
    this.#operational = options.operational;
    this.#finance = options.finance;
  }

  getSnapshot(): GameplaySnapshot {
    const application = this.#operational.applicationRuntime.getSnapshot();
    const inventory = this.#operational.inventory.getSnapshot();
    const locations = new Map(inventory.locations.map((location) => [location.id, location]));
    const at = (id: string): readonly InventoryLocationSnapshot[] => {
      const location = locations.get(id);
      return location === undefined ? freeze([]) : freeze([location]);
    };
    const freightLocations = inventory.locations.filter((location) =>
      location.id.startsWith("storage.freight."),
    );
    const executions = this.#operational.recipeExecutions.createReadModel();
    const activeExecution = executions.active[0] ?? null;
    const activeStep = activeExecution?.steps.find((step) => step.status === "in-progress") ?? null;
    const activeDefinition = activeExecution === null || activeStep === null
      ? null
      : activeExecution.recipe.steps.find((step) => step.id === activeStep.definitionStepId) ?? null;
    const cooking: GameplayCookingSnapshot = freeze({
      selectedRecipeId: activeExecution?.recipe.id ?? null,
      autoRepeat: false,
      activeJob: activeExecution === null || activeStep === null
        ? null
        : freeze({
            id: activeExecution.id,
            recipeId: activeExecution.recipe.id,
            status: "cooking" as const,
            startedAtUtcMs: activeStep.startedAtUtcMs ?? application.currentUtcMs,
            finishAtUtcMs: (activeStep.startedAtUtcMs ?? application.currentUtcMs) +
              (activeDefinition?.durationMs ?? 0),
          }),
      blockedReason: null,
      completedBatches: executions.completed.length,
      nextTransitionUtcMs: application.nextTransitionUtcMs,
    });

    const freight = this.#operational.freightElevators.getSnapshot(application.currentUtcMs);
    const loaded = freight.elevators.find((elevator) => elevator.phase === "moving-loaded");
    const empty = freight.elevators.find((elevator) => elevator.phase === "moving-empty");
    const moving = loaded ?? empty ?? null;
    const logisticsState = this.#operational.logistics.exportState();
    const finishedMealGroups = logisticsState.groups.filter((group) => group.kind === "finished-meal");
    const logistics: GameplayLogisticsSnapshot = freeze({
      phase: loaded !== undefined ? "outbound" : empty !== undefined ? "returning" : "idle",
      shipmentId: moving?.activeClaimId ?? null,
      departedAtUtcMs: moving?.motionStartedAtUtcMs ?? null,
      arriveAtUtcMs: loaded?.motionEndsAtUtcMs ?? null,
      returnStartedAtUtcMs: empty?.motionStartedAtUtcMs ?? null,
      returnAtUtcMs: empty?.motionEndsAtUtcMs ?? null,
      kitchenWaitingSinceUtcMs: finishedMealGroups.find((group) => group.status === "in-progress")?.createdAtUtcMs ?? null,
      kitchenWaitingQuantity: finishedMealGroups.reduce((sum, group) => sum + group.remainingQuantity, 0),
      cargoQuantity: freight.elevators.filter((elevator) => elevator.activeClaimId !== null).length,
      totalDeliveredQuantity: finishedMealGroups.reduce((sum, group) => sum + group.deliveredQuantity, 0),
      nextTransitionUtcMs: moving?.motionEndsAtUtcMs ?? application.nextTransitionUtcMs,
    });

    const restaurant = this.#projectRestaurant(application.currentUtcMs);
    return freeze({
      revision: application.revision,
      currentUtcMs: application.currentUtcMs,
      nextSupplyAtUtcMs: application.nextTransitionUtcMs ?? application.currentUtcMs,
      supplyBoxesReceived: 0,
      inventory: freeze({
        kitchenIngredients: projectContainer("operational.airship-exchange", at(DESKTOP_RESTAURANT_IDS.locations.airshipExchange)),
        kitchenOutput: projectContainer("operational.airship-meals", at(DESKTOP_RESTAURANT_IDS.locations.airshipExchange)),
        cableCargo: projectContainer("operational.freight", freightLocations),
        restaurantStorage: projectContainer("operational.ground-exchange", at(DESKTOP_RESTAURANT_IDS.locations.groundExchange)),
      }),
      cooking,
      logistics,
      restaurant,
      upgrades: freeze({
        kitchen: 0,
        transport: 0,
        restaurant: 0,
        procurement: 0,
        maxLevel: 0,
        maxLevels: freeze({ kitchen: 0, transport: 0, restaurant: 0, procurement: 0 }),
        nextCosts: freeze({ kitchen: null, transport: null, restaurant: null, procurement: null }),
      }),
      procurement: freeze({
        revision: 0,
        arrivalRevision: 0,
        nextTransitionUtcMs: null,
        regions: freeze([]),
        orders: freeze([]),
        recentArrivals: freeze([]),
        incomingItems: freeze([]),
        automation: freeze({ unlocked: false, reserveCopper: 0, policies: freeze([]) }),
      }),
    });
  }

  advanceTo(observedUtcMs: number) {
    const result = this.#operational.applicationRuntime.advanceTo(observedUtcMs);
    return freeze({
      changed: result.changed,
      clockRollbackDetected: result.clockRollbackDetected,
      snapshot: this.getSnapshot(),
      restaurantEvents: freeze([]),
    });
  }

  setCustomerArrivalIntervalRateBasisPoints(rateBasisPoints: number): boolean {
    return this.#operational.customerArrivals.setIntervalRateBasisPoints(rateBasisPoints);
  }

  selectRecipe(_operationId: string, _recipeId: string) {
    return freeze({
      accepted: false as const,
      changed: false as const,
      message: "Menu selection is order-driven in the operational runtime.",
      snapshot: this.getSnapshot(),
    });
  }

  setAutoRepeat(_operationId: string, _enabled: boolean) {
    return freeze({
      accepted: false as const,
      changed: false as const,
      message: "Automatic free production is unavailable in the operational runtime.",
      snapshot: this.getSnapshot(),
    });
  }

  #projectRestaurant(currentUtcMs: number): GameplayRestaurantSnapshot {
    const customerState = this.#operational.customers.exportState();
    const orderState = this.#operational.orders.exportState();
    const finance = this.#finance.getSnapshot(currentUtcMs);
    const recipeById = new Map(this.#content.listRecipes().map((recipe) => [recipe.id, recipe]));
    const orderById = new Map(orderState.orders.map((order) => [order.id, order]));
    const activeVisits = customerState.visits.filter((visit) => visit.phase !== "departed");
    const firstWaiting = activeVisits.find((visit) => visit.phase !== "dining" && visit.phase !== "awaiting-payment") ?? null;
    const visitOrder = firstWaiting?.orderId === null || firstWaiting?.orderId === undefined
      ? null
      : orderById.get(firstWaiting.orderId) ?? null;
    const firstLine = visitOrder?.lines[0] ?? null;
    const firstMemberId = firstWaiting?.memberCharacterIds[0] ?? null;
    const activeCustomer: GameplayRestaurantCustomerSnapshot | null = firstWaiting === null || firstLine === null || firstMemberId === null
      ? null
      : freeze({
          id: firstMemberId,
          recipeId: firstLine.recipeId,
          dishItemId: recipeById.get(firstLine.recipeId)?.outputItemId ?? firstLine.recipeId,
          arrivedAtUtcMs: firstWaiting.arrivedAtUtcMs,
          leaveAtUtcMs: Number.MAX_SAFE_INTEGER,
          phase: customerPhase(firstWaiting.phase),
          phaseEndsAtUtcMs: null,
        });
    const diningCustomers = freeze(activeVisits
      .filter((visit) => visit.phase === "dining" || visit.phase === "awaiting-payment")
      .flatMap((visit): GameplayRestaurantDiningCustomerSnapshot[] => {
        const order = visit.orderId === null ? null : orderById.get(visit.orderId) ?? null;
        if (order === null) return [];
        return order.meals.map((meal) => {
          const progress = visit.mealProgress.find((entry) => entry.mealId === meal.id);
          return freeze({
            id: meal.dinerCharacterId,
            recipeId: meal.recipeId,
            dishItemId: recipeById.get(meal.recipeId)?.outputItemId ?? meal.recipeId,
            diningStartedAtUtcMs: progress?.startedAtUtcMs ?? visit.seatedAtUtcMs ?? visit.arrivedAtUtcMs,
            departAtUtcMs: progress?.completesAtUtcMs ?? currentUtcMs,
          });
        });
      }));
    const settled = orderState.orders.filter((order) => order.status === "settled");
    const allSales = settled.flatMap((order): GameplayRestaurantSaleSnapshot[] => order.meals.map((meal) => {
      const line = order.lines.find((entry) => entry.id === meal.lineId)!;
      return freeze({
        customerId: meal.dinerCharacterId,
        recipeId: meal.recipeId,
        dishItemId: recipeById.get(meal.recipeId)?.outputItemId ?? meal.recipeId,
        quantity: 1 as const,
        copperEarned: line.price.transactionUnitPriceCopper + meal.tipCopper,
        soldAtUtcMs: order.settledAtUtcMs ?? meal.updatedAtUtcMs,
      });
    }));
    const soldByDish = new Map<string, number>();
    for (const sale of allSales) soldByDish.set(sale.dishItemId, (soldByDish.get(sale.dishItemId) ?? 0) + 1);
    return freeze({
      selectedRecipeId: activeCustomer?.recipeId ?? diningCustomers[0]?.recipeId ?? null,
      activeCustomer,
      diningCustomers,
      seatCapacity: 2,
      nextCustomerAtUtcMs: null,
      totalSoldQuantity: allSales.length,
      totalCustomersLeft: customerState.visits.filter((visit) => visit.phase === "departed").length,
      copperBalance: finance.balanceCopper,
      totalCopperSpent: finance.ledger.reduce((sum, entry) => sum + Math.max(0, -entry.amountCopper), 0),
      soldByDish: freeze([...soldByDish.entries()].map(([dishItemId, quantity]) => freeze({ dishItemId, quantity }))),
      recentSales: freeze(allSales.sort((left, right) => left.soldAtUtcMs - right.soldAtUtcMs).slice(-20)),
      nextTransitionUtcMs: this.#operational.applicationRuntime.getSnapshot().nextTransitionUtcMs,
    });
  }
}