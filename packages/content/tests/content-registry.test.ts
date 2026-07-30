import { describe, expect, it } from "vitest";
import {
  ContentRegistry,
  ContentValidationError,
  M2_INITIAL_INGREDIENTS,
  createM2ContentRegistry,
} from "../src";

describe("M2 content", () => {
  it("loads M2 gameplay and the M3 placeholder narrative slice", () => {
    const registry = createM2ContentRegistry();
    expect(registry.listIngredients()).toHaveLength(5);
    expect(registry.listRecipes()).toHaveLength(3);
    expect(registry.listSupplyBundles()).toHaveLength(1);
    expect(
      registry.getRecipe("recipe.hearth_flatbread"),
    ).toMatchObject({
      durationMs: 45_000,
      outputItemId: "dish.hearth_flatbread",
      outputQuantity: 2,
      unitPriceCopper: 4,
    });
    expect(registry.listCharacters()).toHaveLength(2);
    expect(registry.listCustomers()).toHaveLength(1);
    expect(registry.listStoryEvents()).toHaveLength(1);
    expect(registry.listRecipeJournals()).toHaveLength(1);
    expect(
      registry.getStoryEvent("story.homecoming_stew_first_sale"),
    ).toMatchObject({
      presentation: "recipe-log",
      recipeId: "recipe.homecoming_stew",
    });
  });

  it("provides exactly two basic supply bundles as initial stock", () => {
    expect(M2_INITIAL_INGREDIENTS).toEqual([
      { itemId: "ingredient.cloud_wheat", quantity: 12 },
      { itemId: "ingredient.kettle_milk", quantity: 6 },
      { itemId: "ingredient.wind_root", quantity: 8 },
      { itemId: "ingredient.smoked_meat", quantity: 4 },
      { itemId: "ingredient.moon_herb", quantity: 4 },
    ]);
  });
});

describe("ContentRegistry validation", () => {
  it("reports unknown references and duplicate quantities", () => {
    expect(
      () =>
        new ContentRegistry({
          ingredients: [
            {
              id: "ingredient.known",
              name: "Known",
              capacity: 10,
            },
          ],
          recipes: [
            {
              id: "recipe.invalid",
              name: "Invalid",
              durationMs: 1_000,
              outputItemId: "dish.invalid",
              outputQuantity: 1,
              unitPriceCopper: 1,
              ingredients: [
                { itemId: "ingredient.missing", quantity: 1 },
                { itemId: "ingredient.missing", quantity: 1 },
              ],
            },
          ],
          supplyBundles: [],
        }),
    ).toThrow(ContentValidationError);

    try {
      new ContentRegistry({
        ingredients: [
          {
            id: "ingredient.known",
            name: "Known",
            capacity: 10,
          },
        ],
        recipes: [
          {
            id: "recipe.invalid",
            name: "Invalid",
            durationMs: 1_000,
            outputItemId: "dish.invalid",
            outputQuantity: 1,
            unitPriceCopper: 1,
            ingredients: [
              { itemId: "ingredient.missing", quantity: 1 },
              { itemId: "ingredient.missing", quantity: 1 },
            ],
          },
        ],
        supplyBundles: [],
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/unknown ingredient/),
          expect.stringMatching(/duplicate ingredient/),
        ]),
      );
    }
  });

  it("rejects unstable ids and non-positive values", () => {
    expect(
      () =>
        new ContentRegistry({
          ingredients: [
            {
              id: "Cloud Wheat",
              name: "",
              capacity: 0,
            },
          ],
          recipes: [],
          supplyBundles: [],
        }),
    ).toThrow(/stable ingredient/);
  });

  it("reports writer-readable narrative reference errors", () => {
    expect.assertions(3);
    try {
      new ContentRegistry({
        ingredients: [],
        recipes: [],
        supplyBundles: [],
        characters: [
          {
            id: "character.known",
            name: "Known",
            localizationKey:
              "localization.character.known.name",
          },
        ],
        customers: [
          {
            id: "customer.invalid",
            name: "Invalid",
            localizationKey:
              "localization.customer.invalid.name",
            characterId: "character.missing",
          },
        ],
        storyEvents: [
          {
            id: "story.invalid",
            title: "Invalid",
            localizationKey:
              "localization.story.invalid.body",
            presentation: "dialogue",
            priority: 1,
            characterIds: ["character.missing"],
            recipeId: "recipe.missing",
            prerequisiteEventIds: ["story.missing"],
            conditions: [
              {
                type: "online-dish-sales",
                dishItemId: "dish.missing",
                quantity: 1,
              },
            ],
          },
        ],
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ContentValidationError);
      const issues = (error as ContentValidationError).issues;
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/missing localization/),
          expect.stringMatching(/unknown character/),
          expect.stringMatching(/unknown recipe/),
          expect.stringMatching(/invalid prerequisite/),
          expect.stringMatching(/unknown dish/),
        ]),
      );
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("Content validation failed"),
      );
    }
  });
});
