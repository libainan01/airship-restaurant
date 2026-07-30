export interface ContentQuantity {
  readonly itemId: string;
  readonly quantity: number;
}

export interface IngredientDefinition {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export interface RecipeDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly unitPriceCopper: number;
  readonly ingredients: readonly ContentQuantity[];
}

export interface SupplyBundleDefinition {
  readonly id: string;
  readonly name: string;
  readonly intervalMs: number;
  readonly items: readonly ContentQuantity[];
}

export interface CharacterDefinition {
  readonly id: string;
  readonly name: string;
  readonly localizationKey: string;
}

export interface CustomerDefinition {
  readonly id: string;
  readonly name: string;
  readonly localizationKey: string;
  readonly characterId: string;
}

export interface LocationDefinition {
  readonly id: string;
  readonly name: string;
  readonly localizationKey: string;
}

export interface DialogueSpeakerDefinition {
  readonly id: string;
  readonly name: string;
  readonly localizationKey: string;
  readonly characterId: string | null;
}

export type AmbientDialogueContext =
  | "arrival"
  | "waiting"
  | "eating"
  | "departing"
  | "idle";

export type DialogueFamiliarity = "new" | "returning" | "regular";

export interface DialogueLineDefinition {
  readonly speakerId: string;
  readonly localizationKey: string;
  readonly durationMs: number;
}

export interface AmbientDialogueDefinition {
  readonly id: string;
  readonly kind: "ambient";
  readonly locationId: string;
  readonly contexts: readonly AmbientDialogueContext[];
  readonly minimumFamiliarity: DialogueFamiliarity;
  readonly weight: number;
  readonly cooldownMs: number;
  readonly maxPlaysPerSession: number;
  readonly prerequisiteEventIds: readonly string[];
  readonly lines: readonly DialogueLineDefinition[];
}

export interface StoryDialogueDefinition {
  readonly id: string;
  readonly kind: "story";
  readonly lines: readonly DialogueLineDefinition[];
}

export type DialogueDefinition =
  | AmbientDialogueDefinition
  | StoryDialogueDefinition;

export type StoryPresentation =
  | "dialogue"
  | "note"
  | "letter"
  | "memory"
  | "recipe-log";

export interface OnlineDishSalesStoryCondition {
  readonly type: "online-dish-sales";
  readonly dishItemId: string;
  readonly quantity: number;
}

export type StoryConditionDefinition =
  OnlineDishSalesStoryCondition;

export interface StoryEventDefinition {
  readonly id: string;
  readonly title: string;
  readonly localizationKey: string;
  readonly presentation: StoryPresentation;
  readonly priority: number;
  readonly characterIds: readonly string[];
  readonly recipeId: string | null;
  readonly prerequisiteEventIds: readonly string[];
  readonly conditions: readonly StoryConditionDefinition[];
  readonly dialogueId?: string | null;
}

export interface RecipeJournalDefinition {
  readonly id: string;
  readonly recipeId: string;
  readonly sourceCharacterId: string;
  readonly localizationKey: string;
  readonly storyEventIds: readonly string[];
}

export interface ContentDefinitions {
  readonly ingredients: readonly IngredientDefinition[];
  readonly recipes: readonly RecipeDefinition[];
  readonly supplyBundles: readonly SupplyBundleDefinition[];
  readonly characters?: readonly CharacterDefinition[];
  readonly customers?: readonly CustomerDefinition[];
  readonly storyEvents?: readonly StoryEventDefinition[];
  readonly locations?: readonly LocationDefinition[];
  readonly dialogueSpeakers?: readonly DialogueSpeakerDefinition[];
  readonly dialogues?: readonly DialogueDefinition[];
  readonly recipeJournals?: readonly RecipeJournalDefinition[];
  readonly localizations?: Readonly<Record<string, string>>;
}
