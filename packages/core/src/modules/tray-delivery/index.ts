import {
  DomainEventBus,
  TransactionScope,
  type DomainEvent,
  type InstanceId,
  type TransactionParticipantSession,
  type TransactionalParticipant,
} from "../../kernel";
import type { CharacterModule } from "../character";
import type { DomainModule } from "../domain-module";
import type { InventoryModule, InventoryInstanceSnapshot } from "../inventory";
import type { OrderModule } from "../order";
import type { ServiceModule, ServiceWorkflowState } from "../service";

export const TRAY_DELIVERY_MODULE_ID = "module.tray-delivery";
export const TRAY_DELIVERY_SCHEMA_VERSION = 1;

export interface TrayCapacityPort {
  getCapacity(characterId: InstanceId): number;
}

export class FixedTrayCapacity implements TrayCapacityPort {
  readonly #capacity: number;
  constructor(capacity = 1) {
    if (!positiveInteger(capacity)) throw new Error("Tray capacity must be a positive integer.");
    this.#capacity = capacity;
  }
  getCapacity(): number { return this.#capacity; }
}

export interface TrayCarrierLocationPort {
  getCarrierLocationId(characterId: InstanceId): string;
}

export class StaticTrayCarrierLocations implements TrayCarrierLocationPort {
  readonly #locations: ReadonlyMap<InstanceId, string>;
  constructor(entries: readonly { readonly characterId: InstanceId; readonly locationId: string }[]) {
    if (entries.length === 0 || new Set(entries.map((entry) => entry.characterId)).size !== entries.length ||
      entries.some((entry) => !valid(entry.locationId))) {
      throw new Error("Tray carrier locations are invalid.");
    }
    this.#locations = new Map(entries.map((entry) => [entry.characterId, entry.locationId]));
  }
  getCarrierLocationId(characterId: InstanceId): string {
    const locationId = this.#locations.get(characterId);
    if (locationId === undefined) throw new Error(`Missing tray carrier location: ${characterId}`);
    return locationId;
  }
}

export interface TrayRouteCostPort {
  getCost(fromLocationId: string, tableId: string): number;
}

export class StaticTrayRouteCosts implements TrayRouteCostPort {
  readonly #costs: ReadonlyMap<string, number>;
  constructor(entries: readonly { readonly fromLocationId: string; readonly tableId: string; readonly cost: number }[]) {
    if (entries.some((entry) => !valid(entry.fromLocationId) || !valid(entry.tableId) || !nonNegative(entry.cost))) {
      throw new Error("Tray route costs are invalid.");
    }
    this.#costs = new Map(entries.map((entry) => [`${entry.fromLocationId}|${entry.tableId}`, entry.cost]));
  }
  getCost(fromLocationId: string, tableId: string): number {
    return this.#costs.get(`${fromLocationId}|${tableId}`) ?? Number.MAX_SAFE_INTEGER;
  }
}

export interface TrayTipPolicyPort {
  calculateTipCopper(charmLevel: number, transactionUnitPriceCopper: number): number;
}

/** Configurable linear charm mapping: each charm level adds this many basis points. */
export class LinearTrayTipPolicy implements TrayTipPolicyPort {
  readonly #basisPointsPerCharmLevel: number;
  constructor(basisPointsPerCharmLevel = 100) {
    if (!nonNegative(basisPointsPerCharmLevel)) throw new Error("Tip rate must be a non-negative integer.");
    this.#basisPointsPerCharmLevel = basisPointsPerCharmLevel;
  }
  calculateTipCopper(charmLevel: number, transactionUnitPriceCopper: number): number {
    if (!positiveInteger(charmLevel) || !nonNegative(transactionUnitPriceCopper)) {
      throw new Error("Charm level or meal transaction price is invalid.");
    }
    return Math.round(transactionUnitPriceCopper * charmLevel * this.#basisPointsPerCharmLevel / 10_000);
  }
}

export type TrayMealDeliveryStatus = "carried" | "delivered";

export interface TrayMealState {
  readonly mealId: string;
  readonly orderId: string;
  readonly tableId: string;
  readonly inventoryInstanceId: InstanceId;
  readonly status: TrayMealDeliveryStatus;
  readonly deliveredAtUtcMs: number | null;
  readonly tipCopper: number;
}

export type TrayDeliveryBatchStatus = "delivering" | "completed";

export interface TrayDeliveryBatchState {
  readonly id: string;
  readonly leadServiceTaskId: string;
  readonly assignedCharacterId: InstanceId;
  readonly carrierLocationId: string;
  readonly capacitySnapshot: number;
  readonly status: TrayDeliveryBatchStatus;
  readonly meals: readonly TrayMealState[];
  readonly currentLocationId: string;
  readonly pickedUpAtUtcMs: number;
  readonly completedAtUtcMs: number | null;
}

export interface TrayDeliveryState {
  readonly schemaVersion: typeof TRAY_DELIVERY_SCHEMA_VERSION;
  readonly revision: number;
  readonly batches: readonly TrayDeliveryBatchState[];
  readonly processedOperationIds: readonly string[];
}

export interface TrayDeliveryReadModel {
  readonly revision: number;
  readonly activeBatches: readonly TrayDeliveryBatchState[];
  readonly completedBatches: readonly TrayDeliveryBatchState[];
}

export type TrayDeliveryRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "INVALID_SERVICE_WORKFLOW"
  | "CHARACTER_BUSY"
  | "UNKNOWN_BATCH"
  | "BATCH_COMPLETED"
  | "NO_MEAL_AVAILABLE"
  | "DEPENDENCY_REJECTED";

export type TrayDeliveryOperationResult<T> =
  | { readonly accepted: true; readonly changed: true; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: TrayDeliveryRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 4_096;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 220;
const nonNegative = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const cloneMeal = (meal: TrayMealState): TrayMealState => Object.freeze({ ...meal });
const cloneBatch = (batch: TrayDeliveryBatchState): TrayDeliveryBatchState => Object.freeze({
  ...batch,
  meals: Object.freeze(batch.meals.map(cloneMeal)),
});
const cloneState = (state: TrayDeliveryState): TrayDeliveryState => Object.freeze({
  ...state,
  batches: Object.freeze(state.batches.map(cloneBatch)),
  processedOperationIds: Object.freeze([...state.processedOperationIds]),
});

class TrayDeliveryRejected extends Error {
  constructor(readonly code: TrayDeliveryRejectionCode, message: string) { super(message); }
}

interface PickupCandidate {
  readonly mealId: string;
  readonly orderId: string;
  readonly tableId: string;
  readonly updatedAtUtcMs: number;
  readonly inventory: InventoryInstanceSnapshot;
  readonly servicePriority: number;
}

export class TrayDeliveryModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = TRAY_DELIVERY_MODULE_ID;
  readonly transactionParticipantId = TRAY_DELIVERY_MODULE_ID;
  readonly #characters: CharacterModule;
  readonly #inventory: InventoryModule;
  readonly #orders: OrderModule;
  readonly #service: ServiceModule;
  readonly #capacity: TrayCapacityPort;
  readonly #carrierLocations: TrayCarrierLocationPort;
  readonly #routeCosts: TrayRouteCostPort;
  readonly #tips: TrayTipPolicyPort;
  readonly #groundPickupLocationId: string;
  readonly #transaction: TransactionScope;
  #state: TrayDeliveryState;
  #transactionActive = false;

  constructor(options: {
    readonly characters: CharacterModule;
    readonly inventory: InventoryModule;
    readonly orders: OrderModule;
    readonly service: ServiceModule;
    readonly capacity: TrayCapacityPort;
    readonly carrierLocations: TrayCarrierLocationPort;
    readonly routeCosts: TrayRouteCostPort;
    readonly tips: TrayTipPolicyPort;
    readonly groundPickupLocationId: string;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: TrayDeliveryState;
  }) {
    if (!valid(options.groundPickupLocationId) ||
      !options.inventory.getSnapshot().locations.some((entry) => entry.id === options.groundPickupLocationId)) {
      throw new Error("Ground meal pickup location is invalid.");
    }
    this.#characters = options.characters;
    this.#inventory = options.inventory;
    this.#orders = options.orders;
    this.#service = options.service;
    this.#capacity = options.capacity;
    this.#carrierLocations = options.carrierLocations;
    this.#routeCosts = options.routeCosts;
    this.#tips = options.tips;
    this.#groundPickupLocationId = options.groundPickupLocationId;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: TRAY_DELIVERY_SCHEMA_VERSION, revision: 0, batches: [], processedOperationIds: [] })
      : cloneState(options.initialState);
    this.#validate();
  }

  exportState(): TrayDeliveryState { return cloneState(this.#state); }
  getBatch(batchId: string): TrayDeliveryBatchState | null {
    const batch = this.#state.batches.find((entry) => entry.id === batchId);
    return batch === undefined ? null : cloneBatch(batch);
  }
  getNextTableId(batchId: string): string | null {
    const batch = this.#state.batches.find((entry) => entry.id === batchId);
    return batch === undefined || batch.status !== "delivering" ? null : this.#nextTable(batch);
  }

  createReadModel(): TrayDeliveryReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      activeBatches: Object.freeze(this.#state.batches.filter((entry) => entry.status === "delivering").map(cloneBatch)),
      completedBatches: Object.freeze(this.#state.batches.filter((entry) => entry.status === "completed").map(cloneBatch)),
    });
  }

  pickupBatch(operationId: string, batchId: string, leadServiceTaskId: string, occurredAtUtcMs: number): TrayDeliveryOperationResult<TrayDeliveryBatchState> {
    if (!valid(operationId) || !valid(batchId) || !valid(leadServiceTaskId) || !nonNegative(occurredAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Tray pickup request is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject("DUPLICATE_OPERATION", "Tray pickup operation was already processed.");
    }
    const workflow = this.#service.getWorkflow(leadServiceTaskId);
    if (workflow === null || workflow.kind !== "deliver-meal" || workflow.stage !== "external-handoff") {
      return this.#reject("INVALID_SERVICE_WORKFLOW", "Lead service task is not an active meal delivery.");
    }
    if (this.#state.batches.some((entry) => entry.id === batchId)) {
      return this.#reject("INVALID_REQUEST", `Duplicate tray batch: ${batchId}`);
    }
    if (this.#state.batches.some((entry) => entry.status === "delivering" && entry.assignedCharacterId === workflow.assignedCharacterId)) {
      return this.#reject("CHARACTER_BUSY", "The waiter already carries an active tray batch.");
    }
    const capacitySnapshot = this.#capacity.getCapacity(workflow.assignedCharacterId);
    if (!positiveInteger(capacitySnapshot)) return this.#reject("INVALID_REQUEST", "Tray capacity snapshot is invalid.");
    let carrierLocationId: string;
    try { carrierLocationId = this.#carrierLocations.getCarrierLocationId(workflow.assignedCharacterId); }
    catch (error) { return this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Carrier location is invalid."); }
    if (!this.#inventory.getSnapshot().locations.some((entry) => entry.id === carrierLocationId)) {
      return this.#reject("INVALID_REQUEST", "Carrier inventory location is unknown.");
    }
    const candidates = this.#pickupCandidates(workflow);
    const lead = candidates.find((entry) => entry.mealId === workflow.sourceId);
    if (lead === undefined) return this.#reject("NO_MEAL_AVAILABLE", "The lead meal is not at the ground pickup station.");
    const extras = candidates
      .filter((entry) => entry.mealId !== lead.mealId)
      .sort((left, right) => right.servicePriority - left.servicePriority ||
        this.#routeCosts.getCost(this.#groundPickupLocationId, left.tableId) - this.#routeCosts.getCost(this.#groundPickupLocationId, right.tableId) ||
        left.updatedAtUtcMs - right.updatedAtUtcMs || left.mealId.localeCompare(right.mealId));
    const selected = [lead, ...extras].slice(0, capacitySnapshot);
    const pickup = this.#orders.pickupMealsToCarrier({
      operationId: `${operationId}:order-pickup`,
      transfers: selected.map((entry) => ({ mealId: entry.mealId, inventoryInstanceId: entry.inventory.id })),
      sourceLocationId: this.#groundPickupLocationId,
      carrierLocationId,
      occurredAtUtcMs,
    });
    if (!pickup.accepted) return this.#reject("DEPENDENCY_REJECTED", pickup.message);
    const synchronized = this.#service.synchronizeTasks(`${operationId}:service-sync`, occurredAtUtcMs);
    if (!synchronized.accepted) return this.#reject("DEPENDENCY_REJECTED", synchronized.message);
    return this.#run(operationId, (emit) => {
      const batch = cloneBatch({
        id: batchId,
        leadServiceTaskId,
        assignedCharacterId: workflow.assignedCharacterId,
        carrierLocationId,
        capacitySnapshot,
        status: "delivering",
        meals: selected.map((entry) => Object.freeze({
          mealId: entry.mealId,
          orderId: entry.orderId,
          tableId: entry.tableId,
          inventoryInstanceId: entry.inventory.id,
          status: "carried" as const,
          deliveredAtUtcMs: null,
          tipCopper: 0,
        })),
        currentLocationId: this.#groundPickupLocationId,
        pickedUpAtUtcMs: occurredAtUtcMs,
        completedAtUtcMs: null,
      });
      this.#replace({ batches: [...this.#state.batches, batch] });
      emit(this.#event(operationId, "tray-delivery.batch-picked-up", occurredAtUtcMs, {
        batchId,
        leadServiceTaskId,
        assignedCharacterId: workflow.assignedCharacterId,
        capacitySnapshot,
        mealIds: batch.meals.map((entry) => entry.mealId),
      }));
      return batch;
    });
  }

