import type {
  AcceptedCommandResult,
  AmbientDialogueSnapshot,
  CommandResult,
  GameCommand,
  GameSnapshot,
  GameplaySnapshot,
  GameplayRestaurantActivitySnapshot,
  GameplayRestaurantEventSnapshot,
  NarrativeSnapshot,
  OfflineEarningsSummary,
  StorySequenceSnapshot,
  TechnologySnapshot,
  RejectedCommandResult,
} from "@airship-restaurant/contracts";
import type {
  AmbientDialogueAdvanceResult,
  AmbientDialogueNpcOpportunityRequest,
} from "./ambient-dialogue-system";
import type { GameClock } from "./game-time";

import type { RestaurantEvent } from "./restaurant-system";
import type {
  NarrativeActionResult,
  NarrativeAdvanceResult,
  NarrativeGameplayFacts,
} from "./narrative-system";
import type {
  StorySequenceActionResult,
  StorySequenceAdvanceResult,
} from "./story-sequence-system";

export * from "./ambient-dialogue-system";
export * from "./game-time";
export * from "./kernel";
export * from "./gameplay-runtime";
export * from "./modules";
export * from "./narrative-system";
export * from "./projections/public";
export * from "./runtime";
export * from "./story-sequence-system";
export * from "./random-source";

const COMMAND_HISTORY_LIMIT = 512;

export interface RuntimeState {
  readonly revision: number;
  readonly phase: "booting" | "ready";
  readonly runtimeStartedAtUtcMs: number;
  readonly quietMode: boolean;
}

export type RuntimeSnapshotListener = (snapshot: GameSnapshot) => void;

export interface RuntimeSimulationAdvanceResult {
  readonly changed: boolean;
  readonly clockRollbackDetected: boolean;
  readonly snapshot: GameplaySnapshot;
  readonly restaurantEvents: readonly RestaurantEvent[];
}

export type RuntimeSimulationActionResult =
  | { readonly accepted: true; readonly changed: boolean; readonly snapshot: GameplaySnapshot }
  | { readonly accepted: false; readonly changed: false; readonly message: string; readonly snapshot: GameplaySnapshot };

export interface RuntimeSimulation {
  getSnapshot(): GameplaySnapshot;
  advanceTo(observedUtcMs: number): RuntimeSimulationAdvanceResult;
  setCustomerArrivalIntervalRateBasisPoints?(rateBasisPoints: number): boolean;
  selectRecipe(operationId: string, recipeId: string): RuntimeSimulationActionResult;
  setAutoRepeat(operationId: string, enabled: boolean): RuntimeSimulationActionResult;
}
export interface RuntimeNarrative {
  getSnapshot(): NarrativeSnapshot;
  observeOnline(
    before: NarrativeGameplayFacts,
    after: NarrativeGameplayFacts,
    atUtcMs: number,
  ): NarrativeAdvanceResult;
  markViewed(eventId: string, atUtcMs: number): NarrativeActionResult;
  complete(eventId: string, atUtcMs: number): NarrativeActionResult;
}

export interface RuntimeDialogue {
  getSnapshot(): AmbientDialogueSnapshot;
  advanceTo(atUtcMs: number): AmbientDialogueAdvanceResult;
  requestForNpcOpportunity(
    request: AmbientDialogueNpcOpportunityRequest,
  ): AmbientDialogueAdvanceResult;
}

export interface RuntimeStory {
  getSnapshot(): StorySequenceSnapshot;
  observeOnline(
    before: GameplaySnapshot,
    after: GameplaySnapshot,
    atUtcMs: number,
  ): StorySequenceAdvanceResult;
  replay(stageId: string, atUtcMs: number): StorySequenceActionResult;
}



export interface RuntimeFocusSession {
  createReadModel(atUtcMs: number): import("@airship-restaurant/contracts").FocusSessionReadModel;
  requestStart(
    operationId: string,
    requestedAtUtcMs: number,
    foregroundDialogueActive: boolean,
  ): { readonly accepted: boolean; readonly changed: boolean; readonly message?: string };
  advanceTo(
    operationId: string,
    observedAtUtcMs: number,
    foregroundDialogueActive: boolean,
  ): { readonly accepted: boolean; readonly changed: boolean; readonly message?: string };
  cancel(
    operationId: string,
    occurredAtUtcMs: number,
  ): { readonly accepted: boolean; readonly changed: boolean; readonly message?: string };
  skipBreak(
    operationId: string,
    occurredAtUtcMs: number,
  ): { readonly accepted: boolean; readonly changed: boolean; readonly message?: string };
}

