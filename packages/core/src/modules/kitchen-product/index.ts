import type { DomainEvent, InstanceId, SubresourceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope, instanceId } from "../../kernel";
import type { DishwareModule } from "../dishware";
import type { DomainModule } from "../domain-module";
import type { InventoryModule } from "../inventory";
import type { KitchenCacheClaimState } from "../kitchen-facility";
import type { RecipeExecutionModule, RecipeExecutionStepContext } from "../recipe-execution";

export const KITCHEN_PRODUCT_MODULE_ID = "module.kitchen-product";
export const KITCHEN_PRODUCT_SCHEMA_VERSION = 1;

export type KitchenIntermediateStatus = "available" | "reserved" | "consumed";
export type KitchenProductReservationStatus = "reserved" | "started";

export interface KitchenIntermediateState {
  readonly id: InstanceId;
  readonly itemId: string;
  readonly quantity: number;
  readonly executionId: string;
  readonly orderId: string;
  readonly mealId: string;
  readonly sourceStepInstanceId: string;
  readonly cacheClaimId: SubresourceId;
  readonly cacheSlotId: SubresourceId;
  readonly facilityId: InstanceId;
  readonly allowedConsumerStepInstanceIds: readonly string[];
  readonly status: KitchenIntermediateStatus;
  readonly reservedByStepInstanceId: string | null;
  readonly consumedByStepInstanceId: string | null;
  readonly producedAtUtcMs: number;
  readonly consumedAtUtcMs: number | null;
}

export interface KitchenProductReservationState {
  readonly stepInstanceId: string;
  readonly executionId: string;
  readonly mealId: string;
  readonly intermediateInstanceIds: readonly InstanceId[];
  readonly plateReservationId: string | null;
  readonly plateId: InstanceId | null;
  readonly outputCapacityReservationId: string | null;
  readonly status: KitchenProductReservationStatus;
  readonly reservedAtUtcMs: number;
  readonly startedAtUtcMs: number | null;
}

export interface KitchenQualityContribution {
  readonly stepInstanceId: string;
  readonly cookingLevel: number;
  readonly qualityWeight: number;
  readonly weightedQuality: number;
}

export interface KitchenFinishedMealState {
  readonly id: InstanceId;
  readonly itemId: string;
  readonly locationId: string;
  readonly executionId: string;
  readonly orderId: string;
  readonly orderLineId: string;
  readonly mealId: string;
  readonly recipeId: string;
  readonly recipeVersion: number;
  readonly plateId: InstanceId;
  readonly quality: number;
  readonly qualityWeight: number;
  readonly qualityContributions: readonly KitchenQualityContribution[];
  readonly tagIds: readonly string[];
  readonly platedAtUtcMs: number;
}

export interface KitchenProductState {
  readonly schemaVersion: typeof KITCHEN_PRODUCT_SCHEMA_VERSION;
  readonly revision: number;
  readonly intermediates: readonly KitchenIntermediateState[];
  readonly reservations: readonly KitchenProductReservationState[];
  readonly finishedMeals: readonly KitchenFinishedMealState[];
  readonly processedOperationIds: readonly string[];
}

export interface KitchenProductReadModel {
  readonly revision: number;
  readonly availableIntermediates: readonly KitchenIntermediateState[];
  readonly reservedIntermediates: readonly KitchenIntermediateState[];
  readonly finishedMeals: readonly KitchenFinishedMealState[];
}

export type KitchenProductRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_STEP"
  | "STEP_NOT_READY"
  | "STEP_NOT_COMPLETED"
  | "PRODUCT_ALREADY_RESERVED"
  | "MISSING_INTERMEDIATE"
  | "NO_CLEAN_PLATE"
  | "NO_OUTPUT_CAPACITY"
  | "UNKNOWN_RESERVATION"
  | "RESERVATION_NOT_RESERVED"
  | "RESERVATION_NOT_STARTED"
  | "CACHE_MISMATCH"
  | "DEPENDENCY_REJECTED";

export type KitchenProductOperationResult<TValue> =
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
      readonly code: KitchenProductRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

