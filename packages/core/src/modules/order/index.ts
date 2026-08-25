import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus, TransactionScope, isInstanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { FinanceModule, FinanceSettlementLine } from "../finance";
import type {
  InventoryModule,
  StackReservationRequest,
} from "../inventory";

export const ORDER_MODULE_ID = "module.order";
export const ORDER_SCHEMA_VERSION = 2;

export type OrderStatus = "submitted" | "fulfilling" | "awaiting-payment" | "settled";

export type OrderMealStatus =
  | "pending-production"
  | "in-production"
  | "awaiting-pickup"
  | "in-transit"
  | "served"
  | "consumed";

export interface OrderSelectionLine {
  readonly id: string;
  readonly recipeId: string;
  readonly quantity: number;
}

export interface PendingOrderLineState extends OrderSelectionLine {
  /** One explicit diner assignment per serving, in serving-index order. */
  readonly dinerCharacterIds: readonly InstanceId[];
}

export interface OrderRecipeIngredientDefinition {
  readonly itemId: string;
  readonly quantity: number;
}

export interface OrderRecipeDefinition {
  readonly id: string;
  readonly ingredients: readonly OrderRecipeIngredientDefinition[];
}

export interface OrderRecipeCatalogPort {
  getRecipe(recipeId: string): OrderRecipeDefinition | null;
}

export class StaticOrderRecipeCatalog implements OrderRecipeCatalogPort {
  readonly #recipes = new Map<string, OrderRecipeDefinition>();

  constructor(recipes: readonly OrderRecipeDefinition[]) {
    if (recipes.length === 0) throw new Error("Order recipe catalog must not be empty.");
    for (const recipe of recipes) {
      if (!validId(recipe.id) || recipe.ingredients.length === 0 || this.#recipes.has(recipe.id)) {
        throw new Error(`Invalid or duplicate order recipe: ${recipe.id}`);
      }
      const ingredientIds = new Set<string>();
      for (const ingredient of recipe.ingredients) {
        if (!validId(ingredient.itemId) || !positiveInteger(ingredient.quantity) ||
          ingredientIds.has(ingredient.itemId)) {
          throw new Error(`Invalid or duplicate ingredient in order recipe: ${recipe.id}`);
        }
        ingredientIds.add(ingredient.itemId);
      }
      this.#recipes.set(recipe.id, Object.freeze({
        id: recipe.id,
        ingredients: Object.freeze(recipe.ingredients.map((ingredient) => Object.freeze({ ...ingredient }))),
      }));
    }
  }

  getRecipe(recipeId: string): OrderRecipeDefinition | null {
    return this.#recipes.get(recipeId) ?? null;
  }
}

export type OrderIngredientSourceDefinition =
  | { readonly kind: "stack"; readonly locationId: string }
  | { readonly kind: "inbound-stack-cargo"; readonly locationId: string };

export interface OrderIngredientRequirement {
  readonly itemId: string;
  readonly quantity: number;
}

export interface OrderIngredientAvailability {
  readonly orderable: boolean;
  readonly reason: "invalid-selection" | "unknown-recipe" | "ingredients-unavailable" | null;
  readonly unknownRecipeIds: readonly string[];
  readonly requirements: readonly OrderIngredientRequirement[];
  readonly stackAllocations: readonly StackReservationRequest[];
  readonly stackCargoIds: readonly InstanceId[];
  readonly missing: readonly OrderIngredientRequirement[];
}
export interface PendingOrderState {
  readonly id: string;
  readonly tableId: string;
  readonly customerGroupId: string;
  readonly lines: readonly PendingOrderLineState[];
  readonly ingredientReservationIds: readonly string[];
  readonly createdAtUtcMs: number;
  readonly submittedOrderId: string | null;
  readonly submittedAtUtcMs: number | null;
}

export interface OrderPriceSnapshot {
  readonly baseUnitPriceCopper: number;
  readonly businessAdjustmentCopper: number;
  readonly transactionUnitPriceCopper: number;
}

export interface OrderLinePriceSnapshotRequest extends OrderPriceSnapshot {
  readonly lineId: string;
}

export interface OrderLineState extends PendingOrderLineState {
  readonly price: OrderPriceSnapshot;
  readonly mealIds: readonly string[];
}

export interface OrderMealState {
  readonly id: string;
  readonly orderId: string;
  readonly lineId: string;
  readonly recipeId: string;
  readonly servingIndex: number;
  readonly dinerCharacterId: InstanceId;
  readonly status: OrderMealStatus;
  readonly tipCopper: number;
  readonly blockedReason: string | null;
  readonly updatedAtUtcMs: number;
}

export interface OrderState {
  readonly id: string;
  readonly pendingOrderId: string;
  readonly tableId: string;
  readonly customerGroupId: string;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLineState[];
  readonly meals: readonly OrderMealState[];
  readonly ingredientReservationIds: readonly string[];
  readonly focusBonusRateBasisPoints: number;
  readonly submittedAtUtcMs: number;
  readonly settlementBatchId: string | null;
  readonly settledAtUtcMs: number | null;
}

export interface OrderModuleState {
  readonly schemaVersion: typeof ORDER_SCHEMA_VERSION;
  readonly revision: number;
  readonly pendingOrders: readonly PendingOrderState[];
  readonly orders: readonly OrderState[];
  readonly processedOperationIds: readonly string[];
}

export interface CreatePendingOrderRequest {
  readonly operationId: string;
  readonly pendingOrderId: string;
  readonly tableId: string;
  readonly customerGroupId: string;
  readonly lines: readonly PendingOrderLineState[];
  readonly ingredientReservationId: string;
  readonly createdAtUtcMs: number;
}

export interface SubmitPendingOrderRequest {
  readonly operationId: string;
  readonly pendingOrderId: string;
  readonly orderId: string;
  readonly linePrices: readonly OrderLinePriceSnapshotRequest[];
  readonly focusBonusRateBasisPoints?: number;
  readonly submittedAtUtcMs: number;
}

export interface SettleOrderRequest {
  readonly operationId: string;
  readonly orderId: string;
  readonly settlementBatchId: string;
  readonly regionId: string;
  readonly settledAtUtcMs: number;
}