export interface RuntimeTechnology {
  createReadModel(): TechnologySnapshot;
  upgrade(
    operationId: string,
    nodeId: string,
    occurredAtUtcMs: number,
  ): { readonly accepted: boolean; readonly message?: string };
}
function createRestaurantPresentationEvents(
  events: RuntimeSimulationAdvanceResult["restaurantEvents"],
): readonly GameplayRestaurantEventSnapshot[] {
  return Object.freeze(
    events.flatMap((event): GameplayRestaurantEventSnapshot[] => {
      switch (event.type) {
        case "customer.arrived":
          return [Object.freeze({
            id: `customer.arrived:${event.customer.id}:${event.customer.arrivedAtUtcMs}`,
            type: event.type,
            customer: Object.freeze({ ...event.customer }),
          })];
        case "order.requested":
          return [Object.freeze({
            id: `order.requested:${event.order.customerId}:${event.requestedAtUtcMs}`,
            type: event.type,
            order: Object.freeze({ ...event.order }),
            requestedAtUtcMs: event.requestedAtUtcMs,
          })];
        case "order.confirmation-started":
          return [Object.freeze({
            id: `order.confirmation-started:${event.order.customerId}:${event.startedAtUtcMs}`,
            type: event.type,
            order: Object.freeze({ ...event.order }),
            startedAtUtcMs: event.startedAtUtcMs,
          })];
        case "order.confirmed":
          return [Object.freeze({
            id: `order.confirmed:${event.order.customerId}:${event.confirmedAtUtcMs}`,
            type: event.type,
            order: Object.freeze({ ...event.order }),
            confirmedAtUtcMs: event.confirmedAtUtcMs,
          })];
        case "kitchen.notification-sent":
          return [Object.freeze({
            id: `kitchen.notification-sent:${event.order.customerId}:${event.sentAtUtcMs}`,
            type: event.type,
            order: Object.freeze({ ...event.order }),
            channelId: event.channelId,
            sentAtUtcMs: event.sentAtUtcMs,
            expectedReceiptAtUtcMs: event.expectedReceiptAtUtcMs,
          })];
        case "kitchen.order-received":
          return [Object.freeze({
            id: `kitchen.order-received:${event.order.customerId}:${event.receivedAtUtcMs}`,
            type: event.type,
            order: Object.freeze({ ...event.order }),
            channelId: event.channelId,
            receivedAtUtcMs: event.receivedAtUtcMs,
          })];
        case "order.fulfilled":
          return [Object.freeze({
            id: `order.fulfilled:${event.sale.customerId}:${event.sale.soldAtUtcMs}`,
            type: event.type,
            sale: Object.freeze({ ...event.sale }),
          })];
        case "customer.dining-completed":
          return [Object.freeze({
            id: `customer.dining-completed:${event.customer.id}:${event.completedAtUtcMs}`,
            type: event.type,
            customer: Object.freeze({ ...event.customer }),
            completedAtUtcMs: event.completedAtUtcMs,
          })];
        case "customer.left":
          return [Object.freeze({
            id: `customer.left:${event.customerId}:${event.leftAtUtcMs}`,
            type: event.type,
            customerId: event.customerId,
            recipeId: event.recipeId,
            leftAtUtcMs: event.leftAtUtcMs,
            reason: event.reason,
          })];
        case "currency.changed":
          return [];
      }
    }),
  );
}

function narrativeFacts(snapshot: GameplaySnapshot): NarrativeGameplayFacts {
  return { soldByDish: snapshot.restaurant.soldByDish };
}

function completedStoryEventIds(
  narrative: RuntimeNarrative | null,
): readonly string[] {
  return Object.freeze(
    narrative
      ?.getSnapshot()
      .events.filter((event) => event.status === "completed")
      .map((event) => event.eventId) ?? [],
  );
}

