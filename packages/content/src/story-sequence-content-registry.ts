import type {
  ContentDefinitions,
  StorySequenceDefinition,
  StorySequenceStageDefinition,
} from "./definitions";

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

function validId(value: string, prefix: string): boolean {
  return CONTENT_ID_PATTERN.test(value) && value.startsWith(`${prefix}.`);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function cloneStage(stage: StorySequenceStageDefinition): StorySequenceStageDefinition {
  return Object.freeze({
    ...stage,
    trigger: Object.freeze({ ...stage.trigger }),
  });
}

function cloneSequence(sequence: StorySequenceDefinition): StorySequenceDefinition {
  return Object.freeze({
    ...sequence,
    stages: Object.freeze(sequence.stages.map(cloneStage)),
    storyOrder: Object.freeze({ ...sequence.storyOrder }),
    residentSpeakerIds: Object.freeze([...sequence.residentSpeakerIds]),
  });
}

export class StorySequenceContentRegistry {
  readonly #sequences: ReadonlyMap<string, StorySequenceDefinition>;
  readonly #primary: StorySequenceDefinition | undefined;
  readonly #stageIds: ReadonlySet<string>;

  constructor(definitions: ContentDefinitions, issues: string[]) {
    const sequences = definitions.storySequences ?? [];
    const recipes = new Map(definitions.recipes.map((recipe) => [recipe.id, recipe]));
    const dialogues = new Map((definitions.dialogues ?? []).map((dialogue) => [dialogue.id, dialogue]));
    const journals = new Map((definitions.recipeJournals ?? []).map((journal) => [journal.id, journal]));
    const storyEvents = new Set((definitions.storyEvents ?? []).map((event) => event.id));
    const speakers = new Set((definitions.dialogueSpeakers ?? []).map((speaker) => speaker.id));
    const sequenceIds = new Set<string>();
    const globalStageIds = new Set<string>();
    const primarySequences: StorySequenceDefinition[] = [];

    for (const sequence of sequences) {
      if (!validId(sequence.id, "sequence") || sequenceIds.has(sequence.id)) {
        issues.push(`Story sequence has invalid or duplicate id "${sequence.id}".`);
      }
      sequenceIds.add(sequence.id);
      if (sequence.isPrimary) primarySequences.push(sequence);
      if (sequence.stages.length === 0) {
        issues.push(`Story sequence "${sequence.id}" requires at least one stage.`);
      }

      const stageIds = new Set<string>();
      for (const stage of sequence.stages) {
        if (!validId(stage.id, "stage") || stageIds.has(stage.id) || globalStageIds.has(stage.id)) {
          issues.push(`Story sequence "${sequence.id}" has invalid or duplicate stage "${stage.id}".`);
        }
        stageIds.add(stage.id);
        globalStageIds.add(stage.id);
        const dialogue = dialogues.get(stage.dialogueId);
        if (dialogue === undefined || dialogue.kind !== "story") {
          issues.push(`Story stage "${stage.id}" must reference a story dialogue.`);
        }
        if (stage.minimumDelayMs !== undefined && !nonNegativeInteger(stage.minimumDelayMs)) {
          issues.push(`Story stage "${stage.id}" minimum delay must be a non-negative integer.`);
        }
        switch (stage.trigger.type) {
          case "session-start":
          case "after-previous":
          case "story-order-fulfilled":
            break;
          case "online-sales":
            if (!positiveInteger(stage.trigger.quantity)) {
              issues.push(`Story stage "${stage.id}" online sales quantity must be positive.`);
            }
            break;
          case "recipe-selected":
            if (!recipes.has(stage.trigger.recipeId)) {
              issues.push(`Story stage "${stage.id}" references unknown recipe "${stage.trigger.recipeId}".`);
            }
            break;
          default: {
            const neverTrigger: never = stage.trigger;
            issues.push(`Story stage "${stage.id}" has unsupported trigger "${String(neverTrigger)}".`);
          }
        }
      }

      const order = sequence.storyOrder;
      const recipe = recipes.get(order.recipeId);
      if (!validId(order.id, "order") || recipe === undefined || !positiveInteger(order.quantity)) {
        issues.push(`Story sequence "${sequence.id}" has an invalid story order.`);
      }
      if (recipe !== undefined && recipe.outputItemId !== order.dishItemId) {
        issues.push(`Story sequence "${sequence.id}" order dish does not match recipe output.`);
      }
      if (!stageIds.has(order.activatesAfterStageId)) {
        issues.push(`Story sequence "${sequence.id}" order references unknown activation stage "${order.activatesAfterStageId}".`);
      }
      const journal = journals.get(sequence.journalId);
      if (journal === undefined || journal.recipeId !== order.recipeId) {
        issues.push(`Story sequence "${sequence.id}" must reference a journal for its order recipe.`);
      }
      if (!storyEvents.has(sequence.narrativeEventId)) {
        issues.push(`Story sequence "${sequence.id}" references unknown narrative event "${sequence.narrativeEventId}".`);
      }
      const residentIds = new Set<string>();
      for (const speakerId of sequence.residentSpeakerIds) {
        if (!speakers.has(speakerId) || residentIds.has(speakerId)) {
          issues.push(`Story sequence "${sequence.id}" references unknown or duplicate resident speaker "${speakerId}".`);
        }
        residentIds.add(speakerId);
      }
      for (const [label, stageId] of [
        ["journal discovery", sequence.journalDiscoveredAfterStageId],
        ["journal completion", sequence.journalCompletedAfterStageId],
        ["narrative event", sequence.narrativeEventAfterStageId],
        ["resident arrival", sequence.residentsArriveAtStageId],
        ["resident departure", sequence.residentsDepartAfterStageId],
      ] as const) {
        if (!stageIds.has(stageId)) {
          issues.push(`Story sequence "${sequence.id}" ${label} references unknown stage "${stageId}".`);
        }
      }
    }

    if (sequences.length > 0 && primarySequences.length !== 1) {
      issues.push("Story content must define exactly one primary sequence.");
    }

    const clones = sequences.map(cloneSequence);
    this.#sequences = new Map(clones.map((sequence) => [sequence.id, sequence]));
    this.#primary = clones.find((sequence) => sequence.isPrimary);
    this.#stageIds = new Set(globalStageIds);
  }


  listSequences(): readonly StorySequenceDefinition[] {
    return Object.freeze([...this.#sequences.values()]);
  }

  getSequence(id: string): StorySequenceDefinition | undefined {
    return this.#sequences.get(id);
  }

  getPrimarySequence(): StorySequenceDefinition | undefined {
    return this.#primary;
  }

  listStageIds(): ReadonlySet<string> {
    return this.#stageIds;
  }
}