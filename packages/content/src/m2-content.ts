import { ContentRegistry } from "./content-registry";
import type {
  ContentDefinitions,
  ContentQuantity,
} from "./definitions";

export const M2_CONTENT_DEFINITIONS: ContentDefinitions = {
  ingredients: [
    {
      id: "ingredient.cloud_wheat",
      name: "云穗麦粉",
      capacity: 30,
    },
    {
      id: "ingredient.kettle_milk",
      name: "铜壶奶",
      capacity: 30,
    },
    {
      id: "ingredient.wind_root",
      name: "风根菜",
      capacity: 30,
    },
    {
      id: "ingredient.smoked_meat",
      name: "烟熏肉",
      capacity: 30,
    },
    {
      id: "ingredient.moon_herb",
      name: "月露香草",
      capacity: 30,
    },
  ],
  recipes: [
    {
      id: "recipe.hearth_flatbread",
      name: "炉火云麦饼",
      durationMs: 45_000,
      outputQuantity: 2,
      unitPriceCopper: 4,
      ingredients: [
        { itemId: "ingredient.cloud_wheat", quantity: 2 },
        { itemId: "ingredient.kettle_milk", quantity: 1 },
      ],
    },
    {
      id: "recipe.windroot_soup",
      name: "风根浓汤",
      durationMs: 90_000,
      outputQuantity: 3,
      unitPriceCopper: 7,
      ingredients: [
        { itemId: "ingredient.wind_root", quantity: 2 },
        { itemId: "ingredient.kettle_milk", quantity: 1 },
        { itemId: "ingredient.moon_herb", quantity: 1 },
      ],
    },
    {
      id: "recipe.homecoming_stew",
      name: "归航炖锅",
      durationMs: 180_000,
      outputQuantity: 4,
      unitPriceCopper: 12,
      ingredients: [
        { itemId: "ingredient.wind_root", quantity: 2 },
        { itemId: "ingredient.smoked_meat", quantity: 1 },
        { itemId: "ingredient.moon_herb", quantity: 1 },
      ],
    },
  ],
  supplyBundles: [
    {
      id: "supply.guild_basic",
      name: "航行者公会基础补给箱",
      intervalMs: 120_000,
      items: [
        { itemId: "ingredient.cloud_wheat", quantity: 6 },
        { itemId: "ingredient.kettle_milk", quantity: 3 },
        { itemId: "ingredient.wind_root", quantity: 4 },
        { itemId: "ingredient.smoked_meat", quantity: 2 },
        { itemId: "ingredient.moon_herb", quantity: 2 },
      ],
    },
  ],
};

export const M2_INITIAL_INGREDIENTS: readonly ContentQuantity[] =
  Object.freeze(
    M2_CONTENT_DEFINITIONS.supplyBundles[0]?.items.map((item) =>
      Object.freeze({
        itemId: item.itemId,
        quantity: item.quantity * 2,
      }),
    ) ?? [],
  );

export function createM2ContentRegistry(): ContentRegistry {
  return new ContentRegistry(M2_CONTENT_DEFINITIONS);
}
