import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { CharacterModule } from "../character";
import type { DomainModule } from "../domain-module";
import type { EmploymentModule } from "../employment";
import type {
  OrderModule,
  PendingOrderLineState,
} from "../order";

export const CUSTOMER_MODULE_ID = "module.customer";
export const CUSTOMER_SCHEMA_VERSION = 1;

export interface CustomerWaitingAreaDefinition {
  readonly id: string;
  readonly slotIds: readonly string[];
}

export interface CustomerTableDefinition {
  readonly id: string;
  readonly seatIds: readonly string[];
}

export interface CustomerVenueDefinition {
  readonly sceneId: string;
  readonly waitingArea: CustomerWaitingAreaDefinition;
  readonly tables: readonly CustomerTableDefinition[];
}

export interface CustomerVenuePort {
  listVenues(): readonly CustomerVenueDefinition[];
}

export class StaticCustomerVenueCatalog implements CustomerVenuePort {
  readonly #venues: readonly CustomerVenueDefinition[];

  constructor(venues: readonly CustomerVenueDefinition[]) {
    validateVenueDefinitions(venues);
    this.#venues = Object.freeze(venues.map(cloneVenue));
  }

  listVenues(): readonly CustomerVenueDefinition[] {
    return Object.freeze(this.#venues.map(cloneVenue));
  }
}

export interface CustomerMenuItemDefinition {
  readonly recipeId: string;
  readonly baseUnitPriceCopper: number;
}

export interface CustomerMenuPort {
  listMenuItems(sceneId: string): readonly CustomerMenuItemDefinition[];
}

export class StaticCustomerMenuCatalog implements CustomerMenuPort {
  readonly #itemsByScene = new Map<string, readonly CustomerMenuItemDefinition[]>();

  constructor(entries: readonly {
    readonly sceneId: string;
    readonly items: readonly CustomerMenuItemDefinition[];
  }[]) {
    for (const entry of entries) {
      if (!validId(entry.sceneId) || this.#itemsByScene.has(entry.sceneId) || entry.items.length === 0) {
        throw new Error(`Invalid customer menu scene: ${entry.sceneId}`);
      }
      const recipeIds = new Set<string>();
      const items = entry.items.map((item) => {
        if (!validId(item.recipeId) || !positiveInteger(item.baseUnitPriceCopper) || recipeIds.has(item.recipeId)) {
          throw new Error(`Invalid customer menu item: ${entry.sceneId}/${item.recipeId}`);
        }
        recipeIds.add(item.recipeId);
        return Object.freeze({ ...item });
      });
      this.#itemsByScene.set(entry.sceneId, Object.freeze(items));
    }
  }

