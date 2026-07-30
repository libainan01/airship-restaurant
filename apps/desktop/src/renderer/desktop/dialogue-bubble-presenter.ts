import type {
  DialogueDefinition,
  DialogueSpeakerDefinition,
} from "@airship-restaurant/content";
import type { AmbientDialogueSnapshot } from "@airship-restaurant/contracts";

export interface DialogueBubbleContentLookup {
  getDialogue(id: string): DialogueDefinition | undefined;
  getDialogueSpeaker(
    id: string,
  ): DialogueSpeakerDefinition | undefined;
  getLocalizedText(key: string): string | undefined;
}

export interface DialogueBubblePresentation {
  readonly dialogueId: string;
  readonly lineIndex: number;
  readonly speakerId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly restaurantSeatIndex: 0 | 1 | 2;
}

function uniqueSpeakerIds(
  dialogue: DialogueDefinition,
): readonly string[] {
  return [
    ...new Set(dialogue.lines.map((line) => line.speakerId)),
  ];
}

function restaurantSeatIndex(
  speakerId: string,
  dialogue: DialogueDefinition,
): 0 | 1 | 2 {
  const speakerIds = uniqueSpeakerIds(dialogue);
  if (speakerIds.length === 1) {
    return 1;
  }

  const speakerIndex = Math.max(0, speakerIds.indexOf(speakerId));
  if (speakerIds.length === 2) {
    return speakerIndex === 0 ? 0 : 2;
  }

  return Math.min(2, speakerIndex) as 0 | 1 | 2;
}

export function resolveDialogueBubblePresentation(
  snapshot: AmbientDialogueSnapshot | null,
  content: DialogueBubbleContentLookup,
): DialogueBubblePresentation | null {
  const active = snapshot?.active;
  if (active === null || active === undefined) {
    return null;
  }

  const dialogue = content.getDialogue(active.dialogueId);
  const line = dialogue?.lines[active.lineIndex];
  if (dialogue === undefined || line === undefined) {
    return null;
  }

  const speaker = content.getDialogueSpeaker(line.speakerId);
  const text = content.getLocalizedText(line.localizationKey);
  if (speaker === undefined || text === undefined || text.length === 0) {
    return null;
  }

  return Object.freeze({
    dialogueId: active.dialogueId,
    lineIndex: active.lineIndex,
    speakerId: speaker.id,
    speakerName:
      content.getLocalizedText(speaker.localizationKey) ?? speaker.name,
    text,
    restaurantSeatIndex: restaurantSeatIndex(
      speaker.id,
      dialogue,
    ),
  });
}