export interface OrderMealPickupTransfer {
  readonly mealId: string;
  readonly inventoryInstanceId: InstanceId;
}

export interface PickupOrderMealsRequest {
  readonly operationId: string;
  readonly transfers: readonly OrderMealPickupTransfer[];
  readonly sourceLocationId: string;
  readonly carrierLocationId: string;
  readonly occurredAtUtcMs: number;
}

export interface ServeOrderMealRequest {
  readonly operationId: string;
  readonly mealId: string;
  readonly inventoryInstanceId: InstanceId;
  readonly carrierLocationId: string;
  readonly tipCopper: number;
  readonly occurredAtUtcMs: number;
}

export interface OrderReadModel {
  readonly pendingSubmissions: readonly PendingOrderState[];
  readonly openOrders: readonly OrderState[];
  readonly recentSettledOrders: readonly OrderState[];
  readonly mealCountsByStatus: Readonly<Record<OrderMealStatus, number>>;
}

export type OrderRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_ID"
  | "TABLE_ALREADY_HAS_PENDING_ORDER"
  | "UNKNOWN_PENDING_ORDER"
  | "PENDING_ORDER_ALREADY_SUBMITTED"
  | "PRICE_SNAPSHOT_MISMATCH"
  | "UNKNOWN_RECIPE"
  | "INGREDIENTS_UNAVAILABLE"
  | "INVENTORY_REJECTED"
  | "UNKNOWN_ORDER"
  | "UNKNOWN_MEAL"
  | "MEAL_BLOCKED"
  | "INVALID_MEAL_TRANSITION"
  | "ORDER_NOT_READY_FOR_SETTLEMENT"
  | "FINANCE_REJECTED";

export type OrderOperationResult<TValue> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly committedEventIds: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: OrderRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;
const MEAL_STATUS_ORDER: readonly OrderMealStatus[] = [
  "pending-production",
  "in-production",
  "awaiting-pickup",
  "in-transit",
  "served",
  "consumed",
];

