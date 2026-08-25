import type {
  GameplayInventoryContainerSnapshot,
  GameplayProcurementItemSnapshot,
  GameplayProcurementSnapshot,
} from "@airship-restaurant/contracts";
import {
  MANAGEMENT_INGREDIENT_CAPACITIES,
  MANAGEMENT_RECIPES,
} from "../../management-content";

export type ProcurementMode = "free" | "recipe";
export type QuantitySelection = Readonly<Record<string, number>>;

export interface ProcurementDraft {
  readonly mode: ProcurementMode;
  readonly freeSelection: QuantitySelection;
  readonly recipeSelection: QuantitySelection;
  readonly allowedRecipeIds?: ReadonlySet<string>;
}

export interface ProcurementPlanRegion {
  readonly id: string;
  readonly name: string;
  readonly unlocked: boolean;
  readonly durationMs: number;
  readonly quantity: number;
  readonly costCopper: number;
  readonly items: readonly GameplayProcurementItemSnapshot[];
}

export interface ProcurementPlan {
  readonly items: readonly GameplayProcurementItemSnapshot[];
  readonly totalQuantity: number;
  readonly totalCostCopper: number;
  readonly blockedByLockedPort: boolean;
  readonly exceedsCapacity: boolean;
  readonly regions: readonly ProcurementPlanRegion[];
}

export interface ProcurementPlanningSnapshot {
  readonly inventory: {
    readonly kitchenIngredients: Pick<
      GameplayInventoryContainerSnapshot,
      "entries" | "availableCapacity"
    >;
  };
  readonly procurement: Pick<
    GameplayProcurementSnapshot,
    "regions" | "incomingItems"
  >;
}

export function adjustQuantitySelection(
  current: QuantitySelection,
  id: string,
  delta: number,
): QuantitySelection {
  return {
    ...current,
    [id]: Math.max(
      0,
      Math.min(99, (current[id] ?? 0) + delta),
    ),
  };
}

export function subtractQuantitySelection(
  current: QuantitySelection,
  submitted: QuantitySelection,
): QuantitySelection {
  return Object.fromEntries(
    Object.entries(current).flatMap(([id, quantity]) => {
      const remaining = quantity - (submitted[id] ?? 0);
      return remaining > 0 ? [[id, remaining]] : [];
    }),
  );
}
export function buildProcurementPlan(
  gameplay: ProcurementPlanningSnapshot,
  draft: ProcurementDraft,
): ProcurementPlan {
  const requested = new Map<string, number>();
  if (draft.mode === "free") {
    for (const [itemId, quantity] of Object.entries(
      draft.freeSelection,
    )) {
      if (quantity > 0) requested.set(itemId, quantity);
    }
  } else {
    for (const recipe of MANAGEMENT_RECIPES) {
      if (draft.allowedRecipeIds !== undefined &&
          !draft.allowedRecipeIds.has(recipe.id)) continue;
      const batches = draft.recipeSelection[recipe.id] ?? 0;
      if (batches <= 0) continue;
      for (const ingredient of recipe.ingredients) {
        requested.set(
          ingredient.itemId,
          (requested.get(ingredient.itemId) ?? 0) +
            ingredient.quantity * batches,
        );
      }
    }

    const pantry = new Map(
      gameplay.inventory.kitchenIngredients.entries.map((entry) => [
        entry.itemId,
        entry.availableQuantity,
      ]),
    );
    const incoming = new Map(
      gameplay.procurement.incomingItems.map((entry) => [
        entry.itemId,
        entry.quantity,
      ]),
    );
    for (const [itemId, quantity] of requested) {
      requested.set(
        itemId,
        Math.max(
          0,
          quantity -
            (pantry.get(itemId) ?? 0) -
            (incoming.get(itemId) ?? 0),
        ),
      );
    }
  }

  const regions = gameplay.procurement.regions.flatMap((region) => {
    const items: GameplayProcurementItemSnapshot[] =
      region.items.flatMap((marketItem) => {
        const quantity = requested.get(marketItem.itemId) ?? 0;
        return quantity > 0
          ? [{ itemId: marketItem.itemId, quantity }]
          : [];
      });
    if (items.length === 0) return [];

    const quantity = items.reduce(
      (total, item) => total + item.quantity,
      0,
    );
    const itemCost = items.reduce((total, item) => {
      const price = region.items.find(
        (marketItem) => marketItem.itemId === item.itemId,
      )?.unitPriceCopper ?? 0;
      return total + item.quantity * price;
    }, 0);
    return [{
      id: region.id,
      name: region.name,
      unlocked: region.unlocked,
      durationMs: region.deliveryDurationMs,
      quantity,
      costCopper:
        itemCost +
        Math.ceil(quantity / region.cargoCapacity) *
          region.freightCostCopper,
      items,
    }];
  });

  const items = [...requested.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));
  const totalQuantity = items.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const incomingTotal = gameplay.procurement.incomingItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  return {
    items,
    totalQuantity,
    totalCostCopper: regions.reduce(
      (total, region) => total + region.costCopper,
      0,
    ),
    blockedByLockedPort: regions.some((region) => !region.unlocked),
    exceedsCapacity:
      totalQuantity >
        gameplay.inventory.kitchenIngredients.availableCapacity -
          incomingTotal ||
      items.some((item) => {
        const current =
          gameplay.inventory.kitchenIngredients.entries.find(
            (entry) => entry.itemId === item.itemId,
          )?.quantity ?? 0;
        const incoming =
          gameplay.procurement.incomingItems.find(
            (entry) => entry.itemId === item.itemId,
          )?.quantity ?? 0;
        const capacity =
          MANAGEMENT_INGREDIENT_CAPACITIES.get(item.itemId) ?? 0;
        return current + incoming + item.quantity > capacity;
      }),
    regions,
  };
}
