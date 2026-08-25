import type {
  InventoryModule,
  LogisticsDemandModule,
} from "../modules";
import type {
  RestaurantApplicationProcess,
  RestaurantApplicationProcessContext,
  RestaurantApplicationProcessResult,
} from "./restaurant-application-runtime";

export interface RestaurantInventoryReplenishmentTarget {
  readonly itemId: string;
  readonly targetQuantity: number;
}

export interface RestaurantInventoryReplenishmentProcessOptions {
  readonly inventory: InventoryModule;
  readonly logistics: LogisticsDemandModule;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly targets: readonly RestaurantInventoryReplenishmentTarget[];
}

function quantityAt(
  inventory: InventoryModule,
  locationId: string,
  itemId: string,
): number {
  return inventory.getLocationSnapshot(locationId)?.stacks
    .filter((entry) => entry.itemId === itemId)
    .reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
}

/** Creates only the missing ground-to-airship ingredient demand. */
export class RestaurantInventoryReplenishmentProcess
implements RestaurantApplicationProcess {
  readonly id = "25-inventory-replenishment";
  readonly #options: RestaurantInventoryReplenishmentProcessOptions;

  constructor(options: RestaurantInventoryReplenishmentProcessOptions) {
    if (
      options.sourceLocationId.trim().length === 0 ||
      options.targetLocationId.trim().length === 0 ||
      options.sourceLocationId === options.targetLocationId ||
      options.targets.length === 0 ||
      new Set(options.targets.map((target) => target.itemId)).size !== options.targets.length ||
      options.targets.some((target) =>
        target.itemId.trim().length === 0 ||
        !Number.isSafeInteger(target.targetQuantity) ||
        target.targetQuantity < 0)
    ) {
      throw new Error("Restaurant inventory replenishment configuration is invalid.");
    }
    if (
      options.inventory.getLocationSnapshot(options.sourceLocationId) === null ||
      options.inventory.getLocationSnapshot(options.targetLocationId) === null
    ) {
      throw new Error("Restaurant inventory replenishment storage is missing.");
    }
    this.#options = Object.freeze({
      ...options,
      targets: Object.freeze(options.targets.map((target) => Object.freeze({ ...target }))),
    });
  }

  advance(context: RestaurantApplicationProcessContext): RestaurantApplicationProcessResult {
    let changed = false;
    const groups = this.#options.logistics.exportState().groups;
    for (const target of this.#options.targets) {
      if (target.targetQuantity === 0) continue;
      const current = quantityAt(
        this.#options.inventory,
        this.#options.targetLocationId,
        target.itemId,
      );
      const incoming = groups
        .filter((group) =>
          group.status === "in-progress" &&
          group.kind === "replenishment" &&
          group.sourceLocationId === this.#options.sourceLocationId &&
          group.targetLocationId === this.#options.targetLocationId &&
          group.itemId === target.itemId)
        .reduce((sum, group) => sum + group.requestedQuantity - group.deliveredQuantity, 0);
      const availableAtSource = quantityAt(
        this.#options.inventory,
        this.#options.sourceLocationId,
        target.itemId,
      );
      const quantity = Math.min(
        availableAtSource,
        Math.max(0, target.targetQuantity - current - incoming),
      );
      if (quantity === 0) continue;
      const result = this.#options.logistics.createDemand(
        `${context.operationId}:demand:${target.itemId}`,
        {
          id: `demand.replenishment.${context.cycle}.${target.itemId}`,
          kind: "replenishment",
          sourceLocationId: this.#options.sourceLocationId,
          targetLocationId: this.#options.targetLocationId,
          itemId: target.itemId,
          ownerType: "inventory-replenishment",
          ownerId: this.#options.targetLocationId,
          quantity,
          replenishmentCoverageBasisPoints: Math.floor(
            current * 10_000 / target.targetQuantity,
          ),
          occurredAtUtcMs: context.targetUtcMs,
        },
      );
      if (!result.accepted) {
        throw new Error(result.message ?? `Unable to create replenishment demand for ${target.itemId}.`);
      }
      changed ||= result.changed;
    }
    return Object.freeze({ changed, nextTransitionUtcMs: null });
  }
}