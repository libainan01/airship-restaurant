import { ContentRegistry } from "./content-registry";
import type {
  ContentDefinitions,
  ContentQuantity,
} from "./definitions";
import {
  M3_DIALOGUE_LOCALIZATIONS,
  M3_DIALOGUE_SPEAKERS,
  M3_DIALOGUES,
  M3_LOCATIONS,
} from "./m3-dialogue-content";

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
      name: "贝尔家的炉火炖菜",
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
      id: "character.baiyecheng",
      name: "白夜城",
      localizationKey:
        "localization.character.baiyecheng.name",
    },
    {
      id: "character.otto",
      name: "奥托",
      localizationKey:
        "localization.character.otto.name",
    },
    {
      id: "character.martha_bell",
      name: "玛莎·贝尔",
      localizationKey:
        "localization.character.martha_bell.name",
    },
    {
      id: "character.thomas_bell",
      name: "托马斯·贝尔",
      localizationKey:
        "localization.character.thomas_bell.name",
    },
  ],
  customers: [
    {
      id: "customer.martha_bell",
      name: "玛莎·贝尔",
      localizationKey:
        "localization.customer.martha_bell.name",
      characterId: "character.martha_bell",
    },
    {
      id: "customer.thomas_bell",
      name: "托马斯·贝尔",
      localizationKey:
        "localization.customer.thomas_bell.name",
      characterId: "character.thomas_bell",
    },
  ],
  locations: M3_LOCATIONS,
  dialogueSpeakers: M3_DIALOGUE_SPEAKERS,
  dialogues: M3_DIALOGUES,
  storyEvents: [
    {
      id: "story.bell_stew_first_service",
      title: "贝尔家的炉火炖菜·第一次上桌",
      localizationKey:
        "localization.story.bell_stew_first_service.body",
      presentation: "recipe-log",
      priority: 100,
      characterIds: [
        "character.baiyecheng",
        "character.otto",
        "character.martha_bell",
        "character.thomas_bell",
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
      dialogueId: "dialogue.story.bell_stew_first_service",
    },
  ],
  recipeJournals: [
    {
      id: "journal.bell_hearth_stew",
      recipeId: "recipe.homecoming_stew",
      sourceCharacterId: "character.martha_bell",
      localizationKey:
        "localization.journal.bell_hearth_stew.summary",
      storyEventIds: ["story.bell_stew_first_service"],
    },
  ],
  localizations: {
    ...M3_DIALOGUE_LOCALIZATIONS,
    "localization.character.baiyecheng.name": "白夜城",
    "localization.character.otto.name": "奥托",
    "localization.character.martha_bell.name": "玛莎·贝尔",
    "localization.character.thomas_bell.name": "托马斯·贝尔",
    "localization.customer.martha_bell.name": "玛莎·贝尔",
    "localization.customer.thomas_bell.name": "托马斯·贝尔",
    "localization.story.bell_stew_first_service.body":
      "玛莎想要的原本只是一顿安稳的热饭。后来，托马斯把这顿饭做了很多年。",
    "localization.journal.bell_hearth_stew.summary":
      "玛莎想要的原本只是一顿安稳的热饭。后来，托马斯把这顿饭做了很多年。",
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
