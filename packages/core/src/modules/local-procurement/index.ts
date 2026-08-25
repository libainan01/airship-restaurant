import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { CharacterModule } from "../character";
import type { DomainModule } from "../domain-module";
import type { EmploymentModule } from "../employment";
import type { TransactionalFinancePort } from "../finance";
import type { FleetModule } from "../fleet";
import type { InventoryModule } from "../inventory";
import type { OrderRecipeCatalogPort } from "../order";
import { createStableTaskKey, type TaskCandidate, type TaskModule, type TaskRequest, type TaskSourceSnapshot } from "../task";
import {
  createFixedProcurementBatchPlans,
  projectProcurementOrderProgress,
  type ProcurementBatchStatus,
  type ProcurementOrderOrigin,
  type ProcurementOrderStatus,
} from "../procurement-order";

export const LOCAL_PROCUREMENT_MODULE_ID = "module.local-procurement";
export const LOCAL_PROCUREMENT_SCHEMA_VERSION = 2;

export type ProcurementTransportMode = "local" | "remote";
export interface LocalProcurementSupplierDefinition {
  readonly id: string;
  readonly sourceRegionId: string;
  readonly preparationDurationMs: number;
  readonly roundTripDistanceUnits: number;
  readonly transportMode?: ProcurementTransportMode;
  readonly routeId?: string;
  readonly items: readonly { readonly itemId: string; readonly baseUnitPriceCopper: number }[];
}
type NormalizedProcurementSupplierDefinition = Omit<LocalProcurementSupplierDefinition, "transportMode" | "routeId"> & {
  readonly transportMode: ProcurementTransportMode;
  readonly routeId: string | null;
};
export interface ProcurementCartLevelDefinition { readonly level: number; readonly upgradeCostCopper: number; readonly capacity: number; readonly speedUnitsPerSecond: number }
export interface ProcurementCartDefinition { readonly id: string; readonly capacity: number; readonly speedUnitsPerSecond: number; readonly levels?: readonly ProcurementCartLevelDefinition[] }
export interface LocalProcurementPricingPolicy { calculateUnitPriceCopper(baseUnitPriceCopper: number, negotiatorCharmLevel: number): number }
export interface ProcurementRecipeSelection { readonly recipeId: string; readonly quantity: number }
export interface ProcurementItemSelection { readonly itemId: string; readonly quantity: number }
export interface ProcurementSourceOverride { readonly itemId: string; readonly supplierId: string }

export interface LocalProcurementDraftRequest {
  readonly recipeSelections: readonly ProcurementRecipeSelection[];
  readonly freeItems: readonly ProcurementItemSelection[];
  readonly finalQuantityOverrides?: readonly ProcurementItemSelection[];
  readonly sourceOverrides?: readonly ProcurementSourceOverride[];
  readonly minuteOfDay: number;
  readonly remoteAirshipId?: string;
}
export interface LocalProcurementDraftLine {
  readonly itemId: string;
  readonly recipeRequiredQuantity: number;
  readonly freeQuantity: number;
  readonly availableInventoryQuantity: number;
  readonly incomingQuantity: number;
  readonly suggestedRecipeQuantity: number;
  readonly finalQuantity: number;
  readonly supplierId: string;
  readonly baseUnitPriceCopper: number;
  readonly transactionUnitPriceCopper: number;
  readonly totalPriceCopper: number;
}
export interface LocalProcurementDraftPreview {
  readonly lines: readonly LocalProcurementDraftLine[];
  readonly negotiatorCharacterId: InstanceId | null;
  readonly negotiatorCharmLevel: number;
  readonly batchCapacitySnapshot: number;
  readonly expectedBatchCount: number;
  readonly totalPriceCopper: number;
  readonly supplierPlans: readonly {
    readonly supplierId: string;
    readonly transportMode: ProcurementTransportMode;
    readonly routeId: string | null;
    readonly capacitySnapshot: number;
    readonly expectedBatchCount: number;
  }[];
}

export type LocalProcurementOrderStatus = ProcurementOrderStatus;
export type LocalProcurementBatchStatus = ProcurementBatchStatus;
export type LocalProcurementOrigin = ProcurementOrderOrigin;
export interface LocalProcurementOrderLineState { readonly itemId: string; readonly quantity: number; readonly baseUnitPriceCopper: number; readonly transactionUnitPriceCopper: number }
export interface LocalProcurementOrderState {
  readonly id: string; readonly submissionId: string; readonly origin: LocalProcurementOrigin;
  readonly transportMode: ProcurementTransportMode; readonly routeId: string | null; readonly roundTripDistanceUnits: number;
  readonly supplierId: string; readonly sourceRegionId: string; readonly destinationRegionId: string; readonly destinationLocationId: string;
  readonly lines: readonly LocalProcurementOrderLineState[]; readonly totalQuantity: number; readonly deliveredQuantity: number; readonly totalPriceCopper: number;
  readonly negotiatorCharacterId: InstanceId | null; readonly negotiatorCharmLevel: number; readonly paymentEntryId: string;
  readonly status: LocalProcurementOrderStatus; readonly createdAtUtcMs: number; readonly completedAtUtcMs: number | null;
}
export interface LocalProcurementBatchState {
  readonly id: string; readonly orderId: string; readonly sequence: number; readonly items: readonly ProcurementItemSelection[];
  readonly transportMode: ProcurementTransportMode;
  readonly totalQuantity: number; readonly capacitySnapshot: number; readonly status: LocalProcurementBatchStatus;
  readonly preparationStartedAtUtcMs: number; readonly preparationEndsAtUtcMs: number; readonly readyAtUtcMs: number | null; readonly taskId: string;
  readonly assignedCharacterId: InstanceId | null; readonly cartId: string | null; readonly cartSpeedSnapshot: number | null;
  readonly airshipId: string | null; readonly voyageId: string | null;
  readonly departedAtUtcMs: number | null; readonly arrivesAtUtcMs: number | null; readonly arrivedAtUtcMs: number | null;
}
export interface ProcurementCartState { readonly id: string; readonly level: number; readonly capacity: number; readonly speedUnitsPerSecond: number; readonly activeBatchId: string | null }
export interface LocalProcurementState {
  readonly schemaVersion: typeof LOCAL_PROCUREMENT_SCHEMA_VERSION; readonly revision: number;
  readonly orders: readonly LocalProcurementOrderState[]; readonly batches: readonly LocalProcurementBatchState[]; readonly carts: readonly ProcurementCartState[];
  readonly nextOrderSequence: number; readonly nextSubmissionSequence: number; readonly lastAdvancedAtUtcMs: number; readonly processedOperationIds: readonly string[];
}
export interface PlaceLocalProcurementRequest extends LocalProcurementDraftRequest {
  readonly submissionId?: string; readonly origin?: LocalProcurementOrigin; readonly destinationRegionId: string; readonly occurredAtUtcMs: number;
}
export type LocalProcurementRejectionCode = "INVALID_REQUEST" | "DUPLICATE_OPERATION" | "EMPTY_DRAFT" | "UNKNOWN_RECIPE" | "UNKNOWN_ITEM" | "UNKNOWN_SUPPLIER" | "UNKNOWN_BATCH" | "UNKNOWN_CART" | "BATCH_NOT_READY" | "CART_UNAVAILABLE" | "CART_BUSY" | "MAX_LEVEL" | "TASK_REJECTED" | "FINANCE_REJECTED" | "DEPENDENCY_REJECTED" | "REMOTE_UNAVAILABLE" | "WRONG_TRANSPORT" | "CLOCK_ROLLBACK";
export type LocalProcurementResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: LocalProcurementRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 4_096;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const integer = (value: number, minimum = 0): boolean => Number.isSafeInteger(value) && value >= minimum;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const freezeItems = (items: readonly ProcurementItemSelection[]) => Object.freeze(items.map((entry) => Object.freeze({ ...entry })));
const cloneOrder = (value: LocalProcurementOrderState): LocalProcurementOrderState => Object.freeze({ ...value, lines: Object.freeze(value.lines.map((entry) => Object.freeze({ ...entry }))) });
const cloneBatch = (value: LocalProcurementBatchState): LocalProcurementBatchState => Object.freeze({ ...value, items: freezeItems(value.items) });
const cloneCart = (value: ProcurementCartState): ProcurementCartState => Object.freeze({ ...value });
function cloneState(value: LocalProcurementState): LocalProcurementState { return Object.freeze({ ...value, orders: Object.freeze(value.orders.map(cloneOrder)), batches: Object.freeze(value.batches.map(cloneBatch)), carts: Object.freeze(value.carts.map(cloneCart)), processedOperationIds: Object.freeze([...value.processedOperationIds]) }); }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const validOrNull = (value: unknown): boolean => value === null || (typeof value === "string" && valid(value));
const integerOrNull = (value: unknown): boolean => value === null || (typeof value === "number" && integer(value));
const positiveOrNull = (value: unknown): boolean => value === null || (typeof value === "number" && positive(value));

