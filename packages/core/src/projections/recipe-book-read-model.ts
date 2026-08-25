export type RecipeBookLayer = "gameplay" | "real-world";

export interface RecipeBookIngredientDefinition {
  readonly id: string;
  readonly name: string;
}

export interface RecipeBookGameQuantityDefinition {
  readonly itemId: string;
  readonly quantity: number;
}

export interface RecipeBookGameStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly stationTags: readonly string[];
  readonly attendance: "required" | "unattended";
  readonly prerequisiteStepIds: readonly string[];
}

export interface RecipeBookRealIngredientDefinition {
  readonly name: string;
  readonly amount: string;
}

export interface RecipeBookRealStepDefinition {
  readonly order: number;
  readonly instruction: string;
}

export interface RecipeBookRecipeDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly durationMs: number;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly unitPriceCopper: number;
  readonly ingredients: readonly RecipeBookGameQuantityDefinition[];
  readonly productionSteps: readonly RecipeBookGameStepDefinition[];
  readonly detailedRecipe: {
    readonly realWorldName: string;
    readonly servings: number;
    readonly ingredients: readonly RecipeBookRealIngredientDefinition[];
    readonly steps: readonly RecipeBookRealStepDefinition[];
    readonly notes: readonly string[];
  };
}

/** Structurally compatible with ContentRegistry without making core depend on content. */
export interface RecipeBookContentPort {
  readonly revision?: number;
  listRecipes(): readonly RecipeBookRecipeDefinition[];
  getIngredient(id: string): RecipeBookIngredientDefinition | undefined;
}

export interface RecipeBookGameIngredient {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
}

export interface RecipeBookGameStep {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly stationTags: readonly string[];
  readonly attendance: "required" | "unattended";
  readonly prerequisiteStepIds: readonly string[];
  readonly dependentStepIds: readonly string[];
  readonly isRoot: boolean;
  readonly isFinal: boolean;
}

export interface RecipeBookGameplayLayer {
  readonly layer: "gameplay";
  readonly durationMs: number;
  readonly outputItemId: string;
  readonly outputQuantity: number;
  readonly unitPriceCopper: number;
  readonly ingredients: readonly RecipeBookGameIngredient[];
  readonly steps: readonly RecipeBookGameStep[];
}

export interface RecipeBookRealIngredient {
  /** Display-only text. Deliberately has no itemId or numeric business quantity. */
  readonly name: string;
  readonly amount: string;
}

export interface RecipeBookRealStep {
  readonly order: number;
  readonly instruction: string;
}

export interface RecipeBookRealWorldLayer {
  readonly layer: "real-world";
  readonly name: string;
  readonly servings: number;
  readonly ingredients: readonly RecipeBookRealIngredient[];
  readonly steps: readonly RecipeBookRealStep[];
  readonly notes: readonly string[];
}

export interface RecipeBookEntry {
  readonly recipeId: string;
  readonly version: number;
  readonly displayName: string;
  readonly gameplay: RecipeBookGameplayLayer;
  readonly realWorld: RecipeBookRealWorldLayer;
}

export interface RecipeBookReadModel {
  readonly sourceRevision: number;
  readonly entries: readonly RecipeBookEntry[];
}

export type RecipeBookPage =
  | {
      readonly recipeId: string;
      readonly version: number;
      readonly displayName: string;
      readonly layer: "gameplay";
      readonly content: RecipeBookGameplayLayer;
    }
  | {
      readonly recipeId: string;
      readonly version: number;
      readonly displayName: string;
      readonly layer: "real-world";
      readonly content: RecipeBookRealWorldLayer;
    };

