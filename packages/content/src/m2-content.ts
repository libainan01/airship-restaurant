import { ContentRegistry } from "./content-registry";
import type { ContentDefinitions, ContentQuantity } from "./definitions";
import {
  BUILDING_CONTENT,
  CHARACTER_CONTENT,
  GAMEPLAY_CONTENT,
  ITEM_CONTENT,
  PROGRESSION_CONTENT,
  ROUTE_CONTENT,
  STORY_CONTENT,
  TECHNOLOGY_CONTENT,
} from "./generated/content-data";
import {
  M3_DIALOGUE_LOCALIZATIONS,
  M3_DIALOGUE_SPEAKERS,
  M3_DIALOGUES,
  M3_LOCATIONS,
} from "./m3-dialogue-content";

export const M2_CONTENT_DEFINITIONS: ContentDefinitions = {
  ingredients: ITEM_CONTENT.ingredients,
  recipes: GAMEPLAY_CONTENT.recipes,
  supplyBundles: GAMEPLAY_CONTENT.supplyBundles,
  buildings: BUILDING_CONTENT.buildings,
  technologies: TECHNOLOGY_CONTENT.nodes,
  progression: PROGRESSION_CONTENT.contents,
  characters: CHARACTER_CONTENT.characters,
  talents: CHARACTER_CONTENT.talents,
  customers: CHARACTER_CONTENT.customers,
  locations: M3_LOCATIONS,
  dialogueSpeakers: M3_DIALOGUE_SPEAKERS,
  dialogues: M3_DIALOGUES,
  storyEvents: STORY_CONTENT.storyEvents,
  storySequences: STORY_CONTENT.sequences,
  recipeJournals: STORY_CONTENT.recipeJournals,
  storyCharacters: STORY_CONTENT.storyCharacters,
  storyRosterNodes: STORY_CONTENT.storyRosterNodes,
  mealAffinityQualityTiers: STORY_CONTENT.mealAffinityQualityTiers,
  localizations: {
    ...M3_DIALOGUE_LOCALIZATIONS,
    ...CHARACTER_CONTENT.localizations,
    ...STORY_CONTENT.localizations,
  },
};

export const M2_BUILDING_DEFINITIONS = BUILDING_CONTENT.buildings;
export const M2_TECHNOLOGY_DEFINITIONS = TECHNOLOGY_CONTENT.nodes;
export const M2_PROGRESSION_DEFINITIONS = PROGRESSION_CONTENT.contents;
export const M2_STORY_SEQUENCES = STORY_CONTENT.sequences;
export const M2_STORY_CHARACTERS = STORY_CONTENT.storyCharacters;
export const M2_STORY_ROSTER_NODES = STORY_CONTENT.storyRosterNodes;
export const M2_MEAL_AFFINITY_QUALITY_TIERS = STORY_CONTENT.mealAffinityQualityTiers;
export const M2_PROCUREMENT_REGIONS = ROUTE_CONTENT.procurementRegions;
export const M2_LOCAL_PROCUREMENT_SUPPLIERS = ROUTE_CONTENT.localSuppliers;
export const M2_LOCAL_PROCUREMENT_CARTS = ROUTE_CONTENT.localProcurementCarts;
export const M2_REMOTE_PROCUREMENT_ROUTES = ROUTE_CONTENT.remoteProcurementRoutes;
export const M2_PROCUREMENT_AIRSHIPS = ROUTE_CONTENT.procurementAirships;
export const M2_INITIAL_PROCUREMENT_AIRSHIPS = ROUTE_CONTENT.initialProcurementAirships;
export const M2_RECRUITMENT_DEFINITION = CHARACTER_CONTENT.recruitment;

export const M2_INITIAL_INGREDIENTS: readonly ContentQuantity[] = Object.freeze(
  GAMEPLAY_CONTENT.supplyBundles[0]?.items.map((item) => Object.freeze({
    itemId: item.itemId,
    quantity: item.quantity * GAMEPLAY_CONTENT.initialIngredientMultiplier,
  })) ?? [],
);

export function createM2ContentRegistry(): ContentRegistry {
  return new ContentRegistry(M2_CONTENT_DEFINITIONS);
}