export interface KitchenProductStartResult {
  readonly reservation: KitchenProductReservationState | null;
  readonly consumedIntermediates: readonly KitchenIntermediateState[];
}

export interface CompleteKitchenProductStepRequest {
  readonly stepInstanceId: string;
  readonly outputCacheClaim: KitchenCacheClaimState | null;
  readonly qualityContributions: readonly KitchenQualityContribution[];
  readonly occurredAtUtcMs: number;
}

export type KitchenProductCompletion = KitchenIntermediateState | KitchenFinishedMealState;

const OPERATION_HISTORY_LIMIT = 4_096;

class KitchenProductRejected extends Error {
  constructor(readonly code: KitchenProductRejectionCode, message: string) {
    super(message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 300;
}

function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 500;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}

export function createKitchenIntermediateInstanceId(stepInstanceId: string): InstanceId {
  if (!validId(stepInstanceId)) throw new TypeError("Intermediate source step id is invalid.");
  return instanceId(`instance.intermediate.${stableHash(stepInstanceId)}`);
}

export function createKitchenFinishedMealInstanceId(mealId: string): InstanceId {
  if (!validId(mealId)) throw new TypeError("Finished meal id is invalid.");
  return instanceId(`instance.meal.${stableHash(mealId)}`);
}

function plateReservationId(stepInstanceId: string): string {
  return `reservation.kitchen-plate.${stableHash(stepInstanceId)}`;
}

function capacityReservationId(stepInstanceId: string): string {
  return `reservation.kitchen-output.${stableHash(stepInstanceId)}`;
}

function cloneContribution(value: KitchenQualityContribution): KitchenQualityContribution {
  return Object.freeze({ ...value });
}

function cloneIntermediate(value: KitchenIntermediateState): KitchenIntermediateState {
  return Object.freeze({
    ...value,
    allowedConsumerStepInstanceIds: Object.freeze([...value.allowedConsumerStepInstanceIds]),
  });
}

function cloneReservation(value: KitchenProductReservationState): KitchenProductReservationState {
  return Object.freeze({ ...value, intermediateInstanceIds: Object.freeze([...value.intermediateInstanceIds]) });
}

function cloneFinishedMeal(value: KitchenFinishedMealState): KitchenFinishedMealState {
  return Object.freeze({
    ...value,
    qualityContributions: Object.freeze(value.qualityContributions.map(cloneContribution)),
    tagIds: Object.freeze([...value.tagIds]),
  });
}

function cloneState(value: KitchenProductState): KitchenProductState {
  return Object.freeze({
    ...value,
    intermediates: Object.freeze(value.intermediates.map(cloneIntermediate)),
    reservations: Object.freeze(value.reservations.map(cloneReservation)),
    finishedMeals: Object.freeze(value.finishedMeals.map(cloneFinishedMeal)),
    processedOperationIds: Object.freeze([...value.processedOperationIds]),
  });
}

export class KitchenProductModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = KITCHEN_PRODUCT_MODULE_ID;
  readonly transactionParticipantId = KITCHEN_PRODUCT_MODULE_ID;
  readonly #recipes: RecipeExecutionModule;
  readonly #inventory: InventoryModule;
  readonly #dishware: DishwareModule;
  readonly #cleanPlateLocationIds: readonly string[];
  readonly #platedMealLocationId: string;
  readonly #plateUseLocationId: string;
  readonly #transaction: TransactionScope;
  #state: KitchenProductState;
  #transactionActive = false;

