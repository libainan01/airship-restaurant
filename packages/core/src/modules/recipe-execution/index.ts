import type {
  DomainEvent,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { OrderState } from "../order";
import {
  createStableTaskKey,
  type TaskRequest,
  type TaskSourceSnapshot,
} from "../task";

export const RECIPE_EXECUTION_MODULE_ID = "module.recipe-execution";
export const RECIPE_EXECUTION_SCHEMA_VERSION = 1;

export type RecipeStepAttendance = "required" | "unattended";
export type RecipeExecutionStatus = "active" | "completed";
export type RecipeExecutionStepStatus =
  | "locked"
  | "ready"
  | "in-progress"
  | "blocked"
  | "completed";

export interface RecipeIngredientDefinition {
  readonly itemId: string;
  readonly quantity: number;
}

export interface RecipeExecutionStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly requiredCapabilityIds: readonly string[];
  readonly attendance: RecipeStepAttendance;
  readonly prerequisiteStepIds: readonly string[];
  readonly ingredientInputs: readonly RecipeIngredientDefinition[];
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly qualityWeight: number;
}

export interface RecipeExecutionDefinition {
  readonly id: string;
  readonly version: number;
  readonly outputItemId: string;
  readonly ingredients: readonly RecipeIngredientDefinition[];
  readonly steps: readonly RecipeExecutionStepDefinition[];
}

export interface RecipeExecutionCatalogPort {
  getRecipe(recipeId: string): RecipeExecutionDefinition | null;
}

export interface RecipeExecutionStepState {
  readonly id: string;
  readonly definitionStepId: string;
  readonly status: RecipeExecutionStepStatus;
  readonly blockedReason: string | null;
  readonly readyAtUtcMs: number | null;
  readonly startedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
}

export interface RecipeExecutionState {
  readonly id: string;
  readonly orderId: string;
  readonly orderLineId: string;
  readonly mealId: string;
  readonly recipe: RecipeExecutionDefinition;
  readonly status: RecipeExecutionStatus;
  readonly steps: readonly RecipeExecutionStepState[];
  readonly createdAtUtcMs: number;
  readonly completedAtUtcMs: number | null;
}

export interface RecipeExecutionModuleState {
  readonly schemaVersion: typeof RECIPE_EXECUTION_SCHEMA_VERSION;
  readonly revision: number;
  readonly executions: readonly RecipeExecutionState[];
  readonly processedOperationIds: readonly string[];
}

export interface RecipeExecutionStepContext {
  readonly execution: RecipeExecutionState;
  readonly step: RecipeExecutionStepState;
  readonly definition: RecipeExecutionStepDefinition;
  readonly taskRequest: TaskRequest;
}

export interface RecipeExecutionReadModel {
  readonly revision: number;
  readonly active: readonly RecipeExecutionState[];
  readonly completed: readonly RecipeExecutionState[];
  readonly readyStepCount: number;
  readonly blockedStepCount: number;
}

export type RecipeExecutionRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_EXECUTION"
  | "UNKNOWN_RECIPE"
  | "UNKNOWN_EXECUTION"
  | "UNKNOWN_STEP"
  | "STEP_NOT_READY"
  | "STEP_NOT_IN_PROGRESS"
  | "STEP_NOT_BLOCKED";

export type RecipeExecutionOperationResult<TValue> =
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
      readonly code: RecipeExecutionRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;

