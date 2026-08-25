import type {
  AmbientDialogueDefinition,
  BuildingDefinition,
  CharacterDefinition,
  ContentDefinitions,
  ContentQuantity,
  CustomerDefinition,
  DialogueDefinition,
  DialogueSpeakerDefinition,
  IngredientDefinition,
  LocationDefinition,
  ProgressionContentDefinition,
  RecipeJournalDefinition,
  RecipeDefinition,
  StoryDialogueDefinition,
  StoryCharacterProfileDefinition,
  StoryRosterNodeDefinition,
  MealAffinityQualityTierDefinition,
  StoryEventDefinition,
  StorySequenceDefinition,
  SupplyBundleDefinition,
  TechnologyDefinition,
  TalentDefinition,
} from "./definitions";
import { DialogueContentRegistry } from "./dialogue-content-registry";
import { NarrativeContentRegistry } from "./narrative-content-registry";
import { StoryRosterContentRegistry } from "./story-roster-content-registry";
import { StorySequenceContentRegistry } from "./story-sequence-content-registry";

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

export class ContentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Content validation failed:\n${issues.join("\n")}`);
    this.name = "ContentValidationError";
    this.issues = Object.freeze([...issues]);
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateContentId(
  id: string,
  expectedPrefix: string,
  label: string,
  issues: string[],
): void {
  if (
    !CONTENT_ID_PATTERN.test(id) ||
    !id.startsWith(`${expectedPrefix}.`)
  ) {
    issues.push(
      `${label} id "${id}" must be a stable ${expectedPrefix}.* id.`,
    );
  }
}

function validateQuantities(
  quantities: readonly ContentQuantity[],
  label: string,
  ingredientIds: ReadonlySet<string>,
  issues: string[],
): void {
  if (quantities.length === 0) {
    issues.push(`${label} must contain at least one item.`);
    return;
  }

  const seenItemIds = new Set<string>();
  for (const quantity of quantities) {
    if (!ingredientIds.has(quantity.itemId)) {
      issues.push(
        `${label} references unknown ingredient "${quantity.itemId}".`,
      );
    }
    if (!isPositiveInteger(quantity.quantity)) {
      issues.push(
        `${label} quantity for "${quantity.itemId}" must be a positive integer.`,
      );
    }
    if (seenItemIds.has(quantity.itemId)) {
      issues.push(
        `${label} contains duplicate ingredient "${quantity.itemId}".`,
      );
    }
    seenItemIds.add(quantity.itemId);
  }
}

function validateRecipeProductionSteps(
  recipe: RecipeDefinition,
  issues: string[],
): void {
  const steps = recipe.productionSteps ?? [];
  if (steps.length === 0) {
    issues.push(`Recipe "${recipe.id}" must contain at least one production step.`);
    return;
  }
  const stepIds = new Set<string>();
  for (const step of steps) {
    validateContentId(step.id, "step", `Recipe "${recipe.id}" step`, issues);
    if (stepIds.has(step.id)) issues.push(`Recipe "${recipe.id}" contains duplicate step "${step.id}".`);
    stepIds.add(step.id);
    if (step.name.trim().length === 0 || !isPositiveInteger(step.durationMs)) {
      issues.push(`Recipe "${recipe.id}" step "${step.id}" requires a name and positive duration.`);
    }
    if (step.stationTags.length === 0 || new Set(step.stationTags).size !== step.stationTags.length ||
      step.stationTags.some((tag) => !CONTENT_ID_PATTERN.test(tag) || !tag.startsWith("station."))) {
      issues.push(`Recipe "${recipe.id}" step "${step.id}" has invalid or duplicate station capabilities.`);
    }
    if (step.attendance !== "required" && step.attendance !== "unattended") {
      issues.push(`Recipe "${recipe.id}" step "${step.id}" has invalid attendance.`);
    }
    if (new Set(step.prerequisiteStepIds).size !== step.prerequisiteStepIds.length) {
      issues.push(`Recipe "${recipe.id}" step "${step.id}" repeats a prerequisite.`);
    }
  }
  const inDegree = new Map(steps.map((step) => [step.id, 0]));
  const outgoing = new Map(steps.map((step) => [step.id, [] as string[]]));
  for (const step of steps) {
    for (const prerequisiteId of step.prerequisiteStepIds) {
      if (!stepIds.has(prerequisiteId) || prerequisiteId === step.id) {
        issues.push(
          `Recipe "${recipe.id}" step "${step.id}" references invalid prerequisite "${prerequisiteId}".`,
        );
        continue;
      }
      inDegree.set(step.id, inDegree.get(step.id)! + 1);
      outgoing.get(prerequisiteId)!.push(step.id);
    }
  }
  const queue = steps.filter((step) => inDegree.get(step.id) === 0).map((step) => step.id);
  let visited = 0;
  while (queue.length > 0) {
    const stepId = queue.shift()!;
    visited += 1;
    for (const dependentId of outgoing.get(stepId) ?? []) {
      const remaining = inDegree.get(dependentId)! - 1;
      inDegree.set(dependentId, remaining);
      if (remaining === 0) queue.push(dependentId);
    }
  }
  if (visited !== steps.length) issues.push(`Recipe "${recipe.id}" production steps contain a cycle.`);
  const sinks = steps.filter((step) => (outgoing.get(step.id)?.length ?? 0) === 0);
  if (sinks.length !== 1) {
    issues.push(`Recipe "${recipe.id}" must have exactly one final production step.`);
  }
}
function cloneQuantity(quantity: ContentQuantity): ContentQuantity {
  return Object.freeze({ ...quantity });
}

function cloneIngredient(
  ingredient: IngredientDefinition,
): IngredientDefinition {
  return Object.freeze({ ...ingredient });
}

function cloneRecipe(recipe: RecipeDefinition): RecipeDefinition {
  return Object.freeze({
    ...recipe,
    ingredients: Object.freeze(recipe.ingredients.map(cloneQuantity)),
    ...(recipe.productionSteps === undefined ? {} : {
      productionSteps: Object.freeze(recipe.productionSteps.map((step) => Object.freeze({
        ...step,
        stationTags: Object.freeze([...step.stationTags]),
        prerequisiteStepIds: Object.freeze([...step.prerequisiteStepIds]),
      }))),
    }),
    ...(recipe.detailedRecipe === undefined ? {} : {
      detailedRecipe: Object.freeze({
        ...recipe.detailedRecipe,
        ingredients: Object.freeze(recipe.detailedRecipe.ingredients.map((item) => Object.freeze({ ...item }))),
        steps: Object.freeze(recipe.detailedRecipe.steps.map((step) => Object.freeze({ ...step }))),
        notes: Object.freeze([...recipe.detailedRecipe.notes]),
      }),
    }),
  });
}

function cloneSupplyBundle(
  bundle: SupplyBundleDefinition,
): SupplyBundleDefinition {
  return Object.freeze({
    ...bundle,
    items: Object.freeze(bundle.items.map(cloneQuantity)),
  });
}

function cloneBuilding(building: BuildingDefinition): BuildingDefinition {
  return Object.freeze({
    ...building,
    footprint: Object.freeze({ ...building.footprint }),
    capabilityIds: Object.freeze([...building.capabilityIds]),
    styleIds: Object.freeze([...building.styleIds]),
    ...(building.componentSlots === undefined ? {} : {
      componentSlots: Object.freeze(building.componentSlots.map((slot) => Object.freeze({ ...slot }))),
    }),
    placementZoneTags: Object.freeze([...building.placementZoneTags]),
    levels: Object.freeze(building.levels.map((level) => Object.freeze({
      ...level,
      footprint: Object.freeze({ ...level.footprint }),
      capabilityValues: Object.freeze({ ...level.capabilityValues }),
    }))),
  });
}

function cloneTechnology(technology: TechnologyDefinition): TechnologyDefinition {
  return Object.freeze({
    ...technology,
    prerequisites: Object.freeze(technology.prerequisites.map((entry) => Object.freeze({ ...entry }))),
    baseEffects: Object.freeze({ ...technology.baseEffects }),
    levels: Object.freeze(technology.levels.map((level) => Object.freeze({
      ...level,
      effects: Object.freeze({ ...level.effects }),
    }))),
  });
}
function cloneProgression(content: ProgressionContentDefinition): ProgressionContentDefinition {
  const cloneSources = (sources: ProgressionContentDefinition["unlockSources"]) => Object.freeze(
    sources.map((source) => Object.freeze({
      ...source,
      requirements: Object.freeze(source.requirements.map((requirement) => Object.freeze({ ...requirement }))),
    })),
  );
  return Object.freeze({
    ...content,
    revealSources: cloneSources(content.revealSources),
    unlockSources: cloneSources(content.unlockSources),
  });
}function cloneTalent(talent: TalentDefinition): TalentDefinition {
  return Object.freeze({
    ...talent,
    effectKeys: Object.freeze([...talent.effectKeys]),
  });
}
export class ContentRegistry {
  readonly #ingredients: ReadonlyMap<string, IngredientDefinition>;
  readonly #recipes: ReadonlyMap<string, RecipeDefinition>;
  readonly #supplyBundles: ReadonlyMap<string, SupplyBundleDefinition>;
  readonly #buildings: ReadonlyMap<string, BuildingDefinition>;
  readonly #technologies: ReadonlyMap<string, TechnologyDefinition>;
  readonly #progression: ReadonlyMap<string, ProgressionContentDefinition>;
  readonly #talents: ReadonlyMap<string, TalentDefinition>;
  readonly #dialogue: DialogueContentRegistry;
  readonly #narrative: NarrativeContentRegistry;
  readonly #storySequence: StorySequenceContentRegistry;
  readonly #storyRoster: StoryRosterContentRegistry;

  constructor(definitions: ContentDefinitions) {
    const issues: string[] = [];
    const ingredientIds = new Set<string>();
    for (const ingredient of definitions.ingredients) {
      validateContentId(
        ingredient.id,
        "ingredient",
        "Ingredient",
        issues,
      );
      if (ingredientIds.has(ingredient.id)) {
        issues.push(`Duplicate ingredient id "${ingredient.id}".`);
      }
      ingredientIds.add(ingredient.id);
      if (ingredient.name.trim().length === 0) {
        issues.push(`Ingredient "${ingredient.id}" must have a name.`);
      }
      if (!isPositiveInteger(ingredient.capacity)) {
        issues.push(
          `Ingredient "${ingredient.id}" capacity must be a positive integer.`,
        );
      }
    }

    const recipeIds = new Set<string>();
    const dishIds = new Set<string>();
    for (const recipe of definitions.recipes) {
      validateContentId(recipe.id, "recipe", "Recipe", issues);
      if (recipeIds.has(recipe.id)) {
        issues.push(`Duplicate recipe id "${recipe.id}".`);
      }
      recipeIds.add(recipe.id);
      if (recipe.name.trim().length === 0) {
        issues.push(`Recipe "${recipe.id}" must have a name.`);
      }
      validateContentId(
        recipe.outputItemId,
        "dish",
        `Recipe "${recipe.id}" output`,
        issues,
      );
      dishIds.add(recipe.outputItemId);
      if (
        !isPositiveInteger(recipe.version) ||
        !isPositiveInteger(recipe.durationMs) ||
        !isPositiveInteger(recipe.outputQuantity) ||
        !isPositiveInteger(recipe.unitPriceCopper)
      ) {
        issues.push(
          `Recipe "${recipe.id}" version, duration, output and price must be positive integers.`,
        );
      }
      validateQuantities(
        recipe.ingredients,
        `Recipe "${recipe.id}"`,
        ingredientIds,
        issues,
      );      validateRecipeProductionSteps(recipe, issues);

    }

    const supplyBundleIds = new Set<string>();
    for (const bundle of definitions.supplyBundles) {
      validateContentId(
        bundle.id,
        "supply",
        "Supply bundle",
        issues,
      );
      if (supplyBundleIds.has(bundle.id)) {
        issues.push(`Duplicate supply bundle id "${bundle.id}".`);
      }
      supplyBundleIds.add(bundle.id);
      if (bundle.name.trim().length === 0) {
        issues.push(`Supply bundle "${bundle.id}" must have a name.`);
      }
      if (!isPositiveInteger(bundle.intervalMs)) {
        issues.push(
          `Supply bundle "${bundle.id}" interval must be a positive integer.`,
        );
      }
      validateQuantities(
        bundle.items,
        `Supply bundle "${bundle.id}"`,
        ingredientIds,
        issues,
      );
    }

    const talentIds = new Set<string>();
    for (const talent of definitions.talents ?? []) {
      validateContentId(talent.id, "talent", "Talent", issues);
      if (talentIds.has(talent.id)) issues.push(`Duplicate talent id "${talent.id}".`);
      talentIds.add(talent.id);
    }
    for (const character of definitions.characters ?? []) {
      if ((character.talentIds?.length ?? 0) > 3) issues.push(`Character "${character.id}" cannot have more than three talents.`);
      for (const talentId of character.talentIds ?? []) {
        if (!talentIds.has(talentId)) issues.push(`Character "${character.id}" references unknown talent "${talentId}".`);
      }
    }
    const buildingIds = new Set<string>();
    for (const building of definitions.buildings ?? []) {
      validateContentId(building.id, "building", "Building", issues);
      if (buildingIds.has(building.id)) issues.push(`Duplicate building id "${building.id}".`);
      buildingIds.add(building.id);
      if (!isPositiveInteger(building.footprint.width) || !isPositiveInteger(building.footprint.height)) {
        issues.push(`Building "${building.id}" footprint must use positive integers.`);
      }
      if (!isPositiveInteger(building.buildCostCopper) || building.styleIds.length === 0 ||
          !building.styleIds.includes(building.defaultStyleId)) {
        issues.push(`Building "${building.id}" has invalid construction metadata.`);
      }
      if (building.levels.length === 0) issues.push(`Building "${building.id}" must contain at least one level.`);
      const capabilityKeys = Object.keys(building.levels[0]?.capabilityValues ?? {}).sort();
      building.levels.forEach((level, index) => {
        if (level.level !== index + 1 ||
          (index === 0 ? level.upgradeCostCopper !== 0 : !isPositiveInteger(level.upgradeCostCopper)) ||
          !isPositiveInteger(level.footprint.width) || !isPositiveInteger(level.footprint.height) ||
          !isPositiveInteger(level.maxDurability)) {
          issues.push(`Building "${building.id}" has invalid level ${level.level}.`);
        }
        if (Object.keys(level.capabilityValues).sort().join("|") !== capabilityKeys.join("|") ||
          Object.values(level.capabilityValues).some((value) => !Number.isFinite(value) || value < 0)) {
          issues.push(`Building "${building.id}" level ${level.level} must define complete non-negative capability values.`);
        }
      });
      const baseLevel = building.levels[0];
      if (baseLevel !== undefined && (baseLevel.footprint.width !== building.footprint.width || baseLevel.footprint.height !== building.footprint.height)) {
        issues.push(`Building "${building.id}" base footprint must match level 1.`);
      }
    }

    const technologies = definitions.technologies ?? [];
    const technologyIds = new Set<string>();
    const technologyById = new Map<string, TechnologyDefinition>();
    const technologyEffectOwners = new Map<string, string>();
    for (const technology of technologies) {
      validateContentId(technology.id, "technology", "Technology", issues);
      if (technologyIds.has(technology.id)) issues.push(`Duplicate technology id "${technology.id}".`);
      technologyIds.add(technology.id);
      technologyById.set(technology.id, technology);
      if (technology.name.trim().length === 0) issues.push(`Technology "${technology.id}" must have a name.`);
      if (technology.levels.length === 0) issues.push(`Technology "${technology.id}" must contain at least one level.`);
      const baseEffectKeys = Object.keys(technology.baseEffects).sort();
      if (baseEffectKeys.length === 0) issues.push(`Technology "${technology.id}" must declare at least one effect.`);
      for (const [effectKey, value] of Object.entries(technology.baseEffects)) {
        if (effectKey.trim().length === 0 || !Number.isFinite(value)) issues.push(`Technology "${technology.id}" has invalid base effect "${effectKey}".`);
        const owner = technologyEffectOwners.get(effectKey);
        if (owner !== undefined) issues.push(`Technology effect "${effectKey}" is owned by both "${owner}" and "${technology.id}".`);
        else technologyEffectOwners.set(effectKey, technology.id);
      }
      technology.levels.forEach((level, index) => {
        if (level.level !== index + 1 || !isPositiveInteger(level.costCopper)) issues.push(`Technology "${technology.id}" levels must be contiguous and have positive costs.`);
        const levelEffectKeys = Object.keys(level.effects).sort();
        if (levelEffectKeys.join("|") !== baseEffectKeys.join("|") || Object.values(level.effects).some((value) => !Number.isFinite(value))) {
          issues.push(`Technology "${technology.id}" level ${level.level} must define every declared effect with finite values.`);
        }
      });
    }
    for (const technology of technologies) {
      const seenPrerequisites = new Set<string>();
      for (const prerequisite of technology.prerequisites) {
        const target = technologyById.get(prerequisite.nodeId);
        if (seenPrerequisites.has(prerequisite.nodeId)) issues.push(`Technology "${technology.id}" repeats prerequisite "${prerequisite.nodeId}".`);
        seenPrerequisites.add(prerequisite.nodeId);
        if (target === undefined || prerequisite.nodeId === technology.id || !isPositiveInteger(prerequisite.requiredLevel) || prerequisite.requiredLevel > (target?.levels.length ?? 0)) {
          issues.push(`Technology "${technology.id}" has invalid prerequisite "${prerequisite.nodeId}" level ${prerequisite.requiredLevel}.`);
        }
      }
    }
    const technologyVisiting = new Set<string>();
    const technologyVisited = new Set<string>();
    const visitTechnology = (id: string): void => {
      if (technologyVisiting.has(id)) { issues.push(`Technology graph contains a cycle at "${id}".`); return; }
      if (technologyVisited.has(id)) return;
      technologyVisiting.add(id);
      for (const prerequisite of technologyById.get(id)?.prerequisites ?? []) {
        if (technologyById.has(prerequisite.nodeId)) visitTechnology(prerequisite.nodeId);
      }
      technologyVisiting.delete(id);
      technologyVisited.add(id);
    };
    for (const id of technologyIds) visitTechnology(id);
    const progression = definitions.progression ?? [];
    const progressionKinds = new Set(["region", "route", "recipe", "building", "building-style"]);
    const progressionIds = new Set<string>();
    const progressionById = new Map<string, ProgressionContentDefinition>();
    for (const content of progression) {
      const expectedPrefix = content.kind === "building-style" ? "style" : content.kind;
      validateContentId(content.id, expectedPrefix, "Progression content", issues);
      if (progressionIds.has(content.id)) issues.push(`Duplicate progression content "${content.id}".`);
      progressionIds.add(content.id);
      progressionById.set(content.id, content);
      if (!progressionKinds.has(content.kind) || content.name.trim().length === 0 ||
          (content.initiallyUnlocked && !content.initiallyRevealed)) {
        issues.push(`Progression content "${content.id}" has invalid metadata.`);
      }
      const sourceIds = new Set<string>();
      for (const source of [...content.revealSources, ...content.unlockSources]) {
        if (!CONTENT_ID_PATTERN.test(source.id) || sourceIds.has(source.id) || source.requirements.length === 0) {
          issues.push(`Progression content "${content.id}" has invalid source "${source.id}".`);
        }
        sourceIds.add(source.id);
        for (const requirement of source.requirements) {
          if (requirement.kind === "fact") {
            if (!CONTENT_ID_PATTERN.test(requirement.factId) ||
                (requirement.minimumValue !== undefined && (!Number.isFinite(requirement.minimumValue) || requirement.minimumValue < 0))) {
              issues.push(`Progression source "${source.id}" has an invalid fact requirement.`);
            }
          } else if (!CONTENT_ID_PATTERN.test(requirement.contentId) || requirement.contentId === content.id) {
            issues.push(`Progression source "${source.id}" has an invalid content prerequisite.`);
          }
        }
      }
    }
    for (const content of progression) for (const source of [...content.revealSources, ...content.unlockSources]) {
      for (const requirement of source.requirements) if (requirement.kind === "content-unlocked" && !progressionIds.has(requirement.contentId)) {
        issues.push(`Progression content "${content.id}" references unknown prerequisite "${requirement.contentId}".`);
      }
    }
    const progressionVisiting = new Set<string>(); const progressionVisited = new Set<string>();
    const visitProgression = (id: string): void => {
      if (progressionVisiting.has(id)) { issues.push(`Progression graph contains a cycle at "${id}".`); return; }
      if (progressionVisited.has(id)) return;
      progressionVisiting.add(id);
      const content = progressionById.get(id);
      for (const source of [...(content?.revealSources ?? []), ...(content?.unlockSources ?? [])]) {
        for (const requirement of source.requirements) if (requirement.kind === "content-unlocked" && progressionById.has(requirement.contentId)) visitProgression(requirement.contentId);
      }
      progressionVisiting.delete(id); progressionVisited.add(id);
    };
    for (const id of progressionIds) visitProgression(id);    this.#narrative = new NarrativeContentRegistry(
      definitions,
      recipeIds,
      dishIds,
      issues,
    );
    this.#dialogue = new DialogueContentRegistry(definitions, issues);
    this.#storySequence = new StorySequenceContentRegistry(definitions, issues);
    this.#storyRoster = new StoryRosterContentRegistry(
      definitions,
      new Set((definitions.characters ?? []).map((character) => character.id)),
      progressionIds,
      this.#storySequence.listStageIds(),
      issues,
    );

    if (issues.length > 0) {
      throw new ContentValidationError(issues);
    }

    this.#ingredients = new Map(
      definitions.ingredients.map((ingredient) => {
        const cloned = cloneIngredient(ingredient);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#recipes = new Map(
      definitions.recipes.map((recipe) => {
        const cloned = cloneRecipe(recipe);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#supplyBundles = new Map(
      definitions.supplyBundles.map((bundle) => {
        const cloned = cloneSupplyBundle(bundle);
        return [cloned.id, cloned] as const;
      }),
    );    this.#buildings = new Map(
      (definitions.buildings ?? []).map((building) => {
        const cloned = cloneBuilding(building);
        return [cloned.id, cloned] as const;
      }),
    );
    this.#technologies = new Map(
      (definitions.technologies ?? []).map((technology) => {
        const cloned = cloneTechnology(technology);
        return [cloned.id, cloned] as const;
      }),
    );    this.#progression = new Map(
      progression.map((content) => {
        const cloned = cloneProgression(content);
        return [cloned.id, cloned] as const;
      }),
    );    this.#talents = new Map(
      (definitions.talents ?? []).map((talent) => {
        const cloned = cloneTalent(talent);
        return [cloned.id, cloned] as const;
      }),
    );
  }

  listIngredients(): readonly IngredientDefinition[] {
    return Object.freeze([...this.#ingredients.values()]);
  }

  listRecipes(): readonly RecipeDefinition[] {
    return Object.freeze([...this.#recipes.values()]);
  }

  listSupplyBundles(): readonly SupplyBundleDefinition[] {
    return Object.freeze([...this.#supplyBundles.values()]);
  }

  getIngredient(id: string): IngredientDefinition | undefined {
    return this.#ingredients.get(id);
  }

  getRecipe(id: string): RecipeDefinition | undefined {
    return this.#recipes.get(id);
  }

  getSupplyBundle(id: string): SupplyBundleDefinition | undefined {
    return this.#supplyBundles.get(id);
  }
  listBuildings(): readonly BuildingDefinition[] {
    return Object.freeze([...this.#buildings.values()]);
  }

  getBuilding(id: string): BuildingDefinition | undefined {
    return this.#buildings.get(id);
  }

  listTechnologies(): readonly TechnologyDefinition[] {
    return Object.freeze([...this.#technologies.values()]);
  }

  getTechnology(id: string): TechnologyDefinition | undefined {
    return this.#technologies.get(id);
  }
  listProgression(): readonly ProgressionContentDefinition[] {
    return Object.freeze([...this.#progression.values()]);
  }

  getProgression(id: string): ProgressionContentDefinition | undefined {
    return this.#progression.get(id);
  }
  listTalents(): readonly TalentDefinition[] {
    return Object.freeze([...this.#talents.values()]);
  }

  getTalent(id: string): TalentDefinition | undefined {
    return this.#talents.get(id);
  }

  listCharacters(): readonly CharacterDefinition[] {
    return this.#narrative.listCharacters();
  }

  listCustomers(): readonly CustomerDefinition[] {
    return this.#narrative.listCustomers();
  }


  listStorySequences(): readonly StorySequenceDefinition[] {
    return this.#storySequence.listSequences();
  }

  getStorySequence(id: string): StorySequenceDefinition | undefined {
    return this.#storySequence.getSequence(id);
  }

  getPrimaryStorySequence(): StorySequenceDefinition | undefined {
    return this.#storySequence.getPrimarySequence();
  }

  listStoryCharacters(): readonly StoryCharacterProfileDefinition[] {
    return this.#storyRoster.listProfiles();
  }

  listStoryRosterNodes(): readonly StoryRosterNodeDefinition[] {
    return this.#storyRoster.listNodes();
  }

  listMealAffinityQualityTiers(): readonly MealAffinityQualityTierDefinition[] {
    return this.#storyRoster.listQualityTiers();
  }

  getStoryCharacter(characterId: string): StoryCharacterProfileDefinition | undefined {
    return this.#storyRoster.getProfile(characterId);
  }

  getStoryRosterNode(nodeId: string): StoryRosterNodeDefinition | undefined {
    return this.#storyRoster.getNode(nodeId);
  }
  listStoryEvents(): readonly StoryEventDefinition[] {
    return this.#narrative.listStoryEvents();
  }

  listRecipeJournals(): readonly RecipeJournalDefinition[] {
    return this.#narrative.listRecipeJournals();
  }

  listLocations(): readonly LocationDefinition[] {
    return this.#dialogue.listLocations();
  }

  listDialogueSpeakers(): readonly DialogueSpeakerDefinition[] {
    return this.#dialogue.listSpeakers();
  }

  listDialogues(): readonly DialogueDefinition[] {
    return this.#dialogue.listDialogues();
  }

  listAmbientDialogues(): readonly AmbientDialogueDefinition[] {
    return this.#dialogue.listAmbientDialogues();
  }

  listStoryDialogues(): readonly StoryDialogueDefinition[] {
    return this.#dialogue.listStoryDialogues();
  }

  getLocation(id: string): LocationDefinition | undefined {
    return this.#dialogue.getLocation(id);
  }

  getDialogueSpeaker(
    id: string,
  ): DialogueSpeakerDefinition | undefined {
    return this.#dialogue.getSpeaker(id);
  }

  getDialogue(id: string): DialogueDefinition | undefined {
    return this.#dialogue.getDialogue(id);
  }

  getCharacter(id: string): CharacterDefinition | undefined {
    return this.#narrative.getCharacter(id);
  }

  getCustomer(id: string): CustomerDefinition | undefined {
    return this.#narrative.getCustomer(id);
  }

  getStoryEvent(id: string): StoryEventDefinition | undefined {
    return this.#narrative.getStoryEvent(id);
  }

  getRecipeJournal(id: string): RecipeJournalDefinition | undefined {
    return this.#narrative.getRecipeJournal(id);
  }

  getLocalizedText(key: string): string | undefined {
    return this.#narrative.getLocalizedText(key);
  }
}
