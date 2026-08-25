import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { CharacterModule } from "../character";
import type { DomainModule } from "../domain-module";
import type { InventoryModule, StackQuantityRequest } from "../inventory";
import type {
  KitchenFacilityModule,
  KitchenStepAttendance,
  ReserveKitchenStepResourcesRequest,
} from "../kitchen-facility";
import type { KitchenProductModule } from "../kitchen-product";
import type { MovementModule } from "../movement";
import type { OrderModule } from "../order";
import {
  createRecipeExecutionStepId,
  type RecipeExecutionModule,
  type RecipeExecutionStepContext,
} from "../recipe-execution";
import type {
  TaskCandidate,
  TaskExecutionProjection,
  TaskModule,
  TaskRequest,
  TaskSourceSnapshot,
} from "../task";

export const KITCHEN_STEP_EXECUTION_MODULE_ID = "module.kitchen-step-execution";
export const KITCHEN_STEP_EXECUTION_SCHEMA_VERSION = 1;

export type KitchenStepWorkStatus = "claimed" | "running" | "completed";

export interface CookingPerformanceSnapshot {
  readonly cookingLevel: number;
  readonly speedMultiplierBasisPoints: number;
  readonly effectiveDurationMs: number;
  readonly qualityWeight: number;
  readonly weightedQuality: number;
}

export interface CookingPerformancePolicy {
  snapshot(
    cookingLevel: number,
    baseDurationMs: number,
    qualityWeight: number,
  ): CookingPerformanceSnapshot;
}

/** Default tuning: every level after one adds 1% speed; quality keeps the raw weighted level. */
export class LinearCookingPerformancePolicy implements CookingPerformancePolicy {
  readonly #speedBasisPointsPerLevel: number;

  constructor(speedBasisPointsPerLevel = 100) {
    if (!Number.isSafeInteger(speedBasisPointsPerLevel) || speedBasisPointsPerLevel < 0) {
      throw new RangeError("Cooking speed gain per level must be a non-negative integer.");
    }
    this.#speedBasisPointsPerLevel = speedBasisPointsPerLevel;
  }

  snapshot(
    cookingLevel: number,
    baseDurationMs: number,
    qualityWeight: number,
  ): CookingPerformanceSnapshot {
    if (!Number.isSafeInteger(cookingLevel) || cookingLevel < 1 ||
      !positiveInteger(baseDurationMs) || !Number.isFinite(qualityWeight) || qualityWeight < 0) {
      throw new RangeError("Cooking performance inputs are invalid.");
    }
    const speedMultiplierBasisPoints = 10_000 + (cookingLevel - 1) * this.#speedBasisPointsPerLevel;
    return Object.freeze({
      cookingLevel,
      speedMultiplierBasisPoints,
      effectiveDurationMs: Math.max(1, Math.ceil(baseDurationMs * 10_000 / speedMultiplierBasisPoints)),
      qualityWeight,
      weightedQuality: cookingLevel * qualityWeight,
    });
  }
}

export interface KitchenStepWorkState {
  readonly stepInstanceId: string;
  readonly executionId: string;
  readonly orderId: string;
  readonly mealId: string;
  readonly taskRequest: TaskRequest;
  readonly characterId: InstanceId;
  readonly attendance: KitchenStepAttendance;
  readonly ingredientReservationId: string;
  readonly ingredientInputs: readonly StackQuantityRequest[];
  readonly status: KitchenStepWorkStatus;
  readonly performance: CookingPerformanceSnapshot | null;
  readonly progressMs: number;
  readonly claimedAtUtcMs: number;
  readonly startedAtUtcMs: number | null;
  readonly lastAdvancedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
}

export interface KitchenStepExecutionState {
  readonly schemaVersion: typeof KITCHEN_STEP_EXECUTION_SCHEMA_VERSION;
  readonly revision: number;
  readonly steps: readonly KitchenStepWorkState[];
  readonly processedOperationIds: readonly string[];
}

export interface ClaimKitchenStepRequest {
  readonly stepInstanceId: string;
  readonly candidate: TaskCandidate;
  readonly speedUnitsPerSecond: number;
  readonly reservationExpiresAtUtcMs: number;
  readonly occurredAtUtcMs: number;
}

export interface KitchenStepExecutionReadModel {
  readonly revision: number;
  readonly claimed: readonly KitchenStepWorkState[];
  readonly running: readonly KitchenStepWorkState[];
  readonly completed: readonly KitchenStepWorkState[];
}

