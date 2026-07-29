export interface ContentQuantity {
  readonly itemId: string;
  readonly quantity: number;
}

export interface IngredientDefinition {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
}

export interface RecipeDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly outputQuantity: number;
  readonly unitPriceCopper: number;
  readonly ingredients: readonly ContentQuantity[];
}

export interface SupplyBundleDefinition {
  readonly id: string;
  readonly name: string;
  readonly intervalMs: number;
  readonly items: readonly ContentQuantity[];
}

export interface ContentDefinitions {
  readonly ingredients: readonly IngredientDefinition[];
  readonly recipes: readonly RecipeDefinition[];
  readonly supplyBundles: readonly SupplyBundleDefinition[];
}
