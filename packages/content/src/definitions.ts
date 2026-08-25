export interface ContentQuantity {
  readonly itemId: string;
  readonly quantity: number;
}

export interface IngredientDefinition {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export type RecipeStepAttendance = "required" | "unattended";

export interface RecipeProductionStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly stationTags: readonly string[];
  readonly attendance: RecipeStepAttendance;
  readonly prerequisiteStepIds: readonly string[];
}

export interface DetailedRecipeIngredientDefinition {
  readonly name: string;
  readonly amount: string;
}

export interface DetailedRecipeStepDefinition {
  readonly order: number;
  readonly instruction: string;
}

export interface DetailedRecipeDefinition {
  readonly realWorldName: string;
  readonly servings: number;
  readonly ingredients: readonly DetailedRecipeIngredientDefinition[];
  readonly steps: readonly DetailedRecipeStepDefinition[];
  readonly notes: readonly string[];
}

export interface RecipeDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly durationMs: number;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly unitPriceCopper: number;
  readonly ingredients: readonly ContentQuantity[];
  readonly productionSteps: readonly RecipeProductionStepDefinition[];
  readonly detailedRecipe: DetailedRecipeDefinition;
}

export interface SupplyBundleDefinition {
  readonly id: string;
  readonly name: string;
  readonly intervalMs: number;
  readonly items: readonly ContentQuantity[];
}

export interface CharacterSkillSetDefinition {
  readonly cooking: number;
  readonly charm: number;
  readonly movement: number;
  readonly repair: number;
  readonly piloting: number;
}

export interface TalentDefinition {
  readonly id: string;
  readonly name: string;
  readonly exclusiveCharacterId: string | null;
  readonly qualityTier?: number;
  readonly effectKeys: readonly string[];
}