export type KitchenStepExecutionRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_STEP"
  | "STEP_NOT_READY"
  | "STEP_ALREADY_ASSIGNED"
  | "UNKNOWN_ORDER"
  | "UNKNOWN_CHARACTER"
  | "TASK_NOT_WAITING"
  | "RESOURCES_UNAVAILABLE"
  | "TASK_REJECTED"
  | "UNKNOWN_ASSIGNMENT"
  | "ASSIGNMENT_NOT_CLAIMED"
  | "ASSIGNMENT_NOT_RUNNING"
  | "CHARACTER_NOT_ARRIVED"
  | "INGREDIENTS_NOT_READY"
  | "DEPENDENCY_REJECTED";

export type KitchenStepExecutionOperationResult<TValue> =
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
      readonly code: KitchenStepExecutionRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;

class KitchenStepExecutionRejected extends Error {
  constructor(readonly code: KitchenStepExecutionRejectionCode, message: string) {
    super(message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 300;
}

function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 120;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function cloneTaskRequest(value: TaskRequest): TaskRequest {
  return Object.freeze({
    ...value,
    source: Object.freeze({ ...value.source }),
    target: Object.freeze({ ...value.target }),
    requiredTags: Object.freeze([...value.requiredTags]),
    eligibleJobIds: Object.freeze([...value.eligibleJobIds]),
    requiredSkills: Object.freeze(value.requiredSkills.map((entry) => Object.freeze({ ...entry }))),
  });
}

function clonePerformance(value: CookingPerformanceSnapshot | null): CookingPerformanceSnapshot | null {
  return value === null ? null : Object.freeze({ ...value });
}

function cloneStep(value: KitchenStepWorkState): KitchenStepWorkState {
  return Object.freeze({
    ...value,
    taskRequest: cloneTaskRequest(value.taskRequest),
    ingredientInputs: Object.freeze(value.ingredientInputs.map((entry) => Object.freeze({ ...entry }))),
    performance: clonePerformance(value.performance),
  });
}

function cloneState(value: KitchenStepExecutionState): KitchenStepExecutionState {
  return Object.freeze({
    ...value,
    steps: Object.freeze(value.steps.map(cloneStep)),
    processedOperationIds: Object.freeze([...value.processedOperationIds]),
  });
}

export class KitchenStepExecutionModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = KITCHEN_STEP_EXECUTION_MODULE_ID;
  readonly transactionParticipantId = KITCHEN_STEP_EXECUTION_MODULE_ID;
  readonly #recipes: RecipeExecutionModule;
  readonly #facilities: KitchenFacilityModule;
  readonly #inventory: InventoryModule;
  readonly #orders: OrderModule;
  readonly #characters: CharacterModule;
  readonly #tasks: TaskModule;
  readonly #movement: MovementModule;
  readonly #products: KitchenProductModule | null;
  readonly #performance: CookingPerformancePolicy;
  readonly #transaction: TransactionScope;
  #state: KitchenStepExecutionState;
  #transactionActive = false;

  constructor(options: {
    readonly recipes: RecipeExecutionModule;
    readonly facilities: KitchenFacilityModule;
    readonly inventory: InventoryModule;
    readonly orders: OrderModule;
    readonly characters: CharacterModule;
    readonly tasks: TaskModule;
    readonly movement: MovementModule;
    readonly products?: KitchenProductModule;
    readonly performancePolicy?: CookingPerformancePolicy;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: KitchenStepExecutionState;
  }) {
    this.#recipes = options.recipes;
    this.#facilities = options.facilities;
    this.#inventory = options.inventory;
    this.#orders = options.orders;
    this.#characters = options.characters;
    this.#tasks = options.tasks;
    this.#movement = options.movement;
    this.#products = options.products ?? null;
    this.#performance = options.performancePolicy ?? new LinearCookingPerformancePolicy();
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: KITCHEN_STEP_EXECUTION_SCHEMA_VERSION,
          revision: 0,
          steps: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): KitchenStepExecutionState {
    return cloneState(this.#state);
  }

  getStep(stepInstanceId: string): KitchenStepWorkState | null {
    const step = this.#state.steps.find((entry) => entry.stepInstanceId === stepInstanceId);
    return step === undefined ? null : cloneStep(step);
  }

  createReadModel(): KitchenStepExecutionReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      claimed: Object.freeze(this.#state.steps.filter((entry) => entry.status === "claimed").map(cloneStep)),
      running: Object.freeze(this.#state.steps.filter((entry) => entry.status === "running").map(cloneStep)),
      completed: Object.freeze(this.#state.steps.filter((entry) => entry.status === "completed").map(cloneStep)),
    });
  }

  createTaskSourceSnapshot(): TaskSourceSnapshot {
    const recipeSource = this.#recipes.createTaskSourceSnapshot();
    const assignedStepIds = new Set(this.#state.steps
      .filter((entry) => entry.status !== "completed")
      .map((entry) => entry.stepInstanceId));
    const waitingTasks = recipeSource.waitingTasks.filter((request) =>
      !assignedStepIds.has(request.target.id),
    );
    const activeTasks: TaskExecutionProjection[] = this.#state.steps.flatMap((step) => {
      if (step.status === "completed" ||
        (step.status === "running" && step.attendance === "unattended")) return [];
      const request = step.status === "running"
        ? cloneTaskRequest({ ...step.taskRequest, interruptible: false })
        : cloneTaskRequest(step.taskRequest);
      return [Object.freeze({
        request,
        assignedCharacterId: step.characterId,
        claimedAtUtcMs: step.claimedAtUtcMs,
      })];
    });
    return Object.freeze({
      sourceId: "source.kitchen-step-execution",
      sourceRevision: recipeSource.sourceRevision + this.#state.revision,
      waitingTasks: Object.freeze(waitingTasks.map(cloneTaskRequest)),
      activeTasks: Object.freeze(activeTasks),
    });
  }

synchronizeWaitingTasks(
    operationId: string,
    occurredAtUtcMs: number,
  ): KitchenStepExecutionOperationResult<readonly string[]> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    if (!nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Task synchronization time is invalid.");
    }
    const missing = this.createTaskSourceSnapshot().waitingTasks.filter((request) =>
      this.#tasks.getTask(request.taskId) === null,
    );
    if (missing.length === 0) return this.#unchanged(operationId, Object.freeze([]));
    return this.#run(operationId, (emit) => Object.freeze(
      this.#createMissingWaitingTasks(operationId, occurredAtUtcMs, emit),
    ));
  }

  claimStep(
    operationId: string,
    request: ClaimKitchenStepRequest,
  ): KitchenStepExecutionOperationResult<KitchenStepWorkState> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    const validated = this.#validateClaimRequest(request);
    if (validated !== null) return this.#reject(operationId, "INVALID_REQUEST", validated);
    const context = this.#recipes.getStepContext(request.stepInstanceId);
    if (context === null) return this.#reject(operationId, "UNKNOWN_STEP", `Unknown recipe step: ${request.stepInstanceId}`);
    if (context.step.status !== "ready") return this.#reject(operationId, "STEP_NOT_READY", "Only a ready recipe step can be claimed.");
    if (this.#state.steps.some((entry) => entry.stepInstanceId === request.stepInstanceId)) {
      return this.#reject(operationId, "STEP_ALREADY_ASSIGNED", "Recipe step already has a chef assignment.");
    }
    const task = this.#tasks.getTask(context.taskRequest.taskId);
    if (task?.status !== "waiting") return this.#reject(operationId, "TASK_NOT_WAITING", "Recipe step task is not waiting.");
    const order = this.#orders.getOrder(context.execution.orderId);
    if (order === null || order.ingredientReservationIds.length !== 1) {
      return this.#reject(operationId, "UNKNOWN_ORDER", "Recipe execution has no valid order ingredient reservation.");
    }
    if (this.#characters.getCharacter(request.candidate.characterId) === null) {
      return this.#reject(operationId, "UNKNOWN_CHARACTER", "Task candidate has no character instance.");
    }
    const productReservation = this.#products?.reserveStepProducts(
      `${operationId}:products`, request.stepInstanceId, request.occurredAtUtcMs,
    ) ?? null;
    if (productReservation !== null && !productReservation.accepted) {
      return this.#reject(operationId, "RESOURCES_UNAVAILABLE", `${productReservation.code}: ${productReservation.message}`);
    }
    const dependentStepIds = context.execution.recipe.steps
      .filter((definition) => definition.prerequisiteStepIds.includes(context.definition.id))
      .map((definition) => createRecipeExecutionStepId(context.execution.id, definition.id));
    const reserveRequest: ReserveKitchenStepResourcesRequest = Object.freeze({
      stepInstanceId: context.step.id,
      executionId: context.execution.id,
      taskId: context.taskRequest.taskId,
      characterId: request.candidate.characterId,
      requiredCapabilityIds: context.definition.requiredCapabilityIds,
      attendance: context.definition.attendance,
      speedUnitsPerSecond: request.speedUnitsPerSecond,
      occurredAtUtcMs: request.occurredAtUtcMs,
      reservationExpiresAtUtcMs: request.reservationExpiresAtUtcMs,
      ...(dependentStepIds.length === 0
        ? {}
        : { outputCache: Object.freeze({ allowedConsumerStepInstanceIds: Object.freeze(dependentStepIds) }) }),
    });
    const reserved = this.#facilities.reserveStepResources(`${operationId}:resources`, reserveRequest);
    if (!reserved.accepted) {
      this.#products?.releaseStepReservation(
        `${operationId}:product-rollback`, request.stepInstanceId, "facility-reservation-rejected", request.occurredAtUtcMs,
      );
      return this.#reject(operationId, "RESOURCES_UNAVAILABLE", `${reserved.code}: ${reserved.message}`);
    }
    const claimed = this.#tasks.claimTask(
      `${operationId}:task`,
      context.taskRequest.taskId,
      request.candidate,
      request.occurredAtUtcMs,
    );
    if (!claimed.accepted) {
      this.#facilities.releaseStepReservation(
        `${operationId}:resource-rollback`,
        request.stepInstanceId,
        "task-claim-rejected",
        request.occurredAtUtcMs,
      );
      this.#products?.releaseStepReservation(
        `${operationId}:product-rollback`, request.stepInstanceId, "task-claim-rejected", request.occurredAtUtcMs,
      );
      return this.#reject(operationId, "TASK_REJECTED", `${claimed.code}: ${claimed.message}`);
    }
    return this.#run(operationId, (emit) => {
      for (const event of claimed.events) emit(event);
      const step = cloneStep({
        stepInstanceId: context.step.id,
        executionId: context.execution.id,
        orderId: context.execution.orderId,
        mealId: context.execution.mealId,
        taskRequest: context.taskRequest,
        characterId: request.candidate.characterId,
        attendance: context.definition.attendance,
        ingredientReservationId: order.ingredientReservationIds[0]!,
        ingredientInputs: context.definition.ingredientInputs,
        status: "claimed",
        performance: null,
        progressMs: 0,
        claimedAtUtcMs: request.occurredAtUtcMs,
        startedAtUtcMs: null,
        lastAdvancedAtUtcMs: null,
        completedAtUtcMs: null,
      });
      this.#replace({ steps: [...this.#state.steps, step] });
      emit(this.#event(operationId, "kitchen-step.claimed", request.occurredAtUtcMs, {
        stepInstanceId: step.stepInstanceId,
        executionId: step.executionId,
        taskId: step.taskRequest.taskId,
        characterId: step.characterId,
        workstationId: reserved.value.workstationId,
      }, step.stepInstanceId));
      return step;
    });
  }

  releaseClaim(
    operationId: string,
    stepInstanceId: string,
    reason: string,
    occurredAtUtcMs: number,
  ): KitchenStepExecutionOperationResult<KitchenStepWorkState> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    const step = this.#state.steps.find((entry) => entry.stepInstanceId === stepInstanceId);
    if (step === undefined) return this.#reject(operationId, "UNKNOWN_ASSIGNMENT", "Unknown kitchen step assignment.");
    if (step.status !== "claimed") return this.#reject(operationId, "ASSIGNMENT_NOT_CLAIMED", "A running cooking step cannot be interrupted.");
    if (!validId(reason) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen step claim release request is invalid.");
    }
    const releasedResources = this.#facilities.releaseStepReservation(
      `${operationId}:resources`, step.stepInstanceId, reason, occurredAtUtcMs,
    );
    if (!releasedResources.accepted) {
      return this.#reject(operationId, "DEPENDENCY_REJECTED", `${releasedResources.code}: ${releasedResources.message}`);
    }
    const releasedProducts = this.#products?.releaseStepReservation(
      `${operationId}:products`, step.stepInstanceId, reason, occurredAtUtcMs,
    ) ?? null;
    if (releasedProducts !== null && !releasedProducts.accepted) {
      return this.#reject(operationId, "DEPENDENCY_REJECTED", `${releasedProducts.code}: ${releasedProducts.message}`);
    }
    const releasedTask = this.#tasks.releaseClaim(
      `${operationId}:task`, step.taskRequest.taskId, step.characterId, reason, occurredAtUtcMs,
    );
    if (!releasedTask.accepted) {
      return this.#reject(operationId, "DEPENDENCY_REJECTED", `${releasedTask.code}: ${releasedTask.message}`);
    }
    return this.#run(operationId, (emit) => {
      for (const event of releasedTask.events) emit(event);
      this.#replace({ steps: this.#state.steps.filter((entry) => entry.stepInstanceId !== step.stepInstanceId) });
      emit(this.#event(operationId, "kitchen-step.claim-released", occurredAtUtcMs, {
        stepInstanceId: step.stepInstanceId,
        characterId: step.characterId,
        reason,
      }, step.stepInstanceId));
      return step;
    });
  }

  startStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenStepExecutionOperationResult<KitchenStepWorkState> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    const step = this.#state.steps.find((entry) => entry.stepInstanceId === stepInstanceId);
    if (step === undefined) return this.#reject(operationId, "UNKNOWN_ASSIGNMENT", "Unknown kitchen step assignment.");
    if (step.status !== "claimed") return this.#reject(operationId, "ASSIGNMENT_NOT_CLAIMED", "Kitchen step is not waiting to start.");
    const context = this.#recipes.getStepContext(step.stepInstanceId);
    const character = this.#characters.getCharacter(step.characterId);
    const binding = this.#facilities.getBinding(step.stepInstanceId);
    const movement = this.#movement.getCharacter(step.characterId);
    if (context === null || context.step.status !== "ready" || binding?.phase !== "reserved") {
      return this.#reject(operationId, "STEP_NOT_READY", "Recipe or facility binding is no longer ready.");
    }
    if (character === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", "Assigned chef no longer exists.");
    if (movement?.status !== "arrived" || movement.plan?.taskId !== step.taskRequest.taskId ||
      movement.plan.target.id !== binding.facilityId ||
      movement.plan.interactionCandidateId !== binding.interactionId) {
      return this.#reject(operationId, "CHARACTER_NOT_ARRIVED", "Assigned chef has not arrived at the reserved workstation.");
    }
    if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < step.claimedAtUtcMs) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen step start time is invalid.");
    }
    if (step.ingredientInputs.length > 0) {
      const plan = this.#inventory.planReservedStackConsumption(
        step.ingredientReservationId,
        step.ingredientInputs,
      );
      if (!plan.consumable) {
        const released = this.releaseClaim(
          `${operationId}:not-ready`, step.stepInstanceId, "ingredients-not-ready", occurredAtUtcMs,
        );
        if (!released.accepted) {
          return this.#reject(operationId, "DEPENDENCY_REJECTED", released.message);
        }
        return this.#reject(operationId, "INGREDIENTS_NOT_READY", "Reserved ingredients have not reached kitchen storage.");
      }
    }
    const productStarted = this.#products?.startStep(
      `${operationId}:products`, step.stepInstanceId, occurredAtUtcMs,
    ) ?? null;
    if (productStarted !== null && !productStarted.accepted) {
      return this.#reject(operationId, "DEPENDENCY_REJECTED", `${productStarted.code}: ${productStarted.message}`);
    }
    for (const intermediate of productStarted?.value.consumedIntermediates ?? []) {
      const taken = this.#facilities.takeCachedIntermediate(
        `${operationId}:cache:${intermediate.id}`,
        intermediate.cacheClaimId,
        step.executionId,
        step.stepInstanceId,
        occurredAtUtcMs,
      );
      if (!taken.accepted) {
        return this.#reject(operationId, "DEPENDENCY_REJECTED", `${taken.code}: ${taken.message}`);
      }
    }
    const performance = this.#performance.snapshot(
      character.skills.cooking.level,
      context.definition.durationMs,
      context.definition.qualityWeight,
    );
    const facilityStarted = this.#facilities.startStep(`${operationId}:facility`, step.stepInstanceId, occurredAtUtcMs);
    if (!facilityStarted.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", facilityStarted.message);
    const recipeStarted = this.#recipes.startStep(`${operationId}:recipe`, step.stepInstanceId, occurredAtUtcMs);
    if (!recipeStarted.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", recipeStarted.message);
    const inventoryEvents: DomainEvent[] = [];
    if (step.ingredientInputs.length > 0) {
      const consumed = this.#inventory.consumeReservedStacks(
        `${operationId}:ingredients`,
        step.ingredientReservationId,
        step.ingredientInputs,
        occurredAtUtcMs,
      );
      if (!consumed.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", consumed.message);
      inventoryEvents.push(...consumed.events);
    }
    const taskResult = step.attendance === "unattended"
      ? this.#tasks.completeTask(
          `${operationId}:task-release`,
          step.taskRequest.taskId,
          step.characterId,
          { phase: "automatic-running", stepInstanceId: step.stepInstanceId },
          occurredAtUtcMs,
        )
      : this.#tasks.setTaskInterruptible(
          `${operationId}:task-lock`,
          step.taskRequest.taskId,
          step.characterId,
          false,
          occurredAtUtcMs,
        );
    if (!taskResult.accepted) return this.#reject(operationId, "TASK_REJECTED", taskResult.message);
    const meal = this.#orders.getMeal(step.mealId);
    if (meal?.status === "pending-production") {
      const advanced = this.#orders.advanceMeal(
        `${operationId}:meal`, step.mealId, "in-production", occurredAtUtcMs,
      );
      if (!advanced.accepted) return this.#reject(operationId, "DEPENDENCY_REJECTED", advanced.message);
    }
    return this.#run(operationId, (emit) => {
      for (const event of inventoryEvents) emit(event);
      for (const event of taskResult.events) emit(event);
      const running = cloneStep({
        ...step,
        status: "running",
        performance,
        startedAtUtcMs: occurredAtUtcMs,
        lastAdvancedAtUtcMs: occurredAtUtcMs,
      });
      this.#replaceStep(running);
      emit(this.#event(operationId, "kitchen-step.started", occurredAtUtcMs, {
        stepInstanceId: running.stepInstanceId,
        executionId: running.executionId,
        characterId: running.characterId,
        attendance: running.attendance,
        performance: running.performance,
        consumedIngredients: running.ingredientInputs,
      }, running.stepInstanceId));
      return running;
    });
  }

  advance(
    operationId: string,
    nowUtcMs: number,
  ): KitchenStepExecutionOperationResult<readonly KitchenStepWorkState[]> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    if (!nonNegativeInteger(nowUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Kitchen advance time is invalid.");
    const running = this.#state.steps.filter((entry) => entry.status === "running");
    if (running.length === 0) return this.#unchanged(operationId, Object.freeze([]));
    for (const step of running) {
      if (nowUtcMs < step.lastAdvancedAtUtcMs!) {
        return this.#reject(operationId, "INVALID_REQUEST", "Kitchen advance time cannot move backwards.");
      }
    }
    const changed: KitchenStepWorkState[] = [];
    return this.#run(operationId, (emit) => {
      for (const current of running) {
        const canProgress = current.attendance === "unattended" || this.#chefStillAtWorkstation(current);
        const elapsed = canProgress ? nowUtcMs - current.lastAdvancedAtUtcMs! : 0;
        const progressMs = Math.min(
          current.performance!.effectiveDurationMs,
          current.progressMs + elapsed,
        );
        let updated = cloneStep({
          ...current,
          progressMs,
          lastAdvancedAtUtcMs: nowUtcMs,
        });
        if (progressMs >= current.performance!.effectiveDurationMs) {
          const completedAtUtcMs = current.lastAdvancedAtUtcMs! +
            (current.performance!.effectiveDurationMs - current.progressMs);
          const recipeCompleted = this.#recipes.completeStep(
            `${operationId}:recipe:${current.stepInstanceId}`,
            current.stepInstanceId,
            completedAtUtcMs,
          );
          if (!recipeCompleted.accepted) {
            throw new KitchenStepExecutionRejected("DEPENDENCY_REJECTED", recipeCompleted.message);
          }
          const facilityCompleted = this.#facilities.completeStep(
            `${operationId}:facility:${current.stepInstanceId}`,
            current.stepInstanceId,
            completedAtUtcMs,
          );
          if (!facilityCompleted.accepted) {
            throw new KitchenStepExecutionRejected("DEPENDENCY_REJECTED", facilityCompleted.message);
          }
          if (this.#products !== null) {
            const contributionSteps = [
              ...this.#state.steps.filter((entry) =>
                entry.executionId === current.executionId && entry.status === "completed",
              ),
              current,
            ];
            const productCompleted = this.#products.completeStep(
              `${operationId}:product:${current.stepInstanceId}`,
              {
                stepInstanceId: current.stepInstanceId,
                outputCacheClaim: facilityCompleted.value,
                qualityContributions: contributionSteps.map((entry) => Object.freeze({
                  stepInstanceId: entry.stepInstanceId,
                  cookingLevel: entry.performance!.cookingLevel,
                  qualityWeight: entry.performance!.qualityWeight,
                  weightedQuality: entry.performance!.weightedQuality,
                })),
                occurredAtUtcMs: completedAtUtcMs,
              },
            );
            if (!productCompleted.accepted) {
              throw new KitchenStepExecutionRejected("DEPENDENCY_REJECTED", `${productCompleted.code}: ${productCompleted.message}`);
            }
            if ("plateId" in productCompleted.value) {
              const mealAdvanced = this.#orders.advanceMeal(
                `${operationId}:meal-ready:${current.stepInstanceId}`,
                current.mealId,
                "awaiting-pickup",
                completedAtUtcMs,
              );
              if (!mealAdvanced.accepted) {
                throw new KitchenStepExecutionRejected("DEPENDENCY_REJECTED", mealAdvanced.message);
              }
            }
          }
          if (current.attendance === "required") {
            const taskCompleted = this.#tasks.completeTask(
              `${operationId}:task:${current.stepInstanceId}`,
              current.taskRequest.taskId,
              current.characterId,
              {
                stepInstanceId: current.stepInstanceId,
                cookingLevel: current.performance!.cookingLevel,
                weightedQuality: current.performance!.weightedQuality,
              },
              completedAtUtcMs,
            );
            if (!taskCompleted.accepted) {
              throw new KitchenStepExecutionRejected("TASK_REJECTED", taskCompleted.message);
            }
            for (const event of taskCompleted.events) emit(event);
          }
          updated = cloneStep({ ...updated, status: "completed", completedAtUtcMs: completedAtUtcMs });
          emit(this.#event(operationId, "kitchen-step.completed", completedAtUtcMs, {
            stepInstanceId: updated.stepInstanceId,
            executionId: updated.executionId,
            characterId: updated.characterId,
            performance: updated.performance,
          }, updated.stepInstanceId));
        } else {
          emit(this.#event(operationId, canProgress ? "kitchen-step.progressed" : "kitchen-step.paused", nowUtcMs, {
            stepInstanceId: updated.stepInstanceId,
            progressMs: updated.progressMs,
            effectiveDurationMs: updated.performance!.effectiveDurationMs,
            reason: canProgress ? null : "chef-not-at-workstation",
          }, updated.stepInstanceId));
        }
        this.#replaceStep(updated);
        changed.push(updated);
      }
      this.#createMissingWaitingTasks(`${operationId}:sync`, nowUtcMs, emit);
      return Object.freeze(changed.map(cloneStep));
    });
  }

