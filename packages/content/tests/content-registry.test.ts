import { describe, expect, it } from "vitest";
import {
  ContentRegistry,
  ContentValidationError,
  M2_INITIAL_INGREDIENTS,
  createM2ContentRegistry,
} from "../src";

describe("M2 content", () => {
  it("loads five ingredients, three recipes and one supply bundle", () => {
    const registry = createM2ContentRegistry();
    expect(registry.listIngredients()).toHaveLength(5);
    expect(registry.listRecipes()).toHaveLength(3);
    expect(registry.listSupplyBundles()).toHaveLength(1);
    expect(
      registry.getRecipe("recipe.hearth_flatbread"),
    ).toMatchObject({
      durationMs: 45_000,
      outputQuantity: 2,
      unitPriceCopper: 4,
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
});
