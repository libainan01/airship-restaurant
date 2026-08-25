import type {
  ContentRegistry,
  StoryDialogueDefinition,
  StorySequenceDefinition,
} from "@airship-restaurant/content";
import {
  StorySequenceSystem,
  type StorySequenceState,
  type StorySequenceStageConfig,
} from "@airship-restaurant/core";

function storyDialogue(content: ContentRegistry, id: string): StoryDialogueDefinition {
  const dialogue = content.getDialogue(id);
  if (dialogue === undefined || dialogue.kind !== "story") {
    throw new Error(`Required story dialogue "${id}" is missing.`);
  }
  return dialogue;
}


export function createStorySequence(
  content: ContentRegistry,
  definition: StorySequenceDefinition,
  initialState?: StorySequenceState,
): StorySequenceSystem {
  const stages: readonly StorySequenceStageConfig[] = definition.stages.map((entry) => {
    const dialogue = storyDialogue(content, entry.dialogueId);
    return Object.freeze({
      id: entry.id,
      dialogueId: entry.dialogueId,
      lineDurationsMs: Object.freeze(dialogue.lines.map((line) => line.durationMs)),
      trigger: Object.freeze({ ...entry.trigger }),
      minimumDelayMs: entry.minimumDelayMs ?? 0,
    });
  });
  return new StorySequenceSystem({
    id: definition.id,
    stages,
    order: definition.storyOrder,
    journalId: definition.journalId,
    journalDiscoveredAfterStageId: definition.journalDiscoveredAfterStageId,
    journalCompletedAfterStageId: definition.journalCompletedAfterStageId,
    narrativeEventId: definition.narrativeEventId,
    narrativeEventAfterStageId: definition.narrativeEventAfterStageId,
    residentSpeakerIds: definition.residentSpeakerIds,
    residentsArriveAtStageId: definition.residentsArriveAtStageId,
    residentsDepartAfterStageId: definition.residentsDepartAfterStageId,
  }, initialState);
}

export function createPrimaryStorySequence(
  content: ContentRegistry,
  initialState?: StorySequenceState,
): StorySequenceSystem {
  const definition = content.getPrimaryStorySequence();
  if (definition === undefined) {
    throw new Error("Required primary story sequence content is missing.");
  }
  return createStorySequence(content, definition, initialState);
}