expireClaims(
    operationId: string,
    nowUtcMs: number,
  ): KitchenStepExecutionOperationResult<readonly KitchenStepWorkState[]> {
    const operationIssue = this.#operationRejection(operationId);
    if (operationIssue !== null) return operationIssue;
    if (!nonNegativeInteger(nowUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen claim expiry time is invalid.");
    }
    const expired = this.#state.steps.filter((step) => {
      if (step.status !== "claimed") return false;
      const binding = this.#facilities.getBinding(step.stepInstanceId);
      return binding !== null && binding.reservationExpiresAtUtcMs < nowUtcMs;
    });
    if (expired.length === 0) return this.#unchanged(operationId, Object.freeze([]));
    for (const step of expired) {
      const released = this.releaseClaim(
        `${operationId}:${step.stepInstanceId}`,
        step.stepInstanceId,
        "reservation-timeout",
        nowUtcMs,
      );
      if (!released.accepted) {
        return this.#reject(operationId, "DEPENDENCY_REJECTED", released.message);
      }
    }
    return this.#run(operationId, (emit) => {
      emit(this.#event(operationId, "kitchen-step.claims-expired", nowUtcMs, {
        stepInstanceIds: expired.map((step) => step.stepInstanceId),
      }, "batch"));
      return Object.freeze(expired.map(cloneStep));
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Kitchen step execution transaction is already active.");
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

