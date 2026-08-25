import {
  InventorySystem,
  type ItemStack,
} from "./inventory-system";

const OPERATION_HISTORY_LIMIT = 512;
const IDENTIFIER_MAX_LENGTH = 128;

export interface CookingRecipe {
  readonly id: string;
  readonly durationMs: number;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly ingredients: readonly ItemStack[];
}

export type CookingJobStatus = "cooking" | "waiting-output";
export type CookingBlockReason =
  | "insufficient-ingredients"
  | "output-capacity";

export interface CookingJobSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly status: CookingJobStatus;
  readonly startedAtUtcMs: number;
  readonly finishAtUtcMs: number;
}

export interface CookingSnapshot {
  readonly selectedRecipeId: string | null;
  readonly autoRepeat: boolean;
  readonly activeJob: CookingJobSnapshot | null;
  readonly blockedReason: CookingBlockReason | null;
  readonly completedBatches: number;
  readonly nextTransitionUtcMs: number | null;
}

export type CookingEvent =
  | {
      readonly type: "cooking.started";
      readonly job: CookingJobSnapshot;
      readonly automatic: boolean;
    }
  | {
      readonly type: "cooking.completed";
      readonly jobId: string;
      readonly recipeId: string;
      readonly outputItemId: string;
      readonly outputQuantity: number;
      readonly completedAtUtcMs: number;
    }
  | {
      readonly type: "cooking.blocked";
      readonly recipeId: string;
      readonly reason: CookingBlockReason;
      readonly atUtcMs: number;
    };

export type CookingRejectionCode =
  | "INVALID_OPERATION_ID"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_RECIPE"
  | "NO_RECIPE_SELECTED"
  | "ALREADY_COOKING"
  | "INSUFFICIENT_INGREDIENTS"
  | "OUTPUT_CAPACITY_EXCEEDED";

interface CookingActionBase {
  readonly operationId: string;
  readonly snapshot: CookingSnapshot;
  readonly events: readonly CookingEvent[];
}

export interface AcceptedCookingAction extends CookingActionBase {
  readonly accepted: true;
}

export interface RejectedCookingAction extends CookingActionBase {
  readonly accepted: false;
  readonly code: CookingRejectionCode;
  readonly message: string;
}

export type CookingActionResult =
  | AcceptedCookingAction
  | RejectedCookingAction;

export interface CookingAdvanceResult {
  readonly snapshot: CookingSnapshot;
  readonly events: readonly CookingEvent[];
}

export interface CookingSystemState {
  readonly selectedRecipeId: string | null;
  readonly autoRepeat: boolean;
  readonly activeJob: {
    readonly id: string;
    readonly recipeId: string;
    readonly reservationId: string;
    readonly startedAtUtcMs: number;
    readonly finishAtUtcMs: number;
    readonly completionAttempt: number;
    readonly status: CookingJobStatus;
  } | null;
  readonly blockedReason: CookingBlockReason | null;
  readonly completedBatches: number;
  readonly jobSequence: number;
  readonly automaticAttemptSequence: number;
}

export interface CookingSystemOptions {
  readonly inventory: InventorySystem;
  readonly recipes: readonly CookingRecipe[];
  readonly ingredientContainerId: string;
  readonly outputContainerId: string;
  readonly autoRepeatInitially?: boolean;
  readonly initialState?: CookingSystemState;
}

interface ActiveCookingJob {
  readonly id: string;
  readonly recipeId: string;
  readonly reservationId: string;
  readonly startedAtUtcMs: number;
  readonly finishAtUtcMs: number;
  readonly completionAttempt: number;
  readonly status: CookingJobStatus;
}

function isValidIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= IDENTIFIER_MAX_LENGTH;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertUtcMs(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "Cooking UTC time must be a non-negative safe integer.",
    );
  }
}

function freezeEvents(
  events: readonly CookingEvent[],
): readonly CookingEvent[] {
  return Object.freeze([...events]);
}

export class CookingSystem {
  readonly #inventory: InventorySystem;
  readonly #recipes = new Map<string, CookingRecipe>();
  readonly #ingredientContainerId: string;
  readonly #outputContainerId: string;
  readonly #processedOperationIds = new Set<string>();
  readonly #operationHistory: string[] = [];
  #selectedRecipeId: string | null = null;
  #autoRepeat: boolean;
  #activeJob: ActiveCookingJob | null = null;
  #blockedReason: CookingBlockReason | null = null;
  #completedBatches = 0;
  #jobSequence = 0;
  #automaticAttemptSequence = 0;
  #lastAutoAttemptSignature: string | null = null;
  #lastCompletionAttemptSignature: string | null = null;
  #durationScale = 1;