function validText(value: string): boolean {
  return value.trim().length > 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function projectEntry(
  recipe: RecipeBookRecipeDefinition,
  content: RecipeBookContentPort,
): RecipeBookEntry {
  if (!validText(recipe.id) || !positiveInteger(recipe.version) || !validText(recipe.name) ||
    !positiveInteger(recipe.durationMs) || !validText(recipe.outputItemId) ||
    !positiveInteger(recipe.outputQuantity) || !Number.isSafeInteger(recipe.unitPriceCopper) ||
    recipe.unitPriceCopper < 0 || recipe.ingredients.length === 0 || recipe.productionSteps.length === 0 ||
    !validText(recipe.detailedRecipe.realWorldName) || !positiveInteger(recipe.detailedRecipe.servings) ||
    recipe.detailedRecipe.ingredients.length === 0 || recipe.detailedRecipe.steps.length === 0) {
    throw new Error(`Recipe book definition is incomplete: ${recipe.id}`);
  }

  const stepIds = new Set(recipe.productionSteps.map((step) => step.id));
  if (stepIds.size !== recipe.productionSteps.length) {
    throw new Error(`Recipe book contains duplicate game step ids: ${recipe.id}`);
  }
  const dependents = new Map(recipe.productionSteps.map((step) => [step.id, [] as string[]]));
  for (const step of recipe.productionSteps) {
    if (!validText(step.id) || !validText(step.name) || !positiveInteger(step.durationMs) ||
      step.stationTags.length === 0 ||
      (step.attendance !== "required" && step.attendance !== "unattended") ||
      step.prerequisiteStepIds.some((id) => !stepIds.has(id))) {
      throw new Error(`Recipe book game step is invalid: ${recipe.id}/${step.id}`);
    }
    for (const prerequisiteId of step.prerequisiteStepIds) {
      dependents.get(prerequisiteId)!.push(step.id);
    }
  }

  const ingredients = recipe.ingredients.map((quantity): RecipeBookGameIngredient => {
    const ingredient = content.getIngredient(quantity.itemId);
    if (ingredient === undefined || !positiveInteger(quantity.quantity) || !validText(ingredient.name)) {
      throw new Error(`Recipe book game ingredient is invalid: ${recipe.id}/${quantity.itemId}`);
    }
    return Object.freeze({ itemId: quantity.itemId, name: ingredient.name, quantity: quantity.quantity });
  });
  const steps = recipe.productionSteps.map((step): RecipeBookGameStep => Object.freeze({
    id: step.id,
    name: step.name,
    durationMs: step.durationMs,
    stationTags: Object.freeze([...step.stationTags]),
    attendance: step.attendance,
    prerequisiteStepIds: Object.freeze([...step.prerequisiteStepIds]),
    dependentStepIds: Object.freeze([...(dependents.get(step.id) ?? [])]),
    isRoot: step.prerequisiteStepIds.length === 0,
    isFinal: (dependents.get(step.id)?.length ?? 0) === 0,
  }));
  const realIngredients = recipe.detailedRecipe.ingredients.map((ingredient) => {
    if (!validText(ingredient.name) || !validText(ingredient.amount)) {
      throw new Error(`Recipe book real ingredient is invalid: ${recipe.id}`);
    }
    return Object.freeze({ name: ingredient.name, amount: ingredient.amount });
  });
  const realSteps = [...recipe.detailedRecipe.steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => {
      if (!positiveInteger(step.order) || !validText(step.instruction)) {
        throw new Error(`Recipe book real step is invalid: ${recipe.id}`);
      }
      return Object.freeze({ order: step.order, instruction: step.instruction });
    });

  return Object.freeze({
    recipeId: recipe.id,
    version: recipe.version,
    displayName: recipe.name,
    gameplay: Object.freeze({
      layer: "gameplay",
      durationMs: recipe.durationMs,
      outputItemId: recipe.outputItemId,
      outputQuantity: recipe.outputQuantity,
      unitPriceCopper: recipe.unitPriceCopper,
      ingredients: Object.freeze(ingredients),
      steps: Object.freeze(steps),
    }),
    realWorld: Object.freeze({
      layer: "real-world",
      name: recipe.detailedRecipe.realWorldName,
      servings: recipe.detailedRecipe.servings,
      ingredients: Object.freeze(realIngredients),
      steps: Object.freeze(realSteps),
      notes: Object.freeze([...recipe.detailedRecipe.notes]),
    }),
  });
}

export function projectRecipeBookReadModel(content: RecipeBookContentPort): RecipeBookReadModel {
  const entries = content.listRecipes()
    .map((recipe) => projectEntry(recipe, content))
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  return Object.freeze({
    sourceRevision: content.revision ?? 0,
    entries: Object.freeze(entries),
  });
}

/** Page switching only selects immutable data and has no writable domain dependency. */
export function selectRecipeBookPage(
  model: RecipeBookReadModel,
  recipeId: string,
  layer: RecipeBookLayer,
): RecipeBookPage | null {
  const entry = model.entries.find((candidate) => candidate.recipeId === recipeId);
  if (entry === undefined) return null;
  return layer === "gameplay"
    ? Object.freeze({
        recipeId: entry.recipeId,
        version: entry.version,
        displayName: entry.displayName,
        layer,
        content: entry.gameplay,
      })
    : Object.freeze({
        recipeId: entry.recipeId,
        version: entry.version,
        displayName: entry.displayName,
        layer,
        content: entry.realWorld,
      });
}
