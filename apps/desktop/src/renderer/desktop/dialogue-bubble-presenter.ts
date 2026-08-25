import type {
  AmbientDialogueContext,
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

export interface DialogueParticipantPresentation {
  readonly speakerId: string;
  readonly speakerName: string;
}

export interface DialogueBubblePresentation {
  readonly dialogueId: string;
  readonly kind: DialogueDefinition["kind"];
  readonly contexts: readonly AmbientDialogueContext[];
  readonly lineIndex: number;
  readonly speakerId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly participantIndex: number;
  readonly participants: readonly DialogueParticipantPresentation[];
}

function uniqueSpeakerIds(
  dialogue: DialogueDefinition,
): readonly string[] {
  return [
    ...new Set(dialogue.lines.map((line) => line.speakerId)),
  ];
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

  const participants = uniqueSpeakerIds(dialogue)
    .map((speakerId): DialogueParticipantPresentation | null => {
      const participant = content.getDialogueSpeaker(speakerId);
      if (participant === undefined) {
        return null;
      }
      return Object.freeze({
        speakerId: participant.id,
        speakerName:
          content.getLocalizedText(participant.localizationKey) ??
          participant.name,
      });
    })
    .filter(
      (
        participant,
      ): participant is DialogueParticipantPresentation =>
        participant !== null,
    );
  const participantIndex = participants.findIndex(
    (participant) => participant.speakerId === speaker.id,
  );
  if (participantIndex < 0) {
    return null;
  }

  return Object.freeze({
    dialogueId: active.dialogueId,
    kind: dialogue.kind,
    contexts: Object.freeze(
      dialogue.kind === "ambient" ? [...dialogue.contexts] : [],
    ),
    lineIndex: active.lineIndex,
    speakerId: speaker.id,
    speakerName:
      content.getLocalizedText(speaker.localizationKey) ?? speaker.name,
    text,
    participantIndex,
    participants: Object.freeze(participants),
  });
}
