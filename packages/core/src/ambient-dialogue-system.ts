import type { AmbientDialogueSnapshot } from "@airship-restaurant/contracts";
import type { RandomSource } from "./random-source";

export type AmbientDialogueContext =
  | "arrival"
  | "waiting"
  | "eating"
  | "departing"
  | "idle";

export type DialogueFamiliarity = "new" | "returning" | "regular";

export interface AmbientDialogueConfig {
  readonly id: string;
  readonly locationId: string;
  readonly contexts: readonly AmbientDialogueContext[];
  readonly minimumFamiliarity: DialogueFamiliarity;
  readonly weight: number;
  readonly cooldownMs: number;
  readonly maxPlaysPerSession: number;
  readonly prerequisiteEventIds: readonly string[];
  readonly lineDurationsMs: readonly number[];
  readonly participantCount: number;
}

export interface AmbientDialogueSystemOptions {
  readonly dialogues: readonly AmbientDialogueConfig[];
  readonly random: RandomSource;
  readonly locationId: string;
  readonly minimumGapMs: number;
  readonly quietModeGapMultiplier: number;
  readonly returningAfterSales: number;
  readonly regularAfterSales: number;
}

export interface AmbientDialogueRequest {
  readonly atUtcMs: number;
  readonly opportunityId?: string;
  readonly context: AmbientDialogueContext;
  readonly familiarity: DialogueFamiliarity;
  readonly completedStoryEventIds: readonly string[];
  readonly quietMode: boolean;
  readonly availableSpeakerCount: number;
}

export interface AmbientDialogueNpcOpportunityRequest {
  readonly atUtcMs: number;
  readonly opportunityId: string;
  readonly context: AmbientDialogueContext;
  readonly availableSpeakerCount: number;
  readonly totalSoldQuantity: number;
  readonly completedStoryEventIds: readonly string[];
  readonly quietMode: boolean;
}

export interface AmbientDialogueAdvanceResult {
  readonly changed: boolean;
  readonly startedDialogueId: string | null;
  readonly snapshot: AmbientDialogueSnapshot;
}

interface ActiveDialogue {
  readonly config: AmbientDialogueConfig;
  readonly lineIndex: number;
  readonly startedAtUtcMs: number;
  readonly endsAtUtcMs: number;
}

const FAMILIARITY_RANK: Readonly<Record<DialogueFamiliarity, number>> = {
  new: 0,
  returning: 1,
  regular: 2,
};

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function safeAddTime(startUtcMs: number, durationMs: number): number {
  const result = startUtcMs + durationMs;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(
      "Ambient dialogue time exceeds the safe integer range.",
    );
  }
  return result;
}

function cloneConfig(
  config: AmbientDialogueConfig,
): AmbientDialogueConfig {
  return Object.freeze({
    ...config,
    contexts: Object.freeze([...config.contexts]),
    prerequisiteEventIds: Object.freeze([
      ...config.prerequisiteEventIds,
    ]),
    lineDurationsMs: Object.freeze([...config.lineDurationsMs]),
  });
}

export class AmbientDialogueSystem {
  readonly #dialogues: readonly AmbientDialogueConfig[];
  readonly #random: RandomSource;
  readonly #locationId: string;
  readonly #minimumGapMs: number;
  readonly #quietModeGapMultiplier: number;
  readonly #returningAfterSales: number;
  readonly #regularAfterSales: number;
  readonly #playCounts = new Map<string, number>();
  readonly #lastPlayedAtUtcMs = new Map<string, number>();

  #active: ActiveDialogue | null = null;
  #lastCompletedDialogueId: string | null = null;
  #lastStartedOpportunityId: string | null = null;
  #lastCompletedAtUtcMs: number | null = null;
  #lastObservedAtUtcMs: number | null = null;
  #revision = 0;