  constructor(options: CookingSystemOptions) {
    this.#inventory = options.inventory;
    this.#ingredientContainerId = options.ingredientContainerId;
    this.#outputContainerId = options.outputContainerId;
    this.#autoRepeat = options.autoRepeatInitially ?? true;

    if (options.recipes.length === 0) {
      throw new Error("CookingSystem requires at least one recipe.");
    }
    for (const recipe of options.recipes) {
      if (
        !isValidIdentifier(recipe.id) ||
        !isValidIdentifier(recipe.outputItemId) ||
        !isPositiveInteger(recipe.durationMs) ||
        !isPositiveInteger(recipe.outputQuantity) ||
        recipe.ingredients.length === 0 ||
        this.#recipes.has(recipe.id)
      ) {
        throw new Error(`Invalid cooking recipe: ${recipe.id}`);
      }
      this.#recipes.set(recipe.id, Object.freeze({
        ...recipe,
        ingredients: Object.freeze(
          recipe.ingredients.map((ingredient) =>
            Object.freeze({ ...ingredient }),
          ),
        ),
      }));
    }

    // Fail fast if composition references missing containers.
    this.#inventory.getContainerSnapshot(this.#ingredientContainerId);
    this.#inventory.getContainerSnapshot(this.#outputContainerId);

    if (options.initialState !== undefined) {
      this.#restoreState(options.initialState);
    }
  }

  setDurationScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
      throw new RangeError("Cooking duration scale must be in the range (0, 1].");
    }
    this.#durationScale = scale;
  }
  getSnapshot(): CookingSnapshot {
    const activeJob =
      this.#activeJob === null
        ? null
        : Object.freeze({
            id: this.#activeJob.id,
            recipeId: this.#activeJob.recipeId,
            status: this.#activeJob.status,
            startedAtUtcMs: this.#activeJob.startedAtUtcMs,
            finishAtUtcMs: this.#activeJob.finishAtUtcMs,
          });

    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      autoRepeat: this.#autoRepeat,
      activeJob,
      blockedReason: this.#blockedReason,
      completedBatches: this.#completedBatches,
      nextTransitionUtcMs:
        activeJob?.status === "cooking"
          ? activeJob.finishAtUtcMs
          : null,
    });
  }

  exportState(): CookingSystemState {
    return Object.freeze({
      selectedRecipeId: this.#selectedRecipeId,
      autoRepeat: this.#autoRepeat,
      activeJob:
        this.#activeJob === null
          ? null
          : Object.freeze({ ...this.#activeJob }),
      blockedReason: this.#blockedReason,
      completedBatches: this.#completedBatches,
      jobSequence: this.#jobSequence,
      automaticAttemptSequence: this.#automaticAttemptSequence,
    });
  }

  selectRecipe(
    operationId: string,
    recipeId: string,
  ): CookingActionResult {
    const duplicate = this.#prepareOperation(operationId);
    if (duplicate !== null) {
      return duplicate;
    }
    if (!this.#recipes.has(recipeId)) {
      return this.#reject(
        operationId,
        "UNKNOWN_RECIPE",
        `Unknown recipe: ${recipeId}`,
      );
    }

    this.#selectedRecipeId = recipeId;
    this.#lastAutoAttemptSignature = null;
    this.#blockedReason = null;
    return this.#accept(operationId, []);
  }

  setAutoRepeat(
    operationId: string,
    enabled: boolean,
  ): CookingActionResult {
    const duplicate = this.#prepareOperation(operationId);
    if (duplicate !== null) {
      return duplicate;
    }

    this.#autoRepeat = enabled;
    this.#lastAutoAttemptSignature = null;
    if (!enabled && this.#activeJob === null) {
      this.#blockedReason = null;
    }
    return this.#accept(operationId, []);
  }

  startBatch(
    operationId: string,
    nowUtcMs: number,
  ): CookingActionResult {
    assertUtcMs(nowUtcMs);
    const duplicate = this.#prepareOperation(operationId);
    if (duplicate !== null) {
      return duplicate;
    }
    if (this.#activeJob !== null) {
      return this.#reject(
        operationId,
        "ALREADY_COOKING",
        "The kitchen already has an active cooking job.",
      );
    }
    if (this.#selectedRecipeId === null) {
      return this.#reject(
        operationId,
        "NO_RECIPE_SELECTED",
        "Select a recipe before starting a batch.",
      );
    }

    const events: CookingEvent[] = [];
    const rejection = this.#tryStartBatch(
      this.#selectedRecipeId,
      nowUtcMs,
      false,
      `manual-${operationId}`,
      events,
    );
    if (rejection !== null) {
      this.#lastAutoAttemptSignature =
        this.#createAutoAttemptSignature(this.#selectedRecipeId);
      return this.#reject(
        operationId,
        rejection.code,
        rejection.message,
        events,
      );
    }
    return this.#accept(operationId, events);
  }

  advanceTo(nowUtcMs: number): CookingAdvanceResult {
    assertUtcMs(nowUtcMs);
    const events: CookingEvent[] = [];

    if (this.#activeJob === null) {
      this.#tryAutoStart(nowUtcMs, events);
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: freezeEvents(events),
      });
    }

    if (
      this.#activeJob.status === "cooking" &&
      nowUtcMs < this.#activeJob.finishAtUtcMs
    ) {
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: freezeEvents(events),
      });
    }

    const completedAtUtcMs =
      this.#activeJob.status === "cooking"
        ? this.#activeJob.finishAtUtcMs
        : nowUtcMs;
    const completedJob = this.#activeJob;
    const recipe = this.#requireRecipe(completedJob.recipeId);
    if (completedJob.status === "waiting-output") {
      const signature = this.#createCompletionAttemptSignature(
        recipe,
      );
      if (signature === this.#lastCompletionAttemptSignature) {
        return Object.freeze({
          snapshot: this.getSnapshot(),
          events: freezeEvents(events),
        });
      }
      this.#lastCompletionAttemptSignature = signature;
    }
    const completionResult =
      this.#inventory.consumeReservationAndDeposit(
        `${completedJob.id}:complete:${completedJob.completionAttempt}`,
        completedJob.reservationId,
        this.#outputContainerId,
        [
          {
            itemId: recipe.outputItemId,
            quantity: recipe.outputQuantity,
          },
        ],
      );

    if (!completionResult.accepted) {
      if (completionResult.code !== "TARGET_CAPACITY_EXCEEDED") {
        throw new Error(
          `Cooking completion invariant failed: ${completionResult.code}`,
        );
      }
      this.#activeJob = {
        ...completedJob,
        status: "waiting-output",
        completionAttempt: completedJob.completionAttempt + 1,
      };
      this.#lastCompletionAttemptSignature =
        this.#createCompletionAttemptSignature(recipe);
      this.#setBlockedReason(
        "output-capacity",
        recipe.id,
        nowUtcMs,
        events,
      );
      return Object.freeze({
        snapshot: this.getSnapshot(),
        events: freezeEvents(events),
      });
    }

    this.#activeJob = null;
    this.#lastCompletionAttemptSignature = null;
    this.#completedBatches += 1;
    this.#blockedReason = null;
    events.push(Object.freeze({
      type: "cooking.completed",
      jobId: completedJob.id,
      recipeId: recipe.id,
      outputItemId: recipe.outputItemId,
      outputQuantity: recipe.outputQuantity,
      completedAtUtcMs,
    }));

    this.#tryAutoStart(completedAtUtcMs, events);
    return Object.freeze({
      snapshot: this.getSnapshot(),
      events: freezeEvents(events),
    });
  }

  #tryAutoStart(
    nowUtcMs: number,
    events: CookingEvent[],
  ): void {
    if (
      !this.#autoRepeat ||
      this.#selectedRecipeId === null ||
      this.#activeJob !== null
    ) {
      return;
    }

    const signature = this.#createAutoAttemptSignature(
      this.#selectedRecipeId,
    );
    if (signature === this.#lastAutoAttemptSignature) {
      return;
    }
    this.#lastAutoAttemptSignature = signature;

    this.#automaticAttemptSequence += 1;
    this.#tryStartBatch(
      this.#selectedRecipeId,
      nowUtcMs,
      true,
      `auto-${this.#automaticAttemptSequence}`,
      events,
    );
  }

  #tryStartBatch(
    recipeId: string,
    nowUtcMs: number,
    automatic: boolean,
    inventoryOperationSuffix: string,
    events: CookingEvent[],
  ): {
    readonly code:
      | "INSUFFICIENT_INGREDIENTS"
      | "OUTPUT_CAPACITY_EXCEEDED";
    readonly message: string;
  } | null {
    const recipe = this.#requireRecipe(recipeId);
    if (
      !this.#inventory.canDeposit(this.#outputContainerId, [
        {
          itemId: recipe.outputItemId,
          quantity: recipe.outputQuantity,
        },
      ])
    ) {
      this.#setBlockedReason(
        "output-capacity",
        recipe.id,
        nowUtcMs,
        events,
      );
      return {
        code: "OUTPUT_CAPACITY_EXCEEDED",
        message: "The kitchen output counter cannot fit this batch.",
      };
    }

    const finishAtUtcMs = nowUtcMs +
      Math.max(1, Math.round(recipe.durationMs * this.#durationScale));
    if (!Number.isSafeInteger(finishAtUtcMs)) {
      throw new RangeError(
        "Cooking finish time exceeds the safe integer range.",
      );
    }

    const jobId = `cooking-job-${this.#jobSequence + 1}`;
    const reservationId = `${jobId}:ingredients`;
    const reservationResult = this.#inventory.createReservation(
      `cooking-reserve:${inventoryOperationSuffix}`,
      reservationId,
      this.#ingredientContainerId,
      recipe.ingredients,
    );
    if (!reservationResult.accepted) {
      if (reservationResult.code !== "INSUFFICIENT_AVAILABLE") {
        throw new Error(
          `Cooking reservation invariant failed: ${reservationResult.code}`,
        );
      }
      this.#setBlockedReason(
        "insufficient-ingredients",
        recipe.id,
        nowUtcMs,
        events,
      );
      return {
        code: "INSUFFICIENT_INGREDIENTS",
        message: "The kitchen does not have enough available ingredients.",
      };
    }

    this.#jobSequence += 1;
    this.#activeJob = {
      id: jobId,
      recipeId: recipe.id,
      reservationId,
      startedAtUtcMs: nowUtcMs,
      finishAtUtcMs,
      completionAttempt: 0,
      status: "cooking",
    };
    this.#lastCompletionAttemptSignature = null;
    this.#blockedReason = null;
    events.push(Object.freeze({
      type: "cooking.started",
      job: this.getSnapshot().activeJob as CookingJobSnapshot,
      automatic,
    }));
    return null;
  }

  #setBlockedReason(
    reason: CookingBlockReason,
    recipeId: string,
    atUtcMs: number,
    events: CookingEvent[],
  ): void {
    if (this.#blockedReason === reason) {
      return;
    }
    this.#blockedReason = reason;
    events.push(Object.freeze({
      type: "cooking.blocked",
      recipeId,
      reason,
      atUtcMs,
    }));
  }

  #createAutoAttemptSignature(recipeId: string): string {
    const recipe = this.#requireRecipe(recipeId);
    const ingredients = this.#inventory.getContainerSnapshot(
      this.#ingredientContainerId,
    );
    const output = this.#inventory.getContainerSnapshot(
      this.#outputContainerId,
    );
    const availableIngredients = new Map(
      ingredients.entries.map((entry) => [
        entry.itemId,
        entry.availableQuantity,
      ]),
    );
    const outputQuantity =
      output.entries.find(
        (entry) => entry.itemId === recipe.outputItemId,
      )?.quantity ?? 0;

    return [
      recipe.id,
      `output:${output.availableCapacity}:${outputQuantity}`,
      ...recipe.ingredients.map(
        (ingredient) =>
          `${ingredient.itemId}:${
            availableIngredients.get(ingredient.itemId) ?? 0
          }`,
      ),
    ].join("|");
  }

  #createCompletionAttemptSignature(
    recipe: CookingRecipe,
  ): string {
    const output = this.#inventory.getContainerSnapshot(
      this.#outputContainerId,
    );
    const outputQuantity =
      output.entries.find(
        (entry) => entry.itemId === recipe.outputItemId,
      )?.quantity ?? 0;
    return [
      recipe.outputItemId,
      output.availableCapacity,
      outputQuantity,
    ].join("|");
  }

  #requireRecipe(recipeId: string): CookingRecipe {
    const recipe = this.#recipes.get(recipeId);
    if (recipe === undefined) {
      throw new Error(`Missing cooking recipe: ${recipeId}`);
    }
    return recipe;
  }

  #restoreState(state: CookingSystemState): void {
    if (
      typeof state.autoRepeat !== "boolean" ||
      !isNonNegativeInteger(state.completedBatches) ||
      !isNonNegativeInteger(state.jobSequence) ||
      !isNonNegativeInteger(state.automaticAttemptSequence) ||
      (state.selectedRecipeId !== null &&
        !this.#recipes.has(state.selectedRecipeId)) ||
      (state.blockedReason !== null &&
        state.blockedReason !== "insufficient-ingredients" &&
        state.blockedReason !== "output-capacity")
    ) {
      throw new Error("Cooking restore state is invalid.");
    }

    const activeJob = state.activeJob;
    if (activeJob !== null) {
      const recipe = this.#recipes.get(activeJob.recipeId);
      if (
        recipe === undefined ||
        !isValidIdentifier(activeJob.id) ||
        !isValidIdentifier(activeJob.reservationId) ||
        !isNonNegativeInteger(activeJob.startedAtUtcMs) ||
        !isNonNegativeInteger(activeJob.finishAtUtcMs) ||
        activeJob.finishAtUtcMs < activeJob.startedAtUtcMs ||
        !isNonNegativeInteger(activeJob.completionAttempt) ||
        (activeJob.status !== "cooking" &&
          activeJob.status !== "waiting-output") ||
        state.jobSequence === 0
      ) {
        throw new Error("Active cooking restore state is invalid.");
      }
      const reservation = this.#inventory.createReservation(
        `restore-${activeJob.id}`,
        activeJob.reservationId,
        this.#ingredientContainerId,
        recipe.ingredients,
      );
      if (!reservation.accepted) {
        throw new Error(
          `Unable to restore cooking reservation: ${reservation.code}`,
        );
      }
      this.#activeJob = { ...activeJob };
      if (activeJob.status === "waiting-output") {
        this.#lastCompletionAttemptSignature =
          this.#createCompletionAttemptSignature(recipe);
      }
    }

    this.#selectedRecipeId = state.selectedRecipeId;
    this.#autoRepeat = state.autoRepeat;
    this.#blockedReason = state.blockedReason;
    this.#completedBatches = state.completedBatches;
    this.#jobSequence = state.jobSequence;
    this.#automaticAttemptSequence =
      state.automaticAttemptSequence;
    if (
      this.#activeJob === null &&
      this.#autoRepeat &&
      this.#selectedRecipeId !== null &&
      this.#blockedReason !== null
    ) {
      this.#lastAutoAttemptSignature =
        this.#createAutoAttemptSignature(this.#selectedRecipeId);
    }
  }

  #prepareOperation(
    operationId: string,
  ): RejectedCookingAction | null {
    if (!isValidIdentifier(operationId)) {
      return this.#reject(
        operationId,
        "INVALID_OPERATION_ID",
        "Cooking operation id is invalid.",
      );
    }
    if (this.#processedOperationIds.has(operationId)) {
      return this.#reject(
        operationId,
        "DUPLICATE_OPERATION",
        `Cooking operation was already processed: ${operationId}`,
      );
    }

    this.#processedOperationIds.add(operationId);
    this.#operationHistory.push(operationId);
    if (this.#operationHistory.length > OPERATION_HISTORY_LIMIT) {
      const oldestOperationId = this.#operationHistory.shift();
      if (oldestOperationId !== undefined) {
        this.#processedOperationIds.delete(oldestOperationId);
      }
    }
    return null;
  }

  #accept(
    operationId: string,
    events: readonly CookingEvent[],
  ): AcceptedCookingAction {
    return Object.freeze({
      accepted: true,
      operationId,
      snapshot: this.getSnapshot(),
      events: freezeEvents(events),
    });
  }

  #reject(
    operationId: string,
    code: CookingRejectionCode,
    message: string,
    events: readonly CookingEvent[] = [],
  ): RejectedCookingAction {
    return Object.freeze({
      accepted: false,
      operationId,
      code,
      message,
      snapshot: this.getSnapshot(),
      events: freezeEvents(events),
    });
  }
}