  constructor(options: {
    readonly recipes: RecipeExecutionModule;
    readonly inventory: InventoryModule;
    readonly dishware: DishwareModule;
    readonly cleanPlateLocationIds: readonly string[];
    readonly platedMealLocationId: string;
    readonly plateUseLocationId?: string;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: KitchenProductState;
  }) {
    if (options.cleanPlateLocationIds.length === 0 ||
      options.cleanPlateLocationIds.some((id) => !validId(id)) ||
      !validId(options.platedMealLocationId) ||
      (options.plateUseLocationId !== undefined && !validId(options.plateUseLocationId))) {
      throw new Error("Kitchen product storage configuration is invalid.");
    }
    this.#recipes = options.recipes;
    this.#inventory = options.inventory;
    this.#dishware = options.dishware;
    this.#cleanPlateLocationIds = Object.freeze([...options.cleanPlateLocationIds]);
    this.#platedMealLocationId = options.platedMealLocationId;
    this.#plateUseLocationId = options.plateUseLocationId ?? options.platedMealLocationId;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: KITCHEN_PRODUCT_SCHEMA_VERSION,
          revision: 0,
          intermediates: [],
          reservations: [],
          finishedMeals: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): KitchenProductState {
    return cloneState(this.#state);
  }

  getIntermediate(id: InstanceId): KitchenIntermediateState | null {
    const value = this.#state.intermediates.find((entry) => entry.id === id);
    return value === undefined ? null : cloneIntermediate(value);
  }

  getFinishedMealByMealId(mealId: string): KitchenFinishedMealState | null {
    const value = this.#state.finishedMeals.find((entry) => entry.mealId === mealId);
    return value === undefined ? null : this.#projectFinishedMeal(value);
  }

  #projectFinishedMeal(meal: KitchenFinishedMealState): KitchenFinishedMealState {
    const inventoryMeal = this.#inventory
      .getSnapshot()
      .locations.flatMap((location) => location.instances)
      .find((instance) => instance.id === meal.id);
    return cloneFinishedMeal({
      ...meal,
      locationId: inventoryMeal?.locationId ?? meal.locationId,
    });
  }

  getReservation(stepInstanceId: string): KitchenProductReservationState | null {
    const value = this.#state.reservations.find((entry) => entry.stepInstanceId === stepInstanceId);
    return value === undefined ? null : cloneReservation(value);
  }