function restaurantDialogueOpportunity(
  gameplay: GameplaySnapshot,
): {
  readonly opportunityId: string;
  readonly context: "arrival" | "waiting" | "eating";
  readonly availableSpeakerCount: number;
} | null {
  const restaurant = gameplay.restaurant;
  const active = restaurant.activeCustomer;
  const dining = restaurant.diningCustomers;
  const availableSpeakerCount = dining.length + (active === null ? 0 : 1);
  if (availableSpeakerCount === 0) return null;
  const context = dining.length > 0
    ? "eating" as const
    : active?.phase === "seated-idle"
      ? "arrival" as const
      : "waiting" as const;
  const visitKeys = [
    ...(active === null ? [] : [`${active.id}:${active.arrivedAtUtcMs}`]),
    ...dining.map((customer) => `${customer.id}:${customer.diningStartedAtUtcMs}`),
  ].sort();
  return Object.freeze({
    opportunityId: `restaurant:${context}:${visitKeys.join("+")}`.slice(0, 128),
    context,
    availableSpeakerCount,
  });
}

export function createInitialRuntimeState(
  runtimeStartedAtUtcMs: number,
): RuntimeState {
  return {
    revision: 0,
    phase: "booting",
    runtimeStartedAtUtcMs,
    quietMode: false,
  };
}

export class GameRuntime {
  #state: RuntimeState;
  readonly #clock: GameClock;
  readonly #offlineEarnings: OfflineEarningsSummary | null;
  readonly #simulation: RuntimeSimulation | null;
  readonly #narrative: RuntimeNarrative | null;
  readonly #dialogue: RuntimeDialogue | null;
  readonly #story: RuntimeStory | null;
  readonly #technology: RuntimeTechnology | null;
  readonly #focusSession: RuntimeFocusSession | null;
  readonly #listeners = new Set<RuntimeSnapshotListener>();
  readonly #processedCommandIds = new Set<string>();
  readonly #commandHistory: string[] = [];
  #restaurantActivityRevision = 0;
  #restaurantActivityEvents: readonly GameplayRestaurantEventSnapshot[] = Object.freeze([]);

  constructor(
    clock: GameClock,
    simulation: RuntimeSimulation | null = null,
    offlineEarnings: OfflineEarningsSummary | null = null,
    narrative: RuntimeNarrative | null = null,
    dialogue: RuntimeDialogue | null = null,
    story: RuntimeStory | null = null,
    technology: RuntimeTechnology | null = null,
    focusSession: RuntimeFocusSession | null = null,
  ) {
    this.#clock = clock;
    this.#offlineEarnings = offlineEarnings;
    this.#simulation = simulation;
    this.#narrative = narrative;
    this.#dialogue = dialogue;
    this.#story = story;
    this.#technology = technology;
    this.#focusSession = focusSession;
    this.#state = createInitialRuntimeState(clock.nowUtcMs());
  }

  getSnapshot(): GameSnapshot {
    return Object.freeze({
      revision: this.#state.revision,
      phase: this.#state.phase,
      runtimeStartedAtUtcMs: this.#state.runtimeStartedAtUtcMs,
      settings: Object.freeze({
        quietMode: this.#state.quietMode,
      }),
      gameplay: this.#simulation?.getSnapshot() ?? null,
      restaurantActivity: Object.freeze({
        revision: this.#restaurantActivityRevision,
        events: this.#restaurantActivityEvents,
      }) satisfies GameplayRestaurantActivitySnapshot,
      narrative: this.#narrative?.getSnapshot() ?? null,
      dialogue: this.#dialogue?.getSnapshot() ?? null,
      story: this.#story?.getSnapshot() ?? null,
      focusSession: this.#focusSession?.createReadModel(this.#clock.nowUtcMs()) ?? null,
      technology: this.#technology?.createReadModel() ?? null,
      offlineEarnings: this.#offlineEarnings,
    });
  }

  markReady(): GameSnapshot {
    if (this.#state.phase === "ready") {
      return this.getSnapshot();
    }

    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
      phase: "ready",
    };