#createMissingWaitingTasks(
    operationId: string,
    occurredAtUtcMs: number,
    emit: (event: DomainEvent) => void,
  ): string[] {
    const createdIds: string[] = [];
    const missing = this.createTaskSourceSnapshot().waitingTasks.filter((request) =>
      this.#tasks.getTask(request.taskId) === null,
    );
    for (const [index, request] of missing.entries()) {
      const created = this.#tasks.createTask(`${operationId}:${index}`, request);
      if (!created.accepted) {
        throw new KitchenStepExecutionRejected("TASK_REJECTED", `${created.code}: ${created.message}`);
      }
      for (const event of created.events) emit(event);
      createdIds.push(created.value.taskId);
    }
    if (createdIds.length > 0) {
      emit(this.#event(operationId, "kitchen-step.waiting-tasks-synchronized", occurredAtUtcMs, {
        taskIds: createdIds,
      }, "batch"));
    }
    return createdIds;
  }

  #chefStillAtWorkstation(step: KitchenStepWorkState): boolean {
    const binding = this.#facilities.getBinding(step.stepInstanceId);
    const character = this.#movement.getCharacter(step.characterId);
    return binding?.phase === "running" && character?.status === "arrived" &&
      character.plan?.taskId === step.taskRequest.taskId &&
      character.plan.target.id === binding.facilityId &&
      character.plan.interactionCandidateId === binding.interactionId;
  }