/** Structural save-boundary validation; module construction enforces cross-record invariants. */
export function isLocalProcurementState(value: unknown): value is LocalProcurementState {
  if (!record(value) || value.schemaVersion !== LOCAL_PROCUREMENT_SCHEMA_VERSION ||
    typeof value.revision !== "number" || !integer(value.revision) ||
    typeof value.nextOrderSequence !== "number" || !integer(value.nextOrderSequence, 1) ||
    typeof value.nextSubmissionSequence !== "number" || !integer(value.nextSubmissionSequence, 1) ||
    typeof value.lastAdvancedAtUtcMs !== "number" || !integer(value.lastAdvancedAtUtcMs) ||
    !Array.isArray(value.orders) || !Array.isArray(value.batches) || !Array.isArray(value.carts) ||
    !Array.isArray(value.processedOperationIds)) return false;

  const processed = value.processedOperationIds;
  if (processed.some((entry) => typeof entry !== "string" || !valid(entry)) || new Set(processed).size !== processed.length) return false;
  const carts = value.carts;
  if (carts.some((entry) => !record(entry) || typeof entry.id !== "string" || !valid(entry.id) ||
    typeof entry.level !== "number" || !integer(entry.level, 1) ||
    typeof entry.capacity !== "number" || !integer(entry.capacity, 1) ||
    typeof entry.speedUnitsPerSecond !== "number" || !positive(entry.speedUnitsPerSecond) ||
    !validOrNull(entry.activeBatchId)) || new Set(carts.map((entry) => entry.id)).size !== carts.length) return false;

  const orders = value.orders;
  if (orders.some((entry) => {
    if (!record(entry) || typeof entry.id !== "string" || !valid(entry.id) || typeof entry.submissionId !== "string" || !valid(entry.submissionId) ||
      (entry.origin !== "manual" && entry.origin !== "automatic") || (entry.transportMode !== undefined && entry.transportMode !== "local" && entry.transportMode !== "remote") ||
      (entry.routeId !== undefined && !validOrNull(entry.routeId)) || (entry.roundTripDistanceUnits !== undefined && (typeof entry.roundTripDistanceUnits !== "number" || !positive(entry.roundTripDistanceUnits))) || typeof entry.supplierId !== "string" || !valid(entry.supplierId) ||
      typeof entry.sourceRegionId !== "string" || !valid(entry.sourceRegionId) || typeof entry.destinationRegionId !== "string" || !valid(entry.destinationRegionId) ||
      typeof entry.destinationLocationId !== "string" || !valid(entry.destinationLocationId) || !Array.isArray(entry.lines) || entry.lines.length === 0 ||
      typeof entry.totalQuantity !== "number" || !integer(entry.totalQuantity, 1) || typeof entry.deliveredQuantity !== "number" || !integer(entry.deliveredQuantity) ||
      typeof entry.totalPriceCopper !== "number" || !integer(entry.totalPriceCopper, 1) || !validOrNull(entry.negotiatorCharacterId) ||
      typeof entry.negotiatorCharmLevel !== "number" || !integer(entry.negotiatorCharmLevel) || typeof entry.paymentEntryId !== "string" || !valid(entry.paymentEntryId) ||
      !["pending", "fulfilling", "partial", "completed"].includes(entry.status as string) || typeof entry.createdAtUtcMs !== "number" || !integer(entry.createdAtUtcMs) ||
      !integerOrNull(entry.completedAtUtcMs)) return true;
    return entry.lines.some((line) => !record(line) || typeof line.itemId !== "string" || !valid(line.itemId) ||
      typeof line.quantity !== "number" || !integer(line.quantity, 1) || typeof line.baseUnitPriceCopper !== "number" || !integer(line.baseUnitPriceCopper, 1) ||
      typeof line.transactionUnitPriceCopper !== "number" || !integer(line.transactionUnitPriceCopper, 1));
  }) || new Set(orders.map((entry) => entry.id)).size !== orders.length) return false;

  const batches = value.batches;
  if (batches.some((entry) => {
    if (!record(entry) || typeof entry.id !== "string" || !valid(entry.id) || typeof entry.orderId !== "string" || !valid(entry.orderId) ||
      typeof entry.sequence !== "number" || !integer(entry.sequence, 1) || !Array.isArray(entry.items) || entry.items.length === 0 ||
      (entry.transportMode !== undefined && entry.transportMode !== "local" && entry.transportMode !== "remote") ||
      typeof entry.totalQuantity !== "number" || !integer(entry.totalQuantity, 1) || typeof entry.capacitySnapshot !== "number" || !integer(entry.capacitySnapshot, 1) ||
      !["preparing", "waiting", "in-transit", "arrived"].includes(entry.status as string) || typeof entry.preparationStartedAtUtcMs !== "number" || !integer(entry.preparationStartedAtUtcMs) ||
      typeof entry.preparationEndsAtUtcMs !== "number" || !integer(entry.preparationEndsAtUtcMs) || !integerOrNull(entry.readyAtUtcMs) ||
      typeof entry.taskId !== "string" || !valid(entry.taskId) || !validOrNull(entry.assignedCharacterId) || !validOrNull(entry.cartId) ||
      (entry.airshipId !== undefined && !validOrNull(entry.airshipId)) || (entry.voyageId !== undefined && !validOrNull(entry.voyageId)) ||
      !positiveOrNull(entry.cartSpeedSnapshot) || !integerOrNull(entry.departedAtUtcMs) || !integerOrNull(entry.arrivesAtUtcMs) || !integerOrNull(entry.arrivedAtUtcMs)) return true;
    return entry.items.some((item) => !record(item) || typeof item.itemId !== "string" || !valid(item.itemId) || typeof item.quantity !== "number" || !integer(item.quantity, 1));
  }) || new Set(batches.map((entry) => entry.id)).size !== batches.length) return false;
  return true;
}
class ProcurementRejected extends Error { constructor(readonly code: LocalProcurementRejectionCode, message: string) { super(message); } }