    return this.#publishSnapshot();
  }

  tick(): GameSnapshot {
    const observedAtUtcMs = this.#clock.nowUtcMs();
    const foregroundBeforeTick =
      (this.#story?.getSnapshot().active ?? null) !== null ||
      (this.#dialogue?.getSnapshot().active ?? null) !== null;
    const focusAdvance = this.#focusSession?.advanceTo(
      `focus-session:tick:${observedAtUtcMs}`,
      observedAtUtcMs,
      foregroundBeforeTick,
    );
    const focusReadModel = this.#focusSession?.createReadModel(observedAtUtcMs) ?? null;
    const focusActive = focusReadModel?.effects.active === true;
    const focusWaiting = focusReadModel?.phase === "waiting-for-dialogue";
    const focusEffectChanged = this.#simulation?.setCustomerArrivalIntervalRateBasisPoints?.(
      focusReadModel?.effects.customerArrivalIntervalRateBasisPoints ?? 10_000,
    ) ?? false;
    if (this.#simulation === null) {
      if (focusAdvance?.changed !== true) return this.getSnapshot();
      this.#state = { ...this.#state, revision: this.#state.revision + 1 };
      return this.#publishSnapshot();
    }

    const before = this.#simulation.getSnapshot();
    const result = this.#simulation.advanceTo(observedAtUtcMs);
    const restaurantEvents = createRestaurantPresentationEvents(
      result.restaurantEvents,
    );
    if (restaurantEvents.length > 0) {
      this.#restaurantActivityRevision += 1;
      this.#restaurantActivityEvents = restaurantEvents;
    }
    const storyResult = focusActive
      ? undefined
      : this.#story?.observeOnline(
          before,
          result.snapshot,
          result.snapshot.currentUtcMs,
        );
    const narrativeResult = focusActive
      ? undefined
      : this.#narrative?.observeOnline(
          narrativeFacts(before),
          narrativeFacts(result.snapshot),
          result.snapshot.currentUtcMs,
        );
    let narrativeCompletionChanged = false;
    for (const eventId of storyResult?.completedNarrativeEventIds ?? []) {
      const completion = this.#narrative?.complete(
        eventId,
        result.snapshot.currentUtcMs,
      );
      narrativeCompletionChanged ||= completion?.changed === true;
    }
    const dialogueAdvance = focusActive
      ? undefined
      : this.#dialogue?.advanceTo(result.snapshot.currentUtcMs);
    let dialogueChanged = dialogueAdvance?.changed === true;
    const foregroundDialogueActive =
      (this.#story?.getSnapshot().active ?? null) !== null ||
      (this.#dialogue?.getSnapshot().active ?? null) !== null;
    const opportunity = restaurantDialogueOpportunity(result.snapshot);
    if (
      this.#dialogue !== null &&
      !focusActive &&
      !focusWaiting &&
      !foregroundDialogueActive &&
      opportunity !== null
    ) {
      const requested = this.#dialogue.requestForNpcOpportunity({
        ...opportunity,
        atUtcMs: result.snapshot.currentUtcMs,
        totalSoldQuantity: result.snapshot.restaurant.totalSoldQuantity,
        completedStoryEventIds: completedStoryEventIds(this.#narrative),
        quietMode: this.#state.quietMode,
      });
      dialogueChanged ||= requested.changed;
    }
    if (
      !result.changed &&
      !focusEffectChanged &&
      focusAdvance?.changed !== true &&
      storyResult?.changed !== true &&
      narrativeResult?.changed !== true &&
      !narrativeCompletionChanged &&
      !dialogueChanged
    ) {
      return this.getSnapshot();
    }

    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
    };
    return this.#publishSnapshot();
  }

  dispatch(command: GameCommand): CommandResult {
    if (this.#processedCommandIds.has(command.id)) {
      return this.#reject(
        command.id,
        "DUPLICATE_COMMAND",
        "The command id has already been processed.",
      );
    }

    if (this.#state.phase !== "ready") {
      return this.#reject(
        command.id,
        "RUNTIME_NOT_READY",
        "The game runtime is not ready.",
      );
    }

    this.#rememberCommand(command.id);

    switch (command.type) {
      case "settings.set-quiet-mode": {
        if (this.#state.quietMode !== command.payload.enabled) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
            quietMode: command.payload.enabled,
          };
          this.#publishSnapshot();
        }

        return this.#accept(command.id);
      }
      case "focus-session.start":
      case "focus-session.cancel":
      case "focus-session.skip-break": {
        if (this.#focusSession === null) {
          return this.#reject(command.id, "FOCUS_REJECTED", "Focus sessions are unavailable.");
        }
        const occurredAtUtcMs = this.#clock.nowUtcMs();
        const foregroundDialogueActive =
          (this.#story?.getSnapshot().active ?? null) !== null ||
          (this.#dialogue?.getSnapshot().active ?? null) !== null;
        const result = command.type === "focus-session.start"
          ? this.#focusSession.requestStart(command.id, occurredAtUtcMs, foregroundDialogueActive)
          : command.type === "focus-session.cancel"
            ? this.#focusSession.cancel(command.id, occurredAtUtcMs)
            : this.#focusSession.skipBreak(command.id, occurredAtUtcMs);
        if (!result.accepted) {
          return this.#reject(command.id, "FOCUS_REJECTED", result.message ?? "Focus session command was rejected.");
        }
        if (result.changed) {
          this.#simulation?.setCustomerArrivalIntervalRateBasisPoints?.(
            this.#focusSession.createReadModel(occurredAtUtcMs).effects.customerArrivalIntervalRateBasisPoints,
          );
          this.#state = { ...this.#state, revision: this.#state.revision + 1 };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }

      case "gameplay.select-recipe": {
        if (this.#simulation === null) {
          return this.#reject(command.id, "GAMEPLAY_REJECTED", "The gameplay simulation is unavailable.");
        }
        const result = this.#simulation.selectRecipe(command.id, command.payload.recipeId);
        if (!result.accepted) return this.#reject(command.id, "GAMEPLAY_REJECTED", result.message);
        if (result.changed) {
          this.#state = { ...this.#state, revision: this.#state.revision + 1 };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
      case "gameplay.set-auto-repeat": {
        if (this.#simulation === null) {
          return this.#reject(command.id, "GAMEPLAY_REJECTED", "The gameplay simulation is unavailable.");
        }
        const result = this.#simulation.setAutoRepeat(command.id, command.payload.enabled);
        if (!result.accepted) return this.#reject(command.id, "GAMEPLAY_REJECTED", result.message);
        if (result.changed) {
          this.#state = { ...this.#state, revision: this.#state.revision + 1 };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }

      case "technology.upgrade-node": {
        if (this.#technology === null) {
          return this.#reject(command.id, "TECHNOLOGY_REJECTED", "Technology is unavailable.");
        }
        const result = this.#technology.upgrade(
          command.id,
          command.payload.nodeId,
          this.#clock.nowUtcMs(),
        );
        if (!result.accepted) {
          return this.#reject(command.id, "TECHNOLOGY_REJECTED", result.message ?? "Technology upgrade was rejected.");
        }
        this.#state = { ...this.#state, revision: this.#state.revision + 1 };
        this.#publishSnapshot();
        return this.#accept(command.id);
      }
      case "gameplay.place-procurement-order":
        return this.#reject(
          command.id,
          "GAMEPLAY_REJECTED",
          "Procurement is unavailable.",
        );
      case "gameplay.configure-procurement-automation":
        return this.#reject(
          command.id,
          "GAMEPLAY_REJECTED",
          "Automatic procurement is unavailable.",
        );
      case "dialogue.request-ambient": {
        if (this.#dialogue === null || this.#simulation === null) {
          return this.#reject(
            command.id,
            "DIALOGUE_REJECTED",
            "The ambient dialogue system is unavailable.",
          );
        }
        const focusPhase = this.#focusSession?.createReadModel(this.#clock.nowUtcMs()).phase ?? "idle";
        if (focusPhase === "focusing" || focusPhase === "waiting-for-dialogue") {
          return this.#accept(command.id);
        }
        const foregroundDialogueActive =
          (this.#story?.getSnapshot().active ?? null) !== null ||
          this.#dialogue.getSnapshot().active !== null;
        if (foregroundDialogueActive) {
          return this.#accept(command.id);
        }
        const gameplay = this.#simulation.getSnapshot();
        const result = this.#dialogue.requestForNpcOpportunity({
          opportunityId: command.payload.opportunityId,
          atUtcMs: this.#clock.nowUtcMs(),
          context: command.payload.context,
          availableSpeakerCount: command.payload.availableSpeakerCount,
          totalSoldQuantity: gameplay.restaurant.totalSoldQuantity,
          completedStoryEventIds: completedStoryEventIds(this.#narrative),
          quietMode: this.#state.quietMode,
        });
        if (result.changed) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
          };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
      case "story.replay-dialogue": {
        if (this.#focusSession?.createReadModel(this.#clock.nowUtcMs()).effects.active === true) {
          return this.#reject(command.id, "FOCUS_REJECTED", "Story dialogue is unavailable during a focus session.");
        }
        if (this.#story === null) {
          return this.#reject(command.id, "STORY_REJECTED", "The story sequence is unavailable.");
        }
        const result = this.#story.replay(command.payload.stageId, this.#clock.nowUtcMs());
        if (!result.accepted) return this.#reject(command.id, "STORY_REJECTED", result.message);
        if (result.changed) {
          this.#state = { ...this.#state, revision: this.#state.revision + 1 };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
      case "scene-edit.enter":
      case "scene-edit.exit":
      case "instance-upgrade.prepare-building":
      case "instance-upgrade.confirm-building":
      case "instance-upgrade.cancel-building":
      case "instance-upgrade.procurement-cart":
      case "instance-upgrade.procurement-airship":
        return this.#reject(
          command.id,
          "INSTANCE_UPGRADE_REJECTED",
          "Instance upgrade commands require the functional runtime extension.",
        );
      case "recruitment.refresh":
      case "recruitment.hire":
        return this.#reject(
          command.id,
          "RECRUITMENT_REJECTED",
          "Recruitment commands require the functional runtime extension.",
        );
      case "employment.set-primary-job":
      case "employment.set-daily-shift":
      case "employment.request-dismissal":
        return this.#reject(
          command.id,
          "EMPLOYMENT_REJECTED",
          "Employment commands require the functional runtime extension.",
        );
      case "building-construction.start-preview":
      case "building-construction.update-preview":
      case "building-construction.confirm-preview":
      case "building-construction.cancel-preview":
      case "building-construction.move-building":
      case "building-construction.change-style":
        return this.#reject(
          command.id,
          "INVALID_COMMAND",
          "Building construction commands require the functional runtime extension.",
        );
      case "logistics.create-manual":
      case "logistics.update-manual":
      case "logistics.stop-manual":
        return this.#reject(
          command.id,
          "INVALID_COMMAND",
          "Manual logistics commands require the functional runtime extension.",
        );
      case "narrative.mark-viewed":
      case "narrative.complete": {
        if (this.#narrative === null) {
          return this.#reject(
            command.id,
            "NARRATIVE_REJECTED",
            "The narrative system is unavailable.",
          );
        }
        const result =
          command.type === "narrative.mark-viewed"
            ? this.#narrative.markViewed(
                command.payload.eventId,
                this.#clock.nowUtcMs(),
              )
            : this.#narrative.complete(
                command.payload.eventId,
                this.#clock.nowUtcMs(),
              );
        if (!result.accepted) {
          return this.#reject(
            command.id,
            "NARRATIVE_REJECTED",
            result.message,
          );
        }
        if (result.changed) {
          this.#state = {
            ...this.#state,
            revision: this.#state.revision + 1,
          };
          this.#publishSnapshot();
        }
        return this.#accept(command.id);
      }
    }
  }

  notifyExternalChange(): GameSnapshot {
    this.#state = {
      ...this.#state,
      revision: this.#state.revision + 1,
    };
    return this.#publishSnapshot();
  }
  subscribe(listener: RuntimeSnapshotListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #rememberCommand(commandId: string): void {
    this.#processedCommandIds.add(commandId);
    this.#commandHistory.push(commandId);

    if (this.#commandHistory.length <= COMMAND_HISTORY_LIMIT) {
      return;
    }

    const oldestCommandId = this.#commandHistory.shift();

    if (oldestCommandId !== undefined) {
      this.#processedCommandIds.delete(oldestCommandId);
    }
  }

  #publishSnapshot(): GameSnapshot {
    const snapshot = this.getSnapshot();

    for (const listener of this.#listeners) {
      listener(snapshot);
    }

    return snapshot;
  }

  #accept(commandId: string): AcceptedCommandResult {
    return {
      accepted: true,
      commandId,
    };
  }

  #reject(
    commandId: string,
    code: RejectedCommandResult["code"],
    message: string,
  ): RejectedCommandResult {
    return {
      accepted: false,
      commandId,
      code,
      message,
    };
  }
}