class RecipeExecutionRejected extends Error {
  constructor(readonly code: RecipeExecutionRejectionCode, message: string) {
    super(message);
  }
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

export function createRecipeExecutionStepId(
  mealId: string,
  definitionStepId: string,
): string {
  if (mealId.trim().length === 0 || definitionStepId.trim().length === 0) {
    throw new TypeError("Recipe execution step identity parts must not be empty.");
  }
  return `recipe-step.${stableHash(`${mealId}\u0000${definitionStepId}`)}`;
}
function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 300;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validUniqueIds(values: readonly string[]): boolean {
  return values.every(validId) && new Set(values).size === values.length;
}

function cloneIngredient(value: RecipeIngredientDefinition): RecipeIngredientDefinition {
  return Object.freeze({ ...value });
}

function cloneStepDefinition(
  value: RecipeExecutionStepDefinition,
): RecipeExecutionStepDefinition {
  return Object.freeze({
    ...value,
    requiredCapabilityIds: Object.freeze([...value.requiredCapabilityIds]),
    prerequisiteStepIds: Object.freeze([...value.prerequisiteStepIds]),
    ingredientInputs: Object.freeze(value.ingredientInputs.map(cloneIngredient)),
  });
}

function cloneRecipe(value: RecipeExecutionDefinition): RecipeExecutionDefinition {
  return Object.freeze({
    ...value,
    ingredients: Object.freeze(value.ingredients.map(cloneIngredient)),
    steps: Object.freeze(value.steps.map(cloneStepDefinition)),
  });
}

function cloneExecution(value: RecipeExecutionState): RecipeExecutionState {
  return Object.freeze({
    ...value,
    recipe: cloneRecipe(value.recipe),
    steps: Object.freeze(value.steps.map((step) => Object.freeze({ ...step }))),
  });
}

function cloneState(state: RecipeExecutionModuleState): RecipeExecutionModuleState {
  return Object.freeze({
    ...state,
    executions: Object.freeze(state.executions.map(cloneExecution)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function validateRecipeDefinition(recipe: RecipeExecutionDefinition): void {
  if (!validId(recipe.id) || !positiveInteger(recipe.version) || !validId(recipe.outputItemId) ||
    recipe.ingredients.length === 0 || recipe.steps.length === 0) {
    throw new Error(`Recipe execution definition is invalid: ${recipe.id}`);
  }
  const ingredientIds = new Set<string>();
  for (const ingredient of recipe.ingredients) {
    if (!validId(ingredient.itemId) || !positiveInteger(ingredient.quantity) ||
      ingredientIds.has(ingredient.itemId)) {
      throw new Error(`Recipe ingredient is invalid or duplicated: ${recipe.id}/${ingredient.itemId}`);
    }
    ingredientIds.add(ingredient.itemId);
  }
  const stepIds = new Set<string>();
  const outputItemIds = new Set<string>();
  for (const step of recipe.steps) {
    if (!validId(step.id) || stepIds.has(step.id) || step.name.trim().length === 0 ||
      !positiveInteger(step.durationMs) || !validUniqueIds(step.requiredCapabilityIds) ||
      step.requiredCapabilityIds.length === 0 ||
      (step.attendance !== "required" && step.attendance !== "unattended") ||
      !validUniqueIds(step.prerequisiteStepIds) || !validId(step.outputItemId) ||
      outputItemIds.has(step.outputItemId) || !positiveInteger(step.outputQuantity) ||
      !Number.isFinite(step.qualityWeight) || step.qualityWeight < 0) {
      throw new Error(`Recipe step is invalid or duplicated: ${recipe.id}/${step.id}`);
    }
    stepIds.add(step.id);
    outputItemIds.add(step.outputItemId);
    const inputIds = new Set<string>();
    for (const input of step.ingredientInputs) {
      if (!ingredientIds.has(input.itemId) || !positiveInteger(input.quantity) ||
        inputIds.has(input.itemId)) {
        throw new Error(`Recipe step ingredient is invalid: ${recipe.id}/${step.id}/${input.itemId}`);
      }
      inputIds.add(input.itemId);
    }
  }
  const outgoingCounts = new Map(recipe.steps.map((step) => [step.id, 0]));
  const inDegree = new Map(recipe.steps.map((step) => [step.id, 0]));
  const dependents = new Map(recipe.steps.map((step) => [step.id, [] as string[]]));
  for (const step of recipe.steps) {
    for (const prerequisiteId of step.prerequisiteStepIds) {
      if (!stepIds.has(prerequisiteId) || prerequisiteId === step.id) {
        throw new Error(`Recipe step prerequisite is invalid: ${recipe.id}/${step.id}/${prerequisiteId}`);
      }
      outgoingCounts.set(prerequisiteId, outgoingCounts.get(prerequisiteId)! + 1);
      inDegree.set(step.id, inDegree.get(step.id)! + 1);
      dependents.get(prerequisiteId)!.push(step.id);
    }
  }
  const queue = recipe.steps.filter((step) => inDegree.get(step.id) === 0).map((step) => step.id);
  let visited = 0;
  while (queue.length > 0) {
    const stepId = queue.shift()!;
    visited += 1;
    for (const dependentId of dependents.get(stepId)!) {
      const remaining = inDegree.get(dependentId)! - 1;
      inDegree.set(dependentId, remaining);
      if (remaining === 0) queue.push(dependentId);
    }
  }
  if (visited !== recipe.steps.length) throw new Error(`Recipe step graph contains a cycle: ${recipe.id}`);
  const sinks = recipe.steps.filter((step) => outgoingCounts.get(step.id) === 0);
  if (sinks.length !== 1 || sinks[0]!.outputItemId !== recipe.outputItemId) {
    throw new Error(`Recipe must have one final output step: ${recipe.id}`);
  }
  const stepIngredientTotals = new Map<string, number>();
  for (const input of recipe.steps.flatMap((step) => step.ingredientInputs)) {
    stepIngredientTotals.set(input.itemId, (stepIngredientTotals.get(input.itemId) ?? 0) + input.quantity);
  }
  for (const ingredient of recipe.ingredients) {
    if (stepIngredientTotals.get(ingredient.itemId) !== ingredient.quantity) {
      throw new Error(`Recipe step inputs do not match recipe ingredients: ${recipe.id}/${ingredient.itemId}`);
    }
  }
}

export class StaticRecipeExecutionCatalog implements RecipeExecutionCatalogPort {
  readonly #recipes = new Map<string, RecipeExecutionDefinition>();

  constructor(recipes: readonly RecipeExecutionDefinition[]) {
    if (recipes.length === 0) throw new Error("Recipe execution catalog must not be empty.");
    for (const recipe of recipes) {
      validateRecipeDefinition(recipe);
      if (this.#recipes.has(recipe.id)) throw new Error(`Duplicate recipe execution definition: ${recipe.id}`);
      this.#recipes.set(recipe.id, cloneRecipe(recipe));
    }
  }

  getRecipe(recipeId: string): RecipeExecutionDefinition | null {
    const recipe = this.#recipes.get(recipeId);
    return recipe === undefined ? null : cloneRecipe(recipe);
  }
}

export class RecipeExecutionModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = RECIPE_EXECUTION_MODULE_ID;
  readonly transactionParticipantId = RECIPE_EXECUTION_MODULE_ID;
  readonly #catalog: RecipeExecutionCatalogPort;
  readonly #transaction: TransactionScope;
  #state: RecipeExecutionModuleState;
  #transactionActive = false;

  constructor(options: {
    readonly catalog: RecipeExecutionCatalogPort;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: RecipeExecutionModuleState;
  }) {
    this.#catalog = options.catalog;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: RECIPE_EXECUTION_SCHEMA_VERSION,
          revision: 0,
          executions: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): RecipeExecutionModuleState {
    return cloneState(this.#state);
  }

  getExecution(executionId: string): RecipeExecutionState | null {
    const execution = this.#state.executions.find((entry) => entry.id === executionId);
    return execution === undefined ? null : cloneExecution(execution);
  }

  getExecutionForMeal(mealId: string): RecipeExecutionState | null {
    const execution = this.#state.executions.find((entry) => entry.mealId === mealId);
    return execution === undefined ? null : cloneExecution(execution);
  }

getStepContext(stepInstanceId: string): RecipeExecutionStepContext | null {
    const located = this.#findStep(stepInstanceId);
    if (located === null) return null;
    const execution = cloneExecution(located.execution);
    const step = execution.steps.find((entry) => entry.id === stepInstanceId)!;
    const definition = execution.recipe.steps.find((entry) => entry.id === step.definitionStepId)!;
    return Object.freeze({
      execution,
      step,
      definition,
      taskRequest: this.#taskRequest(execution, step),
    });
  }

  createReadModel(): RecipeExecutionReadModel {
    const active = this.#state.executions.filter((execution) => execution.status === "active");
    const completed = this.#state.executions.filter((execution) => execution.status === "completed");
    return Object.freeze({
      revision: this.#state.revision,
      active: Object.freeze(active.map(cloneExecution)),
      completed: Object.freeze(completed.map(cloneExecution)),
      readyStepCount: active.flatMap((execution) => execution.steps)
        .filter((step) => step.status === "ready").length,
      blockedStepCount: active.flatMap((execution) => execution.steps)
        .filter((step) => step.status === "blocked").length,
    });
  }

  createExecutionsForOrder(
    operationId: string,
    order: OrderState,
    occurredAtUtcMs: number,
  ): RecipeExecutionOperationResult<readonly RecipeExecutionState[]> {
    const existing = this.#state.executions.filter((execution) => execution.orderId === order.id);
    if (existing.length === order.meals.length && order.meals.every((meal) =>
      existing.some((execution) => execution.mealId === meal.id),
    )) {
      return this.#unchanged(operationId, Object.freeze(existing.map(cloneExecution)));
    }
    return this.#run(operationId, (emit) => {
      if (!validId(order.id) || order.status === "settled" || order.meals.length === 0 ||
        !nonNegativeInteger(occurredAtUtcMs)) {
        throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe execution order request is invalid.");
      }
      if (existing.length > 0 || order.meals.some((meal) =>
        this.#state.executions.some((execution) => execution.mealId === meal.id),
      )) {
        throw new RecipeExecutionRejected(
          "DUPLICATE_EXECUTION",
          `Order already has a partial recipe execution set: ${order.id}`,
        );
      }
      const created: RecipeExecutionState[] = [];
      for (const meal of order.meals) {
        const recipe = this.#catalog.getRecipe(meal.recipeId);
        if (recipe === null) {
          throw new RecipeExecutionRejected("UNKNOWN_RECIPE", `Unknown execution recipe: ${meal.recipeId}`);
        }
        validateRecipeDefinition(recipe);
        const executionId = meal.id;
        const steps = recipe.steps.map((definition): RecipeExecutionStepState => {
          const ready = definition.prerequisiteStepIds.length === 0;
          return Object.freeze({
            id: createRecipeExecutionStepId(executionId, definition.id),
            definitionStepId: definition.id,
            status: ready ? "ready" : "locked",
            blockedReason: null,
            readyAtUtcMs: ready ? occurredAtUtcMs : null,
            startedAtUtcMs: null,
            completedAtUtcMs: null,
          });
        });
        const execution = cloneExecution({
          id: executionId,
          orderId: order.id,
          orderLineId: meal.lineId,
          mealId: meal.id,
          recipe,
          status: "active",
          steps,
          createdAtUtcMs: occurredAtUtcMs,
          completedAtUtcMs: null,
        });
        created.push(execution);
        emit(this.#event(operationId, "recipe.execution-created", occurredAtUtcMs, execution, execution.id));
        for (const step of steps.filter((entry) => entry.status === "ready")) {
          emit(this.#stepEvent(operationId, "recipe.step-ready", execution, step, occurredAtUtcMs));
        }
      }
      this.#replace({ executions: [...this.#state.executions, ...created] });
      emit(this.#event(operationId, "recipe.order-executions-created", occurredAtUtcMs, {
        orderId: order.id,
        executionIds: created.map((execution) => execution.id),
      }, order.id));
      return Object.freeze(created.map(cloneExecution));
    });
  }

  startStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): RecipeExecutionOperationResult<RecipeExecutionState> {
    return this.#run(operationId, (emit) => {
      const located = this.#requireStep(stepInstanceId);
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < located.step.readyAtUtcMs!) {
        throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe step start time is invalid.");
      }
      if (located.step.status !== "ready") {
        throw new RecipeExecutionRejected("STEP_NOT_READY", `Recipe step is not ready: ${stepInstanceId}`);
      }
      const step = Object.freeze({
        ...located.step,
        status: "in-progress" as const,
        startedAtUtcMs: occurredAtUtcMs,
      });
      const execution = this.#replaceStep(located.execution, step);
      emit(this.#stepEvent(operationId, "recipe.step-started", execution, step, occurredAtUtcMs));
      return execution;
    });
  }

  blockStep(
    operationId: string,
    stepInstanceId: string,
    reason: string,
    occurredAtUtcMs: number,
  ): RecipeExecutionOperationResult<RecipeExecutionState> {
    const current = this.#findStep(stepInstanceId);
    if (current?.step.status === "blocked" && current.step.blockedReason === reason) {
      return this.#unchanged(operationId, cloneExecution(current.execution));
    }
    return this.#run(operationId, (emit) => {
      const located = this.#requireStep(stepInstanceId);
      if (!validId(reason) || reason.length > 500 || !nonNegativeInteger(occurredAtUtcMs) ||
        occurredAtUtcMs < located.step.readyAtUtcMs!) {
        throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe step block request is invalid.");
      }
      if (located.step.status !== "ready") {
        throw new RecipeExecutionRejected("STEP_NOT_READY", "Only a ready recipe step can become blocked.");
      }
      const step = Object.freeze({
        ...located.step,
        status: "blocked" as const,
        blockedReason: reason,
      });
      const execution = this.#replaceStep(located.execution, step);
      emit(this.#stepEvent(operationId, "recipe.step-blocked", execution, step, occurredAtUtcMs));
      return execution;
    });
  }

  restoreStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): RecipeExecutionOperationResult<RecipeExecutionState> {
    return this.#run(operationId, (emit) => {
      const located = this.#requireStep(stepInstanceId);
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < located.step.readyAtUtcMs!) {
        throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe step restore time is invalid.");
      }
      if (located.step.status !== "blocked") {
        throw new RecipeExecutionRejected("STEP_NOT_BLOCKED", "Only a blocked recipe step can be restored.");
      }
      const step = Object.freeze({
        ...located.step,
        status: "ready" as const,
        blockedReason: null,
        readyAtUtcMs: occurredAtUtcMs,
      });
      const execution = this.#replaceStep(located.execution, step);
      emit(this.#stepEvent(operationId, "recipe.step-restored", execution, step, occurredAtUtcMs));
      emit(this.#stepEvent(operationId, "recipe.step-ready", execution, step, occurredAtUtcMs));
      return execution;
    });
  }

  completeStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): RecipeExecutionOperationResult<RecipeExecutionState> {
    return this.#run(operationId, (emit) => {
      const located = this.#requireStep(stepInstanceId);
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < located.step.startedAtUtcMs!) {
        throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe step completion time is invalid.");
      }
      if (located.step.status !== "in-progress") {
        throw new RecipeExecutionRejected(
          "STEP_NOT_IN_PROGRESS",
          `Recipe step is not in progress: ${stepInstanceId}`,
        );
      }
      const completedStep = Object.freeze({
        ...located.step,
        status: "completed" as const,
        completedAtUtcMs: occurredAtUtcMs,
      });
      let steps = located.execution.steps.map((step) =>
        step.id === completedStep.id ? completedStep : step,
      );
      emit(this.#stepEvent(
        operationId,
        "recipe.step-completed",
        located.execution,
        completedStep,
        occurredAtUtcMs,
      ));
      const newlyReady: RecipeExecutionStepState[] = [];
      for (const step of steps) {
        if (step.status !== "locked") continue;
        const definition = located.execution.recipe.steps.find(
          (entry) => entry.id === step.definitionStepId,
        )!;
        const allCompleted = definition.prerequisiteStepIds.every((prerequisiteId) =>
          steps.some((candidate) => candidate.definitionStepId === prerequisiteId &&
            candidate.status === "completed"),
        );
        if (!allCompleted) continue;
        const ready = Object.freeze({
          ...step,
          status: "ready" as const,
          readyAtUtcMs: occurredAtUtcMs,
        });
        steps = steps.map((candidate) => candidate.id === ready.id ? ready : candidate);
        newlyReady.push(ready);
      }
      const completed = steps.every((step) => step.status === "completed");
      const execution = cloneExecution({
        ...located.execution,
        steps,
        status: completed ? "completed" : "active",
        completedAtUtcMs: completed ? occurredAtUtcMs : null,
      });
      this.#replaceExecution(execution);
      for (const step of newlyReady) {
        emit(this.#stepEvent(operationId, "recipe.step-ready", execution, step, occurredAtUtcMs));
      }
      if (completed) {
        emit(this.#event(operationId, "recipe.execution-completed", occurredAtUtcMs, {
          executionId: execution.id,
          orderId: execution.orderId,
          orderLineId: execution.orderLineId,
          mealId: execution.mealId,
          recipeId: execution.recipe.id,
          recipeVersion: execution.recipe.version,
        }, execution.id));
      }
      return execution;
    });
  }

  createTaskSourceSnapshot(): TaskSourceSnapshot {
    const waitingTasks = this.#state.executions.flatMap((execution) =>
      execution.steps
        .filter((step) => step.status === "ready")
        .map((step) => this.#taskRequest(execution, step)),
    );
    return Object.freeze({
      sourceId: "source.recipe-execution",
      sourceRevision: this.#state.revision,
      waitingTasks: Object.freeze(waitingTasks),
      activeTasks: Object.freeze([]),
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Recipe execution transaction is already active.");
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

  #taskRequest(execution: RecipeExecutionState, step: RecipeExecutionStepState): TaskRequest {
    return Object.freeze({
      taskId: createStableTaskKey({
        sourceType: "recipe-execution",
        sourceId: `execution.${stableHash(execution.id)}`,
        taskType: "kitchen.recipe-step",
        targetType: "recipe-step",
        targetId: step.id,
        discriminator: stableHash(step.definitionStepId),
      }),
      taskType: "kitchen.recipe-step",
      source: Object.freeze({ type: "recipe-execution", id: execution.id }),
      target: Object.freeze({ type: "recipe-step", id: step.id }),
      basePriority: 300,
      requiredTags: Object.freeze(["employee"]),
      eligibleJobIds: Object.freeze(["job.chef"]),
      requiredSkills: Object.freeze([]),
      urgency: 0,
      urgent: false,
      interruptible: true,
      createdAtUtcMs: step.readyAtUtcMs ?? execution.createdAtUtcMs,
    });
  }

  #findStep(
    stepInstanceId: string,
  ): { readonly execution: RecipeExecutionState; readonly step: RecipeExecutionStepState } | null {
    for (const execution of this.#state.executions) {
      const step = execution.steps.find((entry) => entry.id === stepInstanceId);
      if (step !== undefined) return { execution, step };
    }
    return null;
  }

  #requireStep(
    stepInstanceId: string,
  ): { readonly execution: RecipeExecutionState; readonly step: RecipeExecutionStepState } {
    if (!validId(stepInstanceId)) {
      throw new RecipeExecutionRejected("INVALID_REQUEST", "Recipe step id is invalid.");
    }
    const located = this.#findStep(stepInstanceId);
    if (located === null) {
      throw new RecipeExecutionRejected("UNKNOWN_STEP", `Unknown recipe step: ${stepInstanceId}`);
    }
    return located;
  }

  #replaceStep(
    execution: RecipeExecutionState,
    step: RecipeExecutionStepState,
  ): RecipeExecutionState {
    const updated = cloneExecution({
      ...execution,
      steps: execution.steps.map((entry) => entry.id === step.id ? step : entry),
    });
    this.#replaceExecution(updated);
    return updated;
  }

  #replaceExecution(execution: RecipeExecutionState): void {
    this.#replace({
      executions: this.#state.executions.map((entry) =>
        entry.id === execution.id ? execution : entry,
      ),
    });
  }

  #run<TValue>(
    operationId: string,
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): RecipeExecutionOperationResult<TValue> {
    if (!validId(operationId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Recipe execution operation id is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Recipe execution operation was already processed.");
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
      return error instanceof RecipeExecutionRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(
            operationId,
            "INVALID_REQUEST",
            error instanceof Error ? error.message : "Recipe execution operation failed.",
          );
    }
  }

  #unchanged<TValue>(
    operationId: string,
    value: TValue,
  ): RecipeExecutionOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: false,
      operationId,
      value,
      committedEventIds: Object.freeze([]),
    });
  }

  #replace(update: Partial<RecipeExecutionModuleState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(
    operationId: string,
    code: RecipeExecutionRejectionCode,
    message: string,
  ): RecipeExecutionOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      committedEventIds: [] as const,
    });
  }

  #stepEvent(
    operationId: string,
    type: string,
    execution: RecipeExecutionState,
    step: RecipeExecutionStepState,
    occurredAtUtcMs: number,
  ): DomainEvent {
    return this.#event(operationId, type, occurredAtUtcMs, {
      executionId: execution.id,
      orderId: execution.orderId,
      orderLineId: execution.orderLineId,
      mealId: execution.mealId,
      recipeId: execution.recipe.id,
      recipeVersion: execution.recipe.version,
      stepId: step.id,
      definitionStepId: step.definitionStepId,
      status: step.status,
      blockedReason: step.blockedReason,
    }, `${step.id}:${type}:${operationId}`);
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
    if (this.#state.schemaVersion !== RECIPE_EXECUTION_SCHEMA_VERSION ||
      !nonNegativeInteger(this.#state.revision)) {
      throw new Error("Recipe execution state header is invalid.");
    }
    const executionIds = new Set<string>();
    const mealIds = new Set<string>();
    const stepIds = new Set<string>();
    for (const execution of this.#state.executions) {
      validateRecipeDefinition(execution.recipe);
      if (!validId(execution.id) || executionIds.has(execution.id) || mealIds.has(execution.mealId) ||
        !validId(execution.orderId) || !validId(execution.orderLineId) || !validId(execution.mealId) ||
        execution.id !== execution.mealId || !nonNegativeInteger(execution.createdAtUtcMs) ||
        execution.steps.length !== execution.recipe.steps.length) {
        throw new Error(`Recipe execution invariant failed: ${execution.id}`);
      }
      executionIds.add(execution.id);
      mealIds.add(execution.mealId);
      const statesByDefinition = new Map(execution.steps.map((step) => [step.definitionStepId, step]));
      for (const definition of execution.recipe.steps) {
        const step = statesByDefinition.get(definition.id);
        if (step === undefined || !validId(step.id) || stepIds.has(step.id) ||
          step.id !== createRecipeExecutionStepId(execution.id, definition.id) ||
          (step.status !== "locked" && step.status !== "ready" && step.status !== "in-progress" &&
            step.status !== "blocked" && step.status !== "completed") ||
          (step.blockedReason !== null && (step.blockedReason.length === 0 || step.blockedReason.length > 500))) {
          throw new Error(`Recipe execution step invariant failed: ${execution.id}/${definition.id}`);
        }
        stepIds.add(step.id);
        const dependenciesCompleted = definition.prerequisiteStepIds.every((prerequisiteId) =>
          statesByDefinition.get(prerequisiteId)?.status === "completed",
        );
        if ((step.status === "locked") === dependenciesCompleted ||
          (step.status === "locked" && step.readyAtUtcMs !== null) ||
          (step.status !== "locked" && !nonNegativeInteger(step.readyAtUtcMs ?? -1)) ||
          (step.status === "in-progress" && !nonNegativeInteger(step.startedAtUtcMs ?? -1)) ||
          (step.status !== "in-progress" && step.status !== "completed" && step.startedAtUtcMs !== null) ||
          (step.status === "completed" && (!nonNegativeInteger(step.startedAtUtcMs ?? -1) ||
            !nonNegativeInteger(step.completedAtUtcMs ?? -1) ||
            step.completedAtUtcMs! < step.startedAtUtcMs!)) ||
          (step.readyAtUtcMs !== null && step.readyAtUtcMs < execution.createdAtUtcMs) ||
          (step.startedAtUtcMs !== null && step.readyAtUtcMs !== null &&
            step.startedAtUtcMs < step.readyAtUtcMs) ||
          (step.status !== "completed" && step.completedAtUtcMs !== null) ||
          (step.status === "blocked" ? step.blockedReason === null : step.blockedReason !== null)) {
          throw new Error(`Recipe execution step lifecycle invariant failed: ${step.id}`);
        }
      }
      const allCompleted = execution.steps.every((step) => step.status === "completed");
      if ((execution.status === "completed") !== allCompleted ||
        (execution.status === "completed" ? !nonNegativeInteger(execution.completedAtUtcMs ?? -1)
          : execution.completedAtUtcMs !== null)) {
        throw new Error(`Recipe execution aggregate status invariant failed: ${execution.id}`);
      }
    }
    if (new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      this.#state.processedOperationIds.some((id) => !validId(id))) {
      throw new Error("Recipe execution processed operation ids are invalid.");
    }
  }
}