  deliverNextTable(operationId: string, batchId: string, occurredAtUtcMs: number): TrayDeliveryOperationResult<TrayDeliveryBatchState> {
    if (!valid(operationId) || !valid(batchId) || !nonNegative(occurredAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Tray delivery request is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject("DUPLICATE_OPERATION", "Tray delivery operation was already processed.");
    }
    const batch = this.#state.batches.find((entry) => entry.id === batchId);
    if (batch === undefined) return this.#reject("UNKNOWN_BATCH", `Unknown tray batch: ${batchId}`);
    if (batch.status === "completed") return this.#reject("BATCH_COMPLETED", "Tray batch is already completed.");
    const targetTableId = this.#nextTable(batch);
    if (targetTableId === null) return this.#finishBatch(operationId, batch, occurredAtUtcMs);
    const character = this.#characters.getCharacter(batch.assignedCharacterId);
    if (character === null) return this.#reject("DEPENDENCY_REJECTED", "Assigned waiter no longer exists.");
    const tableMeals = batch.meals.filter((entry) => entry.status === "carried" && entry.tableId === targetTableId);
    let latest = cloneBatch(batch);
    for (const meal of tableMeals) {
      const order = this.#orders.getOrder(meal.orderId);
      const orderMeal = order?.meals.find((entry) => entry.id === meal.mealId);
      const unitPriceCopper = order?.lines.find((entry) => entry.id === orderMeal?.lineId)?.price.transactionUnitPriceCopper;
      if (unitPriceCopper === undefined) return this.#reject("DEPENDENCY_REJECTED", `Meal price snapshot is missing: ${meal.mealId}`);
      const tipCopper = this.#tips.calculateTipCopper(character.skills.charm.level, unitPriceCopper);
      const served = this.#orders.serveMealFromCarrier({
        operationId: `${operationId}:serve:${meal.mealId}`,
        mealId: meal.mealId,
        inventoryInstanceId: meal.inventoryInstanceId,
        carrierLocationId: batch.carrierLocationId,
        tipCopper,
        occurredAtUtcMs,
      });
      if (!served.accepted) return this.#reject("DEPENDENCY_REJECTED", served.message);
      const advanced = this.#run(`${operationId}:record:${meal.mealId}`, (emit) => {
        const current = this.#state.batches.find((entry) => entry.id === batchId)!;
        const next = cloneBatch({
          ...current,
          currentLocationId: targetTableId,
          meals: current.meals.map((entry) => entry.mealId === meal.mealId
            ? Object.freeze({ ...entry, status: "delivered" as const, deliveredAtUtcMs: occurredAtUtcMs, tipCopper })
            : entry),
        });
        this.#replace({ batches: this.#state.batches.map((entry) => entry.id === batchId ? next : entry) });
        emit(this.#event(operationId, "tray-delivery.meal-delivered", occurredAtUtcMs, {
          batchId,
          mealId: meal.mealId,
          orderId: meal.orderId,
          tableId: targetTableId,
          waiterCharacterId: batch.assignedCharacterId,
          charmLevel: character.skills.charm.level,
          tipCopper,
        }, meal.mealId));
        return next;
      });
      if (!advanced.accepted) return advanced;
      latest = advanced.value;
    }
    if (latest.meals.every((entry) => entry.status === "delivered")) {
      return this.#finishBatch(operationId, latest, occurredAtUtcMs);
    }
    return this.#run(operationId, (emit) => {
      emit(this.#event(operationId, "tray-delivery.table-delivered", occurredAtUtcMs, {
        batchId,
        tableId: targetTableId,
        remainingMealCount: latest.meals.filter((entry) => entry.status === "carried").length,
      }));
      return latest;
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Tray delivery transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validate(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = checkpoint; this.#transactionActive = false; },
    };
  }

  #pickupCandidates(workflow: ServiceWorkflowState): PickupCandidate[] {
    const ground = this.#inventory.getSnapshot().locations.find((entry) => entry.id === this.#groundPickupLocationId)!;
    const instances = new Map<string, InventoryInstanceSnapshot>();
    for (const instance of ground.instances.filter((entry) => entry.category === "meal")) {
      if (typeof instance.attributes.mealId === "string") instances.set(instance.attributes.mealId, instance);
    }
    const priorities = new Map(this.#service.createTaskSourceSnapshot().waitingTasks
      .filter((entry) => entry.taskType === "service.deliver-meal")
      .map((entry) => [entry.source.id, entry.basePriority + entry.urgency]));
    priorities.set(workflow.sourceId, workflow.request.basePriority + workflow.request.urgency);
    const result: PickupCandidate[] = [];
    for (const order of this.#orders.getReadModel(0).openOrders) {
      for (const meal of order.meals) {
        const inventory = instances.get(meal.id);
        if (meal.status !== "awaiting-pickup" || inventory === undefined || !priorities.has(meal.id)) continue;
        result.push({
          mealId: meal.id,
          orderId: order.id,
          tableId: order.tableId,
          updatedAtUtcMs: meal.updatedAtUtcMs,
          inventory,
          servicePriority: priorities.get(meal.id)!,
        });
      }
    }
    return result;
  }

  #nextTable(batch: TrayDeliveryBatchState): string | null {
    const tables = [...new Set(batch.meals.filter((entry) => entry.status === "carried").map((entry) => entry.tableId))];
    tables.sort((left, right) => this.#routeCosts.getCost(batch.currentLocationId, left) - this.#routeCosts.getCost(batch.currentLocationId, right) || left.localeCompare(right));
    return tables[0] ?? null;
  }

  #finishBatch(operationId: string, batch: TrayDeliveryBatchState, occurredAtUtcMs: number): TrayDeliveryOperationResult<TrayDeliveryBatchState> {
    const completed = this.#service.completeExternalHandoff(`${operationId}:service-complete`, batch.leadServiceTaskId, {
      batchId: batch.id,
      mealCount: batch.meals.length,
    }, occurredAtUtcMs);
    if (!completed.accepted) return this.#reject("DEPENDENCY_REJECTED", completed.message);
    return this.#run(operationId, (emit) => {
      const next = cloneBatch({ ...batch, status: "completed", completedAtUtcMs: occurredAtUtcMs });
      this.#replace({ batches: this.#state.batches.map((entry) => entry.id === batch.id ? next : entry) });
      emit(this.#event(operationId, "tray-delivery.batch-completed", occurredAtUtcMs, {
        batchId: batch.id,
        leadServiceTaskId: batch.leadServiceTaskId,
        mealCount: batch.meals.length,
        tipCopper: batch.meals.reduce((sum, entry) => sum + entry.tipCopper, 0),
      }));
      return next;
    });
  }

  #run<T>(operationId: string, work: (emit: (event: DomainEvent) => void) => T): TrayDeliveryOperationResult<T> {
    if (!valid(operationId)) return this.#reject("INVALID_REQUEST", "Tray delivery operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Tray delivery operation was already processed.");
    try {
      const result = this.#transaction.run([this], ({ emit }) => {
        this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        return work(emit);
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) {
      return error instanceof TrayDeliveryRejected
        ? this.#reject(error.code, error.message)
        : this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Tray delivery operation failed.");
    }
  }

  #replace(update: Partial<TrayDeliveryState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }
  #reject(code: TrayDeliveryRejectionCode, message: string): TrayDeliveryOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown, discriminator = operationId): DomainEvent {
    return Object.freeze({ id: `${type}:${discriminator}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #validate(): void {
    if (this.#state.schemaVersion !== TRAY_DELIVERY_SCHEMA_VERSION || !nonNegative(this.#state.revision) ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      new Set(this.#state.batches.map((entry) => entry.id)).size !== this.#state.batches.length) {
      throw new Error("Tray delivery state header is invalid.");
    }
    const activeCharacters = new Set<InstanceId>();
    for (const batch of this.#state.batches) {
      if (!valid(batch.id) || !valid(batch.leadServiceTaskId) || !valid(batch.carrierLocationId) ||
        !positiveInteger(batch.capacitySnapshot) || batch.meals.length === 0 || batch.meals.length > batch.capacitySnapshot ||
        new Set(batch.meals.map((entry) => entry.mealId)).size !== batch.meals.length ||
        !nonNegative(batch.pickedUpAtUtcMs) ||
        (batch.status === "completed") !== (batch.completedAtUtcMs !== null) ||
        (batch.status === "completed" && batch.meals.some((entry) => entry.status !== "delivered")) ||
        (batch.status === "delivering" && activeCharacters.has(batch.assignedCharacterId))) {
        throw new Error(`Tray delivery batch invariant failed: ${batch.id}`);
      }
      if (batch.status === "delivering") activeCharacters.add(batch.assignedCharacterId);
      for (const meal of batch.meals) {
        if (!valid(meal.mealId) || !valid(meal.orderId) || !valid(meal.tableId) || !nonNegative(meal.tipCopper) ||
          (meal.status === "carried") !== (meal.deliveredAtUtcMs === null)) {
          throw new Error(`Tray delivery meal invariant failed: ${meal.mealId}`);
        }
      }
    }
  }
}