  createReadModel(): KitchenProductReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      availableIntermediates: Object.freeze(this.#state.intermediates
        .filter((entry) => entry.status === "available").map(cloneIntermediate)),
      reservedIntermediates: Object.freeze(this.#state.intermediates
        .filter((entry) => entry.status === "reserved").map(cloneIntermediate)),
      finishedMeals: Object.freeze(this.#state.finishedMeals.map((meal) => this.#projectFinishedMeal(meal))),
    });
  }

  reserveStepProducts(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenProductOperationResult<KitchenProductReservationState | null> {
    const issue = this.#operationRejection(operationId);
    if (issue !== null) return issue;
    const context = this.#recipes.getStepContext(stepInstanceId);
    if (context === null) return this.#reject(operationId, "UNKNOWN_STEP", `Unknown recipe step: ${stepInstanceId}`);
    if (context.step.status !== "ready") return this.#reject(operationId, "STEP_NOT_READY", "Only a ready step can reserve products.");
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Product reservation time is invalid.");
    if (this.#state.reservations.some((entry) => entry.stepInstanceId === stepInstanceId)) {
      return this.#reject(operationId, "PRODUCT_ALREADY_RESERVED", "Kitchen products are already reserved for this step.");
    }
    const required = this.#requiredIntermediates(context);
    if (required === null) {
      return this.#reject(operationId, "MISSING_INTERMEDIATE", "A direct prerequisite intermediate is missing or already reserved.");
    }
    const isFinal = this.#isFinalStep(context);
    let selectedPlateId: InstanceId | null = null;
    let selectedPlateReservationId: string | null = null;
    let selectedCapacityReservationId: string | null = null;
    if (isFinal) {
      selectedPlateReservationId = plateReservationId(stepInstanceId);
      const plate = this.#dishware.reserveCleanPlate(
        `${operationId}:plate`,
        selectedPlateReservationId,
        "kitchen-plating",
        stepInstanceId,
        this.#cleanPlateLocationIds,
        occurredAtUtcMs,
      );
      if (!plate.accepted) {
        return this.#reject(operationId, "NO_CLEAN_PLATE", plate.message);
      }
      selectedPlateId = plate.value;
      selectedCapacityReservationId = capacityReservationId(stepInstanceId);
      const capacity = this.#inventory.reserveCapacity(
        `${operationId}:capacity`,
        selectedCapacityReservationId,
        "kitchen-plating",
        stepInstanceId,
        this.#platedMealLocationId,
        context.execution.recipe.outputItemId,
        1,
        occurredAtUtcMs,
      );
      if (!capacity.accepted) {
        this.#inventory.releaseReservation(`${operationId}:plate-rollback`, selectedPlateReservationId, occurredAtUtcMs);
        return this.#reject(operationId, "NO_OUTPUT_CAPACITY", capacity.message);
      }
    }
    const result = this.#run(operationId, (emit) => {
      const requiredIds = new Set(required.map((entry) => entry.id));
      const intermediates = this.#state.intermediates.map((entry) => requiredIds.has(entry.id)
        ? cloneIntermediate({ ...entry, status: "reserved", reservedByStepInstanceId: stepInstanceId })
        : entry);
      const reservation = cloneReservation({
        stepInstanceId,
        executionId: context.execution.id,
        mealId: context.execution.mealId,
        intermediateInstanceIds: required.map((entry) => entry.id),
        plateReservationId: selectedPlateReservationId,
        plateId: selectedPlateId,
        outputCapacityReservationId: selectedCapacityReservationId,
        status: "reserved",
        reservedAtUtcMs: occurredAtUtcMs,
        startedAtUtcMs: null,
      });
      this.#replace({ intermediates, reservations: [...this.#state.reservations, reservation] });
      emit(this.#event(operationId, "kitchen-product.step-products-reserved", occurredAtUtcMs, reservation, stepInstanceId));
      return reservation;
    });
    if (!result.accepted) {
      if (selectedPlateReservationId !== null) {
        this.#inventory.releaseReservation(
          `${operationId}:failed-plate-cleanup`, selectedPlateReservationId, occurredAtUtcMs,
        );
      }
      if (selectedCapacityReservationId !== null) {
        this.#inventory.releaseCapacityReservation(
          `${operationId}:failed-capacity-cleanup`, selectedCapacityReservationId, occurredAtUtcMs,
        );
      }
    }
    return result;
  }

  releaseStepReservation(
    operationId: string,
    stepInstanceId: string,
    reason: string,
    occurredAtUtcMs: number,
  ): KitchenProductOperationResult<KitchenProductReservationState | null> {
    const issue = this.#operationRejection(operationId);
    if (issue !== null) return issue;
    const reservation = this.#state.reservations.find((entry) => entry.stepInstanceId === stepInstanceId);
    if (reservation === undefined) return this.#unchanged(operationId, null);
    if (reservation.status !== "reserved") {
      return this.#reject(operationId, "RESERVATION_NOT_RESERVED", "Started kitchen product reservations cannot be released.");
    }
    if (!validId(reason) || !nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < reservation.reservedAtUtcMs) {
      return this.#reject(operationId, "INVALID_REQUEST", "Product reservation release request is invalid.");
    }
    if (reservation.plateReservationId !== null) {
      const released = this.#inventory.releaseReservation(
        `${operationId}:plate`, reservation.plateReservationId, occurredAtUtcMs,
      );
      if (!released.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", released.message);
    }
    if (reservation.outputCapacityReservationId !== null) {
      const released = this.#inventory.releaseCapacityReservation(
        `${operationId}:capacity`, reservation.outputCapacityReservationId, occurredAtUtcMs,
      );
      if (!released.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", released.message);
    }
    return this.#run(operationId, (emit) => {
      const ids = new Set(reservation.intermediateInstanceIds);
      this.#replace({
        intermediates: this.#state.intermediates.map((entry) => ids.has(entry.id)
          ? cloneIntermediate({ ...entry, status: "available", reservedByStepInstanceId: null })
          : entry),
        reservations: this.#state.reservations.filter((entry) => entry.stepInstanceId !== stepInstanceId),
      });
      emit(this.#event(operationId, "kitchen-product.step-products-released", occurredAtUtcMs, {
        stepInstanceId,
        reason,
        intermediateInstanceIds: reservation.intermediateInstanceIds,
      }, stepInstanceId));
      return reservation;
    });
  }

  startStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenProductOperationResult<KitchenProductStartResult> {
    const issue = this.#operationRejection(operationId);
    if (issue !== null) return issue;
    const context = this.#recipes.getStepContext(stepInstanceId);
    if (context === null) return this.#reject(operationId, "UNKNOWN_STEP", `Unknown recipe step: ${stepInstanceId}`);
    const reservation = this.#state.reservations.find((entry) => entry.stepInstanceId === stepInstanceId);
    if (reservation === undefined) {
      if (context.definition.prerequisiteStepIds.length === 0 && !this.#isFinalStep(context)) {
        return this.#unchanged(operationId, Object.freeze({ reservation: null, consumedIntermediates: Object.freeze([]) }));
      }
      return this.#reject(operationId, "UNKNOWN_RESERVATION", "Kitchen product inputs were not reserved.");
    }
    if (reservation.status !== "reserved") return this.#reject(operationId, "RESERVATION_NOT_RESERVED", "Kitchen product reservation already started.");
    if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < reservation.reservedAtUtcMs) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen product start time is invalid.");
    }
    if (reservation.plateReservationId !== null) {
      const used = this.#dishware.beginUse(
        `${operationId}:plate`, reservation.plateReservationId, this.#plateUseLocationId, occurredAtUtcMs,
      );
      if (!used.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", used.message);
    }
    return this.#run(operationId, (emit) => {
      const ids = new Set(reservation.intermediateInstanceIds);
      const consumed = this.#state.intermediates.filter((entry) => ids.has(entry.id)).map((entry) =>
        cloneIntermediate({
          ...entry,
          status: "consumed",
          consumedByStepInstanceId: stepInstanceId,
          consumedAtUtcMs: occurredAtUtcMs,
        }));
      const byId = new Map(consumed.map((entry) => [entry.id, entry]));
      const started = cloneReservation({ ...reservation, status: "started", startedAtUtcMs: occurredAtUtcMs });
      this.#replace({
        intermediates: this.#state.intermediates.map((entry) => byId.get(entry.id) ?? entry),
        reservations: this.#state.reservations.map((entry) => entry.stepInstanceId === stepInstanceId ? started : entry),
      });
      emit(this.#event(operationId, "kitchen-product.step-products-started", occurredAtUtcMs, {
        stepInstanceId,
        intermediateInstanceIds: started.intermediateInstanceIds,
        plateId: started.plateId,
      }, stepInstanceId));
      return Object.freeze({ reservation: started, consumedIntermediates: Object.freeze(consumed) });
    });
  }

  completeStep(
    operationId: string,
    request: CompleteKitchenProductStepRequest,
  ): KitchenProductOperationResult<KitchenProductCompletion> {
    const issue = this.#operationRejection(operationId);
    if (issue !== null) return issue;
    const context = this.#recipes.getStepContext(request.stepInstanceId);
    if (context === null) return this.#reject(operationId, "UNKNOWN_STEP", `Unknown recipe step: ${request.stepInstanceId}`);
    const existingIntermediate = this.#state.intermediates.find((entry) =>
      entry.sourceStepInstanceId === request.stepInstanceId,
    );
    if (existingIntermediate !== undefined) return this.#unchanged(operationId, cloneIntermediate(existingIntermediate));
    const existingMeal = this.#state.finishedMeals.find((entry) => entry.mealId === context.execution.mealId);
    if (existingMeal !== undefined) return this.#unchanged(operationId, cloneFinishedMeal(existingMeal));
    if (context.step.status !== "completed") {
      return this.#reject(operationId, "STEP_NOT_COMPLETED", "Kitchen product output requires a completed recipe step.");
    }
    if (!nonNegativeInteger(request.occurredAtUtcMs) || request.occurredAtUtcMs < context.step.completedAtUtcMs!) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen product completion time is invalid.");
    }
    if (!this.#isFinalStep(context)) return this.#completeIntermediate(operationId, context, request);
    return this.#completeFinishedMeal(operationId, context, request);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Kitchen product transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = cloneState(checkpoint); this.#transactionActive = false; },
    };
  }

  #completeIntermediate(
    operationId: string,
    context: RecipeExecutionStepContext,
    request: CompleteKitchenProductStepRequest,
  ): KitchenProductOperationResult<KitchenIntermediateState> {
    const cache = request.outputCacheClaim;
    if (cache === null || cache.status !== "occupied" || cache.executionId !== context.execution.id ||
      cache.sourceStepInstanceId !== context.step.id) {
      return this.#reject(operationId, "CACHE_MISMATCH", "Completed intermediate has no matching occupied cache slot.");
    }
    return this.#run(operationId, (emit) => {
      const intermediate = cloneIntermediate({
        id: createKitchenIntermediateInstanceId(context.step.id),
        itemId: context.definition.outputItemId,
        quantity: context.definition.outputQuantity,
        executionId: context.execution.id,
        orderId: context.execution.orderId,
        mealId: context.execution.mealId,
        sourceStepInstanceId: context.step.id,
        cacheClaimId: cache.id,
        cacheSlotId: cache.cacheSlotId,
        facilityId: cache.facilityId,
        allowedConsumerStepInstanceIds: cache.allowedConsumerStepInstanceIds,
        status: "available",
        reservedByStepInstanceId: null,
        consumedByStepInstanceId: null,
        producedAtUtcMs: request.occurredAtUtcMs,
        consumedAtUtcMs: null,
      });
      this.#replace({
        intermediates: [...this.#state.intermediates, intermediate],
        reservations: this.#state.reservations.filter((entry) =>
          entry.stepInstanceId !== context.step.id),
      });
      emit(this.#event(operationId, "kitchen-product.intermediate-created", request.occurredAtUtcMs, intermediate, intermediate.id));
      return intermediate;
    });
  }

  #completeFinishedMeal(
    operationId: string,
    context: RecipeExecutionStepContext,
    request: CompleteKitchenProductStepRequest,
  ): KitchenProductOperationResult<KitchenFinishedMealState> {
    if (request.outputCacheClaim !== null) {
      return this.#reject(operationId, "CACHE_MISMATCH", "The final plating step must not occupy an intermediate cache.");
    }
    const reservation = this.#state.reservations.find((entry) => entry.stepInstanceId === context.step.id);
    if (reservation === undefined) return this.#reject(operationId, "UNKNOWN_RESERVATION", "Plating resources are missing.");
    if (reservation.status !== "started" || reservation.plateId === null ||
      reservation.outputCapacityReservationId === null) {
      return this.#reject(operationId, "RESERVATION_NOT_STARTED", "Plating resources have not entered use.");
    }
    const contributions = request.qualityContributions.map(cloneContribution);
    if (contributions.some((entry) => !validId(entry.stepInstanceId) ||
      !positiveInteger(entry.cookingLevel) || !Number.isFinite(entry.qualityWeight) || entry.qualityWeight < 0 ||
      !Number.isFinite(entry.weightedQuality) || entry.weightedQuality < 0)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen quality contribution is invalid.");
    }
    const qualityWeight = contributions.reduce((sum, entry) => sum + entry.qualityWeight, 0);
    const weightedQuality = contributions.reduce((sum, entry) => sum + entry.weightedQuality, 0);
    const quality = qualityWeight === 0 ? 0 : weightedQuality / qualityWeight;
    const mealInstanceId = createKitchenFinishedMealInstanceId(context.execution.mealId);
    const created = this.#inventory.createInstance(`${operationId}:inventory`, {
      instanceId: mealInstanceId,
      itemId: context.execution.recipe.outputItemId,
      locationId: this.#platedMealLocationId,
      capacityReservationId: reservation.outputCapacityReservationId,
      occurredAtUtcMs: request.occurredAtUtcMs,
      attributes: {
        executionId: context.execution.id,
        orderId: context.execution.orderId,
        orderLineId: context.execution.orderLineId,
        mealId: context.execution.mealId,
        recipeId: context.execution.recipe.id,
        recipeVersion: context.execution.recipe.version,
        plateId: reservation.plateId,
        quality,
      },
    });
    if (!created.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", created.message);
    return this.#run(operationId, (emit) => {
      const finished = cloneFinishedMeal({
        id: mealInstanceId,
        itemId: context.execution.recipe.outputItemId,
        locationId: this.#platedMealLocationId,
        executionId: context.execution.id,
        orderId: context.execution.orderId,
        orderLineId: context.execution.orderLineId,
        mealId: context.execution.mealId,
        recipeId: context.execution.recipe.id,
        recipeVersion: context.execution.recipe.version,
        plateId: reservation.plateId!,
        quality,
        qualityWeight,
        qualityContributions: contributions,
        tagIds: [],
        platedAtUtcMs: request.occurredAtUtcMs,
      });
      this.#replace({
        reservations: this.#state.reservations.filter((entry) => entry.stepInstanceId !== context.step.id),
        finishedMeals: [...this.#state.finishedMeals, finished],
      });
      emit(this.#event(operationId, "kitchen-product.finished-meal-created", request.occurredAtUtcMs, finished, finished.id));
      return finished;
    });
  }

  #requiredIntermediates(context: RecipeExecutionStepContext): readonly KitchenIntermediateState[] | null {
    const required: KitchenIntermediateState[] = [];
    for (const prerequisiteDefinitionId of context.definition.prerequisiteStepIds) {
      const prerequisiteStep = context.execution.steps.find((entry) =>
        entry.definitionStepId === prerequisiteDefinitionId,
      );
      if (prerequisiteStep === undefined) return null;
      const intermediate = this.#state.intermediates.find((entry) =>
        entry.sourceStepInstanceId === prerequisiteStep.id &&
        entry.executionId === context.execution.id &&
        entry.status === "available" &&
        entry.allowedConsumerStepInstanceIds.includes(context.step.id),
      );
      if (intermediate === undefined) return null;
      required.push(intermediate);
    }
    return Object.freeze(required.map(cloneIntermediate));
  }

  #isFinalStep(context: RecipeExecutionStepContext): boolean {
    return context.execution.recipe.steps.every((definition) =>
      !definition.prerequisiteStepIds.includes(context.definition.id),
    );
  }

  #operationRejection(operationId: string): KitchenProductOperationResult<never> | null {
    if (!validOperationId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Kitchen product operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Kitchen product operation was already processed.");
    }
    return null;
  }

  #run<TValue>(operationId: string, work: (emit: (event: DomainEvent) => void) => TValue): KitchenProductOperationResult<TValue> {
    if (!validOperationId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Kitchen product operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Kitchen product operation was already processed.");
    }
    try {
      const result = this.#transaction.run([this], ({ emit }) => {
        this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT) });
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
      return error instanceof KitchenProductRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(operationId, "DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Kitchen product operation failed.");
    }
  }

  #unchanged<TValue>(operationId: string, value: TValue): KitchenProductOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: false, operationId, value, committedEventIds: Object.freeze([]) });
  }

  #replace(update: Partial<KitchenProductState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(operationId: string, code: KitchenProductRejectionCode, message: string): KitchenProductOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, committedEventIds: [] as const });
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown, discriminator: string): DomainEvent {
    return Object.freeze({
      id: `${type}:${discriminator}:${operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #validateState(): void {
    if (this.#state.schemaVersion !== KITCHEN_PRODUCT_SCHEMA_VERSION ||
      !nonNegativeInteger(this.#state.revision) ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      this.#state.processedOperationIds.some((id) => !validOperationId(id))) {
      throw new Error("Kitchen product state header is invalid.");
    }
    const objectIds = new Set<string>();
    const sourceStepIds = new Set<string>();
    for (const intermediate of this.#state.intermediates) {
      const context = this.#recipes.getStepContext(intermediate.sourceStepInstanceId);
      if (objectIds.has(intermediate.id) || sourceStepIds.has(intermediate.sourceStepInstanceId) ||
        context === null || context.execution.id !== intermediate.executionId ||
        context.execution.orderId !== intermediate.orderId || context.execution.mealId !== intermediate.mealId ||
        context.step.status !== "completed" || !positiveInteger(intermediate.quantity) ||
        !nonNegativeInteger(intermediate.producedAtUtcMs) ||
        (intermediate.status !== "available" && intermediate.status !== "reserved" && intermediate.status !== "consumed") ||
        (intermediate.status === "available" && (intermediate.reservedByStepInstanceId !== null ||
          intermediate.consumedByStepInstanceId !== null || intermediate.consumedAtUtcMs !== null)) ||
        (intermediate.status === "reserved" && (intermediate.reservedByStepInstanceId === null ||
          intermediate.consumedByStepInstanceId !== null || intermediate.consumedAtUtcMs !== null)) ||
        (intermediate.status === "consumed" && (intermediate.reservedByStepInstanceId === null ||
          intermediate.consumedByStepInstanceId !== intermediate.reservedByStepInstanceId ||
          !nonNegativeInteger(intermediate.consumedAtUtcMs ?? -1)))) {
        throw new Error(`Kitchen intermediate invariant failed: ${intermediate.id}`);
      }
      objectIds.add(intermediate.id);
      sourceStepIds.add(intermediate.sourceStepInstanceId);
    }
    const reservationSteps = new Set<string>();
    for (const reservation of this.#state.reservations) {
      const context = this.#recipes.getStepContext(reservation.stepInstanceId);
      if (reservationSteps.has(reservation.stepInstanceId) || context === null ||
        context.execution.id !== reservation.executionId || context.execution.mealId !== reservation.mealId ||
        (reservation.status !== "reserved" && reservation.status !== "started") ||
        !nonNegativeInteger(reservation.reservedAtUtcMs) ||
        (reservation.status === "reserved" && reservation.startedAtUtcMs !== null) ||
        (reservation.status === "started" && !nonNegativeInteger(reservation.startedAtUtcMs ?? -1)) ||
        reservation.intermediateInstanceIds.some((id) => !this.#state.intermediates.some((entry) =>
          entry.id === id && entry.reservedByStepInstanceId === reservation.stepInstanceId &&
          entry.status === (reservation.status === "reserved" ? "reserved" : "consumed"),
        ))) {
        throw new Error(`Kitchen product reservation invariant failed: ${reservation.stepInstanceId}`);
      }
      reservationSteps.add(reservation.stepInstanceId);
    }
    const mealIds = new Set<string>();
    const inventory = this.#inventory.getSnapshot();
    const dishware = this.#dishware.getSnapshot();
    for (const meal of this.#state.finishedMeals) {
      const execution = this.#recipes.getExecution(meal.executionId);
      const inventoryMeal = inventory.locations.flatMap((entry) => entry.instances).find((entry) => entry.id === meal.id);
      if (objectIds.has(meal.id) || mealIds.has(meal.mealId) || execution === null || execution.status !== "completed" ||
        execution.orderId !== meal.orderId || execution.orderLineId !== meal.orderLineId || execution.mealId !== meal.mealId ||
        execution.recipe.id !== meal.recipeId || execution.recipe.version !== meal.recipeVersion ||
        (inventoryMeal !== undefined && inventoryMeal.itemId !== meal.itemId) ||
        dishware.plates.every((entry) => entry.id !== meal.plateId) ||
        !Number.isFinite(meal.quality) || meal.quality < 0 ||
        !Number.isFinite(meal.qualityWeight) || meal.qualityWeight < 0 ||
        !nonNegativeInteger(meal.platedAtUtcMs)) {
        throw new Error(`Kitchen finished meal invariant failed: ${meal.id}`);
      }
      objectIds.add(meal.id);
      mealIds.add(meal.mealId);
    }
  }
}
