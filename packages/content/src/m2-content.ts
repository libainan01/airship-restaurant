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
      outputItemId: "dish.hearth_flatbread",
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
      outputItemId: "dish.windroot_soup",
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
      outputItemId: "dish.homecoming_stew",
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
  characters: [
    {
      id: "character.placeholder_cook",
      name: "飞艇厨师（占位）",
      localizationKey:
        "localization.character.placeholder_cook.name",
    },
    {
      id: "character.placeholder_wayfarer",
      name: "归航旅人（占位）",
      localizationKey:
        "localization.character.placeholder_wayfarer.name",
    },
  ],
  customers: [
    {
      id: "customer.placeholder_wayfarer",
      name: "第一位故事客人（占位）",
      localizationKey:
        "localization.customer.placeholder_wayfarer.name",
      characterId: "character.placeholder_wayfarer",
    },
  ],
  storyEvents: [
    {
      id: "story.homecoming_stew_first_sale",
      title: "归航炖锅·第一次售出（占位）",
      localizationKey:
        "localization.story.homecoming_stew_first_sale.body",
      presentation: "recipe-log",
      priority: 100,
      characterIds: [
        "character.placeholder_cook",
        "character.placeholder_wayfarer",
      ],
      recipeId: "recipe.homecoming_stew",
      prerequisiteEventIds: [],
      conditions: [
        {
          type: "online-dish-sales",
          dishItemId: "dish.homecoming_stew",
          quantity: 1,
        },
      ],
    },
  ],
  recipeJournals: [
    {
      id: "journal.homecoming_stew",
      recipeId: "recipe.homecoming_stew",
      sourceCharacterId: "character.placeholder_wayfarer",
      localizationKey:
        "localization.journal.homecoming_stew.summary",
      storyEventIds: ["story.homecoming_stew_first_sale"],
    },
  ],
  localizations: {
    "localization.character.placeholder_cook.name":
      "飞艇厨房的年轻经营者（占位）",
    "localization.character.placeholder_wayfarer.name":
      "正在寻找归路的旅人（占位）",
    "localization.customer.placeholder_wayfarer.name":
      "第一位故事客人（占位）",
    "localization.story.homecoming_stew_first_sale.body":
      "旅人尝到炖锅后认出了熟悉的香草气味。这是一段用于验证系统的占位文字。",
    "localization.journal.homecoming_stew.summary":
      "一道关于远行与归来的炖锅；人物和具体回忆尚待正式剧情确定。",
  },
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
