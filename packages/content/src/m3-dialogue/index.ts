import { buildDialogueContentFromJson } from "./dialogue-json-content";
import {
  GENERATED_DIALOGUE_CATALOG,
  GENERATED_DIALOGUE_CHAPTERS,
} from "./generated-dialogue-source";

const content = buildDialogueContentFromJson(
  GENERATED_DIALOGUE_CATALOG,
  GENERATED_DIALOGUE_CHAPTERS,
);

export const M3_LOCATIONS = content.locations;
export const M3_DIALOGUE_SPEAKERS = content.speakers;
export const M3_AMBIENT_DIALOGUES = content.ambientDialogues;
export const M3_STORY_DIALOGUES = content.storyDialogues;
export const M3_DIALOGUES = content.dialogues;
export const M3_DIALOGUE_LOCALIZATIONS =
  content.localizations;
