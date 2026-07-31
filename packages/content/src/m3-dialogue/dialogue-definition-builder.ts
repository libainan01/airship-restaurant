import type {
  AmbientDialogueContext,
  AmbientDialogueDefinition,
  DialogueFamiliarity,
  DialogueLineDefinition,
  DialogueSpeakerDefinition,
  LocationDefinition,
  StoryDialogueDefinition,
} from "../definitions";

const LINE_DURATION_MS = 5_000;
const AMBIENT_COOLDOWN_MS = 10 * 60_000;

export interface DialogueLineDraft {
  readonly speakerId: string;
  readonly text: string;
  readonly durationMs?: number;
}

export interface DialogueDefinitionBuilderOptions {
  readonly ambientLocationId?: string;
}

export interface AmbientDialoguePlaybackDraft {
  readonly weight?: number;
  readonly cooldownMs?: number;
  readonly maxPlaysPerSession?: number;
}

export class DialogueDefinitionBuilder {
  readonly #ambientLocationId: string | null;
  readonly #localizations: Record<string, string> = {};

  constructor(options: DialogueDefinitionBuilderOptions = {}) {
    this.#ambientLocationId = options.ambientLocationId ?? null;
  }

  createLocation(id: string, name: string): LocationDefinition {
    const localizationKey = `localization.${id}.name`;
    this.#localizations[localizationKey] = name;
    return Object.freeze({
      id,
      name,
      localizationKey,
    });
  }

  createSpeaker(
    id: string,
    name: string,
    characterId: string | null = null,
  ): DialogueSpeakerDefinition {
    const localizationKey = `localization.${id}.name`;
    this.#localizations[localizationKey] = name;
    return Object.freeze({
      id,
      name,
      localizationKey,
      characterId,
    });
  }

  createAmbientDialogue(
    suffix: string,
    contexts: readonly AmbientDialogueContext[],
    minimumFamiliarity: DialogueFamiliarity,
    drafts: readonly DialogueLineDraft[],
    prerequisiteEventIds: readonly string[] = [],
    playback: AmbientDialoguePlaybackDraft = {},
  ): AmbientDialogueDefinition {
    if (this.#ambientLocationId === null) {
      throw new Error(
        "Ambient dialogue builder requires an ambient location id.",
      );
    }

    const id = `dialogue.ambient.${suffix}`;
    return Object.freeze({
      id,
      kind: "ambient",
      locationId: this.#ambientLocationId,
      contexts: Object.freeze([...contexts]),
      minimumFamiliarity,
      weight: playback.weight ?? 100,
      cooldownMs:
        playback.cooldownMs ?? AMBIENT_COOLDOWN_MS,
      maxPlaysPerSession: playback.maxPlaysPerSession ?? 1,
      prerequisiteEventIds: Object.freeze([
        ...prerequisiteEventIds,
      ]),
      lines: this.#createLines(id, drafts),
    });
  }

  createStoryDialogue(
    suffix: string,
    drafts: readonly DialogueLineDraft[],
  ): StoryDialogueDefinition {
    const id = `dialogue.story.${suffix}`;
    return Object.freeze({
      id,
      kind: "story",
      lines: this.#createLines(id, drafts),
    });
  }

  getLocalizations(): Readonly<Record<string, string>> {
    return Object.freeze({ ...this.#localizations });
  }

  #createLines(
    dialogueId: string,
    drafts: readonly DialogueLineDraft[],
  ): readonly DialogueLineDefinition[] {
    return Object.freeze(
      drafts.map((draft, index) => {
        const localizationKey =
          `localization.${dialogueId}.line_${index + 1}`;
        this.#localizations[localizationKey] = draft.text;
        return Object.freeze({
          speakerId: draft.speakerId,
          localizationKey,
          durationMs: draft.durationMs ?? LINE_DURATION_MS,
        });
      }),
    );
  }
}
