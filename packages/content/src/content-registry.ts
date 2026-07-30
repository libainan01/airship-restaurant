import type {
  AmbientDialogueDefinition,
  CharacterDefinition,
  ContentDefinitions,
  ContentQuantity,
  CustomerDefinition,
  DialogueDefinition,
  DialogueSpeakerDefinition,
  IngredientDefinition,
  LocationDefinition,
  RecipeJournalDefinition,
  RecipeDefinition,
  StoryDialogueDefinition,
  StoryEventDefinition,
  SupplyBundleDefinition,
} from "./definitions";
import { DialogueContentRegistry } from "./dialogue-content-registry";
import { NarrativeContentRegistry } from "./narrative-content-registry";

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

export class ContentRegistry {
  readonly #ingredients: ReadonlyMap<string, IngredientDefinition>;
  readonly #recipes: ReadonlyMap<string, RecipeDefinition>;
  readonly #supplyBundles: ReadonlyMap<string, SupplyBundleDefinition>;
  readonly #dialogue: DialogueContentRegistry;
  readonly #narrative: NarrativeContentRegistry;

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
        !isPositiveInteger(recipe.durationMs) ||
        !isPositiveInteger(recipe.outputQuantity) ||
        !isPositiveInteger(recipe.unitPriceCopper)
      ) {
        issues.push(
          `Recipe "${recipe.id}" duration, output and price must be positive integers.`,
        );
      }
      validateQuantities(
        recipe.ingredients,
        `Recipe "${recipe.id}"`,
        ingredientIds,
        issues,
      );
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

    this.#narrative = new NarrativeContentRegistry(
      definitions,
      recipeIds,
      dishIds,
      issues,
    );
    this.#dialogue = new DialogueContentRegistry(definitions, issues);

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

  listCharacters(): readonly CharacterDefinition[] {
    return this.#narrative.listCharacters();
  }

  listCustomers(): readonly CustomerDefinition[] {
    return this.#narrative.listCustomers();
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
