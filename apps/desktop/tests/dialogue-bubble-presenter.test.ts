import type {
  DialogueDefinition,
  DialogueSpeakerDefinition,
} from "@airship-restaurant/content";
import type { AmbientDialogueSnapshot } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import {
  resolveDialogueBubblePresentation,
  type DialogueBubbleContentLookup,
} from "../src/renderer/desktop/dialogue-bubble-presenter";

function createSnapshot(
  dialogueId: string,
  lineIndex: number,
): AmbientDialogueSnapshot {
  return {
    revision: 1,
    active: {
      dialogueId,
      lineIndex,
      startedAtUtcMs: 1_000,
      endsAtUtcMs: 6_000,
    },
    lastCompletedDialogueId: null,
    nextTransitionUtcMs: 6_000,
  };
}

function createDialogue(
  speakerIds: readonly string[],
): DialogueDefinition {
  return {
    id: "dialogue.ambient.test",
    kind: "ambient",
    locationId: "location.test",
    contexts: ["eating"],
    minimumFamiliarity: "new",
    weight: 1,
    cooldownMs: 0,
    maxPlaysPerSession: 1,
    prerequisiteEventIds: [],
    lines: speakerIds.map((speakerId, index) => ({
      speakerId,
      localizationKey: `line.${index}`,
      durationMs: 5_000,
    })),
  };
}

function createSpeaker(id: string): DialogueSpeakerDefinition {
  return {
    id,
    name: `fallback:${id}`,
    localizationKey: `speaker.${id}`,
    characterId: null,
  };
}

function createLookup(
  dialogue: DialogueDefinition,
  speakers: readonly DialogueSpeakerDefinition[],
  localizations: Readonly<Record<string, string>>,
): DialogueBubbleContentLookup {
  return {
    getDialogue: (id) =>
      id === dialogue.id ? dialogue : undefined,
    getDialogueSpeaker: (id) =>
      speakers.find((speaker) => speaker.id === id),
    getLocalizedText: (key) => localizations[key],
  };
}

describe("dialogue bubble presenter", () => {
  it("returns no bubble without an active dialogue", () => {
    const dialogue = createDialogue(["speaker.one"]);
    const lookup = createLookup(
      dialogue,
      [createSpeaker("speaker.one")],
      {},
    );

    expect(
      resolveDialogueBubblePresentation(null, lookup),
    ).toBeNull();
    expect(
      resolveDialogueBubblePresentation(
        {
          revision: 1,
          active: null,
          lastCompletedDialogueId: null,
          nextTransitionUtcMs: null,
        },
        lookup,
      ),
    ).toBeNull();
  });

  it("resolves localized text and a single participant", () => {
    const dialogue = createDialogue(["speaker.one"]);
    const lookup = createLookup(
      dialogue,
      [createSpeaker("speaker.one")],
      {
        "speaker.speaker.one": "送信员",
        "line.0": "先来碗热汤。",
      },
    );

    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 0),
        lookup,
      ),
    ).toEqual({
      dialogueId: dialogue.id,
      lineIndex: 0,
      speakerId: "speaker.one",
      speakerName: "送信员",
      text: "先来碗热汤。",
      participantIndex: 0,
      participants: [
        {
          speakerId: "speaker.one",
          speakerName: "送信员",
        },
      ],
    });
  });

  it("keeps stable participant identities while lines alternate", () => {
    const dialogue = createDialogue([
      "speaker.left",
      "speaker.right",
      "speaker.left",
    ]);
    const lookup = createLookup(
      dialogue,
      [
        createSpeaker("speaker.left"),
        createSpeaker("speaker.right"),
      ],
      {
        "speaker.speaker.left": "巡线员",
        "speaker.speaker.right": "送信员",
        "line.0": "北边的桥又封了。",
        "line.1": "昨天不是刚修好吗？",
        "line.2": "昨天是风，今天是羊群。",
      },
    );

    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 0),
        lookup,
      ),
    ).toMatchObject({
      participantIndex: 0,
      participants: [
        {
          speakerId: "speaker.left",
          speakerName: "巡线员",
        },
        {
          speakerId: "speaker.right",
          speakerName: "送信员",
        },
      ],
    });
    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 1),
        lookup,
      )?.participantIndex,
    ).toBe(1);
    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 2),
        lookup,
      )?.participantIndex,
    ).toBe(0);
  });

  it("hides malformed or unresolved dialogue lines", () => {
    const dialogue = createDialogue(["speaker.one"]);
    const lookup = createLookup(
      dialogue,
      [createSpeaker("speaker.one")],
      {
        "speaker.speaker.one": "送信员",
      },
    );

    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 0),
        lookup,
      ),
    ).toBeNull();
    expect(
      resolveDialogueBubblePresentation(
        createSnapshot(dialogue.id, 4),
        lookup,
      ),
    ).toBeNull();
  });
});