  listMenuItems(sceneId: string): readonly CustomerMenuItemDefinition[] {
    return Object.freeze((this.#itemsByScene.get(sceneId) ?? []).map((item) => Object.freeze({ ...item })));
  }
}

export type CustomerVisitPhase =
  | "waiting"
  | "moving-to-table"
  | "awaiting-order"
  | "pending-order"
  | "dining"
  | "awaiting-payment"
  | "departing"
  | "departed";

export type CustomerDialogueContext = "arrival" | "waiting" | "eating" | "departing";

export interface CustomerSeatAssignmentState {
  readonly characterId: InstanceId;
  readonly seatId: string;
}

export interface CustomerMealProgressState {
  readonly mealId: string;
  readonly startedAtUtcMs: number;
  readonly completesAtUtcMs: number;
  readonly consumedAtUtcMs: number | null;
}

export interface CustomerVisitState {
  readonly id: string;
  readonly sceneId: string;
  readonly memberCharacterIds: readonly InstanceId[];
  readonly phase: CustomerVisitPhase;
  readonly waitingAreaId: string;
  readonly waitingSlotIds: readonly string[];
  readonly tableId: string | null;
  readonly seatAssignments: readonly CustomerSeatAssignmentState[];
  readonly arrivedAtUtcMs: number;
  readonly tableReservedAtUtcMs: number | null;
  readonly seatedAtUtcMs: number | null;
  readonly pendingOrderId: string | null;
  readonly orderId: string | null;
  readonly mealProgress: readonly CustomerMealProgressState[];
  readonly checkoutObservedAtUtcMs: number | null;
  readonly departedAtUtcMs: number | null;
}

export interface CustomerTableState {
  readonly tableId: string;
  readonly sceneId: string;
  readonly cleanliness: "clean" | "dirty";
  readonly assignedVisitId: string | null;
}

export interface CustomerModuleState {
  readonly schemaVersion: typeof CUSTOMER_SCHEMA_VERSION;
  readonly revision: number;
  readonly visits: readonly CustomerVisitState[];
  readonly tables: readonly CustomerTableState[];
  readonly lastAdvancedAtUtcMs: number;
  readonly processedOperationIds: readonly string[];
}

export interface CustomerOrderableMenuItem extends CustomerMenuItemDefinition {
  readonly orderable: boolean;
  readonly missingIngredients: readonly { readonly itemId: string; readonly quantity: number }[];
}

export interface CustomerReadModel {
  readonly revision: number;
  readonly activeVisits: readonly CustomerVisitState[];
  readonly recentDepartures: readonly CustomerVisitState[];
  readonly tables: readonly CustomerTableState[];
  readonly waitingPeopleByScene: Readonly<Record<string, number>>;
}

export interface ArriveCustomerGroupRequest {
  readonly visitId: string;
  readonly sceneId: string;
  readonly memberCharacterIds: readonly InstanceId[];
  readonly minuteOfDay: number;
  readonly arrivedAtUtcMs: number;
}

export interface RecordCustomerOrderRequest {
  readonly pendingOrderId: string;
  readonly ingredientReservationId: string;
  readonly lines: readonly PendingOrderLineState[];
  readonly occurredAtUtcMs: number;
}

export type CustomerRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_VISIT"
  | "UNKNOWN_SCENE"
  | "UNKNOWN_VISIT"
  | "UNKNOWN_TABLE"
  | "CHARACTER_UNAVAILABLE"
  | "WAITING_AREA_FULL"
  | "INVALID_PHASE"
  | "NO_ORDERABLE_SELECTION"
  | "ORDER_REJECTED"
  | "CLOCK_ROLLBACK";

export type CustomerOperationResult<TValue> =
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
      readonly code: CustomerRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;
const DEPARTED_VISIT_HISTORY_LIMIT = 256;

class CustomerRejected extends Error {
  constructor(readonly code: CustomerRejectionCode, message: string) {
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

function validMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 1_440;
}

function cloneVenue(venue: CustomerVenueDefinition): CustomerVenueDefinition {
  return Object.freeze({
    sceneId: venue.sceneId,
    waitingArea: Object.freeze({
      id: venue.waitingArea.id,
      slotIds: Object.freeze([...venue.waitingArea.slotIds]),
    }),
    tables: Object.freeze(venue.tables.map((table) => Object.freeze({
      id: table.id,
      seatIds: Object.freeze([...table.seatIds]),
    }))),
  });
}

function cloneVisit(visit: CustomerVisitState): CustomerVisitState {
  return Object.freeze({
    ...visit,
    memberCharacterIds: Object.freeze([...visit.memberCharacterIds]),
    waitingSlotIds: Object.freeze([...visit.waitingSlotIds]),
    seatAssignments: Object.freeze(visit.seatAssignments.map((entry) => Object.freeze({ ...entry }))),
    mealProgress: Object.freeze(visit.mealProgress.map((entry) => Object.freeze({ ...entry }))),
  });
}

function cloneTable(table: CustomerTableState): CustomerTableState {
  return Object.freeze({ ...table });
}

function cloneState(state: CustomerModuleState): CustomerModuleState {
  return Object.freeze({
    ...state,
    visits: Object.freeze(state.visits.map(cloneVisit)),
    tables: Object.freeze(state.tables.map(cloneTable)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function validateVenueDefinitions(venues: readonly CustomerVenueDefinition[]): void {
  if (venues.length === 0) throw new Error("Customer venues must not be empty.");
  const sceneIds = new Set<string>();
  const resourceIds = new Set<string>();
  for (const venue of venues) {
    if (!validId(venue.sceneId) || sceneIds.has(venue.sceneId) ||
      !validId(venue.waitingArea.id) || venue.waitingArea.slotIds.length === 0) {
      throw new Error(`Invalid customer venue: ${venue.sceneId}`);
    }
    sceneIds.add(venue.sceneId);
    const localIds = [venue.waitingArea.id, ...venue.waitingArea.slotIds];
    for (const table of venue.tables) {
      if (!validId(table.id) || table.seatIds.length === 0) throw new Error(`Invalid customer table: ${table.id}`);
      localIds.push(table.id, ...table.seatIds);
    }
    for (const id of localIds) {
      if (!validId(id) || resourceIds.has(id)) throw new Error(`Duplicate customer venue resource: ${id}`);
      resourceIds.add(id);
    }
  }
}
export class CustomerModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = CUSTOMER_MODULE_ID;
  readonly transactionParticipantId = CUSTOMER_MODULE_ID;
  readonly #characters: CharacterModule;
  readonly #employment: EmploymentModule;
  readonly #orders: OrderModule;
  readonly #venues: CustomerVenuePort;
  readonly #menu: CustomerMenuPort;
  readonly #mealDurationMs: number;
  readonly #transaction: TransactionScope;
  #state: CustomerModuleState;
  #transactionActive = false;

  constructor(options: {
    readonly characters: CharacterModule;
    readonly employment: EmploymentModule;
    readonly orders: OrderModule;
    readonly venues: CustomerVenuePort;
    readonly menu: CustomerMenuPort;
    readonly mealDurationMs: number;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: CustomerModuleState;
  }) {
    const venues = options.venues.listVenues();
    validateVenueDefinitions(venues);
    if (!positiveInteger(options.mealDurationMs)) throw new Error("Customer meal duration must be positive.");
    this.#characters = options.characters;
    this.#employment = options.employment;
    this.#orders = options.orders;
    this.#venues = options.venues;
    this.#menu = options.menu;
    this.#mealDurationMs = options.mealDurationMs;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: CUSTOMER_SCHEMA_VERSION,
          revision: 0,
          visits: [],
          tables: venues.flatMap((venue) => venue.tables.map((table) => ({
            tableId: table.id,
            sceneId: venue.sceneId,
            cleanliness: "clean" as const,
            assignedVisitId: null,
          }))),
          lastAdvancedAtUtcMs: 0,
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): CustomerModuleState {
    return cloneState(this.#state);
  }

  getVisit(visitId: string): CustomerVisitState | null {
    const visit = this.#state.visits.find((entry) => entry.id === visitId);
    return visit === undefined ? null : cloneVisit(visit);
  }

  getTable(tableId: string): CustomerTableState | null {
    const table = this.#state.tables.find((entry) => entry.tableId === tableId);
    return table === undefined ? null : cloneTable(table);
  }

  isCustomerVisitActive(characterId: InstanceId): boolean {
    return this.#state.visits.some((visit) =>
      visit.phase !== "departed" && visit.memberCharacterIds.includes(characterId));
  }

  createReadModel(recentDepartureLimit = 20): CustomerReadModel {
    if (!nonNegativeInteger(recentDepartureLimit)) throw new RangeError("Recent departure limit is invalid.");
    const waitingPeopleByScene: Record<string, number> = {};
    for (const visit of this.#state.visits) {
      if (visit.phase !== "waiting") continue;
      waitingPeopleByScene[visit.sceneId] = (waitingPeopleByScene[visit.sceneId] ?? 0) +
        visit.memberCharacterIds.length;
    }
    const departures = this.#state.visits
      .filter((visit) => visit.phase === "departed")
      .sort((left, right) => (right.departedAtUtcMs ?? 0) - (left.departedAtUtcMs ?? 0))
      .slice(0, recentDepartureLimit);
    return Object.freeze({
      revision: this.#state.revision,
      activeVisits: Object.freeze(this.#state.visits
        .filter((visit) => visit.phase !== "departed")
        .map(cloneVisit)),
      recentDepartures: Object.freeze(departures.map(cloneVisit)),
      tables: Object.freeze(this.#state.tables.map(cloneTable)),
      waitingPeopleByScene: Object.freeze(waitingPeopleByScene),
    });
  }

  getOrderableMenu(visitId: string): readonly CustomerOrderableMenuItem[] {
    const visit = this.#state.visits.find((entry) => entry.id === visitId);
    if (visit === undefined || visit.phase !== "awaiting-order") return Object.freeze([]);
    return Object.freeze(this.#menu.listMenuItems(visit.sceneId).map((item, index) => {
      const availability = this.#orders.checkIngredientAvailability([{
        id: `menu-line-${index + 1}`,
        recipeId: item.recipeId,
        quantity: 1,
      }]);
      return Object.freeze({
        ...item,
        orderable: availability.orderable,
        missingIngredients: Object.freeze(availability.missing.map((entry) => Object.freeze({ ...entry }))),
      });
    }));
  }

  getDialogueContext(visitId: string): {
    readonly context: CustomerDialogueContext;
    readonly tableId: string | null;
    readonly requiresMovement: false;
  } | null {
    const visit = this.#state.visits.find((entry) => entry.id === visitId);
    if (visit === undefined || visit.phase === "departed") return null;
    const context: CustomerDialogueContext = visit.phase === "departing"
      ? "departing"
      : visit.phase === "dining" || visit.phase === "awaiting-payment"
        ? "eating"
        : visit.phase === "waiting" || visit.phase === "moving-to-table"
          ? "arrival"
          : "waiting";
    return Object.freeze({ context, tableId: visit.tableId, requiresMovement: false as const });
  }

  arriveGroup(
    operationId: string,
    request: ArriveCustomerGroupRequest,
  ): CustomerOperationResult<CustomerVisitState> {
    return this.#run(operationId, request.arrivedAtUtcMs, (emit) => {
      if (!validId(request.visitId) || !validId(request.sceneId) ||
        request.memberCharacterIds.length === 0 || !validMinute(request.minuteOfDay) ||
        !nonNegativeInteger(request.arrivedAtUtcMs)) {
        throw new CustomerRejected("INVALID_REQUEST", "Customer arrival request is invalid.");
      }
      const memberIds = new Set(request.memberCharacterIds);
      if (memberIds.size !== request.memberCharacterIds.length ||
        this.#state.visits.some((visit) => visit.id === request.visitId)) {
        throw new CustomerRejected("DUPLICATE_VISIT", "Customer visit or member list is duplicated.");
      }
      const venue = this.#venue(request.sceneId);
      for (const characterId of request.memberCharacterIds) {
        if (this.#characters.getCharacter(characterId) === null || this.isCustomerVisitActive(characterId)) {
          throw new CustomerRejected("CHARACTER_UNAVAILABLE", `Character cannot start another visit: ${characterId}`);
        }
        const context = this.#employment.getWorkContext(characterId, {
          minuteOfDay: request.minuteOfDay,
          customerVisitActive: false,
          voyageActive: false,
        });
        if (context.tags.includes("employee") || context.voyageActive) {
          throw new CustomerRejected("CHARACTER_UNAVAILABLE", `On-duty or voyaging character cannot visit: ${characterId}`);
        }
      }
      let visits = [...this.#state.visits, cloneVisit({
        id: request.visitId,
        sceneId: request.sceneId,
        memberCharacterIds: request.memberCharacterIds,
        phase: "waiting",
        waitingAreaId: venue.waitingArea.id,
        waitingSlotIds: [],
        tableId: null,
        seatAssignments: [],
        arrivedAtUtcMs: request.arrivedAtUtcMs,
        tableReservedAtUtcMs: null,
        seatedAtUtcMs: null,
        pendingOrderId: null,
        orderId: null,
        mealProgress: [],
        checkoutObservedAtUtcMs: null,
        departedAtUtcMs: null,
      })];
      let tables = this.#reconcileTables(this.#state.tables, visits);
      ({ visits, tables } = this.#matchTables(visits, tables, request.arrivedAtUtcMs, operationId, emit));
      this.#ensureWaitingCapacity(visits);
      visits = this.#assignWaitingSlots(visits);
      this.#replace({ visits, tables });
      const created = visits.find((entry) => entry.id === request.visitId)!;
      emit(this.#event(operationId, "customer.group-arrived", request.arrivedAtUtcMs, {
        visitId: created.id,
        sceneId: created.sceneId,
        memberCharacterIds: created.memberCharacterIds,
      }, created.id));
      if (created.phase === "waiting") {
        emit(this.#event(operationId, "customer.group-waiting", request.arrivedAtUtcMs, {
          visitId: created.id,
          waitingAreaId: created.waitingAreaId,
          waitingSlotIds: created.waitingSlotIds,
        }, created.id));
      }
      return cloneVisit(created);
    });
  }

  confirmSeated(
    operationId: string,
    visitId: string,
    occurredAtUtcMs: number,
  ): CustomerOperationResult<CustomerVisitState> {
    return this.#run(operationId, occurredAtUtcMs, (emit) => {
      const visit = this.#requireVisit(visitId);
      if (visit.phase !== "moving-to-table" || visit.tableId === null) {
        throw new CustomerRejected("INVALID_PHASE", "Only a group moving to its reserved table can sit down.");
      }
      const seated = cloneVisit({ ...visit, phase: "awaiting-order", seatedAtUtcMs: occurredAtUtcMs });
      this.#replace({ visits: this.#state.visits.map((entry) => entry.id === visit.id ? seated : entry) });
      emit(this.#event(operationId, "customer.group-seated", occurredAtUtcMs, {
        visitId: seated.id,
        tableId: seated.tableId,
        seatAssignments: seated.seatAssignments,
      }, seated.id));
      emit(this.#event(operationId, "customer.awaiting-order", occurredAtUtcMs, {
        visitId: seated.id,
        tableId: seated.tableId,
      }, seated.id));
      return seated;
    });
  }
  recordPendingOrder(
    operationId: string,
    visitId: string,
    request: RecordCustomerOrderRequest,
  ): CustomerOperationResult<CustomerVisitState> {
    return this.#run(operationId, request.occurredAtUtcMs, (emit) => {
      const visit = this.#requireVisit(visitId);
      if (visit.phase !== "awaiting-order" || visit.tableId === null ||
        !validId(request.pendingOrderId) || !validId(request.ingredientReservationId) ||
        !nonNegativeInteger(request.occurredAtUtcMs) || request.lines.length === 0) {
        throw new CustomerRejected("INVALID_PHASE", "Customer group is not ready to record an order.");
      }
      const menuRecipeIds = new Set(this.#menu.listMenuItems(visit.sceneId).map((item) => item.recipeId));
      if (request.lines.some((line) => !menuRecipeIds.has(line.recipeId) ||
        line.dinerCharacterIds.length !== line.quantity ||
        line.dinerCharacterIds.some((characterId) => !visit.memberCharacterIds.includes(characterId)))) {
        throw new CustomerRejected("NO_ORDERABLE_SELECTION", "Selection contains a recipe not offered in this scene.");
      }
      const availability = this.#orders.checkIngredientAvailability(request.lines);
      if (!availability.orderable) {
        throw new CustomerRejected(
          "NO_ORDERABLE_SELECTION",
          availability.reason === "ingredients-unavailable"
            ? `Selected ingredients are unavailable: ${availability.missing
              .map((entry) => `${entry.itemId} x${entry.quantity}`).join(", ")}`
            : "Customer selection or diner assignment is not orderable.",
        );
      }
      const created = this.#orders.createPendingOrder({
        operationId: `${operationId}:order`,
        pendingOrderId: request.pendingOrderId,
        tableId: visit.tableId,
        customerGroupId: visit.id,
        lines: request.lines,
        ingredientReservationId: request.ingredientReservationId,
        createdAtUtcMs: request.occurredAtUtcMs,
      });
      if (!created.accepted) throw new CustomerRejected("ORDER_REJECTED", created.message);
      const updated = cloneVisit({
        ...visit,
        phase: "pending-order",
        pendingOrderId: created.value.id,
      });
      this.#replace({ visits: this.#state.visits.map((entry) => entry.id === visit.id ? updated : entry) });
      emit(this.#event(operationId, "customer.pending-order-recorded", request.occurredAtUtcMs, {
        visitId: visit.id,
        tableId: visit.tableId,
        pendingOrderId: created.value.id,
        lineCount: created.value.lines.length,
      }, visit.id));
      return updated;
    });
  }

  advanceTo(
    operationId: string,
    nowUtcMs: number,
  ): CustomerOperationResult<CustomerModuleState> {
    return this.#run(operationId, nowUtcMs, (emit) => {
      if (!nonNegativeInteger(nowUtcMs) || nowUtcMs < this.#state.lastAdvancedAtUtcMs) {
        throw new CustomerRejected("CLOCK_ROLLBACK", "Customer clock cannot move backwards.");
      }
      let visits = this.#state.visits.map(cloneVisit);
      let tables = this.#reconcileTables(this.#state.tables, visits);
      const orderState = this.#orders.exportState();
      for (let index = 0; index < visits.length; index += 1) {
        let visit = visits[index]!;
        if (visit.phase === "pending-order" && visit.pendingOrderId !== null) {
          const pending = orderState.pendingOrders.find((entry) => entry.id === visit.pendingOrderId);
          if (pending?.submittedOrderId !== null && pending?.submittedOrderId !== undefined) {
            visit = cloneVisit({ ...visit, phase: "dining", orderId: pending.submittedOrderId });
            visits[index] = visit;
            emit(this.#event(operationId, "customer.formal-order-observed", pending.submittedAtUtcMs ?? nowUtcMs, {
              visitId: visit.id,
              pendingOrderId: pending.id,
              orderId: pending.submittedOrderId,
            }, visit.id));
          }
        }
        if (visit.orderId === null || visit.phase === "departed" || visit.phase === "departing") continue;
        let order = this.#orders.getOrder(visit.orderId);
        if (order === null) throw new CustomerRejected("ORDER_REJECTED", `Visit references unknown order: ${visit.orderId}`);
        let progress = visit.mealProgress.map((entry) => ({ ...entry }));
        for (const meal of order.meals) {
          if (meal.status === "served" && !progress.some((entry) => entry.mealId === meal.id)) {
            const startedAtUtcMs = meal.updatedAtUtcMs;
            progress.push({
              mealId: meal.id,
              startedAtUtcMs,
              completesAtUtcMs: startedAtUtcMs + this.#mealDurationMs,
              consumedAtUtcMs: null,
            });
            emit(this.#event(operationId, "customer.meal-started", startedAtUtcMs, {
              visitId: visit.id,
              orderId: order.id,
              mealId: meal.id,
              completesAtUtcMs: startedAtUtcMs + this.#mealDurationMs,
            }, meal.id));
          } else if (meal.status === "consumed") {
            const existing = progress.find((entry) => entry.mealId === meal.id);
            if (existing === undefined) {
              progress.push({
                mealId: meal.id,
                startedAtUtcMs: Math.max(0, meal.updatedAtUtcMs - this.#mealDurationMs),
                completesAtUtcMs: meal.updatedAtUtcMs,
                consumedAtUtcMs: meal.updatedAtUtcMs,
              });
            } else if (existing.consumedAtUtcMs === null) {
              existing.consumedAtUtcMs = meal.updatedAtUtcMs;
            }
          }
        }
        for (const mealProgress of progress
          .filter((entry) => entry.consumedAtUtcMs === null && entry.completesAtUtcMs <= nowUtcMs)
          .sort((left, right) => left.completesAtUtcMs - right.completesAtUtcMs ||
            left.mealId.localeCompare(right.mealId))) {
          const meal = this.#orders.getMeal(mealProgress.mealId);
          if (meal?.status === "consumed") {
            mealProgress.consumedAtUtcMs = meal.updatedAtUtcMs;
            continue;
          }
          if (meal?.status !== "served") continue;
          const consumed = this.#orders.advanceMeal(
            `customer-consume:${meal.id}`,
            meal.id,
            "consumed",
            mealProgress.completesAtUtcMs,
          );
          if (!consumed.accepted) throw new CustomerRejected("ORDER_REJECTED", consumed.message);
          mealProgress.consumedAtUtcMs = mealProgress.completesAtUtcMs;
          order = consumed.value;
          emit(this.#event(operationId, "customer.meal-consumed", mealProgress.completesAtUtcMs, {
            visitId: visit.id,
            orderId: order.id,
            mealId: meal.id,
            dinerCharacterId: meal.dinerCharacterId,
          }, meal.id));
        }
        order = this.#orders.getOrder(visit.orderId)!;
        let phase: CustomerVisitPhase = visit.phase;
        if (order.status === "awaiting-payment" && phase !== "awaiting-payment") {
          phase = "awaiting-payment";
          emit(this.#event(operationId, "customer.awaiting-payment", nowUtcMs, {
            visitId: visit.id,
            orderId: order.id,
            tableId: visit.tableId,
          }, visit.id));
        }
        let checkoutObservedAtUtcMs = visit.checkoutObservedAtUtcMs;
        if (order.status === "settled") {
          phase = "departing";
          checkoutObservedAtUtcMs = order.settledAtUtcMs ?? nowUtcMs;
          if (visit.tableId !== null) {
            tables = tables.map((table) => table.tableId === visit.tableId
              ? cloneTable({ ...table, cleanliness: "dirty" })
              : table);
          }
          emit(this.#event(operationId, "customer.checkout-observed", checkoutObservedAtUtcMs, {
            visitId: visit.id,
            orderId: order.id,
            tableId: visit.tableId,
          }, visit.id));
          emit(this.#event(operationId, "customer.table-dirtied", checkoutObservedAtUtcMs, {
            visitId: visit.id,
            tableId: visit.tableId,
          }, visit.tableId ?? visit.id));
        }
        visits[index] = cloneVisit({ ...visit, phase, mealProgress: progress, checkoutObservedAtUtcMs });
      }
      this.#replace({ visits, tables, lastAdvancedAtUtcMs: nowUtcMs });
      return this.exportState();
    });
  }

  confirmDeparted(
    operationId: string,
    visitId: string,
    occurredAtUtcMs: number,
  ): CustomerOperationResult<CustomerVisitState> {
    return this.#run(operationId, occurredAtUtcMs, (emit) => {
      const visit = this.#requireVisit(visitId);
      if (visit.phase !== "departing" || visit.tableId === null) {
        throw new CustomerRejected("INVALID_PHASE", "Only a checked-out group can leave.");
      }
      let tables = this.#reconcileTables(this.#state.tables, this.#state.visits);
      const table = tables.find((entry) => entry.tableId === visit.tableId);
      if (table?.assignedVisitId !== visit.id || table.cleanliness !== "dirty") {
        throw new CustomerRejected("INVALID_PHASE", "Departure table assignment is inconsistent.");
      }
      const departed = cloneVisit({
        ...visit,
        phase: "departed",
        seatAssignments: [],
        departedAtUtcMs: occurredAtUtcMs,
      });
      let visits = this.#state.visits.map((entry) => entry.id === visit.id ? departed : entry);
      tables = tables.map((entry) => entry.tableId === visit.tableId
        ? cloneTable({ ...entry, assignedVisitId: null })
        : entry);
      ({ visits, tables } = this.#matchTables(visits, tables, occurredAtUtcMs, operationId, emit));
      visits = this.#assignWaitingSlots(visits);
      const retainedDepartureIds = new Set(visits
        .filter((entry) => entry.phase === "departed")
        .sort((left, right) => (right.departedAtUtcMs ?? 0) - (left.departedAtUtcMs ?? 0))
        .slice(0, DEPARTED_VISIT_HISTORY_LIMIT)
        .map((entry) => entry.id));
      visits = visits.filter((entry) =>
        entry.phase !== "departed" || retainedDepartureIds.has(entry.id));
      this.#replace({ visits, tables });
      emit(this.#event(operationId, "customer.group-departed", occurredAtUtcMs, {
        visitId: visit.id,
        tableId: visit.tableId,
        memberCharacterIds: visit.memberCharacterIds,
      }, visit.id));
      return departed;
    });
  }

  markTableCleaned(
    operationId: string,
    tableId: string,
    occurredAtUtcMs: number,
  ): CustomerOperationResult<CustomerTableState> {
    return this.#run(operationId, occurredAtUtcMs, (emit) => {
      if (!validId(tableId)) throw new CustomerRejected("INVALID_REQUEST", "Table id is invalid.");
      let visits = this.#state.visits.map(cloneVisit);
      let tables = this.#reconcileTables(this.#state.tables, visits);
      const table = tables.find((entry) => entry.tableId === tableId);
      if (table === undefined) throw new CustomerRejected("UNKNOWN_TABLE", `Unknown customer table: ${tableId}`);
      if (table.assignedVisitId !== null || table.cleanliness !== "dirty") {
        throw new CustomerRejected("INVALID_PHASE", "Only an unoccupied dirty table can be cleaned.");
      }
      tables = tables.map((entry) => entry.tableId === tableId
        ? cloneTable({ ...entry, cleanliness: "clean" })
        : entry);
      emit(this.#event(operationId, "customer.table-cleaned", occurredAtUtcMs, { tableId }, tableId));
      ({ visits, tables } = this.#matchTables(visits, tables, occurredAtUtcMs, operationId, emit));
      visits = this.#assignWaitingSlots(visits);
      this.#replace({ visits, tables });
      return cloneTable(tables.find((entry) => entry.tableId === tableId)!);
    });
  }

  refreshAssignments(
    operationId: string,
    occurredAtUtcMs: number,
  ): CustomerOperationResult<CustomerModuleState> {
    return this.#run(operationId, occurredAtUtcMs, (emit) => {
      let visits = this.#state.visits.map(cloneVisit);
      let tables = this.#reconcileTables(this.#state.tables, visits);
      ({ visits, tables } = this.#matchTables(visits, tables, occurredAtUtcMs, operationId, emit));
      this.#ensureWaitingCapacity(visits);
      visits = this.#assignWaitingSlots(visits);
      this.#replace({ visits, tables });
      return this.exportState();
    });
  }
  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Customer transaction is already active.");
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

  #run<TValue>(
    operationId: string,
    occurredAtUtcMs: number,
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): CustomerOperationResult<TValue> {
    if (!validId(operationId) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Customer operation request is invalid.");
    }
    if (occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs) {
      return this.#reject(operationId, "CLOCK_ROLLBACK", "Customer operation precedes the current clock.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Customer operation was already processed.");
    }
    try {
      const result = this.#transaction.run([this], ({ emit }) => {
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
    } catch (error) {
      if (error instanceof CustomerRejected) return this.#reject(operationId, error.code, error.message);
      return this.#reject(
        operationId,
        "INVALID_REQUEST",
        error instanceof Error ? error.message : "Customer operation failed.",
      );
    }
  }

  #venue(sceneId: string): CustomerVenueDefinition {
    const venues = this.#venues.listVenues();
    validateVenueDefinitions(venues);
    const venue = venues.find((entry) => entry.sceneId === sceneId);
    if (venue === undefined) throw new CustomerRejected("UNKNOWN_SCENE", `Unknown customer scene: ${sceneId}`);
    return venue;
  }

  #requireVisit(visitId: string): CustomerVisitState {
    if (!validId(visitId)) throw new CustomerRejected("INVALID_REQUEST", "Visit id is invalid.");
    const visit = this.#state.visits.find((entry) => entry.id === visitId);
    if (visit === undefined) throw new CustomerRejected("UNKNOWN_VISIT", `Unknown customer visit: ${visitId}`);
    return visit;
  }

  #reconcileTables(
    current: readonly CustomerTableState[],
    visits: readonly CustomerVisitState[],
  ): CustomerTableState[] {
    const definitions = this.#venues.listVenues().flatMap((venue) =>
      venue.tables.map((table) => ({ sceneId: venue.sceneId, table })));
    const desiredIds = new Set(definitions.map((entry) => entry.table.id));
    for (const table of current) {
      if (!desiredIds.has(table.tableId) && table.assignedVisitId !== null) {
        throw new CustomerRejected("INVALID_PHASE", `Occupied table disappeared from venue: ${table.tableId}`);
      }
    }
    return definitions.map(({ sceneId, table }) => {
      const existing = current.find((entry) => entry.tableId === table.id);
      if (existing === undefined) {
        return cloneTable({ tableId: table.id, sceneId, cleanliness: "clean", assignedVisitId: null });
      }
      if (existing.sceneId !== sceneId) {
        throw new CustomerRejected("INVALID_PHASE", `Customer table changed scenes: ${table.id}`);
      }
      if (existing.assignedVisitId !== null) {
        const visit = visits.find((entry) => entry.id === existing.assignedVisitId);
        if (visit === undefined || visit.seatAssignments.some((seat) => !table.seatIds.includes(seat.seatId))) {
          throw new CustomerRejected("INVALID_PHASE", `Occupied table changed seat layout: ${table.id}`);
        }
      }
      return cloneTable(existing);
    });
  }

  #matchTables(
    sourceVisits: readonly CustomerVisitState[],
    sourceTables: readonly CustomerTableState[],
    occurredAtUtcMs: number,
    operationId: string,
    emit: (event: DomainEvent) => void,
  ): { readonly visits: CustomerVisitState[]; readonly tables: CustomerTableState[] } {
    let visits = sourceVisits.map(cloneVisit);
    let tables = sourceTables.map(cloneTable);
    for (const venue of [...this.#venues.listVenues()].sort((left, right) => left.sceneId.localeCompare(right.sceneId))) {
      const tableDefinitions = new Map(venue.tables.map((table) => [table.id, table]));
      const waiting = visits
        .filter((visit) => visit.sceneId === venue.sceneId && visit.phase === "waiting")
        .sort((left, right) => left.arrivedAtUtcMs - right.arrivedAtUtcMs || left.id.localeCompare(right.id));
      for (const visit of waiting) {
        const candidates = tables
          .filter((table) => table.sceneId === venue.sceneId && table.cleanliness === "clean" &&
            table.assignedVisitId === null)
          .map((table) => ({ table, definition: tableDefinitions.get(table.tableId)! }))
          .filter((entry) => entry.definition.seatIds.length >= visit.memberCharacterIds.length)
          .sort((left, right) => left.definition.seatIds.length - right.definition.seatIds.length ||
            left.table.tableId.localeCompare(right.table.tableId));
        const selected = candidates[0];
        if (selected === undefined) continue;
        const seatAssignments = visit.memberCharacterIds.map((characterId, index) => Object.freeze({
          characterId,
          seatId: selected.definition.seatIds[index]!,
        }));
        const reserved = cloneVisit({
          ...visit,
          phase: "moving-to-table",
          waitingSlotIds: [],
          tableId: selected.table.tableId,
          seatAssignments,
          tableReservedAtUtcMs: occurredAtUtcMs,
        });
        visits = visits.map((entry) => entry.id === visit.id ? reserved : entry);
        tables = tables.map((entry) => entry.tableId === selected.table.tableId
          ? cloneTable({ ...entry, assignedVisitId: visit.id })
          : entry);
        emit(this.#event(operationId, "customer.table-reserved", occurredAtUtcMs, {
          visitId: visit.id,
          tableId: selected.table.tableId,
          seatAssignments,
        }, visit.id));
      }
    }
    return { visits, tables };
  }

  #ensureWaitingCapacity(visits: readonly CustomerVisitState[]): void {
    for (const venue of this.#venues.listVenues()) {
      const waitingPeople = visits
        .filter((visit) => visit.sceneId === venue.sceneId && visit.phase === "waiting")
        .reduce((sum, visit) => sum + visit.memberCharacterIds.length, 0);
      if (waitingPeople > venue.waitingArea.slotIds.length) {
        throw new CustomerRejected("WAITING_AREA_FULL", `Waiting area is full: ${venue.waitingArea.id}`);
      }
    }
  }

  #assignWaitingSlots(source: readonly CustomerVisitState[]): CustomerVisitState[] {
    let visits = source.map((visit) => visit.phase === "waiting"
      ? cloneVisit({ ...visit, waitingSlotIds: [] })
      : cloneVisit({ ...visit, waitingSlotIds: [] }));
    for (const venue of this.#venues.listVenues()) {
      let slotIndex = 0;
      const waiting = visits
        .filter((visit) => visit.sceneId === venue.sceneId && visit.phase === "waiting")
        .sort((left, right) => left.arrivedAtUtcMs - right.arrivedAtUtcMs || left.id.localeCompare(right.id));
      for (const visit of waiting) {
        const slots = venue.waitingArea.slotIds.slice(slotIndex, slotIndex + visit.memberCharacterIds.length);
        slotIndex += visit.memberCharacterIds.length;
        visits = visits.map((entry) => entry.id === visit.id
          ? cloneVisit({ ...entry, waitingAreaId: venue.waitingArea.id, waitingSlotIds: slots })
          : entry);
      }
    }
    return visits;
  }

  #event(
    operationId: string,
    type: string,
    occurredAtUtcMs: number,
    payload: unknown,
    discriminator = "0",
  ): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}:${discriminator}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #replace(update: Partial<CustomerModuleState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(
    operationId: string,
    code: CustomerRejectionCode,
    message: string,
  ): CustomerOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      committedEventIds: [] as const,
    });
  }

  #validateState(): void {
    const state = this.#state;
    if (state.schemaVersion !== CUSTOMER_SCHEMA_VERSION || !nonNegativeInteger(state.revision) ||
      !nonNegativeInteger(state.lastAdvancedAtUtcMs) ||
      new Set(state.processedOperationIds).size !== state.processedOperationIds.length ||
      state.processedOperationIds.some((id) => !validId(id))) {
      throw new Error("Customer state metadata is invalid.");
    }
    const venues = this.#venues.listVenues();
    validateVenueDefinitions(venues);
    const venueByScene = new Map(venues.map((venue) => [venue.sceneId, venue]));
    const tableDefinitions = new Map(venues.flatMap((venue) =>
      venue.tables.map((table) => [table.id, { sceneId: venue.sceneId, table }] as const)));
    if (new Set(state.visits.map((visit) => visit.id)).size !== state.visits.length ||
      new Set(state.tables.map((table) => table.tableId)).size !== state.tables.length) {
      throw new Error("Customer visit or table ids are duplicated.");
    }
    const activeMembers = new Set<InstanceId>();
    const waitingSlots = new Set<string>();
    for (const visit of state.visits) {
      const venue = venueByScene.get(visit.sceneId);
      if (!validId(visit.id) || venue === undefined || visit.memberCharacterIds.length === 0 ||
        new Set(visit.memberCharacterIds).size !== visit.memberCharacterIds.length ||
        !nonNegativeInteger(visit.arrivedAtUtcMs)) {
        throw new Error(`Customer visit is invalid: ${visit.id}`);
      }
      for (const characterId of visit.memberCharacterIds) {
        if (this.#characters.getCharacter(characterId) === null) throw new Error(`Unknown visiting character: ${characterId}`);
        if (visit.phase !== "departed" && activeMembers.has(characterId)) {
          throw new Error(`Character has multiple active visits: ${characterId}`);
        }
        if (visit.phase !== "departed") activeMembers.add(characterId);
      }
      if (visit.phase === "waiting") {
        if (visit.tableId !== null || visit.seatAssignments.length > 0 ||
          visit.waitingSlotIds.length !== visit.memberCharacterIds.length ||
          visit.waitingSlotIds.some((slotId) => !venue.waitingArea.slotIds.includes(slotId) || waitingSlots.has(slotId))) {
          throw new Error(`Waiting visit is invalid: ${visit.id}`);
        }
        for (const slotId of visit.waitingSlotIds) waitingSlots.add(slotId);
      } else if (visit.phase === "departed") {
        if (visit.departedAtUtcMs === null || visit.seatAssignments.length > 0) {
          throw new Error(`Departed visit is invalid: ${visit.id}`);
        }
      } else {
        if (visit.tableId === null || visit.seatAssignments.length !== visit.memberCharacterIds.length ||
          visit.waitingSlotIds.length > 0) throw new Error(`Seated visit is invalid: ${visit.id}`);
        const table = tableDefinitions.get(visit.tableId);
        if (table === undefined || table.sceneId !== visit.sceneId ||
          visit.seatAssignments.some((seat) => !table.table.seatIds.includes(seat.seatId))) {
          throw new Error(`Visit table reference is invalid: ${visit.id}`);
        }
      }
      const pendingOrder = visit.pendingOrderId === null
        ? null
        : this.#orders.exportState().pendingOrders.find((entry) => entry.id === visit.pendingOrderId);
      const formalOrder = visit.orderId === null ? null : this.#orders.getOrder(visit.orderId);
      if ((visit.pendingOrderId !== null && (pendingOrder == null ||
          pendingOrder.customerGroupId !== visit.id || pendingOrder.tableId !== visit.tableId)) ||
        (visit.orderId !== null && (formalOrder === null ||
          formalOrder.customerGroupId !== visit.id || formalOrder.tableId !== visit.tableId)) ||
        (visit.phase === "pending-order" && visit.pendingOrderId === null) ||
        (["dining", "awaiting-payment", "departing"].includes(visit.phase) && visit.orderId === null) ||
        new Set(visit.mealProgress.map((meal) => meal.mealId)).size !== visit.mealProgress.length ||
        visit.mealProgress.some((meal) => !validId(meal.mealId) ||
          !nonNegativeInteger(meal.startedAtUtcMs) || !nonNegativeInteger(meal.completesAtUtcMs) ||
          meal.completesAtUtcMs < meal.startedAtUtcMs ||
          (meal.consumedAtUtcMs !== null && !nonNegativeInteger(meal.consumedAtUtcMs)))) {
        throw new Error(`Customer order progress is invalid: ${visit.id}`);
      }
    }
    for (const table of state.tables) {
      const definition = tableDefinitions.get(table.tableId);
      if (definition === undefined || definition.sceneId !== table.sceneId ||
        (table.cleanliness !== "clean" && table.cleanliness !== "dirty")) {
        throw new Error(`Customer table state is invalid: ${table.tableId}`);
      }
      if (table.assignedVisitId !== null) {
        const visit = state.visits.find((entry) => entry.id === table.assignedVisitId);
        if (visit === undefined || visit.phase === "waiting" || visit.phase === "departed" ||
          visit.tableId !== table.tableId) {
          throw new Error(`Customer table assignment is invalid: ${table.tableId}`);
        }
      }
    }
    this.#ensureWaitingCapacity(state.visits);
  }
}

export * from "./scene-venue-adapter";
