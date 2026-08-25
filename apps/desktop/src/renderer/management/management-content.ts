import { createM2ContentRegistry } from "@airship-restaurant/content";

export const MANAGEMENT_CONTENT = createM2ContentRegistry();
export const MANAGEMENT_RECIPES = MANAGEMENT_CONTENT.listRecipes();
export const MANAGEMENT_RECIPE_JOURNALS =
  MANAGEMENT_CONTENT.listRecipeJournals();

export const MANAGEMENT_INGREDIENT_CAPACITIES = new Map(
  MANAGEMENT_CONTENT.listIngredients().map((ingredient) => [
    ingredient.id,
    ingredient.capacity,
  ]),
);

const ITEM_NAMES = new Map<string, string>([
  ["dishware.plate", "餐盘"],
  ...MANAGEMENT_CONTENT.listIngredients().map(
    (ingredient): readonly [string, string] => [
      ingredient.id,
      ingredient.name,
    ],
  ),
  ...MANAGEMENT_RECIPES.map(
    (recipe): readonly [string, string] => [
      recipe.outputItemId,
      recipe.name,
    ],
  ),
]);


const RECIPE_NAMES = new Map(
  MANAGEMENT_RECIPES.map((recipe) => [recipe.id, recipe.name]),
);

export function getManagementRecipeName(
  recipeId: string | null,
): string {
  return recipeId === null
    ? "未选择食谱"
    : RECIPE_NAMES.get(recipeId) ?? recipeId;
}
export function getManagementItemName(itemId: string): string {
  return ITEM_NAMES.get(itemId) ?? itemId;
}