export class LocalProcurementModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = LOCAL_PROCUREMENT_MODULE_ID;
  readonly transactionParticipantId = LOCAL_PROCUREMENT_MODULE_ID;
  readonly #finance: TransactionalFinancePort; readonly #inventory: InventoryModule; readonly #characters: CharacterModule; readonly #employment: EmploymentModule;
  readonly #tasks: TaskModule; readonly #recipes: OrderRecipeCatalogPort; readonly #pricing: LocalProcurementPricingPolicy; readonly #destinationLocationId: string;
  readonly #fleet: FleetModule | null;
  readonly #suppliers = new Map<string, NormalizedProcurementSupplierDefinition>(); readonly #suppliersByItem = new Map<string, NormalizedProcurementSupplierDefinition[]>();
  readonly #cartLevels = new Map<string, readonly ProcurementCartLevelDefinition[]>();
  readonly #transaction: TransactionScope; #state: LocalProcurementState; #transactionActive = false;

  constructor(options: { readonly finance: TransactionalFinancePort; readonly inventory: InventoryModule; readonly characters: CharacterModule; readonly employment: EmploymentModule; readonly tasks: TaskModule; readonly recipes: OrderRecipeCatalogPort; readonly pricing: LocalProcurementPricingPolicy; readonly destinationLocationId: string; readonly suppliers: readonly LocalProcurementSupplierDefinition[]; readonly carts: readonly ProcurementCartDefinition[]; readonly fleet?: FleetModule; readonly eventBus?: DomainEventBus; readonly initialState?: LocalProcurementState }) {
    if (!valid(options.destinationLocationId) || options.inventory.getLocationSnapshot(options.destinationLocationId) === null || options.suppliers.length === 0 || options.carts.length === 0 || new Set(options.carts.map((entry) => entry.id)).size !== options.carts.length) throw new Error("Local procurement definitions are invalid.");
    for (const supplier of options.suppliers) {
      if (!valid(supplier.id) || !valid(supplier.sourceRegionId) || !integer(supplier.preparationDurationMs) || !positive(supplier.roundTripDistanceUnits) || supplier.items.length === 0 || this.#suppliers.has(supplier.id)) throw new Error(`Invalid local supplier: ${supplier.id}`);
      const itemIds = new Set<string>();
      const transportMode = supplier.transportMode ?? "local";
      if ((transportMode === "remote") !== (supplier.routeId !== undefined) || (supplier.routeId !== undefined && !valid(supplier.routeId))) throw new Error(`Invalid procurement supplier transport: ${supplier.id}`);
      if (transportMode === "remote" && options.fleet === undefined) throw new Error(`Remote supplier requires Fleet: ${supplier.id}`);
      const frozen: NormalizedProcurementSupplierDefinition = Object.freeze({ ...supplier, transportMode, routeId: supplier.routeId ?? null, items: Object.freeze(supplier.items.map((entry) => { if (!valid(entry.itemId) || !integer(entry.baseUnitPriceCopper, 1) || itemIds.has(entry.itemId)) throw new Error(`Invalid local supplier item: ${supplier.id}/${entry.itemId}`); itemIds.add(entry.itemId); return Object.freeze({ ...entry }); })) });
      this.#suppliers.set(frozen.id, frozen); for (const item of frozen.items) this.#suppliersByItem.set(item.itemId, [...(this.#suppliersByItem.get(item.itemId) ?? []), frozen]);
    }
    for (const cart of options.carts) {
      if (!valid(cart.id) || !integer(cart.capacity, 1) || !positive(cart.speedUnitsPerSecond)) throw new Error("Invalid procurement cart: " + cart.id);
      const levels = cart.levels ?? [{ level: 1, upgradeCostCopper: 0, capacity: cart.capacity, speedUnitsPerSecond: cart.speedUnitsPerSecond }];
      if (levels.length === 0 || levels.some((level, index) => level.level !== index + 1 || !integer(level.upgradeCostCopper, index === 0 ? 0 : 1) || !integer(level.capacity, 1) || !positive(level.speedUnitsPerSecond)) || levels[0]!.upgradeCostCopper !== 0 || levels[0]!.capacity !== cart.capacity || levels[0]!.speedUnitsPerSecond !== cart.speedUnitsPerSecond) throw new Error("Invalid procurement cart levels: " + cart.id);
      this.#cartLevels.set(cart.id, Object.freeze(levels.map((level) => Object.freeze({ ...level }))));
    }
    this.#finance = options.finance; this.#inventory = options.inventory; this.#characters = options.characters; this.#employment = options.employment; this.#tasks = options.tasks; this.#recipes = options.recipes; this.#pricing = options.pricing; this.#destinationLocationId = options.destinationLocationId; this.#fleet = options.fleet ?? null;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined ? cloneState({ schemaVersion: LOCAL_PROCUREMENT_SCHEMA_VERSION, revision: 0, orders: [], batches: [], carts: options.carts.map((entry) => ({ id: entry.id, level: 1, capacity: entry.capacity, speedUnitsPerSecond: entry.speedUnitsPerSecond, activeBatchId: null })), nextOrderSequence: 1, nextSubmissionSequence: 1, lastAdvancedAtUtcMs: 0, processedOperationIds: [] }) : this.#migrateState(options.initialState);
    const definitions = new Map(options.carts.map((entry) => [entry.id, entry]));
    if (this.#state.carts.length !== options.carts.length || this.#state.carts.some((entry) => !definitions.has(entry.id))) throw new Error("Saved procurement carts do not match definitions.");
    this.#validate();
  }

  exportState(): LocalProcurementState { return cloneState(this.#state); }
  getCart(id: string): ProcurementCartState | null { const value = this.#state.carts.find((entry) => entry.id === id); return value === undefined ? null : cloneCart(value); }
  listCartLevels(id: string): readonly ProcurementCartLevelDefinition[] { return Object.freeze([...(this.#cartLevels.get(id) ?? [])].map((entry) => Object.freeze({ ...entry }))); }
  getOrder(id: string): LocalProcurementOrderState | null { const value = this.#state.orders.find((entry) => entry.id === id); return value === undefined ? null : cloneOrder(value); }
  getBatch(id: string): LocalProcurementBatchState | null { const value = this.#state.batches.find((entry) => entry.id === id); return value === undefined ? null : cloneBatch(value); }
  previewDraft(request: LocalProcurementDraftRequest): LocalProcurementResult<LocalProcurementDraftPreview> {
    try { return Object.freeze({ accepted: true, changed: false, value: this.#buildDraft(request), committedEventIds: Object.freeze([]) }); }
    catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Local procurement draft failed."); }
  }

  placeOrder(operationId: string, request: PlaceLocalProcurementRequest): LocalProcurementResult<readonly LocalProcurementOrderState[]> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    if (!valid(request.destinationRegionId) || !integer(request.occurredAtUtcMs) || request.occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs || (request.origin !== undefined && request.origin !== "manual" && request.origin !== "automatic")) return this.#reject("INVALID_REQUEST", "Local procurement order request is invalid.");
    let draft: LocalProcurementDraftPreview;
    try { draft = this.#buildDraft(request); } catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Local procurement draft failed."); }
    if (draft.lines.length === 0 || draft.totalPriceCopper <= 0) return this.#reject("EMPTY_DRAFT", "Local procurement draft has no purchasable quantity.");
    const submissionId = request.submissionId ?? `procurement-submission-${this.#state.nextSubmissionSequence}`;
    if (!valid(submissionId) || this.#state.orders.some((entry) => entry.submissionId === submissionId)) return this.#reject("INVALID_REQUEST", "Local procurement submission id is invalid or duplicated.");
    const paymentEntryId = `ledger.procurement.${submissionId}`;
    try {
      const result = this.#transaction.run([this, this.#finance], ({ emit }) => {
        const payment = this.#finance.payExpense(`${operationId}:payment`, { entryId: paymentEntryId, amountCopper: draft.totalPriceCopper, category: "ingredient-procurement", occurredAtUtcMs: request.occurredAtUtcMs, sourceType: "local-procurement", sourceId: submissionId, regionId: request.destinationRegionId });
        if (!payment.accepted) throw new ProcurementRejected("FINANCE_REJECTED", payment.message);
        for (const event of payment.events) emit(event);
        const created = this.#createOrders(submissionId, paymentEntryId, request, draft);
        this.#replace({ orders: [...this.#state.orders, ...created.orders], batches: [...this.#state.batches, ...created.batches], nextOrderSequence: created.nextOrderSequence, nextSubmissionSequence: request.submissionId === undefined ? this.#state.nextSubmissionSequence + 1 : this.#state.nextSubmissionSequence, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        emit(this.#event(operationId, "local-procurement.submission-paid", request.occurredAtUtcMs, { submissionId, paymentEntryId, totalPriceCopper: draft.totalPriceCopper, orderIds: created.orders.map((entry) => entry.id) }));
        for (const order of created.orders) emit(this.#event(operationId, "local-procurement.order-created", request.occurredAtUtcMs, order, order.id));
        return Object.freeze(created.orders.map(cloneOrder));
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Local procurement order failed."); }
  }

  advanceTo(operationId: string, nowUtcMs: number): LocalProcurementResult<LocalProcurementState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    if (!integer(nowUtcMs) || nowUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject("CLOCK_ROLLBACK", "Local procurement clock cannot move backwards.");
    try {
      const result = this.#transaction.run([this, this.#inventory, this.#tasks, ...(this.#fleet === null ? [] : [this.#fleet])], ({ emit }) => {
        let batches = this.#state.batches.map(cloneBatch); let carts = this.#state.carts.map(cloneCart); let orders = this.#state.orders.map(cloneOrder);
        for (let index = 0; index < batches.length; index += 1) {
          let batch = batches[index]!;
          if (batch.status === "preparing" && batch.preparationEndsAtUtcMs <= nowUtcMs) {
            batch = cloneBatch({ ...batch, status: "waiting", readyAtUtcMs: batch.preparationEndsAtUtcMs }); batches[index] = batch;
            emit(this.#event(operationId, "local-procurement.batch-ready", batch.preparationEndsAtUtcMs, { batchId: batch.id, orderId: batch.orderId }, batch.id));
          }
          if (batch.transportMode === "local" && batch.status === "in-transit" && batch.arrivesAtUtcMs! <= nowUtcMs) {
            const arrivedAt = batch.arrivesAtUtcMs!; const order = orders.find((entry) => entry.id === batch.orderId)!;
            const deposit = this.#inventory.depositStack(`local-procurement-arrival:${batch.id}`, order.destinationLocationId, batch.items, arrivedAt);
            if (!deposit.accepted) throw new ProcurementRejected("DEPENDENCY_REJECTED", deposit.message);
            for (const event of deposit.events) emit(event);
            const completed = this.#tasks.completeTask(`local-procurement-task-complete:${batch.id}`, batch.taskId, batch.assignedCharacterId!, { orderId: batch.orderId, batchId: batch.id, quantity: batch.totalQuantity }, arrivedAt);
            if (!completed.accepted) throw new ProcurementRejected("TASK_REJECTED", completed.message);
            for (const event of completed.events) emit(event);
            carts = carts.map((entry) => entry.id === batch.cartId ? cloneCart({ ...entry, activeBatchId: null }) : entry);
            batch = cloneBatch({ ...batch, status: "arrived", arrivedAtUtcMs: arrivedAt }); batches[index] = batch;
            const progress = projectProcurementOrderProgress(
              order.totalQuantity,
              batches.filter((entry) => entry.orderId === order.id),
              arrivedAt,
            );
            const nextOrder = cloneOrder({ ...order, ...progress });
            orders = orders.map((entry) => entry.id === order.id ? nextOrder : entry);
            emit(this.#event(operationId, "local-procurement.batch-arrived", arrivedAt, { batchId: batch.id, orderId: order.id, items: batch.items, characterId: batch.assignedCharacterId, cartId: batch.cartId }, batch.id));
            emit(this.#event(operationId, progress.status === "completed" ? "local-procurement.order-completed" : "local-procurement.order-partially-arrived", arrivedAt, nextOrder, order.id));
          }
          if (batch.transportMode === "remote" && batch.status === "in-transit" && batch.voyageId !== null && batch.arrivesAtUtcMs! <= nowUtcMs) {
            const voyage = this.#fleet?.getVoyage(batch.voyageId);
            if (voyage?.status === "awaiting-handoff") {
              const arrivedAt = nowUtcMs;
              const order = orders.find((entry) => entry.id === batch.orderId)!;
              const deposit = this.#inventory.depositStack(`remote-procurement-arrival:${batch.id}`, order.destinationLocationId, batch.items, arrivedAt);
              if (!deposit.accepted) throw new ProcurementRejected("DEPENDENCY_REJECTED", deposit.message);
              for (const event of deposit.events) emit(event);
              const completed = this.#tasks.completeTask(`remote-procurement-task-complete:${batch.id}`, batch.taskId, batch.assignedCharacterId!, { orderId: batch.orderId, batchId: batch.id, quantity: batch.totalQuantity }, arrivedAt);
              if (!completed.accepted) throw new ProcurementRejected("TASK_REJECTED", completed.message);
              for (const event of completed.events) emit(event);
              const handoff = this.#fleet!.completeHandoff(`remote-procurement-handoff:${batch.id}`, batch.voyageId, arrivedAt);
              if (!handoff.accepted) throw new ProcurementRejected("DEPENDENCY_REJECTED", handoff.message);
              batch = cloneBatch({ ...batch, status: "arrived", arrivedAtUtcMs: arrivedAt });
              batches[index] = batch;
              const progress = projectProcurementOrderProgress(
                order.totalQuantity,
                batches.filter((entry) => entry.orderId === order.id),
                arrivedAt,
              );
              const nextOrder = cloneOrder({ ...order, ...progress });
              orders = orders.map((entry) => entry.id === order.id ? nextOrder : entry);
              emit(this.#event(operationId, "remote-procurement.batch-arrived", arrivedAt, { batchId: batch.id, orderId: order.id, items: batch.items, captainId: batch.assignedCharacterId, airshipId: batch.airshipId, voyageId: batch.voyageId }, batch.id));
              emit(this.#event(operationId, progress.status === "completed" ? "remote-procurement.order-completed" : "remote-procurement.order-partially-arrived", arrivedAt, nextOrder, order.id));
            }
          }        }
        this.#replace({ batches, carts, orders, lastAdvancedAtUtcMs: nowUtcMs, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        for (const [index, request] of this.#waitingTaskRequests(batches, orders).entries()) {
          if (this.#tasks.getTask(request.taskId) !== null) continue;
          const created = this.#tasks.createTask(`${operationId}:task:${index}`, request);
          if (!created.accepted) throw new ProcurementRejected("TASK_REJECTED", created.message);
          for (const event of created.events) emit(event);
        }
        return this.exportState();
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Local procurement advance failed."); }
  }

  startBatch(operationId: string, request: { readonly batchId: string; readonly cartId: string; readonly candidate: TaskCandidate; readonly occurredAtUtcMs: number }): LocalProcurementResult<LocalProcurementBatchState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const batch = this.#state.batches.find((entry) => entry.id === request.batchId); if (batch === undefined) return this.#reject("UNKNOWN_BATCH", "Unknown local procurement batch.");
    const cart = this.#state.carts.find((entry) => entry.id === request.cartId); if (cart === undefined) return this.#reject("UNKNOWN_CART", "Unknown procurement cart.");
    if (!integer(request.occurredAtUtcMs) || request.occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject("INVALID_REQUEST", "Local procurement departure time is invalid.");
    if (batch.transportMode !== "local") return this.#reject("WRONG_TRANSPORT", "Remote procurement batches must use a procurement airship.");
    if (batch.status !== "waiting") return this.#reject("BATCH_NOT_READY", "Local procurement batch is not waiting for transport.");
    if (cart.activeBatchId !== null || cart.capacity < batch.totalQuantity) return this.#reject("CART_UNAVAILABLE", "Procurement cart is busy or too small for this fixed batch.");
    const order = this.#state.orders.find((entry) => entry.id === batch.orderId)!; const supplier = this.#suppliers.get(order.supplierId)!;
    try {
      const result = this.#transaction.run([this, this.#tasks], ({ emit }) => {
        const claimed = this.#tasks.claimTask(`${operationId}:task`, batch.taskId, request.candidate, request.occurredAtUtcMs);
        if (!claimed.accepted) throw new ProcurementRejected("TASK_REJECTED", claimed.message);
        for (const event of claimed.events) emit(event);
        const durationMs = Math.max(1, Math.ceil(supplier.roundTripDistanceUnits * 1_000 / cart.speedUnitsPerSecond));
        const next = cloneBatch({ ...batch, status: "in-transit", assignedCharacterId: request.candidate.characterId, cartId: cart.id, cartSpeedSnapshot: cart.speedUnitsPerSecond, departedAtUtcMs: request.occurredAtUtcMs, arrivesAtUtcMs: request.occurredAtUtcMs + durationMs });
        const nextBatches = this.#state.batches.map((entry) => entry.id === batch.id ? next : entry);
        const progress = projectProcurementOrderProgress(
          order.totalQuantity,
          nextBatches.filter((entry) => entry.orderId === order.id),
          request.occurredAtUtcMs,
        );
        const nextOrder = cloneOrder({ ...order, ...progress });
        this.#replace({ batches: nextBatches, carts: this.#state.carts.map((entry) => entry.id === cart.id ? cloneCart({ ...entry, activeBatchId: batch.id }) : entry), orders: this.#state.orders.map((entry) => entry.id === order.id ? nextOrder : entry), processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        emit(this.#event(operationId, "local-procurement.batch-departed", request.occurredAtUtcMs, { batchId: batch.id, orderId: order.id, characterId: request.candidate.characterId, cartId: cart.id, speedUnitsPerSecond: cart.speedUnitsPerSecond, arrivesAtUtcMs: next.arrivesAtUtcMs }, batch.id));
        return next;
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Local procurement departure failed."); }
  }

  startRemoteBatch(operationId: string, request: { readonly batchId: string; readonly airshipId: string; readonly candidate: TaskCandidate; readonly occurredAtUtcMs: number }): LocalProcurementResult<LocalProcurementBatchState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const batch = this.#state.batches.find((entry) => entry.id === request.batchId);
    if (batch === undefined) return this.#reject("UNKNOWN_BATCH", "Unknown remote procurement batch.");
    if (batch.transportMode !== "remote") return this.#reject("WRONG_TRANSPORT", "Local procurement batches must use a procurement cart.");
    if (this.#fleet === null) return this.#reject("REMOTE_UNAVAILABLE", "Remote procurement Fleet is unavailable.");
    if (!valid(request.airshipId) || !integer(request.occurredAtUtcMs) || request.occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs) {
      return this.#reject("INVALID_REQUEST", "Remote procurement departure request is invalid.");
    }
    if (batch.status !== "waiting") return this.#reject("BATCH_NOT_READY", "Remote procurement batch is not waiting for transport.");
    const order = this.#state.orders.find((entry) => entry.id === batch.orderId)!;
    if (order.routeId === null) return this.#reject("REMOTE_UNAVAILABLE", "Remote procurement order has no locked route.");
    const voyageId = `procurement-voyage-${batch.id}`;
    try {
      const result = this.#transaction.run([this, this.#tasks, this.#fleet], ({ emit }) => {
        const claimed = this.#tasks.claimTask(`${operationId}:task`, batch.taskId, request.candidate, request.occurredAtUtcMs);
        if (!claimed.accepted) throw new ProcurementRejected("TASK_REJECTED", claimed.message);
        for (const event of claimed.events) emit(event);
        const started = this.#fleet!.startVoyage(`${operationId}:fleet`, {
          voyageId,
          batchId: batch.id,
          routeId: order.routeId!,
          shipId: request.airshipId,
          captainId: request.candidate.characterId,
          cargoQuantity: batch.totalQuantity,
          roundTripDistanceUnits: order.roundTripDistanceUnits,
          occurredAtUtcMs: request.occurredAtUtcMs,
        });
        if (!started.accepted) throw new ProcurementRejected("REMOTE_UNAVAILABLE", started.message);
        const next = cloneBatch({
          ...batch,
          status: "in-transit",
          assignedCharacterId: request.candidate.characterId,
          airshipId: request.airshipId,
          voyageId,
          departedAtUtcMs: request.occurredAtUtcMs,
          arrivesAtUtcMs: started.value.returnsAtUtcMs,
        });
        const nextBatches = this.#state.batches.map((entry) => entry.id === batch.id ? next : entry);
        const progress = projectProcurementOrderProgress(order.totalQuantity, nextBatches.filter((entry) => entry.orderId === order.id), request.occurredAtUtcMs);
        const nextOrder = cloneOrder({ ...order, ...progress });
        this.#replace({
          batches: nextBatches,
          orders: this.#state.orders.map((entry) => entry.id === order.id ? nextOrder : entry),
          processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT),
        });
        emit(this.#event(operationId, "remote-procurement.batch-departed", request.occurredAtUtcMs, {
          batchId: batch.id,
          orderId: order.id,
          voyageId,
          captainId: request.candidate.characterId,
          airshipId: request.airshipId,
          routeId: order.routeId,
          returnsAtUtcMs: started.value.returnsAtUtcMs,
        }, batch.id));
        return next;
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) {
      return error instanceof ProcurementRejected
        ? this.#reject(error.code, error.message)
        : this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Remote procurement departure failed.");
    }
  }
  upgradeCart(operationId: string, cartId: string, occurredAtUtcMs: number): LocalProcurementResult<ProcurementCartState> {
    const issue = this.#operationIssue(operationId); if (issue !== null) return issue;
    const cart = this.#state.carts.find((entry) => entry.id === cartId); if (cart === undefined) return this.#reject("UNKNOWN_CART", "Unknown procurement cart.");
    if (!integer(occurredAtUtcMs) || occurredAtUtcMs < this.#state.lastAdvancedAtUtcMs) return this.#reject("INVALID_REQUEST", "Procurement cart upgrade time is invalid.");
    if (cart.activeBatchId !== null) return this.#reject("CART_BUSY", "An in-transit procurement cart cannot be upgraded.");
    const nextLevel = this.#cartLevels.get(cartId)!.find((entry) => entry.level === cart.level + 1); if (nextLevel === undefined) return this.#reject("MAX_LEVEL", "Procurement cart is already at its maximum level.");
    try {
      const result = this.#transaction.run([this, this.#finance], ({ emit }) => {
        const payment = this.#finance.payExpense(operationId, { entryId: "ledger.procurement-cart-upgrade." + cartId + "." + nextLevel.level, amountCopper: nextLevel.upgradeCostCopper, category: "vehicle-upgrade", occurredAtUtcMs, sourceType: "procurement-cart-upgrade", sourceId: cartId, regionId: "local" });
        if (!payment.accepted) throw new ProcurementRejected("FINANCE_REJECTED", payment.message);
        for (const event of payment.events) emit(event);
        const next = cloneCart({ id: cart.id, level: nextLevel.level, capacity: nextLevel.capacity, speedUnitsPerSecond: nextLevel.speedUnitsPerSecond, activeBatchId: null });
        this.#replace({ carts: this.#state.carts.map((entry) => entry.id === cart.id ? next : entry), processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        emit(this.#event(operationId, "local-procurement.cart-upgraded", occurredAtUtcMs, { cartId, previousLevel: cart.level, level: next.level, previousCapacity: cart.capacity, capacity: next.capacity, previousSpeedUnitsPerSecond: cart.speedUnitsPerSecond, speedUnitsPerSecond: next.speedUnitsPerSecond, costCopper: nextLevel.upgradeCostCopper }, cartId));
        return next;
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) { return error instanceof ProcurementRejected ? this.#reject(error.code, error.message) : this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Procurement cart upgrade failed."); }
  }
  createTaskSourceSnapshot(): TaskSourceSnapshot {
    const waitingTasks = this.#waitingTaskRequests(this.#state.batches, this.#state.orders);
    const activeTasks = this.#state.batches.filter((entry) => entry.status === "in-transit").map((entry) => Object.freeze({ request: this.#taskRequest(entry, this.#state.orders.find((order) => order.id === entry.orderId)!), assignedCharacterId: entry.assignedCharacterId!, claimedAtUtcMs: entry.departedAtUtcMs! }));
    return Object.freeze({ sourceId: "source.local-procurement", sourceRevision: this.#state.revision, waitingTasks: Object.freeze(waitingTasks), activeTasks: Object.freeze(activeTasks) });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Local procurement transaction is already active.");
    this.#transactionActive = true; const saved = this.exportState();
    return { validateTransaction: () => this.#validate(), commitTransaction: () => { this.#transactionActive = false; }, rollbackTransaction: () => { this.#state = saved; this.#transactionActive = false; } };
  }
  #buildDraft(request: LocalProcurementDraftRequest): LocalProcurementDraftPreview {
    if (!integer(request.minuteOfDay) || request.minuteOfDay >= 1_440 ||
        (request.remoteAirshipId !== undefined && !valid(request.remoteAirshipId)) ||
        request.recipeSelections.some((entry) => !valid(entry.recipeId) || !integer(entry.quantity, 1)) ||
        request.freeItems.some((entry) => !valid(entry.itemId) || !integer(entry.quantity, 1))) {
      throw new ProcurementRejected("INVALID_REQUEST", "Procurement draft request is invalid.");
    }
    const recipeTotals = new Map<string, number>();
    for (const selection of request.recipeSelections) {
      const recipe = this.#recipes.getRecipe(selection.recipeId);
      if (recipe === null) throw new ProcurementRejected("UNKNOWN_RECIPE", `Unknown procurement recipe: ${selection.recipeId}`);
      for (const ingredient of recipe.ingredients) {
        recipeTotals.set(ingredient.itemId, (recipeTotals.get(ingredient.itemId) ?? 0) + ingredient.quantity * selection.quantity);
      }
    }
    const freeTotals = this.#aggregate(request.freeItems);
    const overrideTotals = request.finalQuantityOverrides === undefined ? null : this.#aggregate(request.finalQuantityOverrides, true);
    const sourceOverrides = new Map<string, string>();
    for (const entry of request.sourceOverrides ?? []) {
      if (!valid(entry.itemId) || !valid(entry.supplierId) || sourceOverrides.has(entry.itemId)) {
        throw new ProcurementRejected("INVALID_REQUEST", "Procurement source overrides are invalid.");
      }
      sourceOverrides.set(entry.itemId, entry.supplierId);
    }
    const negotiator = this.#selectNegotiator(request.minuteOfDay);
    const location = this.#inventory.getLocationSnapshot(this.#destinationLocationId)!;
    const itemIds = [...new Set([...recipeTotals.keys(), ...freeTotals.keys(), ...(overrideTotals?.keys() ?? [])])].sort();
    if ([...sourceOverrides.keys()].some((itemId) => !itemIds.includes(itemId))) {
      throw new ProcurementRejected("INVALID_REQUEST", "Procurement source override has no matching draft item.");
    }
    const lines: LocalProcurementDraftLine[] = [];
    for (const itemId of itemIds) {
      const catalogSuppliers = this.#suppliersByItem.get(itemId);
      if (catalogSuppliers === undefined) throw new ProcurementRejected("UNKNOWN_ITEM", `No supplier sells ${itemId}.`);
      const suppliers = catalogSuppliers.filter((supplier) =>
        supplier.transportMode === "local" || (supplier.routeId !== null && this.#fleet?.isRouteUnlocked(supplier.routeId) === true),
      );
      if (suppliers.length === 0) throw new ProcurementRejected("UNKNOWN_SUPPLIER", `No unlocked procurement route can supply ${itemId}.`);
      const recipeRequiredQuantity = recipeTotals.get(itemId) ?? 0;
      const freeQuantity = freeTotals.get(itemId) ?? 0;
      const availableInventoryQuantity = location.stacks.find((entry) => entry.itemId === itemId)?.availableQuantity ?? 0;
      const incomingQuantity = this.#state.batches
        .filter((entry) => entry.status !== "arrived")
        .flatMap((entry) => entry.items)
        .filter((entry) => entry.itemId === itemId)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const suggestedRecipeQuantity = Math.max(0, recipeRequiredQuantity - availableInventoryQuantity - incomingQuantity);
      const finalQuantity = overrideTotals?.get(itemId) ?? suggestedRecipeQuantity + freeQuantity;
      if (!integer(finalQuantity)) throw new ProcurementRejected("INVALID_REQUEST", "Procurement final quantities are invalid.");
      if (finalQuantity === 0) continue;
      const override = sourceOverrides.get(itemId);
      const ranked = suppliers.map((supplier) => {
        const item = supplier.items.find((entry) => entry.itemId === itemId)!;
        const price = this.#pricing.calculateUnitPriceCopper(item.baseUnitPriceCopper, negotiator.charmLevel);
        if (!integer(price, 1)) throw new ProcurementRejected("INVALID_REQUEST", "Procurement pricing policy returned an invalid price.");
        const speed = supplier.transportMode === "local"
          ? Math.max(...this.#state.carts.map((entry) => entry.speedUnitsPerSecond))
          : this.#remoteShip(request.remoteAirshipId).speedUnitsPerSecond;
        return { supplier, item, price, duration: supplier.preparationDurationMs + Math.ceil(supplier.roundTripDistanceUnits * 1_000 / speed) };
      }).sort((a, b) => a.price - b.price || a.duration - b.duration || a.supplier.id.localeCompare(b.supplier.id));
      const selected = override === undefined ? ranked[0]! : ranked.find((entry) => entry.supplier.id === override);
      if (selected === undefined) throw new ProcurementRejected("UNKNOWN_SUPPLIER", `Supplier ${override} cannot currently provide ${itemId}.`);
      lines.push(Object.freeze({
        itemId,
        recipeRequiredQuantity,
        freeQuantity,
        availableInventoryQuantity,
        incomingQuantity,
        suggestedRecipeQuantity,
        finalQuantity,
        supplierId: selected.supplier.id,
        baseUnitPriceCopper: selected.item.baseUnitPriceCopper,
        transactionUnitPriceCopper: selected.price,
        totalPriceCopper: selected.price * finalQuantity,
      }));
    }
    const supplierPlans = [...new Set(lines.map((entry) => entry.supplierId))].sort().map((supplierId) => {
      const supplier = this.#suppliers.get(supplierId)!;
      const capacitySnapshot = supplier.transportMode === "local"
        ? Math.max(...this.#state.carts.map((entry) => entry.capacity))
        : this.#remoteShip(request.remoteAirshipId).cargoCapacity;
      const totalQuantity = lines.filter((entry) => entry.supplierId === supplierId)
        .reduce((total, entry) => total + entry.finalQuantity, 0);
      return Object.freeze({
        supplierId,
        transportMode: supplier.transportMode,
        routeId: supplier.routeId,
        capacitySnapshot,
        expectedBatchCount: Math.ceil(totalQuantity / capacitySnapshot),
      });
    });
    const fallbackCapacity = Math.max(...this.#state.carts.map((entry) => entry.capacity));
    return Object.freeze({
      lines: Object.freeze(lines),
      negotiatorCharacterId: negotiator.characterId,
      negotiatorCharmLevel: negotiator.charmLevel,
      batchCapacitySnapshot: supplierPlans.length === 0 ? fallbackCapacity : Math.max(...supplierPlans.map((entry) => entry.capacitySnapshot)),
      expectedBatchCount: supplierPlans.reduce((sum, entry) => sum + entry.expectedBatchCount, 0),
      totalPriceCopper: lines.reduce((sum, entry) => sum + entry.totalPriceCopper, 0),
      supplierPlans: Object.freeze(supplierPlans),
    });
  }

  #remoteShip(shipId: string | undefined): { readonly id: string; readonly cargoCapacity: number; readonly speedUnitsPerSecond: number } {
    if (this.#fleet === null) throw new ProcurementRejected("REMOTE_UNAVAILABLE", "Remote procurement Fleet is unavailable.");
    const ships = this.#fleet.createReadModel(this.#state.lastAdvancedAtUtcMs).ships;
    const selected = shipId === undefined
      ? [...ships].sort((a, b) => b.cargoCapacity - a.cargoCapacity || b.speedUnitsPerSecond - a.speedUnitsPerSecond || a.id.localeCompare(b.id))[0]
      : ships.find((ship) => ship.id === shipId);
    if (selected === undefined) throw new ProcurementRejected("REMOTE_UNAVAILABLE", "No owned procurement airship can plan this order.");
    return Object.freeze({ id: selected.id, cargoCapacity: selected.cargoCapacity, speedUnitsPerSecond: selected.speedUnitsPerSecond });
  }
  #selectNegotiator(minuteOfDay: number): { readonly characterId: InstanceId | null; readonly charmLevel: number } {
    const eligible = this.#employment.createReadModel(minuteOfDay).employees
      .filter((entry) => entry.onShift && entry.acceptingNewWork && entry.learnedJobIds.includes("job.local_procurer"))
      .map((entry) => ({ characterId: entry.characterId, charmLevel: this.#characters.getCharacter(entry.characterId)!.skills.charm.level }))
      .sort((a, b) => b.charmLevel - a.charmLevel || a.characterId.localeCompare(b.characterId));
    return eligible[0] ?? { characterId: null, charmLevel: 0 };
  }

  #aggregate(items: readonly ProcurementItemSelection[], allowZero = false): Map<string, number> {
    const result = new Map<string, number>();
    for (const item of items) { if (!valid(item.itemId) || (!allowZero && !integer(item.quantity, 1)) || (allowZero && !integer(item.quantity))) throw new ProcurementRejected("INVALID_REQUEST", "Local procurement item selection is invalid."); if (result.has(item.itemId)) throw new ProcurementRejected("INVALID_REQUEST", `Duplicate local procurement item: ${item.itemId}`); result.set(item.itemId, item.quantity); }
    return result;
  }

  #createOrders(submissionId: string, paymentEntryId: string, request: PlaceLocalProcurementRequest, draft: LocalProcurementDraftPreview): { readonly orders: readonly LocalProcurementOrderState[]; readonly batches: readonly LocalProcurementBatchState[]; readonly nextOrderSequence: number } {
    const orders: LocalProcurementOrderState[] = []; const batches: LocalProcurementBatchState[] = []; let sequence = this.#state.nextOrderSequence;
    for (const supplierId of [...new Set(draft.lines.map((entry) => entry.supplierId))].sort()) {
      const supplier = this.#suppliers.get(supplierId)!; const orderId = `local-procurement-order-${sequence++}`;
      const lines = draft.lines.filter((entry) => entry.supplierId === supplierId).map((entry) => Object.freeze({ itemId: entry.itemId, quantity: entry.finalQuantity, baseUnitPriceCopper: entry.baseUnitPriceCopper, transactionUnitPriceCopper: entry.transactionUnitPriceCopper }));
      const totalQuantity = lines.reduce((sum, entry) => sum + entry.quantity, 0); const totalPriceCopper = lines.reduce((sum, entry) => sum + entry.quantity * entry.transactionUnitPriceCopper, 0);
      orders.push(cloneOrder({ id: orderId, submissionId, origin: request.origin ?? "manual", transportMode: supplier.transportMode, routeId: supplier.routeId, roundTripDistanceUnits: supplier.roundTripDistanceUnits, supplierId, sourceRegionId: supplier.sourceRegionId, destinationRegionId: request.destinationRegionId, destinationLocationId: this.#destinationLocationId, lines, totalQuantity, deliveredQuantity: 0, totalPriceCopper, negotiatorCharacterId: draft.negotiatorCharacterId, negotiatorCharmLevel: draft.negotiatorCharmLevel, paymentEntryId, status: "pending", createdAtUtcMs: request.occurredAtUtcMs, completedAtUtcMs: null }));
      const plans = createFixedProcurementBatchPlans(
        lines.map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity })),
        draft.supplierPlans.find((entry) => entry.supplierId === supplierId)!.capacitySnapshot,
      );
      for (const plan of plans) {
        const batchId = `${orderId}-batch-${plan.sequence}`;
        batches.push(cloneBatch({ id: batchId, orderId, sequence: plan.sequence, items: plan.items, transportMode: supplier.transportMode, totalQuantity: plan.totalQuantity, capacitySnapshot: plan.capacitySnapshot, status: "preparing", preparationStartedAtUtcMs: request.occurredAtUtcMs, preparationEndsAtUtcMs: request.occurredAtUtcMs + supplier.preparationDurationMs, readyAtUtcMs: null, taskId: this.#taskId(batchId, supplier.transportMode), assignedCharacterId: null, cartId: null, cartSpeedSnapshot: null, airshipId: null, voyageId: null, departedAtUtcMs: null, arrivesAtUtcMs: null, arrivedAtUtcMs: null }));
      }
    }
    return { orders: Object.freeze(orders), batches: Object.freeze(batches), nextOrderSequence: sequence };
  }

  #taskId(batchId: string, transportMode: ProcurementTransportMode): string { return createStableTaskKey({ sourceType: "procurement", sourceId: batchId, taskType: transportMode === "local" ? "procure-local" : "procure-remote", targetType: "procurement-batch", targetId: batchId, discriminator: "round-trip" }); }
  #taskRequest(batch: LocalProcurementBatchState, order: LocalProcurementOrderState): TaskRequest {
    const local = batch.transportMode === "local";
    return Object.freeze({ taskId: batch.taskId, taskType: local ? "procurement.local-round-trip" : "procurement.remote-round-trip", source: Object.freeze({ type: "procurement-order", id: order.id }), target: Object.freeze({ type: "procurement-batch", id: batch.id }), basePriority: order.origin === "manual" ? 180 : 100, requiredTags: Object.freeze(local ? ["employee"] : []), eligibleJobIds: Object.freeze([local ? "job.local_procurer" : "job.captain"]), requiredSkills: Object.freeze([]), urgency: 0, urgent: false, interruptible: false, createdAtUtcMs: batch.readyAtUtcMs ?? batch.preparationEndsAtUtcMs });
  }
  #waitingTaskRequests(batches: readonly LocalProcurementBatchState[], orders: readonly LocalProcurementOrderState[]): readonly TaskRequest[] {
    return Object.freeze(batches.filter((entry) => entry.status === "waiting").map((entry) => this.#taskRequest(entry, orders.find((order) => order.id === entry.orderId)!)).sort((a, b) => b.basePriority - a.basePriority || a.createdAtUtcMs - b.createdAtUtcMs || a.taskId.localeCompare(b.taskId)));
  }
  #operationIssue(operationId: string): LocalProcurementResult<never> | null { if (!valid(operationId)) return this.#reject("INVALID_REQUEST", "Local procurement operation id is invalid."); if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Local procurement operation was already processed."); return null; }
  #event(operationId: string, type: string, time: number, payload: unknown, discriminator = "0"): DomainEvent { return Object.freeze({ id: `${type}:${operationId}:${discriminator}`, type, occurredAtUtcMs: time, causationId: operationId, correlationId: operationId, payload }); }
  #replace(update: Partial<LocalProcurementState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #reject(code: LocalProcurementRejectionCode, message: string): LocalProcurementResult<never> { return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const }); }
  #migrateState(initialState: LocalProcurementState): LocalProcurementState {
    type LegacyOrder = Omit<LocalProcurementOrderState, "transportMode" | "routeId" | "roundTripDistanceUnits"> & {
      readonly transportMode?: ProcurementTransportMode;
      readonly routeId?: string | null;
      readonly roundTripDistanceUnits?: number;
    };
    type LegacyBatch = Omit<LocalProcurementBatchState, "transportMode" | "airshipId" | "voyageId"> & {
      readonly transportMode?: ProcurementTransportMode;
      readonly airshipId?: string | null;
      readonly voyageId?: string | null;
    };
    const source = initialState as unknown as Omit<LocalProcurementState, "schemaVersion" | "carts" | "orders" | "batches"> & {
      readonly schemaVersion: number;
      readonly carts: readonly { readonly id: string; readonly level?: number; readonly capacity: number; readonly speedUnitsPerSecond: number; readonly activeBatchId: string | null }[];
      readonly orders: readonly LegacyOrder[];
      readonly batches: readonly LegacyBatch[];
    };
    if (source.schemaVersion !== 1 && source.schemaVersion !== LOCAL_PROCUREMENT_SCHEMA_VERSION) {
      throw new Error("Unsupported local procurement schema version: " + source.schemaVersion);
    }
    return cloneState({
      ...source,
      schemaVersion: LOCAL_PROCUREMENT_SCHEMA_VERSION,
      carts: source.carts.map((cart) => ({ id: cart.id, level: cart.level ?? 1, capacity: cart.capacity, speedUnitsPerSecond: cart.speedUnitsPerSecond, activeBatchId: cart.activeBatchId })),
      orders: source.orders.map((order) => ({
        ...order,
        transportMode: order.transportMode ?? "local",
        routeId: order.routeId ?? null,
        roundTripDistanceUnits: order.roundTripDistanceUnits ?? this.#suppliers.get(order.supplierId)?.roundTripDistanceUnits ?? 1,
      })),
      batches: source.batches.map((batch) => ({
        ...batch,
        transportMode: batch.transportMode ?? "local",
        airshipId: batch.airshipId ?? null,
        voyageId: batch.voyageId ?? null,
      })),
    });
  }
  #validate(): void {
    const state = this.#state;
    if (state.schemaVersion !== LOCAL_PROCUREMENT_SCHEMA_VERSION || !integer(state.revision) || !integer(state.nextOrderSequence, 1) || !integer(state.nextSubmissionSequence, 1) || !integer(state.lastAdvancedAtUtcMs) || new Set(state.orders.map((entry) => entry.id)).size !== state.orders.length || new Set(state.batches.map((entry) => entry.id)).size !== state.batches.length || new Set(state.carts.map((entry) => entry.id)).size !== state.carts.length || new Set(state.processedOperationIds).size !== state.processedOperationIds.length) {
      throw new Error("Procurement state metadata is invalid.");
    }
    for (const cart of state.carts) {
      const level = this.#cartLevels.get(cart.id)?.find((entry) => entry.level === cart.level);
      if (level === undefined || cart.capacity !== level.capacity || cart.speedUnitsPerSecond !== level.speedUnitsPerSecond) {
        throw new Error("Procurement cart level invariant failed: " + cart.id);
      }
    }
    for (const order of state.orders) {
      const supplier = this.#suppliers.get(order.supplierId);
      const related = state.batches.filter((entry) => entry.orderId === order.id);
      const delivered = related.filter((entry) => entry.status === "arrived").reduce((sum, entry) => sum + entry.totalQuantity, 0);
      if (!valid(order.id) || supplier === undefined || related.length === 0 || related.some((batch) => batch.transportMode !== order.transportMode) ||
          supplier.transportMode !== order.transportMode || supplier.routeId !== order.routeId || order.roundTripDistanceUnits !== supplier.roundTripDistanceUnits ||
          (order.transportMode === "local") !== (order.routeId === null) || related.reduce((sum, entry) => sum + entry.totalQuantity, 0) !== order.totalQuantity ||
          order.deliveredQuantity !== delivered || (order.status === "completed") !== (delivered === order.totalQuantity)) {
        throw new Error(`Procurement order invariant failed: ${order.id}`);
      }
    }
    const activeCartBatches = state.carts.map((entry) => entry.activeBatchId).filter((value): value is string => value !== null);
    if (new Set(activeCartBatches).size !== activeCartBatches.length || activeCartBatches.some((batchId) => !state.batches.some((entry) => entry.id === batchId && entry.transportMode === "local" && entry.status === "in-transit"))) {
      throw new Error("Procurement cart assignment invariant failed.");
    }
    for (const batch of state.batches) {
      const cart = batch.cartId === null ? null : state.carts.find((entry) => entry.id === batch.cartId);
      const voyage = batch.voyageId === null ? null : this.#fleet?.getVoyage(batch.voyageId) ?? null;
      const commonInvalid = !valid(batch.id) || !integer(batch.totalQuantity, 1) || batch.totalQuantity > batch.capacitySnapshot;
      const localInvalid = batch.transportMode === "local" && (
        batch.airshipId !== null || batch.voyageId !== null ||
        (batch.status === "in-transit" && (batch.assignedCharacterId === null || cart?.activeBatchId !== batch.id || batch.arrivesAtUtcMs === null)) ||
        (batch.status !== "in-transit" && batch.status !== "arrived" && (batch.assignedCharacterId !== null || batch.cartId !== null))
      );
      const remoteInvalid = batch.transportMode === "remote" && (
        batch.cartId !== null || batch.cartSpeedSnapshot !== null || this.#fleet === null ||
        (batch.status === "in-transit" && (batch.assignedCharacterId === null || batch.airshipId === null || voyage === null || voyage.batchId !== batch.id || voyage.status === "completed" || batch.arrivesAtUtcMs !== voyage.returnsAtUtcMs)) ||
        (batch.status === "arrived" && (voyage === null || voyage.status !== "completed")) ||
        (batch.status !== "in-transit" && batch.status !== "arrived" && (batch.assignedCharacterId !== null || batch.airshipId !== null || batch.voyageId !== null))
      );
      if (commonInvalid || localInvalid || remoteInvalid) throw new Error(`Procurement batch invariant failed: ${batch.id}`);
    }
  }
}