export interface CharacterDefinition {
  readonly id: string;
  readonly name: string;
  readonly localizationKey: string;
  readonly baseSkills?: CharacterSkillSetDefinition;
  readonly talentIds?: readonly string[];
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

export interface StoryRelationshipTierDefinition {
  readonly id: string;
  readonly minimumAffinity: number;
}

export interface StoryCharacterProfileDefinition {
  readonly characterId: string;
  readonly identityLocalizationKey: string;
  readonly relationshipTiers: readonly StoryRelationshipTierDefinition[];
}

export interface MealAffinityQualityTierDefinition {
  readonly qualityTier: number;
  readonly minimumQuality: number;
  readonly affinityIncrease: number;
}

export interface StoryRosterStageConditionDefinition {
  readonly type: "story-stage-completed";
  readonly stageId: string;
}

export interface StoryRosterNodeDefinition {
  readonly id: string;
  readonly characterId: string;
  readonly sequence: number;
  readonly hintLocalizationKey: string;
  readonly summaryLocalizationKey: string;
  readonly prerequisiteNodeIds: readonly string[];
  readonly rewardContentIds: readonly string[];
  readonly availableWhen: StoryRosterStageConditionDefinition;
  readonly completeWhen: StoryRosterStageConditionDefinition;
}
export interface RecipeJournalDefinition {
  readonly id: string;
  readonly recipeId: string;
  readonly sourceCharacterId: string;
  readonly localizationKey: string;
  readonly storyEventIds: readonly string[];
}

export type StorySequenceTriggerDefinition =
  | { readonly type: "session-start" }
  | { readonly type: "online-sales"; readonly quantity: number }
  | { readonly type: "after-previous" }
  | { readonly type: "recipe-selected"; readonly recipeId: string }
  | { readonly type: "story-order-fulfilled" };

export interface StorySequenceStageDefinition {
  readonly id: string;
  readonly dialogueId: string;
  readonly trigger: StorySequenceTriggerDefinition;
  readonly minimumDelayMs?: number;
}

export interface StorySequenceOrderDefinition {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly quantity: number;
  readonly activatesAfterStageId: string;
}


export interface StorySequenceDefinition {
  readonly id: string;
  readonly isPrimary: boolean;
  readonly stages: readonly StorySequenceStageDefinition[];
  readonly storyOrder: StorySequenceOrderDefinition;
  readonly journalId: string;
  readonly journalDiscoveredAfterStageId: string;
  readonly journalCompletedAfterStageId: string;
  readonly narrativeEventId: string;
  readonly narrativeEventAfterStageId: string;
  readonly residentSpeakerIds: readonly string[];
  readonly residentsArriveAtStageId: string;
  readonly residentsDepartAfterStageId: string;
}

export interface BuildingComponentSlotDefinition {
  readonly slotId: string;
  readonly capabilityId: string;
}

export interface BuildingLevelDefinition {
  readonly level: number;
  readonly upgradeCostCopper: number;
  readonly footprint: {
    readonly width: number;
    readonly height: number;
  };
  readonly maxDurability: number;
  readonly capabilityValues: Readonly<Record<string, number>>;
}
export interface BuildingDefinition {
  readonly id: string;
  readonly name: string;
  readonly buildCostCopper: number;
  readonly styleIds: readonly string[];
  readonly defaultStyleId: string;
  readonly necessary: boolean;
  readonly movable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  readonly footprint: {
    readonly width: number;
    readonly height: number;
  };
  readonly capabilityIds: readonly string[];
  readonly componentSlots?: readonly BuildingComponentSlotDefinition[];
  readonly placementZoneTags: readonly string[];
  readonly levels: readonly BuildingLevelDefinition[];
}

export interface TechnologyPrerequisiteDefinition {
  readonly nodeId: string;
  readonly requiredLevel: number;
}

export interface TechnologyLevelDefinition {
  readonly level: number;
  readonly costCopper: number;
  readonly effects: Readonly<Record<string, number>>;
}

export interface TechnologyDefinition {
  readonly id: string;
  readonly name: string;
  readonly prerequisites: readonly TechnologyPrerequisiteDefinition[];
  readonly baseEffects: Readonly<Record<string, number>>;
  readonly levels: readonly TechnologyLevelDefinition[];
}
export type ProgressionContentKindDefinition = "region" | "route" | "recipe" | "building" | "building-style";
export type ProgressionRequirementDefinition =
  | { readonly kind: "fact"; readonly factId: string; readonly minimumValue?: number }
  | { readonly kind: "content-unlocked"; readonly contentId: string };
export interface ProgressionSourceDefinition {
  readonly id: string;
  readonly requirements: readonly ProgressionRequirementDefinition[];
}
export interface ProgressionContentDefinition {
  readonly id: string;
  readonly kind: ProgressionContentKindDefinition;
  readonly name: string;
  readonly spoilerSensitive: boolean;
  readonly initiallyRevealed: boolean;
  readonly initiallyUnlocked: boolean;
  readonly revealSources: readonly ProgressionSourceDefinition[];
  readonly unlockSources: readonly ProgressionSourceDefinition[];
}
export interface RemoteProcurementRouteDefinition {
  readonly id: string;
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  readonly roundTripDistanceUnits: number;
}

export interface ProcurementAirshipLevelDefinition {
  readonly level: number;
  readonly upgradeCostCopper: number;
  readonly cargoCapacity: number;
  readonly speedUnitsPerSecond: number;
  readonly maxDurability: number;
  readonly cooldownEfficiency: number;
}

export interface ProcurementAirshipDefinition {
  readonly id: string;
  readonly name: string;
  readonly purchaseCostCopper: number;
  readonly defaultStyleId: string;
  readonly styleIds: readonly string[];
  readonly levels: readonly ProcurementAirshipLevelDefinition[];
}

export interface InitialProcurementAirshipDefinition {
  readonly id: string;
  readonly definitionId: string;
  readonly level: number;
  readonly styleId: string;
}
export interface ContentDefinitions {
  readonly ingredients: readonly IngredientDefinition[];
  readonly recipes: readonly RecipeDefinition[];
  readonly supplyBundles: readonly SupplyBundleDefinition[];
  readonly buildings?: readonly BuildingDefinition[];
  readonly technologies?: readonly TechnologyDefinition[];
  readonly progression?: readonly ProgressionContentDefinition[];
  readonly characters?: readonly CharacterDefinition[];
  readonly talents?: readonly TalentDefinition[];
  readonly customers?: readonly CustomerDefinition[];
  readonly storyEvents?: readonly StoryEventDefinition[];
  readonly storySequences?: readonly StorySequenceDefinition[];
  readonly locations?: readonly LocationDefinition[];
  readonly dialogueSpeakers?: readonly DialogueSpeakerDefinition[];
  readonly dialogues?: readonly DialogueDefinition[];
  readonly recipeJournals?: readonly RecipeJournalDefinition[];
  readonly storyCharacters?: readonly StoryCharacterProfileDefinition[];
  readonly storyRosterNodes?: readonly StoryRosterNodeDefinition[];
  readonly mealAffinityQualityTiers?: readonly MealAffinityQualityTierDefinition[];
  readonly localizations?: Readonly<Record<string, string>>;
}
