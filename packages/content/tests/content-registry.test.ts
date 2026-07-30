import { describe, expect, it } from "vitest";
import {
  ContentRegistry,
  ContentValidationError,
  M2_INITIAL_INGREDIENTS,
  createM2ContentRegistry,
} from "../src";

describe("M2 content", () => {
  it("loads M2 gameplay and the formal M3 dialogue slice", () => {
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
    expect(registry.listCharacters()).toHaveLength(4);
    expect(registry.listCustomers()).toHaveLength(2);
    expect(registry.listStoryEvents()).toHaveLength(1);
    expect(registry.listRecipeJournals()).toHaveLength(1);
    expect(registry.listLocations()).toHaveLength(1);
    expect(registry.listDialogueSpeakers()).toHaveLength(25);
    expect(registry.listAmbientDialogues()).toHaveLength(21);
    expect(registry.listStoryDialogues()).toHaveLength(7);
    expect(
      registry.getStoryEvent("story.bell_stew_first_service"),
    ).toMatchObject({
      presentation: "recipe-log",
      recipeId: "recipe.homecoming_stew",
      dialogueId: "dialogue.story.bell_stew_first_service",
    });
    expect(
      registry.getDialogue("dialogue.ambient.d001_cold_wind"),
    ).toMatchObject({
      kind: "ambient",
      locationId: "location.greyfeather_beacon",
      contexts: ["waiting"],
      minimumFamiliarity: "new",
    });
    const firstAmbientLine = registry
      .getDialogue("dialogue.ambient.d001_cold_wind")
      ?.lines[0];
    expect(
      firstAmbientLine === undefined
        ? undefined
        : registry.getLocalizedText(
            firstAmbientLine.localizationKey,
          ),
    ).toBe("先来碗热汤。风快把耳朵刮走了。");
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

  it("reports writer-readable dialogue metadata errors", () => {
    expect.assertions(2);
    try {
      new ContentRegistry({
        ingredients: [],
        recipes: [],
        supplyBundles: [],
        locations: [
          {
            id: "location.known",
            name: "Known",
            localizationKey: "localization.location.known.name",
          },
        ],
        dialogueSpeakers: [
          {
            id: "speaker.invalid",
            name: "Invalid",
            localizationKey:
              "localization.speaker.invalid.name",
            characterId: "character.missing",
          },
        ],
        dialogues: [
          {
            id: "dialogue.ambient.invalid",
            kind: "ambient",
            locationId: "location.missing",
            contexts: ["waiting", "waiting"],
            minimumFamiliarity: "new",
            weight: 0,
            cooldownMs: -1,
            maxPlaysPerSession: 0,
            prerequisiteEventIds: ["story.missing"],
            lines: [
              {
                speakerId: "speaker.missing",
                localizationKey:
                  "localization.dialogue.invalid.line_1",
                durationMs: 0,
              },
            ],
          },
        ],
        localizations: {
          "localization.location.known.name": "Known",
        },
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/unknown character/),
          expect.stringMatching(/missing localization/),
          expect.stringMatching(/unknown speaker/),
          expect.stringMatching(/duration must be a positive integer/),
          expect.stringMatching(/unknown location/),
          expect.stringMatching(/unique valid contexts/),
          expect.stringMatching(/weight, cooldown and session limit/),
          expect.stringMatching(/unknown prerequisite/),
        ]),
      );
    }
  });
});
