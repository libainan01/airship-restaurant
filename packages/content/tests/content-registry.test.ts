import { describe, expect, it } from "vitest";
import {
  ContentRegistry,
  ContentValidationError,
  M2_CONTENT_DEFINITIONS,
  M2_INITIAL_INGREDIENTS,
  createM2ContentRegistry,
} from "../src";
import {
  M3_AMBIENT_DIALOGUES,
  M3_DIALOGUES,
  M3_DIALOGUE_LOCALIZATIONS,
  M3_STORY_DIALOGUES,
} from "../src/m3-dialogue-content";

describe("M2 content", () => {
  it("loads M2 gameplay and the formal M3 dialogue slice", () => {
    const registry = createM2ContentRegistry();
    expect(registry.listIngredients()).toHaveLength(7);
    expect(registry.listRecipes()).toHaveLength(4);
    expect(registry.listSupplyBundles()).toHaveLength(1);
    expect(registry.getRecipe("recipe.tomato_scrambled_egg")).toMatchObject({
      name: "番茄炒蛋",
      outputItemId: "dish.tomato_scrambled_egg",
      ingredients: [
        { itemId: "ingredient.egg", quantity: 2 },
        { itemId: "ingredient.tomato", quantity: 3 },
      ],
      productionSteps: [
        { id: "step.process_tomato", prerequisiteStepIds: [] },
        { id: "step.whisk_egg", prerequisiteStepIds: [] },
        { id: "step.fry_tomato", prerequisiteStepIds: ["step.process_tomato"] },
        { id: "step.fry_egg", prerequisiteStepIds: ["step.whisk_egg"] },
        { id: "step.combine", prerequisiteStepIds: ["step.fry_tomato", "step.fry_egg"] },
        { id: "step.plate", prerequisiteStepIds: ["step.combine"] },
      ],
      detailedRecipe: {
        realWorldName: "家常番茄炒鸡蛋",
        servings: 2,
        ingredients: expect.arrayContaining([
          { name: "番茄", amount: "300 克（约 2 个中等大小）" },
          { name: "食用油", amount: "20 毫升" },
          { name: "盐", amount: "2 克" },
        ]),
        steps: [{ order: 1 }, { order: 2 }, { order: 3 }, { order: 4 }, { order: 5 }],
      },
    });
    expect(
      registry.getRecipe("recipe.hearth_flatbread"),
    ).toMatchObject({
      version: 1,
      durationMs: 45_000,
      outputItemId: "dish.hearth_flatbread",
      outputQuantity: 2,
      unitPriceCopper: 4,
    });
    expect(registry.listCharacters()).toHaveLength(5);
    expect(registry.listCustomers()).toHaveLength(2);
    expect(registry.listStoryEvents()).toHaveLength(1);
    expect(registry.listStorySequences()).toHaveLength(1);
    expect(registry.getPrimaryStorySequence()).toMatchObject({
      id: "sequence.greyfeather.first_service",
      isPrimary: true,
    });
    expect(registry.getPrimaryStorySequence()?.stages[0]).toMatchObject({
      id: "stage.greyfeather.arrival",
    });
    expect(registry.listRecipeJournals()).toHaveLength(1);
    expect(registry.listStoryCharacters()).toHaveLength(2);
    expect(registry.listStoryRosterNodes()).toHaveLength(2);
    expect(registry.listMealAffinityQualityTiers()).toEqual([
      { qualityTier: 1, minimumQuality: 1, affinityIncrease: 1 },
      { qualityTier: 2, minimumQuality: 3, affinityIncrease: 2 },
      { qualityTier: 3, minimumQuality: 5, affinityIncrease: 4 },
    ]);
    expect(registry.getStoryCharacter("character.martha_bell")).toMatchObject({
      identityLocalizationKey: "localization.story_profile.martha_bell.identity",
      relationshipTiers: [
        { id: "relationship.new", minimumAffinity: 0 },
        { id: "relationship.familiar", minimumAffinity: 5 },
        { id: "relationship.trusted", minimumAffinity: 15 },
      ],
    });
    expect(registry.getStoryRosterNode("story_node.martha_bell.first_service")).toMatchObject({
      sequence: 1,
      rewardContentIds: ["region.windroot"],
    });
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

  it("aggregates the split ambient and story dialogue modules", () => {
    expect(M3_AMBIENT_DIALOGUES).toHaveLength(21);
    expect(M3_STORY_DIALOGUES).toHaveLength(7);
    expect(M3_DIALOGUES).toEqual([
      ...M3_AMBIENT_DIALOGUES,
      ...M3_STORY_DIALOGUES,
    ]);

    for (const dialogue of M3_DIALOGUES) {
      for (const line of dialogue.lines) {
        expect(
          M3_DIALOGUE_LOCALIZATIONS[line.localizationKey],
          `${dialogue.id} is missing ${line.localizationKey}`,
        ).toBeTypeOf("string");
      }
    }
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
  it("rejects invalid story sequence references and ambiguous primary entries", () => {
    const primary = M2_CONTENT_DEFINITIONS.storySequences?.[0];
    expect(primary).toBeDefined();
    if (primary === undefined) return;

    const invalidDialogue = {
      ...primary,
      stages: primary.stages.map((stage, index) => index === 0
        ? { ...stage, dialogueId: "dialogue.ambient.d001_cold_wind" }
        : stage),
    };
    expect(() => new ContentRegistry({
      ...M2_CONTENT_DEFINITIONS,
      storySequences: [invalidDialogue],
    })).toThrowError(/must reference a story dialogue/i);

    expect(() => new ContentRegistry({
      ...M2_CONTENT_DEFINITIONS,
      storySequences: [primary, { ...primary, id: "sequence.second_primary" }],
    })).toThrowError(/exactly one primary sequence/i);
  });

  it("rejects unknown prerequisites, cycles, and multiple production sinks at content load", () => {
    const base = M2_CONTENT_DEFINITIONS.recipes.find(
      (recipe) => recipe.id === "recipe.homecoming_stew",
    )!;
    const expectRecipeIssue = (
      productionSteps: typeof base.productionSteps,
      pattern: RegExp,
    ) => {
      try {
        new ContentRegistry({
          ...M2_CONTENT_DEFINITIONS,
          recipes: [{ ...base, productionSteps }],
        });
        throw new Error("Expected invalid recipe graph to be rejected.");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ContentValidationError);
        expect((error as ContentValidationError).issues).toEqual(
          expect.arrayContaining([expect.stringMatching(pattern)]),
        );
      }
    };

    expectRecipeIssue(
      base.productionSteps.map((step) => step.id === "step.finish_stew"
        ? { ...step, prerequisiteStepIds: [...step.prerequisiteStepIds, "step.missing"] }
        : step),
      /invalid prerequisite.*step\.missing/i,
    );
    expectRecipeIssue(
      base.productionSteps.map((step) => step.id === "step.chop_vegetables"
        ? { ...step, prerequisiteStepIds: ["step.finish_stew"] }
        : step),
      /contain a cycle/i,
    );
    expectRecipeIssue(
      base.productionSteps.map((step) => step.id === "step.finish_stew"
        ? { ...step, prerequisiteStepIds: ["step.simmer_meat"] }
        : step),
      /exactly one final production step/i,
    );
  });
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

  it("reports story roster reference and ordering errors", () => {
    const firstNode = M2_CONTENT_DEFINITIONS.storyRosterNodes![0]!;
    expect(() => new ContentRegistry({
      ...M2_CONTENT_DEFINITIONS,
      storyRosterNodes: [{
        ...firstNode,
        rewardContentIds: ["region.missing"],
        prerequisiteNodeIds: ["story_node.missing"],
      }],
    })).toThrow(ContentValidationError);

    try {
      new ContentRegistry({
        ...M2_CONTENT_DEFINITIONS,
        storyRosterNodes: [{
          ...firstNode,
          rewardContentIds: ["region.missing"],
          prerequisiteNodeIds: ["story_node.missing"],
        }],
      });
    } catch (error: unknown) {
      expect((error as ContentValidationError).issues).toEqual(expect.arrayContaining([
        expect.stringMatching(/unknown progression reward.*region\.missing/i),
        expect.stringMatching(/invalid prerequisite.*story_node\.missing/i),
      ]));
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
