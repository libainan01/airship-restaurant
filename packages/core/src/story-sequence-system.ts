import type {
  AmbientDialogueActiveSnapshot,
  GameplaySnapshot,
  StorySequenceSnapshot,
} from "@airship-restaurant/contracts";

export type StoryStageTrigger =
  | { readonly type: "session-start" }
  | { readonly type: "online-sales"; readonly quantity: number }
  | { readonly type: "after-previous" }
  | { readonly type: "recipe-selected"; readonly recipeId: string }
  | { readonly type: "story-order-fulfilled" };

export interface StorySequenceStageConfig {
  readonly id: string;
  readonly dialogueId: string;
  readonly lineDurationsMs: readonly number[];
  readonly trigger: StoryStageTrigger;
  readonly minimumDelayMs?: number;
}

export interface StoryOrderConfig {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly quantity: number;
  readonly activatesAfterStageId: string;
}

export interface StorySequenceConfig {
  readonly id: string;
  readonly stages: readonly StorySequenceStageConfig[];
  readonly order: StoryOrderConfig;
  readonly journalId: string;
  readonly journalDiscoveredAfterStageId: string;
  readonly journalCompletedAfterStageId: string;
  readonly narrativeEventId: string;
  readonly narrativeEventAfterStageId: string;
  readonly residentSpeakerIds: readonly string[];
  readonly residentsArriveAtStageId: string;
  readonly residentsDepartAfterStageId: string;
}

export interface StorySequenceState {
  readonly version: 1;
  readonly revision: number;
  readonly completedStages: readonly {
    readonly stageId: string;
    readonly completedAtUtcMs: number;
  }[];
  readonly active: {
    readonly stageId: string;
    readonly lineIndex: number;
    readonly replay: boolean;
  } | null;
  readonly onlineSales: number;
  readonly storyOrderFulfilled: number;
}

export interface StorySequenceAdvanceResult {
  readonly changed: boolean;
  readonly completedNarrativeEventIds: readonly string[];
  readonly snapshot: StorySequenceSnapshot;
}

export interface StorySequenceActionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly message: string;
  readonly snapshot: StorySequenceSnapshot;
}

interface MutableActiveStage {
  stageId: string;
  lineIndex: number;
  startedAtUtcMs: number;
  endsAtUtcMs: number;
  replay: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isStorySequenceState(
  value: unknown,
): value is StorySequenceState {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  if (!Array.isArray(value.completedStages)) return false;
  if (!value.completedStages.every((entry) =>
    isRecord(entry) &&
    typeof entry.stageId === "string" &&
    entry.stageId.length > 0 &&
    typeof entry.completedAtUtcMs === "number" &&
    Number.isFinite(entry.completedAtUtcMs)
  )) return false;
  if (value.active !== null) {
    if (!isRecord(value.active) ||
      typeof value.active.stageId !== "string" ||
      !Number.isSafeInteger(value.active.lineIndex) ||
      (value.active.lineIndex as number) < 0 ||
      typeof value.active.replay !== "boolean") return false;
  }
  return Number.isSafeInteger(value.onlineSales) &&
    (value.onlineSales as number) >= 0 &&
    Number.isSafeInteger(value.storyOrderFulfilled) &&
    (value.storyOrderFulfilled as number) >= 0;
}

function soldQuantity(snapshot: GameplaySnapshot, dishItemId: string): number {
  return snapshot.restaurant.soldByDish.find((entry) => entry.dishItemId === dishItemId)?.quantity ?? 0;
}

export class StorySequenceSystem {
  readonly #config: StorySequenceConfig;
  readonly #stagesById: ReadonlyMap<string, StorySequenceStageConfig>;
  readonly #completedAt = new Map<string, number>();
  #revision = 0;
  #active: MutableActiveStage | null = null;
  #onlineSales = 0;
  #storyOrderFulfilled = 0;