class OrderRejected extends Error {
  constructor(readonly code: OrderRejectionCode, message: string) {
    super(message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validPrice(price: OrderPriceSnapshot | undefined): price is OrderPriceSnapshot {
  return price !== undefined && positiveInteger(price.baseUnitPriceCopper) &&
    Number.isSafeInteger(price.businessAdjustmentCopper) &&
    positiveInteger(price.transactionUnitPriceCopper) &&
    price.baseUnitPriceCopper + price.businessAdjustmentCopper === price.transactionUnitPriceCopper;
}

function clonePending(order: PendingOrderState): PendingOrderState {
  return Object.freeze({
    ...order,
    lines: Object.freeze(order.lines.map((line) => Object.freeze({
      ...line,
      dinerCharacterIds: Object.freeze([...line.dinerCharacterIds]),
    }))),
    ingredientReservationIds: Object.freeze([...order.ingredientReservationIds]),
  });
}

function cloneOrder(order: OrderState): OrderState {
  return Object.freeze({
    ...order,
    lines: Object.freeze(order.lines.map((line) => Object.freeze({
      ...line,
      price: Object.freeze({ ...line.price }),
      mealIds: Object.freeze([...line.mealIds]),
      dinerCharacterIds: Object.freeze([...line.dinerCharacterIds]),
    }))),
    meals: Object.freeze(order.meals.map((meal) => Object.freeze({ ...meal }))),
    ingredientReservationIds: Object.freeze([...order.ingredientReservationIds]),
  });
}

function cloneState(state: OrderModuleState): OrderModuleState {
  return Object.freeze({
    ...state,
    pendingOrders: Object.freeze(state.pendingOrders.map(clonePending)),
    orders: Object.freeze(state.orders.map(cloneOrder)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function derivedOrderStatus(order: Pick<OrderState, "status" | "meals">): OrderStatus {
  if (order.status === "settled") return "settled";
  if (order.meals.every((meal) => meal.status === "consumed")) return "awaiting-payment";
  if (order.meals.some((meal) => meal.status !== "pending-production")) return "fulfilling";
  return "submitted";
}

export class OrderModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = ORDER_MODULE_ID;
  readonly transactionParticipantId = ORDER_MODULE_ID;
  readonly #finance: FinanceModule;
  readonly #inventory: InventoryModule;
  readonly #recipeCatalog: OrderRecipeCatalogPort;
  readonly #ingredientSources: readonly OrderIngredientSourceDefinition[];
  readonly #transaction: TransactionScope;
  #state: OrderModuleState;
  #transactionActive = false;

  constructor(options: {
    readonly finance: FinanceModule;
    readonly inventory: InventoryModule;
    readonly recipeCatalog: OrderRecipeCatalogPort;
    readonly ingredientSources: readonly OrderIngredientSourceDefinition[];
    readonly eventBus?: DomainEventBus;
    readonly initialState?: OrderModuleState;
  }) {
    if (options.ingredientSources.length === 0) {
      throw new Error("Order ingredient source priority must not be empty.");
    }
    const sourceKeys = new Set<string>();
    const inventoryLocationIds = new Set(options.inventory.getSnapshot().locations.map((location) => location.id));
    for (const source of options.ingredientSources) {
      const key = `${source.kind}:${source.locationId}`;
      if (!validId(source.locationId) || sourceKeys.has(key) || !inventoryLocationIds.has(source.locationId)) {
        throw new Error(`Invalid or duplicate order ingredient source: ${key}`);
      }
      sourceKeys.add(key);
    }
    this.#finance = options.finance;
    this.#inventory = options.inventory;
    this.#recipeCatalog = options.recipeCatalog;
    this.#ingredientSources = Object.freeze(options.ingredientSources.map((source) => Object.freeze({ ...source })));
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: ORDER_SCHEMA_VERSION,
          revision: 0,
          pendingOrders: [],
          orders: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): OrderModuleState {
    return cloneState(this.#state);
  }

getOrder(orderId: string): OrderState | null {
    const order = this.#state.orders.find((entry) => entry.id === orderId);
    return order === undefined ? null : cloneOrder(order);
  }

  getMeal(mealId: string): OrderMealState | null {
    for (const order of this.#state.orders) {
      const meal = order.meals.find((entry) => entry.id === mealId);
      if (meal !== undefined) return Object.freeze({ ...meal });
    }
    return null;
  }

  getReadModel(recentSettledLimit = 20): OrderReadModel {
    if (!nonNegativeInteger(recentSettledLimit)) {
      throw new RangeError("Recent settled order limit must be a non-negative integer.");
    }
    const mealCountsByStatus: Record<OrderMealStatus, number> = {
      "pending-production": 0,
      "in-production": 0,
      "awaiting-pickup": 0,
      "in-transit": 0,
      served: 0,
      consumed: 0,
    };
    for (const order of this.#state.orders) {
      if (order.status === "settled") continue;
      for (const meal of order.meals) mealCountsByStatus[meal.status] += 1;
    }
    const settled = this.#state.orders
      .filter((order) => order.status === "settled")
      .sort((left, right) => (right.settledAtUtcMs ?? 0) - (left.settledAtUtcMs ?? 0))
      .slice(0, recentSettledLimit);
    return Object.freeze({
      pendingSubmissions: Object.freeze(this.#state.pendingOrders
        .filter((order) => order.submittedOrderId === null)
        .map(clonePending)),
      openOrders: Object.freeze(this.#state.orders
        .filter((order) => order.status !== "settled")
        .map(cloneOrder)),
      recentSettledOrders: Object.freeze(settled.map(cloneOrder)),
      mealCountsByStatus: Object.freeze(mealCountsByStatus),
    });
  }

  checkIngredientAvailability(
    lines: readonly OrderSelectionLine[],
  ): OrderIngredientAvailability {
    const freezeAvailability = (
      value: Omit<OrderIngredientAvailability, "requirements" | "stackAllocations" |
        "stackCargoIds" | "missing" | "unknownRecipeIds"> & {
        readonly requirements?: readonly OrderIngredientRequirement[];
        readonly stackAllocations?: readonly StackReservationRequest[];
        readonly stackCargoIds?: readonly InstanceId[];
        readonly missing?: readonly OrderIngredientRequirement[];
        readonly unknownRecipeIds?: readonly string[];
      },
    ): OrderIngredientAvailability => Object.freeze({
      ...value,
      unknownRecipeIds: Object.freeze([...(value.unknownRecipeIds ?? [])]),
      requirements: Object.freeze((value.requirements ?? []).map((entry) => Object.freeze({ ...entry }))),
      stackAllocations: Object.freeze((value.stackAllocations ?? []).map((entry) => Object.freeze({ ...entry }))),
      stackCargoIds: Object.freeze([...(value.stackCargoIds ?? [])]),
      missing: Object.freeze((value.missing ?? []).map((entry) => Object.freeze({ ...entry }))),
    });
    const lineIds = new Set<string>();
    if (lines.length === 0) {
      return freezeAvailability({ orderable: false, reason: "invalid-selection" });
    }
    for (const line of lines) {
      if (!validId(line.id) || !validId(line.recipeId) || !positiveInteger(line.quantity) ||
        lineIds.has(line.id)) {
        return freezeAvailability({ orderable: false, reason: "invalid-selection" });
      }
      lineIds.add(line.id);
    }
    const quantities = new Map<string, number>();
    const unknownRecipeIds = new Set<string>();
    for (const line of lines) {
      const recipe = this.#recipeCatalog.getRecipe(line.recipeId);
      if (recipe === null) {
        unknownRecipeIds.add(line.recipeId);
        continue;
      }
      for (const ingredient of recipe.ingredients) {
        const quantity = (quantities.get(ingredient.itemId) ?? 0) + ingredient.quantity * line.quantity;
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
          return freezeAvailability({ orderable: false, reason: "invalid-selection" });
        }
        quantities.set(ingredient.itemId, quantity);
      }
    }
    const requirements = [...quantities].map(([itemId, quantity]) => Object.freeze({ itemId, quantity }));
    if (unknownRecipeIds.size > 0) {
      return freezeAvailability({
        orderable: false,
        reason: "unknown-recipe",
        unknownRecipeIds: [...unknownRecipeIds],
        requirements,
      });
    }
    const snapshot = this.#inventory.getSnapshot();
    const stackAllocations: StackReservationRequest[] = [];
    const stackCargoIds: InstanceId[] = [];
    const selectedCargoIds = new Set<InstanceId>();
    const missing: OrderIngredientRequirement[] = [];
    for (const requirement of requirements) {
      let remaining = requirement.quantity;
      for (const source of this.#ingredientSources) {
        if (remaining === 0) break;
        const location = snapshot.locations.find((entry) => entry.id === source.locationId)!;
        if (source.kind === "stack") {
          const available = location.stacks.find((entry) => entry.itemId === requirement.itemId &&
            entry.category === "ingredient")?.availableQuantity ?? 0;
          const quantity = Math.min(remaining, available);
          if (quantity > 0) {
            stackAllocations.push(Object.freeze({
              locationId: source.locationId,
              itemId: requirement.itemId,
              quantity,
            }));
            remaining -= quantity;
          }
          continue;
        }
        const candidates = location.stackCargo
          .filter((entry) => entry.itemId === requirement.itemId && entry.category === "ingredient" &&
            entry.reservationId === null &&
            !selectedCargoIds.has(entry.id))
          .sort((left, right) => left.id.localeCompare(right.id));
        for (const cargo of candidates.slice(0, remaining)) {
          selectedCargoIds.add(cargo.id);
          stackCargoIds.push(cargo.id);
          remaining -= 1;
        }
      }
      if (remaining > 0) missing.push(Object.freeze({
        itemId: requirement.itemId,
        quantity: remaining,
      }));
    }
    return freezeAvailability({
      orderable: missing.length === 0,
      reason: missing.length === 0 ? null : "ingredients-unavailable",
      requirements,
      stackAllocations,
      stackCargoIds,
      missing,
    });
  }

  createPendingOrder(
    request: CreatePendingOrderRequest,
  ): OrderOperationResult<PendingOrderState> {
    return this.#run(request.operationId, [this, this.#inventory], (emit) => {
      if (!validId(request.pendingOrderId) || !validId(request.tableId) ||
        !validId(request.customerGroupId) || !validId(request.ingredientReservationId) ||
        !nonNegativeInteger(request.createdAtUtcMs) || request.lines.length === 0) {
        throw new OrderRejected("INVALID_REQUEST", "Pending order request is invalid.");
      }
      if (this.#state.pendingOrders.some((order) => order.id === request.pendingOrderId) ||
        this.#state.orders.some((order) => order.id === request.pendingOrderId)) {
        throw new OrderRejected("DUPLICATE_ID", `Order id already exists: ${request.pendingOrderId}`);
      }
      if (this.#state.pendingOrders.some((order) =>
        order.tableId === request.tableId && order.submittedOrderId === null,
      ) || this.#state.orders.some((order) =>
        order.tableId === request.tableId && order.status !== "settled",
      )) {
        throw new OrderRejected(
          "TABLE_ALREADY_HAS_PENDING_ORDER",
          `Table already has a pending order: ${request.tableId}`,
        );
      }
      const lineIds = new Set<string>();
      for (const line of request.lines) {
        if (!validId(line.id) || !validId(line.recipeId) || !positiveInteger(line.quantity) ||
          line.dinerCharacterIds.length !== line.quantity ||
          line.dinerCharacterIds.some((id) => !isInstanceId(id)) || lineIds.has(line.id)) {
          throw new OrderRejected("INVALID_REQUEST", "Pending order contains an invalid line or diner assignment.");
        }
        lineIds.add(line.id);
      }
      const availability = this.checkIngredientAvailability(request.lines);
      if (!availability.orderable) {
        if (availability.reason === "unknown-recipe") {
          throw new OrderRejected(
            "UNKNOWN_RECIPE",
            `Unknown order recipe: ${availability.unknownRecipeIds.join(", ")}`,
          );
        }
        if (availability.reason === "ingredients-unavailable") {
          throw new OrderRejected(
            "INGREDIENTS_UNAVAILABLE",
            `Order ingredients are unavailable: ${availability.missing
              .map((entry) => `${entry.itemId} x${entry.quantity}`).join(", ")}`,
          );
        }
        throw new OrderRejected("INVALID_REQUEST", "Pending order selection is invalid.");
      }
      const reservation = this.#inventory.createReservation(`${request.operationId}:inventory`, {
        reservationId: request.ingredientReservationId,
        ownerType: "pending-order",
        ownerId: request.pendingOrderId,
        stacks: availability.stackAllocations,
        stackCargoIds: availability.stackCargoIds,
        createdAtUtcMs: request.createdAtUtcMs,
      });
      if (!reservation.accepted) {
        throw new OrderRejected(
          reservation.code === "INSUFFICIENT_AVAILABLE" || reservation.code === "INSTANCE_RESERVED"
            ? "INGREDIENTS_UNAVAILABLE"
            : "INVENTORY_REJECTED",
          reservation.message,
        );
      }
      for (const event of reservation.events) emit(event);
      const reservationIds = Object.freeze([reservation.value.id]);
      const pending = clonePending({
        id: request.pendingOrderId,
        tableId: request.tableId,
        customerGroupId: request.customerGroupId,
        lines: request.lines,
        ingredientReservationIds: reservationIds,
        createdAtUtcMs: request.createdAtUtcMs,
        submittedOrderId: null,
        submittedAtUtcMs: null,
      });
      this.#replace({ pendingOrders: [...this.#state.pendingOrders, pending] });
      emit(this.#event(request.operationId, "order.ingredients-reserved", request.createdAtUtcMs, {
        pendingOrderId: pending.id,
        reservationId: reservation.value.id,
        requirements: availability.requirements,
        stackAllocations: availability.stackAllocations,
        stackCargoIds: availability.stackCargoIds,
      }));
      emit(this.#event(request.operationId, "order.pending-created", request.createdAtUtcMs, pending));
      return pending;
    });
  }

  submitPendingOrder(
    request: SubmitPendingOrderRequest,
  ): OrderOperationResult<OrderState> {
    const pending = this.#state.pendingOrders.find((order) => order.id === request.pendingOrderId);
    if (pending?.submittedOrderId === request.orderId) {
      const existing = this.#state.orders.find((order) => order.id === request.orderId);
      if (existing !== undefined) return this.#unchanged(request.operationId, cloneOrder(existing));
    }
    return this.#run(request.operationId, [this], (emit) => {
      if (!validId(request.pendingOrderId) || !validId(request.orderId) ||
        !nonNegativeInteger(request.submittedAtUtcMs) ||
        !nonNegativeInteger(request.focusBonusRateBasisPoints ?? 0) ||
        (request.focusBonusRateBasisPoints ?? 0) > 10_000) {
        throw new OrderRejected("INVALID_REQUEST", "Order submission request is invalid.");
      }
      const current = this.#state.pendingOrders.find((order) => order.id === request.pendingOrderId);
      if (current === undefined) {
        throw new OrderRejected("UNKNOWN_PENDING_ORDER", `Unknown pending order: ${request.pendingOrderId}`);
      }
      if (current.submittedOrderId !== null) {
        throw new OrderRejected("PENDING_ORDER_ALREADY_SUBMITTED", "Pending order can only be submitted once.");
      }
      if (this.#state.orders.some((order) => order.id === request.orderId) ||
        this.#state.pendingOrders.some((order) => order.id === request.orderId)) {
        throw new OrderRejected("DUPLICATE_ID", `Order id already exists: ${request.orderId}`);
      }
      const prices = new Map(request.linePrices.map((entry) => [entry.lineId, entry]));
      if (prices.size !== current.lines.length || request.linePrices.length !== current.lines.length ||
        current.lines.some((line) => !validPrice(prices.get(line.id)))) {
        throw new OrderRejected(
          "PRICE_SNAPSHOT_MISMATCH",
          "Every pending line requires exactly one valid immutable price snapshot.",
        );
      }
      const meals: OrderMealState[] = [];
      const lines = current.lines.map((line) => {
        const mealIds: string[] = [];
        for (let servingIndex = 1; servingIndex <= line.quantity; servingIndex += 1) {
          const mealId = `${request.orderId}:meal:${line.id}:${servingIndex}`;
          mealIds.push(mealId);
          meals.push(Object.freeze({
            id: mealId,
            orderId: request.orderId,
            lineId: line.id,
            recipeId: line.recipeId,
            servingIndex,
            dinerCharacterId: line.dinerCharacterIds[servingIndex - 1]!,
            status: "pending-production" as const,
            tipCopper: 0,
            blockedReason: null,
            updatedAtUtcMs: request.submittedAtUtcMs,
          }));
        }
        const price = prices.get(line.id)!;
        return Object.freeze({
          ...line,
          price: Object.freeze({
            baseUnitPriceCopper: price.baseUnitPriceCopper,
            businessAdjustmentCopper: price.businessAdjustmentCopper,
            transactionUnitPriceCopper: price.transactionUnitPriceCopper,
          }),
          mealIds: Object.freeze(mealIds),
        });
      });
      const order = cloneOrder({
        id: request.orderId,
        pendingOrderId: current.id,
        tableId: current.tableId,
        customerGroupId: current.customerGroupId,
        status: "submitted",
        lines,
        meals,
        ingredientReservationIds: current.ingredientReservationIds,
        focusBonusRateBasisPoints: request.focusBonusRateBasisPoints ?? 0,
        submittedAtUtcMs: request.submittedAtUtcMs,
        settlementBatchId: null,
        settledAtUtcMs: null,
      });
      const submittedPending = clonePending({
        ...current,
        submittedOrderId: request.orderId,
        submittedAtUtcMs: request.submittedAtUtcMs,
      });
      this.#replace({
        pendingOrders: this.#state.pendingOrders.map((entry) =>
          entry.id === current.id ? submittedPending : entry,
        ),
        orders: [...this.#state.orders, order],
      });
      emit(this.#event(request.operationId, "order.created", request.submittedAtUtcMs, order));
      emit(this.#event(request.operationId, "order.kitchen-notified", request.submittedAtUtcMs, {
        orderId: order.id,
        tableId: order.tableId,
        mealIds: order.meals.map((meal) => meal.id),
      }));
      return order;
    });
  }

  advanceMeal(
    operationId: string,
    mealId: string,
    nextStatus: OrderMealStatus,
    occurredAtUtcMs: number,
    tipCopper?: number,
  ): OrderOperationResult<OrderState> {
    return this.#run(operationId, [this], (emit) => {
      if (!validId(mealId) || !MEAL_STATUS_ORDER.includes(nextStatus) ||
        !nonNegativeInteger(occurredAtUtcMs) ||
        (tipCopper !== undefined && (!nonNegativeInteger(tipCopper) || nextStatus !== "served"))) {
        throw new OrderRejected("INVALID_REQUEST", "Meal transition request is invalid.");
      }
      const located = this.#findMeal(mealId);
      if (located === null) throw new OrderRejected("UNKNOWN_MEAL", `Unknown meal: ${mealId}`);
      if (located.order.status === "settled") {
        throw new OrderRejected("INVALID_MEAL_TRANSITION", "A settled order cannot change meal state.");
      }
      if (located.meal.blockedReason !== null) {
        throw new OrderRejected("MEAL_BLOCKED", `Meal is blocked: ${located.meal.blockedReason}`);
      }
      const expectedIndex = MEAL_STATUS_ORDER.indexOf(located.meal.status) + 1;
      if (MEAL_STATUS_ORDER[expectedIndex] !== nextStatus) {
        throw new OrderRejected(
          "INVALID_MEAL_TRANSITION",
          `Meal must advance one step from ${located.meal.status}.`,
        );
      }
      const changedMeal = Object.freeze({
        ...located.meal,
        status: nextStatus,
        tipCopper: nextStatus === "served" ? (tipCopper ?? 0) : located.meal.tipCopper,
        updatedAtUtcMs: occurredAtUtcMs,
      });
      const nextMeals = located.order.meals.map((meal) => meal.id === mealId ? changedMeal : meal);
      const candidate: OrderState = { ...located.order, meals: nextMeals };
      const nextOrder = cloneOrder({ ...candidate, status: derivedOrderStatus(candidate) });
      this.#replace({
        orders: this.#state.orders.map((order) => order.id === nextOrder.id ? nextOrder : order),
      });
      emit(this.#event(operationId, "order.meal-status-changed", occurredAtUtcMs, {
        orderId: nextOrder.id,
        mealId,
        previousStatus: located.meal.status,
        status: nextStatus,
      }, `${mealId}:${nextStatus}`));
      if (nextOrder.status !== located.order.status) {
        emit(this.#event(operationId, "order.status-changed", occurredAtUtcMs, {
          orderId: nextOrder.id,
          previousStatus: located.order.status,
          status: nextOrder.status,
        }, `${nextOrder.id}:${nextOrder.status}`));
        if (nextOrder.status === "awaiting-payment") {
          emit(this.#event(operationId, "order.awaiting-payment", occurredAtUtcMs, {
            orderId: nextOrder.id,
            tableId: nextOrder.tableId,
          }, nextOrder.id));
        }
      }
      return nextOrder;
    });
  }

  /**
   * Atomically moves finished-meal instances onto one carrier and advances all
   * matching order meals to in-transit.
   */
  pickupMealsToCarrier(request: PickupOrderMealsRequest): OrderOperationResult<readonly OrderState[]> {
    return this.#run(request.operationId, [this, this.#inventory], (emit) => {
      if (!validId(request.sourceLocationId) || !validId(request.carrierLocationId) ||
        request.sourceLocationId === request.carrierLocationId || !nonNegativeInteger(request.occurredAtUtcMs) ||
        request.transfers.length === 0 || new Set(request.transfers.map((entry) => entry.mealId)).size !== request.transfers.length ||
        new Set(request.transfers.map((entry) => entry.inventoryInstanceId)).size !== request.transfers.length) {
        throw new OrderRejected("INVALID_REQUEST", "Meal pickup batch is invalid.");
      }
      const source = this.#inventory.getSnapshot().locations.find((entry) => entry.id === request.sourceLocationId);
      if (source === undefined) throw new OrderRejected("INVENTORY_REJECTED", "Meal pickup source location is unknown.");
      const instances = new Map(source.instances.map((entry) => [entry.id, entry]));
      for (const transfer of request.transfers) {
        if (!validId(transfer.mealId)) throw new OrderRejected("INVALID_REQUEST", "Meal pickup id is invalid.");
        const located = this.#findMeal(transfer.mealId);
        if (located === null) throw new OrderRejected("UNKNOWN_MEAL", `Unknown meal: ${transfer.mealId}`);
        if (located.meal.status !== "awaiting-pickup" || located.meal.blockedReason !== null) {
          throw new OrderRejected("INVALID_MEAL_TRANSITION", `Meal is not ready for pickup: ${transfer.mealId}`);
        }
        const instance = instances.get(transfer.inventoryInstanceId);
        if (instance === undefined || instance.category !== "meal" || instance.attributes.mealId !== transfer.mealId) {
          throw new OrderRejected("INVENTORY_REJECTED", `Finished-meal instance mismatch: ${transfer.mealId}`);
        }
      }
      const changedOrderIds = new Set<string>();
      for (const transfer of request.transfers) {
        const moved = this.#inventory.transferInstance(
          `${request.operationId}:inventory:${transfer.mealId}`,
          transfer.inventoryInstanceId,
          request.carrierLocationId,
          request.occurredAtUtcMs,
        );
        if (!moved.accepted) throw new OrderRejected("INVENTORY_REJECTED", moved.message);
        moved.events.forEach(emit);
        const located = this.#findMeal(transfer.mealId)!;
        const changedMeal = Object.freeze({
          ...located.meal,
          status: "in-transit" as const,
          updatedAtUtcMs: request.occurredAtUtcMs,
        });
        const candidate: OrderState = {
          ...located.order,
          meals: located.order.meals.map((meal) => meal.id === transfer.mealId ? changedMeal : meal),
        };
        const nextOrder = cloneOrder({ ...candidate, status: derivedOrderStatus(candidate) });
        this.#replace({ orders: this.#state.orders.map((order) => order.id === nextOrder.id ? nextOrder : order) });
        changedOrderIds.add(nextOrder.id);
        emit(this.#event(request.operationId, "order.meal-status-changed", request.occurredAtUtcMs, {
          orderId: nextOrder.id,
          mealId: transfer.mealId,
          previousStatus: "awaiting-pickup",
          status: "in-transit",
        }, `${transfer.mealId}:in-transit`));
      }
      return Object.freeze([...changedOrderIds].map((orderId) => this.getOrder(orderId)!));
    });
  }

  /** Removes one carried meal instance and records table delivery atomically. */
  serveMealFromCarrier(request: ServeOrderMealRequest): OrderOperationResult<OrderState> {
    return this.#run(request.operationId, [this, this.#inventory], (emit) => {
      if (!validId(request.mealId) || !validId(request.carrierLocationId) ||
        !nonNegativeInteger(request.tipCopper) || !nonNegativeInteger(request.occurredAtUtcMs)) {
        throw new OrderRejected("INVALID_REQUEST", "Meal serving request is invalid.");
      }
      const located = this.#findMeal(request.mealId);
      if (located === null) throw new OrderRejected("UNKNOWN_MEAL", `Unknown meal: ${request.mealId}`);
      if (located.meal.status !== "in-transit" || located.meal.blockedReason !== null) {
        throw new OrderRejected("INVALID_MEAL_TRANSITION", `Meal is not carried: ${request.mealId}`);
      }
      const carrier = this.#inventory.getSnapshot().locations.find((entry) => entry.id === request.carrierLocationId);
      const instance = carrier?.instances.find((entry) => entry.id === request.inventoryInstanceId);
      if (instance === undefined || instance.category !== "meal" || instance.attributes.mealId !== request.mealId) {
        throw new OrderRejected("INVENTORY_REJECTED", `Carried meal instance mismatch: ${request.mealId}`);
      }
      const removed = this.#inventory.removeInstance(
        `${request.operationId}:inventory`,
        request.inventoryInstanceId,
        request.occurredAtUtcMs,
      );
      if (!removed.accepted) throw new OrderRejected("INVENTORY_REJECTED", removed.message);
      removed.events.forEach(emit);
      const changedMeal = Object.freeze({
        ...located.meal,
        status: "served" as const,
        tipCopper: request.tipCopper,
        updatedAtUtcMs: request.occurredAtUtcMs,
      });
      const candidate: OrderState = {
        ...located.order,
        meals: located.order.meals.map((meal) => meal.id === request.mealId ? changedMeal : meal),
      };
      const nextOrder = cloneOrder({ ...candidate, status: derivedOrderStatus(candidate) });
      this.#replace({ orders: this.#state.orders.map((order) => order.id === nextOrder.id ? nextOrder : order) });
      emit(this.#event(request.operationId, "order.meal-status-changed", request.occurredAtUtcMs, {
        orderId: nextOrder.id,
        mealId: request.mealId,
        previousStatus: "in-transit",
        status: "served",
        tipCopper: request.tipCopper,
      }, `${request.mealId}:served`));
      if (nextOrder.status !== located.order.status) {
        emit(this.#event(request.operationId, "order.status-changed", request.occurredAtUtcMs, {
          orderId: nextOrder.id,
          previousStatus: located.order.status,
          status: nextOrder.status,
        }, `${nextOrder.id}:${nextOrder.status}`));
        if (nextOrder.status === "awaiting-payment") {
          emit(this.#event(request.operationId, "order.awaiting-payment", request.occurredAtUtcMs, {
            orderId: nextOrder.id,
            tableId: nextOrder.tableId,
          }, nextOrder.id));
        }
      }
      return nextOrder;
    });
  }

  setMealBlocked(
    operationId: string,
    mealId: string,
    blockedReason: string | null,
    occurredAtUtcMs: number,
  ): OrderOperationResult<OrderMealState> {
    return this.#run(operationId, [this], (emit) => {
      if (!validId(mealId) || !nonNegativeInteger(occurredAtUtcMs) ||
        (blockedReason !== null && (blockedReason.trim().length === 0 || blockedReason.length > 500))) {
        throw new OrderRejected("INVALID_REQUEST", "Meal blocking request is invalid.");
      }
      const located = this.#findMeal(mealId);
      if (located === null) throw new OrderRejected("UNKNOWN_MEAL", `Unknown meal: ${mealId}`);
      if (located.order.status === "settled" || located.meal.status === "consumed") {
        throw new OrderRejected("INVALID_MEAL_TRANSITION", "Completed meals cannot be blocked or restored.");
      }
      if (located.meal.blockedReason === blockedReason) {
        return located.meal;
      }
      const meal = Object.freeze({ ...located.meal, blockedReason, updatedAtUtcMs: occurredAtUtcMs });
      const order = cloneOrder({
        ...located.order,
        meals: located.order.meals.map((entry) => entry.id === mealId ? meal : entry),
      });
      this.#replace({
        orders: this.#state.orders.map((entry) => entry.id === order.id ? order : entry),
      });
      emit(this.#event(
        operationId,
        blockedReason === null ? "order.meal-restored" : "order.meal-blocked",
        occurredAtUtcMs,
        { orderId: order.id, mealId, blockedReason },
      ));
      return meal;
    });
  }

  settleOrder(request: SettleOrderRequest): OrderOperationResult<OrderState> {
    const existing = this.#state.orders.find((order) => order.id === request.orderId);
    if (existing?.status === "settled") return this.#unchanged(request.operationId, cloneOrder(existing));
    return this.#run(request.operationId, [this, this.#finance], (emit) => {
      if (!validId(request.orderId) || !validId(request.settlementBatchId) ||
        !validId(request.regionId) || !nonNegativeInteger(request.settledAtUtcMs)) {
        throw new OrderRejected("INVALID_REQUEST", "Order settlement request is invalid.");
      }
      const order = this.#state.orders.find((entry) => entry.id === request.orderId);
      if (order === undefined) throw new OrderRejected("UNKNOWN_ORDER", `Unknown order: ${request.orderId}`);
      if (order.status !== "awaiting-payment") {
        throw new OrderRejected(
          "ORDER_NOT_READY_FOR_SETTLEMENT",
          "Every meal must be consumed before the order can settle.",
        );
      }
      const source = {
        sourceType: "restaurant-order",
        sourceId: order.id,
        regionId: request.regionId,
      };
      const dishSalesCopper = order.lines.reduce(
        (sum, line) => sum + line.price.transactionUnitPriceCopper * line.quantity,
        0,
      );
      const tipCopper = order.meals.reduce((sum, meal) => sum + meal.tipCopper, 0);
      const focusBonusCopper = Math.round(
        dishSalesCopper * order.focusBonusRateBasisPoints / 10_000,
      );
      const lines: FinanceSettlementLine[] = [{
        ...source,
        entryId: `${request.settlementBatchId}:dish-sales`,
        amountCopper: dishSalesCopper,
        category: "dish-sales",
        occurredAtUtcMs: request.settledAtUtcMs,
      }];
      if (tipCopper > 0) lines.push({
        ...source,
        entryId: `${request.settlementBatchId}:tips`,
        amountCopper: tipCopper,
        category: "tips",
        occurredAtUtcMs: request.settledAtUtcMs,
      });
      if (focusBonusCopper > 0) lines.push({
        ...source,
        entryId: `${request.settlementBatchId}:focus-bonus`,
        amountCopper: focusBonusCopper,
        category: "focus-bonus",
        occurredAtUtcMs: request.settledAtUtcMs,
      });
      const financeResult = this.#finance.settleBatch(
        `${request.operationId}:finance`,
        request.settlementBatchId,
        `order:${order.id}`,
        lines,
        request.settledAtUtcMs,
        source.sourceType,
        source.sourceId,
      );
      if (!financeResult.accepted) {
        throw new OrderRejected("FINANCE_REJECTED", financeResult.message);
      }
      for (const event of financeResult.events) emit(event);
      const settled = cloneOrder({
        ...order,
        status: "settled",
        settlementBatchId: financeResult.value.id,
        settledAtUtcMs: request.settledAtUtcMs,
      });
      this.#replace({
        orders: this.#state.orders.map((entry) => entry.id === order.id ? settled : entry),
      });
      emit(this.#event(request.operationId, "order.status-changed", request.settledAtUtcMs, {
        orderId: order.id,
        previousStatus: order.status,
        status: "settled",
      }, `${order.id}:settled`));
      emit(this.#event(request.operationId, "order.settled", request.settledAtUtcMs, {
        orderId: order.id,
        settlementBatchId: financeResult.value.id,
        dishSalesCopper,
        tipCopper,
        focusBonusCopper,
      }, order.id));
      return settled;
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Order transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = cloneState(checkpoint);
        this.#transactionActive = false;
      },
    };
  }

  #findMeal(mealId: string): { readonly order: OrderState; readonly meal: OrderMealState } | null {
    for (const order of this.#state.orders) {
      const meal = order.meals.find((entry) => entry.id === mealId);
      if (meal !== undefined) return { order, meal };
    }
    return null;
  }

  #run<TValue>(
    operationId: string,
    participants: readonly TransactionalParticipant[],
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): OrderOperationResult<TValue> {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Order operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Order operation was already processed.");
    }
    try {
      const result = this.#transaction.run(participants, ({ emit }) => {
        this.#replace({
          processedOperationIds: [...this.#state.processedOperationIds, operationId]
            .slice(-OPERATION_HISTORY_LIMIT),
        });
        return work(emit);
      });
      return Object.freeze({
        accepted: true,
        changed: true,
        operationId,
        value: result.value,
        committedEventIds: result.committedEventIds,
      });
    } catch (error: unknown) {
      return error instanceof OrderRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(
            operationId,
            "INVALID_REQUEST",
            error instanceof Error ? error.message : "Order operation failed.",
          );
    }
  }

  #unchanged<TValue>(operationId: string, value: TValue): OrderOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: false,
      operationId,
      value,
      committedEventIds: Object.freeze([]),
    });
  }

  #replace(update: Partial<OrderModuleState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(operationId: string, code: OrderRejectionCode, message: string): OrderOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      committedEventIds: [] as const,
    });
  }

  #event(
    operationId: string,
    type: string,
    occurredAtUtcMs: number,
    payload: unknown,
    discriminator = operationId,
  ): DomainEvent {
    return Object.freeze({
      id: `${type}:${discriminator}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #validateState(): void {
    if (this.#state.schemaVersion !== ORDER_SCHEMA_VERSION || !nonNegativeInteger(this.#state.revision)) {
      throw new Error("Order state header is invalid.");
    }
    const pendingIds = new Set<string>();
    const activeTables = new Set<string>();
    for (const pending of this.#state.pendingOrders) {
      if (!validId(pending.id) || !validId(pending.tableId) || !validId(pending.customerGroupId) ||
        !nonNegativeInteger(pending.createdAtUtcMs) || pending.lines.length === 0 || pendingIds.has(pending.id)) {
        throw new Error(`Pending order invariant failed: ${pending.id}`);
      }
      pendingIds.add(pending.id);
      if (pending.submittedOrderId === null) {
        if (pending.submittedAtUtcMs !== null || activeTables.has(pending.tableId)) {
          throw new Error(`Pending order table invariant failed: ${pending.tableId}`);
        }
        activeTables.add(pending.tableId);
      } else if (!validId(pending.submittedOrderId) || !nonNegativeInteger(pending.submittedAtUtcMs ?? -1)) {
        throw new Error(`Submitted pending order invariant failed: ${pending.id}`);
      }
      const lineIds = new Set<string>();
      for (const line of pending.lines) {
        if (!validId(line.id) || !validId(line.recipeId) || !positiveInteger(line.quantity) ||
          line.dinerCharacterIds.length !== line.quantity ||
          line.dinerCharacterIds.some((id) => !isInstanceId(id)) || lineIds.has(line.id)) {
          throw new Error(`Pending order line invariant failed: ${line.id}`);
        }
        lineIds.add(line.id);
      }
      if (pending.ingredientReservationIds.length !== 1 ||
        pending.ingredientReservationIds.some((id) => !validId(id))) {
        throw new Error(`Pending order reservation invariant failed: ${pending.id}`);
      }
    }
    const orderIds = new Set<string>();
    const globalMealIds = new Set<string>();
    for (const order of this.#state.orders) {
      const pending = this.#state.pendingOrders.find((entry) => entry.id === order.pendingOrderId);
      if (!validId(order.id) || orderIds.has(order.id) || pending === undefined ||
        pending.submittedOrderId !== order.id || order.tableId !== pending.tableId ||
        order.customerGroupId !== pending.customerGroupId ||
        order.ingredientReservationIds.length !== 1 ||
        order.ingredientReservationIds[0] !== pending.ingredientReservationIds[0] ||
        order.lines.length === 0 || order.meals.length === 0 ||
        !nonNegativeInteger(order.submittedAtUtcMs) ||
        !nonNegativeInteger(order.focusBonusRateBasisPoints) || order.focusBonusRateBasisPoints > 10_000) {
        throw new Error(`Formal order invariant failed: ${order.id}`);
      }
      orderIds.add(order.id);
      if (order.status !== "settled") {
        if (activeTables.has(order.tableId)) {
          throw new Error(`Open order table invariant failed: ${order.tableId}`);
        }
        activeTables.add(order.tableId);
      }
      if (order.status === "settled") {
        if (!validId(order.settlementBatchId ?? "") || !nonNegativeInteger(order.settledAtUtcMs ?? -1)) {
          throw new Error(`Settled order invariant failed: ${order.id}`);
        }
      } else if (order.settlementBatchId !== null || order.settledAtUtcMs !== null) {
        throw new Error(`Open order contains settlement data: ${order.id}`);
      }
      const lineIds = new Set<string>();
      const referencedMealIds = new Set<string>();
      for (const line of order.lines) {
        if (!validId(line.id) || !validId(line.recipeId) || !positiveInteger(line.quantity) ||
          !validPrice(line.price) || lineIds.has(line.id) || line.mealIds.length !== line.quantity ||
          line.dinerCharacterIds.length !== line.quantity || line.dinerCharacterIds.some((id) => !isInstanceId(id))) {
          throw new Error(`Formal order line invariant failed: ${line.id}`);
        }
        lineIds.add(line.id);
        for (const mealId of line.mealIds) {
          if (!validId(mealId) || referencedMealIds.has(mealId)) {
            throw new Error(`Order meal reference invariant failed: ${mealId}`);
          }
          referencedMealIds.add(mealId);
        }
      }
      for (const meal of order.meals) {
        if (!validId(meal.id) || globalMealIds.has(meal.id) || meal.orderId !== order.id ||
          !lineIds.has(meal.lineId) || !validId(meal.recipeId) || !positiveInteger(meal.servingIndex) ||
          !isInstanceId(meal.dinerCharacterId) ||
          !MEAL_STATUS_ORDER.includes(meal.status) || !nonNegativeInteger(meal.tipCopper) ||
          !nonNegativeInteger(meal.updatedAtUtcMs) ||
          (meal.blockedReason !== null && (meal.blockedReason.length === 0 || meal.blockedReason.length > 500))) {
          throw new Error(`Order meal invariant failed: ${meal.id}`);
        }
        globalMealIds.add(meal.id);
        if (!referencedMealIds.has(meal.id)) throw new Error(`Unreferenced order meal: ${meal.id}`);
      }
      if (order.meals.length !== referencedMealIds.size ||
        [...referencedMealIds].some((mealId) => !order.meals.some((meal) => meal.id === mealId)) ||
        derivedOrderStatus(order) !== order.status) {
        throw new Error(`Order aggregate invariant failed: ${order.id}`);
      }
    }
    if ([...pendingIds].some((id) => orderIds.has(id)) ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      this.#state.processedOperationIds.some((id) => !validId(id))) {
      throw new Error("Order state contains duplicate or invalid stable ids.");
    }
  }
}
