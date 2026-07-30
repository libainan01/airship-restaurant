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
  readonly recipeJournals?: readonly RecipeJournalDefinition[];
  readonly localizations?: Readonly<Record<string, string>>;
}
