import type {
  AmbientDialogueContext,
  AmbientDialogueDefinition,
  DialogueDefinition,
  DialogueFamiliarity,
  DialogueSpeakerDefinition,
  LocationDefinition,
  StoryDialogueDefinition,
} from "../definitions";
import { DialogueDefinitionBuilder } from "./dialogue-definition-builder";

export interface DialogueCatalogLocationSource {
  readonly id: string;
  readonly name: string;
}

export interface DialogueCatalogSpeakerSource {
  readonly id: string;
  readonly name: string;
  readonly characterId: string | null;
}

export interface DialogueCatalogSource {
  readonly schemaVersion: 1;
  readonly locations: readonly DialogueCatalogLocationSource[];
  readonly speakers: readonly DialogueCatalogSpeakerSource[];
}

export interface DialogueLineSource {
  readonly speakerId: string;
  readonly text: string;
  readonly durationMs?: number;
}

export interface AmbientDialogueSource {
  readonly id: string;
  readonly contexts: readonly AmbientDialogueContext[];
  readonly minimumFamiliarity: DialogueFamiliarity;
  readonly prerequisiteEventIds?: readonly string[];
  readonly weight?: number;
  readonly cooldownMs?: number;
  readonly maxPlaysPerSession?: number;
  readonly lines: readonly DialogueLineSource[];
}

export interface StoryDialogueSource {
  readonly id: string;
  readonly lines: readonly DialogueLineSource[];
}

export interface DialogueChapterDefaultsSource {
  readonly lineDurationMs: number;
  readonly ambientWeight: number;
  readonly ambientCooldownMs: number;
  readonly ambientMaxPlaysPerSession: number;
}

export interface DialogueChapterSource {
  readonly schemaVersion: 1;
  readonly chapterId: string;
  readonly title: string;
  readonly locationId: string;
  readonly defaults: DialogueChapterDefaultsSource;
  readonly ambientDialogues: readonly AmbientDialogueSource[];
  readonly storyDialogues: readonly StoryDialogueSource[];
}

export interface BuiltDialogueContent {
  readonly locations: readonly LocationDefinition[];
  readonly speakers: readonly DialogueSpeakerDefinition[];
  readonly ambientDialogues: readonly AmbientDialogueDefinition[];
  readonly storyDialogues: readonly StoryDialogueDefinition[];
  readonly dialogues: readonly DialogueDefinition[];
  readonly localizations: Readonly<Record<string, string>>;
}

function suffixFromId(id: string, prefix: string): string {
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(
      `Dialogue id "${id}" must start with "${prefix}".`,
    );
  }
  return id.slice(prefix.length);
}

function mergeLocalizations(
  target: Record<string, string>,
  source: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) {
      throw new Error(`Duplicate dialogue localization key: ${key}`);
    }
    target[key] = value;
  }
}

export function buildDialogueContentFromJson(
  catalog: DialogueCatalogSource,
  chapters: readonly DialogueChapterSource[],
): BuiltDialogueContent {
  const catalogBuilder = new DialogueDefinitionBuilder();
  const locations = catalog.locations.map((location) =>
    catalogBuilder.createLocation(location.id, location.name),
  );
  const speakers = catalog.speakers.map((speaker) =>
    catalogBuilder.createSpeaker(
      speaker.id,
      speaker.name,
      speaker.characterId,
    ),
  );
  const ambientDialogues: AmbientDialogueDefinition[] = [];
  const storyDialogues: StoryDialogueDefinition[] = [];
  const localizations: Record<string, string> = {};
  mergeLocalizations(
    localizations,
    catalogBuilder.getLocalizations(),
  );

  for (const chapter of chapters) {
    const builder = new DialogueDefinitionBuilder({
      ambientLocationId: chapter.locationId,
    });
    const lineDrafts = (lines: readonly DialogueLineSource[]) =>
      lines.map((line) => ({
        speakerId: line.speakerId,
        text: line.text,
        durationMs:
          line.durationMs ?? chapter.defaults.lineDurationMs,
      }));

    for (const dialogue of chapter.ambientDialogues) {
      ambientDialogues.push(
        builder.createAmbientDialogue(
          suffixFromId(dialogue.id, "dialogue.ambient."),
          dialogue.contexts,
          dialogue.minimumFamiliarity,
          lineDrafts(dialogue.lines),
          dialogue.prerequisiteEventIds ?? [],
          {
            weight:
              dialogue.weight ?? chapter.defaults.ambientWeight,
            cooldownMs:
              dialogue.cooldownMs ??
              chapter.defaults.ambientCooldownMs,
            maxPlaysPerSession:
              dialogue.maxPlaysPerSession ??
              chapter.defaults.ambientMaxPlaysPerSession,
          },
        ),
      );
    }

    for (const dialogue of chapter.storyDialogues) {
      storyDialogues.push(
        builder.createStoryDialogue(
          suffixFromId(dialogue.id, "dialogue.story."),
          lineDrafts(dialogue.lines),
        ),
      );
    }

    mergeLocalizations(localizations, builder.getLocalizations());
  }

  const frozenAmbient = Object.freeze([...ambientDialogues]);
  const frozenStory = Object.freeze([...storyDialogues]);
  return Object.freeze({
    locations: Object.freeze([...locations]),
    speakers: Object.freeze([...speakers]),
    ambientDialogues: frozenAmbient,
    storyDialogues: frozenStory,
    dialogues: Object.freeze([
      ...frozenAmbient,
      ...frozenStory,
    ]),
    localizations: Object.freeze({ ...localizations }),
  });
}
