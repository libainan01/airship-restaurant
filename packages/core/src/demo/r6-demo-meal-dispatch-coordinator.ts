import type { KitchenProductModule, LogisticsDemandModule } from "../modules";

/** Publishes one standard Logistics demand for each plated meal still on the airship. */
export class R6DemoMealDispatchCoordinator {
  readonly #products: KitchenProductModule;
  readonly #logistics: LogisticsDemandModule;
  readonly #groundLocationId: string;

  constructor(options: { readonly products: KitchenProductModule; readonly logistics: LogisticsDemandModule; readonly groundLocationId: string }) {
    if (options.groundLocationId.trim().length === 0) throw new Error("R6 Demo ground meal location is invalid.");
    this.#products = options.products;
    this.#logistics = options.logistics;
    this.#groundLocationId = options.groundLocationId;
  }

  synchronize(operationId: string, occurredAtUtcMs: number): readonly string[] {
    if (operationId.trim().length === 0 || !Number.isSafeInteger(occurredAtUtcMs) || occurredAtUtcMs < 0) throw new Error("R6 Demo meal dispatch request is invalid.");
    const groups = this.#logistics.exportState().groups;
    const created: string[] = [];
    for (const meal of this.#products.createReadModel().finishedMeals) {
      if (meal.locationId === this.#groundLocationId || groups.some((group) => group.ownerType === "demo-finished-meal" && group.ownerId === meal.mealId)) continue;
      const demandId = `demand.finished-meal.${meal.mealId}`;
      const result = this.#logistics.createDemand(`${operationId}:${meal.mealId}`, {
        id: demandId,
        kind: "finished-meal",
        sourceLocationId: meal.locationId,
        targetLocationId: this.#groundLocationId,
        itemId: meal.itemId,
        instanceId: meal.id,
        ownerType: "demo-finished-meal",
        ownerId: meal.mealId,
        quantity: 1,
        occurredAtUtcMs,
      });
      if (!result.accepted) throw new Error(result.message);
      created.push(demandId);
    }
    return Object.freeze(created);
  }
}