  constructor(config: StorySequenceConfig, initialState?: StorySequenceState) {
    if (config.stages.length === 0) throw new Error("A story sequence requires at least one stage.");
    this.#config = config;
    this.#stagesById = new Map(config.stages.map((stage) => [stage.id, stage]));
    for (const stage of config.stages) {
      if (stage.lineDurationsMs.length === 0 || stage.lineDurationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
        throw new Error(`Story stage "${stage.id}" requires positive dialogue line durations.`);
      }
    }
    if (initialState !== undefined) {
      this.#revision = initialState.revision;
      for (const entry of initialState.completedStages) {
        if (this.#stagesById.has(entry.stageId)) this.#completedAt.set(entry.stageId, entry.completedAtUtcMs);
      }
      this.#onlineSales = initialState.onlineSales;
      this.#storyOrderFulfilled = Math.min(config.order.quantity, initialState.storyOrderFulfilled);
    }
  }

  getSnapshot(): StorySequenceSnapshot {
    const active = this.#active === null ? null : this.#activeSnapshot(this.#active);
    const nextStage = this.#nextIncompleteStage();
    const orderActive = this.#completedAt.has(this.#config.order.activatesAfterStageId);
    const orderFulfilled = this.#storyOrderFulfilled >= this.#config.order.quantity;
    const journalDiscovered = this.#completedAt.has(this.#config.journalDiscoveredAfterStageId);
    const journalCompleted = this.#completedAt.has(this.#config.journalCompletedAfterStageId);
    const residentsArrived = this.#hasReachedStage(this.#config.residentsArriveAtStageId);
    const residentsDeparted = this.#completedAt.has(this.#config.residentsDepartAfterStageId);
    return Object.freeze({
      revision: this.#revision,
      sequenceId: this.#config.id,
      currentStageId: this.#active?.stageId ?? nextStage?.id ?? null,
      active,
      stages: Object.freeze(this.#config.stages.map((stage) => Object.freeze({
        stageId: stage.id,
        dialogueId: stage.dialogueId,
        status: this.#completedAt.has(stage.id)
          ? "completed"
          : this.#active?.stageId === stage.id
            ? "active"
            : stage.id === nextStage?.id
              ? "waiting"
              : "locked",
        completedAtUtcMs: this.#completedAt.get(stage.id) ?? null,
      }))),
      storyOrder: Object.freeze({
        orderId: this.#config.order.id,
        recipeId: this.#config.order.recipeId,
        dishItemId: this.#config.order.dishItemId,
        requestedQuantity: this.#config.order.quantity,
        fulfilledQuantity: this.#storyOrderFulfilled,
        status: !orderActive ? "locked" : orderFulfilled ? "fulfilled" : "active",
      }),
      recipeJournal: Object.freeze({
        journalId: this.#config.journalId,
        phase: journalCompleted ? "completed" : journalDiscovered ? "discovered" : "locked",
      }),
      residentSpeakerIds: Object.freeze(
        residentsArrived && !residentsDeparted ? [...this.#config.residentSpeakerIds] : [],
      ),
      nextTransitionUtcMs: active?.endsAtUtcMs ?? null,
    });
  }