  constructor(options: AmbientDialogueSystemOptions) {
    if (
      options.locationId.length === 0 ||
      !isNonNegativeInteger(options.minimumGapMs) ||
      !isPositiveInteger(options.quietModeGapMultiplier) ||
      !isNonNegativeInteger(options.returningAfterSales) ||
      !isPositiveInteger(options.regularAfterSales) ||
      options.regularAfterSales <= options.returningAfterSales
    ) {
      throw new Error("Ambient dialogue system options are invalid.");
    }

    const ids = new Set<string>();
    for (const dialogue of options.dialogues) {
      const contexts = new Set(dialogue.contexts);
      if (
        dialogue.id.length === 0 ||
        ids.has(dialogue.id) ||
        dialogue.locationId.length === 0 ||
        dialogue.contexts.length === 0 ||
        contexts.size !== dialogue.contexts.length ||
        !isPositiveInteger(dialogue.weight) ||
        !isNonNegativeInteger(dialogue.cooldownMs) ||
        !isPositiveInteger(dialogue.maxPlaysPerSession) ||
        !isPositiveInteger(dialogue.participantCount) ||
        dialogue.lineDurationsMs.length === 0 ||
        !dialogue.lineDurationsMs.every(isPositiveInteger)
      ) {
        throw new Error(
          `Invalid ambient dialogue config: ${dialogue.id}`,
        );
      }
      ids.add(dialogue.id);
    }

    this.#dialogues = Object.freeze(
      options.dialogues.map(cloneConfig),
    );
    this.#random = options.random;
    this.#locationId = options.locationId;
    this.#minimumGapMs = options.minimumGapMs;
    this.#quietModeGapMultiplier =
      options.quietModeGapMultiplier;
    this.#returningAfterSales = options.returningAfterSales;
    this.#regularAfterSales = options.regularAfterSales;
  }

  getSnapshot(): AmbientDialogueSnapshot {
    return Object.freeze({
      revision: this.#revision,
      active:
        this.#active === null
          ? null
          : Object.freeze({
              dialogueId: this.#active.config.id,
              lineIndex: this.#active.lineIndex,
              startedAtUtcMs: this.#active.startedAtUtcMs,
              endsAtUtcMs: this.#active.endsAtUtcMs,
            }),
      lastCompletedDialogueId: this.#lastCompletedDialogueId,
      lastStartedOpportunityId: this.#lastStartedOpportunityId,
      nextTransitionUtcMs: this.#active?.endsAtUtcMs ?? null,
    });
  }

  advanceTo(atUtcMs: number): AmbientDialogueAdvanceResult {
    this.#assertForwardTime(atUtcMs);
    const changed = this.#advanceActiveTo(atUtcMs);
    this.#lastObservedAtUtcMs = atUtcMs;
    return Object.freeze({
      changed,
      startedDialogueId: null,
      snapshot: this.getSnapshot(),
    });
  }

  request(
    request: AmbientDialogueRequest,
  ): AmbientDialogueAdvanceResult {
    if (
      request.opportunityId !== undefined &&
      (request.opportunityId.length === 0 || request.opportunityId.length > 128)
    ) {
      throw new Error("Ambient dialogue opportunity id is invalid.");
    }
    this.#assertForwardTime(request.atUtcMs);
    const completedEventIds = new Set(
      request.completedStoryEventIds,
    );
    if (completedEventIds.size !== request.completedStoryEventIds.length) {
      throw new Error(
        "Ambient dialogue request repeats a completed story event.",
      );
    }

    let changed = this.#advanceActiveTo(request.atUtcMs);
    let startedDialogueId: string | null = null;
    if (this.#active === null) {
      const config = this.#chooseEligibleDialogue(
        request,
        completedEventIds,
      );
      if (config !== null) {
        this.#start(
          config,
          request.atUtcMs,
          request.opportunityId ?? null,
        );
        changed = true;
        startedDialogueId = config.id;
      }
    }
    this.#lastObservedAtUtcMs = request.atUtcMs;

    return Object.freeze({
      changed,
      startedDialogueId,
      snapshot: this.getSnapshot(),
    });
  }

  requestForNpcOpportunity(
    request: AmbientDialogueNpcOpportunityRequest,
  ): AmbientDialogueAdvanceResult {
    if (
      request.opportunityId.length === 0 ||
      request.opportunityId.length > 128 ||
      !isPositiveInteger(request.availableSpeakerCount) ||
      !isNonNegativeInteger(request.totalSoldQuantity)
    ) {
      throw new Error("Ambient dialogue NPC opportunity is invalid.");
    }
    return this.request({
      atUtcMs: request.atUtcMs,
      opportunityId: request.opportunityId,
      context: request.context,
      familiarity: this.#getFamiliarity(request.totalSoldQuantity),
      completedStoryEventIds: request.completedStoryEventIds,
      quietMode: request.quietMode,
      availableSpeakerCount: request.availableSpeakerCount,
    });
  }

  #getFamiliarity(totalSoldQuantity: number): DialogueFamiliarity {
    if (totalSoldQuantity >= this.#regularAfterSales) {
      return "regular";
    }
    if (totalSoldQuantity >= this.#returningAfterSales) {
      return "returning";
    }
    return "new";
  }

  #chooseEligibleDialogue(
    request: AmbientDialogueRequest,
    completedEventIds: ReadonlySet<string>,
  ): AmbientDialogueConfig | null {
    const gapMultiplier = request.quietMode
      ? this.#quietModeGapMultiplier
      : 1;
    const requiredGap = this.#minimumGapMs * gapMultiplier;
    if (
      !Number.isSafeInteger(requiredGap) ||
      (this.#lastCompletedAtUtcMs !== null &&
        request.atUtcMs - this.#lastCompletedAtUtcMs < requiredGap)
    ) {
      return null;
    }

    const candidates = this.#dialogues.filter((dialogue) => {
      const lastPlayedAtUtcMs =
        this.#lastPlayedAtUtcMs.get(dialogue.id) ?? null;
      return (
        dialogue.locationId === this.#locationId &&
        dialogue.contexts.includes(request.context) &&
        dialogue.participantCount <= request.availableSpeakerCount &&
        FAMILIARITY_RANK[request.familiarity] >=
          FAMILIARITY_RANK[dialogue.minimumFamiliarity] &&
        (this.#playCounts.get(dialogue.id) ?? 0) <
          dialogue.maxPlaysPerSession &&
        (lastPlayedAtUtcMs === null ||
          request.atUtcMs - lastPlayedAtUtcMs >=
            dialogue.cooldownMs) &&
        dialogue.prerequisiteEventIds.every((eventId) =>
          completedEventIds.has(eventId),
        )
      );
    });
    if (candidates.length === 0) {
      return null;
    }

    const totalWeight = candidates.reduce(
      (sum, dialogue) => sum + dialogue.weight,
      0,
    );
    let selection = this.#random.nextFloat() * totalWeight;
    for (const dialogue of candidates) {
      selection -= dialogue.weight;
      if (selection < 0) {
        return dialogue;
      }
    }
    return candidates.at(-1) ?? null;
  }

  #start(
    config: AmbientDialogueConfig,
    atUtcMs: number,
    opportunityId: string | null,
  ): void {
    const firstDuration = config.lineDurationsMs[0];
    if (firstDuration === undefined) {
      throw new Error(`Ambient dialogue has no lines: ${config.id}`);
    }
    this.#active = {
      config,
      lineIndex: 0,
      startedAtUtcMs: atUtcMs,
      endsAtUtcMs: safeAddTime(atUtcMs, firstDuration),
    };
    this.#lastStartedOpportunityId = opportunityId;
    this.#playCounts.set(
      config.id,
      (this.#playCounts.get(config.id) ?? 0) + 1,
    );
    this.#lastPlayedAtUtcMs.set(config.id, atUtcMs);
    this.#revision += 1;
  }

  #advanceActiveTo(atUtcMs: number): boolean {
    let changed = false;
    while (
      this.#active !== null &&
      atUtcMs >= this.#active.endsAtUtcMs
    ) {
      const nextLineIndex = this.#active.lineIndex + 1;
      const nextDuration =
        this.#active.config.lineDurationsMs[nextLineIndex];
      if (nextDuration === undefined) {
        this.#lastCompletedDialogueId = this.#active.config.id;
        this.#lastCompletedAtUtcMs = this.#active.endsAtUtcMs;
        this.#active = null;
      } else {
        const startedAtUtcMs = this.#active.endsAtUtcMs;
        this.#active = {
          config: this.#active.config,
          lineIndex: nextLineIndex,
          startedAtUtcMs,
          endsAtUtcMs: safeAddTime(
            startedAtUtcMs,
            nextDuration,
          ),
        };
      }
      this.#revision += 1;
      changed = true;
    }
    return changed;
  }

  #assertForwardTime(atUtcMs: number): void {
    if (
      !isNonNegativeInteger(atUtcMs) ||
      (this.#lastObservedAtUtcMs !== null &&
        atUtcMs < this.#lastObservedAtUtcMs)
    ) {
      throw new RangeError(
        "Ambient dialogue timestamps must move forward.",
      );
    }
  }
}
