import { describe, expect, it } from "vitest";
import {
  FinanceModule,
  InventoryModule,
  OrderModule,
  RecipeExecutionModule,
  StaticInventoryStorageDefinitions,
  StaticOrderRecipeCatalog,
  StaticRecipeExecutionCatalog,
  projectRecipeBookReadModel,
  selectRecipeBookPage,
  type RecipeBookContentPort,
  type RecipeBookRecipeDefinition,
} from "../src";

const recipe: RecipeBookRecipeDefinition = Object.freeze({
  id: "recipe.tomato_egg",
  version: 2,
  name: "番茄炒蛋",
  durationMs: 60_000,
  outputItemId: "dish.tomato_egg",
  outputQuantity: 1,
  unitPriceCopper: 120,
  ingredients: Object.freeze([
    Object.freeze({ itemId: "ingredient.tomato", quantity: 3 }),
    Object.freeze({ itemId: "ingredient.egg", quantity: 2 }),
  ]),
  productionSteps: Object.freeze([
    Object.freeze({
      id: "step.tomato",
      name: "切番茄",
      durationMs: 10_000,
      stationTags: Object.freeze(["station.prep"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze([]),
    }),
    Object.freeze({
      id: "step.egg",
      name: "炒鸡蛋",
      durationMs: 15_000,
      stationTags: Object.freeze(["station.stir_fry"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze([]),
    }),
    Object.freeze({
      id: "step.finish",
      name: "汇合翻炒并装盘",
      durationMs: 20_000,
      stationTags: Object.freeze(["station.stir_fry", "station.plating"]),
      attendance: "required",
      prerequisiteStepIds: Object.freeze(["step.tomato", "step.egg"]),
    }),
  ]),
  detailedRecipe: Object.freeze({
    realWorldName: "家常番茄炒鸡蛋",
    servings: 2,
    ingredients: Object.freeze([
      Object.freeze({ name: "番茄", amount: "300 克" }),
      Object.freeze({ name: "鸡蛋", amount: "3 个" }),
      Object.freeze({ name: "盐", amount: "2 克" }),
      Object.freeze({ name: "食用油", amount: "15 毫升" }),
    ]),
    steps: Object.freeze([
      Object.freeze({ order: 2, instruction: "锅中放油，中火将蛋液炒至刚凝固后盛出。" }),
      Object.freeze({ order: 1, instruction: "番茄切块；鸡蛋打散并加入少量盐。" }),
      Object.freeze({ order: 3, instruction: "番茄炒出汁后倒回鸡蛋，调味并翻匀。" }),
    ]),
    notes: Object.freeze(["蛋液刚凝固就盛出，口感会更嫩。"]),
  }),
});

function contentPort(): RecipeBookContentPort {
  const ingredients = new Map([
    ["ingredient.tomato", Object.freeze({ id: "ingredient.tomato", name: "番茄" })],
    ["ingredient.egg", Object.freeze({ id: "ingredient.egg", name: "鸡蛋" })],
  ]);
  return Object.freeze({
    revision: 7,
    listRecipes: () => Object.freeze([recipe]),
    getIngredient: (id: string) => ingredients.get(id),
  });
}

describe("recipe book read model", () => {
  it("projects the integer game DAG and the real recipe as two layers of one dish", () => {
    const model = projectRecipeBookReadModel(contentPort());
    expect(model).toMatchObject({
      sourceRevision: 7,
      entries: [{
        recipeId: recipe.id,
        version: 2,
        displayName: "番茄炒蛋",
        gameplay: {
          layer: "gameplay",
          ingredients: [
            { itemId: "ingredient.tomato", name: "番茄", quantity: 3 },
            { itemId: "ingredient.egg", name: "鸡蛋", quantity: 2 },
          ],
          steps: [
            { id: "step.tomato", isRoot: true, isFinal: false, dependentStepIds: ["step.finish"] },
            { id: "step.egg", isRoot: true, isFinal: false, dependentStepIds: ["step.finish"] },
            { id: "step.finish", isRoot: false, isFinal: true, prerequisiteStepIds: ["step.tomato", "step.egg"] },
          ],
        },
        realWorld: {
          layer: "real-world",
          name: "家常番茄炒鸡蛋",
          servings: 2,
          ingredients: expect.arrayContaining([
            { name: "盐", amount: "2 克" },
            { name: "食用油", amount: "15 毫升" },
          ]),
          steps: [
            { order: 1 },
            { order: 2 },
            { order: 3 },
          ],
        },
      }],
    });
    const realSalt = model.entries[0]!.realWorld.ingredients.find((entry) => entry.name === "盐")!;
    expect(realSalt).not.toHaveProperty("itemId");
    expect(realSalt).not.toHaveProperty("quantity");
    expect(model.entries[0]!.gameplay.ingredients.some((entry) => entry.name === "盐")).toBe(false);
  });

  it("switches pages by immutable selection and returns null for an unknown recipe", () => {
    const model = projectRecipeBookReadModel(contentPort());
    const game = selectRecipeBookPage(model, recipe.id, "gameplay");
    const real = selectRecipeBookPage(model, recipe.id, "real-world");
    expect(game).toMatchObject({ layer: "gameplay", content: { layer: "gameplay", outputQuantity: 1 } });
    expect(real).toMatchObject({ layer: "real-world", content: { layer: "real-world", servings: 2 } });
    expect(selectRecipeBookPage(model, "recipe.unknown", "gameplay")).toBeNull();
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.entries)).toBe(true);
    expect(Object.isFrozen(model.entries[0]!.realWorld.ingredients)).toBe(true);
  });

  it("cannot mutate inventory, orders, or recipe executions while reading and switching", () => {
    const inventory = new InventoryModule(
      [{ id: "ingredient.tomato", category: "ingredient", storageMode: "stack" }],
      new StaticInventoryStorageDefinitions([{
        id: "storage.airship",
        compartments: [{ id: "ingredients", capacity: 10, acceptedCategories: ["ingredient"] }],
      }]),
    );
    inventory.depositStack("seed", "storage.airship", [{ itemId: "ingredient.tomato", quantity: 3 }], 1);
    const orders = new OrderModule({
      finance: new FinanceModule(1_000),
      inventory,
      recipeCatalog: new StaticOrderRecipeCatalog([{
        id: recipe.id,
        ingredients: [{ itemId: "ingredient.tomato", quantity: 3 }],
      }]),
      ingredientSources: [{ kind: "stack", locationId: "storage.airship" }],
    });
    const executions = new RecipeExecutionModule({
      catalog: new StaticRecipeExecutionCatalog([{
        id: recipe.id,
        version: recipe.version,
        outputItemId: recipe.outputItemId,
        ingredients: [{ itemId: "ingredient.tomato", quantity: 3 }],
        steps: [{
          id: "step.cook",
          name: "烹饪",
          durationMs: 1_000,
          requiredCapabilityIds: ["station.stir_fry"],
          attendance: "required",
          prerequisiteStepIds: [],
          ingredientInputs: [{ itemId: "ingredient.tomato", quantity: 3 }],
          outputItemId: recipe.outputItemId,
          outputQuantity: 1,
          qualityWeight: 1,
        }],
      }]),
    });
    const before = {
      inventory: inventory.exportState(),
      orders: orders.exportState(),
      executions: executions.exportState(),
    };

    const model = projectRecipeBookReadModel(contentPort());
    for (let index = 0; index < 20; index += 1) {
      selectRecipeBookPage(model, recipe.id, index % 2 === 0 ? "gameplay" : "real-world");
    }
    expect(inventory.exportState()).toEqual(before.inventory);
    expect(orders.exportState()).toEqual(before.orders);
    expect(executions.exportState()).toEqual(before.executions);
  });
});