  observeOnline(before: GameplaySnapshot, after: GameplaySnapshot, atUtcMs: number): StorySequenceAdvanceResult {
    let changed = false;
    const completedNarrativeEventIds: string[] = [];
    const totalSaleDelta = Math.max(0, after.restaurant.totalSoldQuantity - before.restaurant.totalSoldQuantity);
    if (totalSaleDelta > 0) {
      this.#onlineSales += totalSaleDelta;
      changed = true;
    }
    if (this.#isOrderActive() && this.#storyOrderFulfilled < this.#config.order.quantity) {
      const dishDelta = Math.max(0, soldQuantity(after, this.#config.order.dishItemId) - soldQuantity(before, this.#config.order.dishItemId));
      if (dishDelta > 0) {
        this.#storyOrderFulfilled = Math.min(this.#config.order.quantity, this.#storyOrderFulfilled + dishDelta);
        changed = true;
      }
    }

    if (this.#advanceActive(atUtcMs, completedNarrativeEventIds)) changed = true;
    if (this.#active === null) {
      const next = this.#nextIncompleteStage();
      if (next !== undefined && this.#canStart(next, after, atUtcMs)) {
        this.#startStage(next, 0, atUtcMs, false);
        changed = true;
      }
    }
    if (changed) this.#revision += 1;
    return Object.freeze({
      changed,
      completedNarrativeEventIds: Object.freeze(completedNarrativeEventIds),
      snapshot: this.getSnapshot(),
    });
  }

  replay(stageId: string, atUtcMs: number): StorySequenceActionResult {
    const stage = this.#stagesById.get(stageId);
    if (stage === undefined) return this.#action(false, false, `Unknown story stage "${stageId}".`);
    if (!this.#completedAt.has(stageId)) return this.#action(false, false, "Only completed story dialogue can be replayed.");
    if (this.#active !== null) return this.#action(false, false, "A story dialogue is already playing.");
    this.#startStage(stage, 0, atUtcMs, true);
    this.#revision += 1;
    return this.#action(true, true, "Story dialogue replay started.");
  }

  exportState(): StorySequenceState {
    return Object.freeze({
      version: 1,
      revision: this.#revision,
      completedStages: Object.freeze([...this.#completedAt.entries()].map(([stageId, completedAtUtcMs]) => Object.freeze({ stageId, completedAtUtcMs }))),
      active: null,
      onlineSales: this.#onlineSales,
      storyOrderFulfilled: this.#storyOrderFulfilled,
    });
  }

  #advanceActive(atUtcMs: number, completedNarrativeEventIds: string[]): boolean {
    if (this.#active === null || atUtcMs < this.#active.endsAtUtcMs) return false;
    const stage = this.#stagesById.get(this.#active.stageId);
    if (stage === undefined) return false;
    if (this.#active.lineIndex + 1 < stage.lineDurationsMs.length) {
      this.#startStage(stage, this.#active.lineIndex + 1, atUtcMs, this.#active.replay);
      return true;
    }
    const replay = this.#active.replay;
    this.#active = null;
    if (!replay) {
      this.#completedAt.set(stage.id, atUtcMs);
      if (stage.id === this.#config.narrativeEventAfterStageId) completedNarrativeEventIds.push(this.#config.narrativeEventId);
    }
    return true;
  }

  #startStage(stage: StorySequenceStageConfig, lineIndex: number, atUtcMs: number, replay: boolean): void {
    const duration = stage.lineDurationsMs[lineIndex] ?? stage.lineDurationsMs[0] ?? 1;
    this.#active = { stageId: stage.id, lineIndex, startedAtUtcMs: atUtcMs, endsAtUtcMs: atUtcMs + duration, replay };
  }

  #activeSnapshot(active: MutableActiveStage): AmbientDialogueActiveSnapshot {
    const stage = this.#stagesById.get(active.stageId);
    if (stage === undefined) throw new Error(`Unknown active story stage "${active.stageId}".`);
    return Object.freeze({ dialogueId: stage.dialogueId, lineIndex: active.lineIndex, startedAtUtcMs: active.startedAtUtcMs, endsAtUtcMs: active.endsAtUtcMs });
  }

  #nextIncompleteStage(): StorySequenceStageConfig | undefined {
    return this.#config.stages.find((stage) => !this.#completedAt.has(stage.id));
  }

  #canStart(stage: StorySequenceStageConfig, gameplay: GameplaySnapshot, atUtcMs: number): boolean {
    const index = this.#config.stages.findIndex((candidate) => candidate.id === stage.id);
    const previous = index > 0 ? this.#config.stages[index - 1] : undefined;
    if (previous !== undefined) {
      const completedAt = this.#completedAt.get(previous.id);
      if (completedAt === undefined || atUtcMs - completedAt < (stage.minimumDelayMs ?? 0)) return false;
    }
    switch (stage.trigger.type) {
      case "session-start": return true;
      case "after-previous": return previous === undefined || this.#completedAt.has(previous.id);
      case "online-sales": return this.#onlineSales >= stage.trigger.quantity;
      case "recipe-selected": return gameplay.cooking.selectedRecipeId === stage.trigger.recipeId;
      case "story-order-fulfilled": return this.#storyOrderFulfilled >= this.#config.order.quantity;
    }
  }

  #isOrderActive(): boolean {
    return this.#completedAt.has(this.#config.order.activatesAfterStageId);
  }

  #hasReachedStage(stageId: string): boolean {
    return this.#completedAt.has(stageId) || this.#active?.stageId === stageId || this.#config.stages.findIndex((stage) => stage.id === stageId) < this.#config.stages.findIndex((stage) => this.#completedAt.has(stage.id) === false);
  }

  #action(accepted: boolean, changed: boolean, message: string): StorySequenceActionResult {
    return Object.freeze({ accepted, changed, message, snapshot: this.getSnapshot() });
  }
}