#operationRejection(operationId: string): KitchenStepExecutionOperationResult<never> | null {
    if (!validOperationId(operationId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Kitchen step operation id is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Kitchen step operation was already processed.");
    }
    return null;
  }

  #validateClaimRequest(request: ClaimKitchenStepRequest): string | null {
    return !validId(request.stepInstanceId) ||
      !Number.isFinite(request.speedUnitsPerSecond) || request.speedUnitsPerSecond <= 0 ||
      !nonNegativeInteger(request.occurredAtUtcMs) ||
      !nonNegativeInteger(request.reservationExpiresAtUtcMs) ||
      request.reservationExpiresAtUtcMs <= request.occurredAtUtcMs
      ? "Kitchen step claim request is invalid."
      : null;
  }

  #replaceStep(step: KitchenStepWorkState): void {
    this.#replace({
      steps: this.#state.steps.map((entry) =>
        entry.stepInstanceId === step.stepInstanceId ? step : entry,
      ),
    });
  }

  #run<TValue>(
    operationId: string,
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): KitchenStepExecutionOperationResult<TValue> {
    if (!validOperationId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Kitchen step operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Kitchen step operation was already processed.");
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
    } catch (error: unknown) {
      return error instanceof KitchenStepExecutionRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(
            operationId,
            "DEPENDENCY_REJECTED",
            error instanceof Error ? error.message : "Kitchen step operation failed.",
          );
    }
  }

  #unchanged<TValue>(operationId: string, value: TValue): KitchenStepExecutionOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: false,
      operationId,
      value,
      committedEventIds: Object.freeze([]),
    });
  }

  #replace(update: Partial<KitchenStepExecutionState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(
    operationId: string,
    code: KitchenStepExecutionRejectionCode,
    message: string,
  ): KitchenStepExecutionOperationResult<never> {
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
    discriminator: string,
  ): DomainEvent {
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
    if (this.#state.schemaVersion !== KITCHEN_STEP_EXECUTION_SCHEMA_VERSION ||
      !nonNegativeInteger(this.#state.revision) ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      this.#state.processedOperationIds.some((id) => !validId(id))) {
      throw new Error("Kitchen step execution state header is invalid.");
    }
    const ids = new Set<string>();
    for (const step of this.#state.steps) {
      const context: RecipeExecutionStepContext | null = this.#recipes.getStepContext(step.stepInstanceId);
      if (ids.has(step.stepInstanceId) || context === null || context.execution.id !== step.executionId ||
        context.execution.orderId !== step.orderId || context.execution.mealId !== step.mealId ||
        step.taskRequest.target.id !== step.stepInstanceId ||
        step.taskRequest.taskId !== context.taskRequest.taskId ||
        (step.status !== "claimed" && step.status !== "running" && step.status !== "completed") ||
        !validId(step.ingredientReservationId) || !nonNegativeInteger(step.progressMs) ||
        !nonNegativeInteger(step.claimedAtUtcMs) ||
        (step.status === "claimed" && (step.performance !== null || step.startedAtUtcMs !== null ||
          step.lastAdvancedAtUtcMs !== null || step.completedAtUtcMs !== null || step.progressMs !== 0)) ||
        (step.status !== "claimed" && (step.performance === null ||
          !nonNegativeInteger(step.startedAtUtcMs ?? -1) ||
          !nonNegativeInteger(step.lastAdvancedAtUtcMs ?? -1))) ||
        (step.status === "running" && step.completedAtUtcMs !== null) ||
        (step.status === "completed" && (!nonNegativeInteger(step.completedAtUtcMs ?? -1) ||
          step.progressMs !== step.performance!.effectiveDurationMs)) ||
        (step.performance !== null && (step.progressMs > step.performance.effectiveDurationMs ||
          step.performance.cookingLevel < 1 ||
          !positiveInteger(step.performance.speedMultiplierBasisPoints) ||
          !positiveInteger(step.performance.effectiveDurationMs) ||
          !Number.isFinite(step.performance.qualityWeight) || step.performance.qualityWeight < 0 ||
          !Number.isFinite(step.performance.weightedQuality) || step.performance.weightedQuality < 0))) {
        throw new Error(`Kitchen step execution invariant failed: ${step.stepInstanceId}`);
      }
      if ((step.status === "claimed" && context.step.status !== "ready") ||
        (step.status === "running" && context.step.status !== "in-progress") ||
        (step.status === "completed" && context.step.status !== "completed")) {
        throw new Error(`Kitchen step authority mismatch: ${step.stepInstanceId}`);
      }
      ids.add(step.stepInstanceId);
    }
  }
}

