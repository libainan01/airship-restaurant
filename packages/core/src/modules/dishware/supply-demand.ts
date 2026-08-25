import type { InventoryModule } from "../inventory";
import type { DishwareModule } from "./index";

export interface DishwareSupplyTargetDefinition {
  readonly id: string;
  readonly sourceCleanStorageLocationId: string;
  readonly targetCleanStorageLocationId: string;
  readonly targetQuantity: number;
}

export type DishwareSupplyBlockReason = "NONE" | "NO_CLEAN_SOURCE";

export interface DishwareSupplyNeedSnapshot {
  readonly targetId: string;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly targetQuantity: number;
  readonly currentTargetQuantity: number;
  readonly arrangedIncomingQuantity: number;
  readonly missingQuantity: number;
  readonly availableSourcePlateIds: readonly string[];
  readonly requestableQuantity: number;
  readonly blockReason: DishwareSupplyBlockReason;
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

/**
 * Pure demand projection. It creates no transport task itself; R6 Logistics will
 * consume the missing/requestable quantities and reserve one destination slot at
 * a time.
 */
export class DishwareSupplyDemandProjector {
  readonly #dishware: DishwareModule;
  readonly #inventory: InventoryModule;
  readonly #targets: readonly DishwareSupplyTargetDefinition[];

  constructor(options: {
    readonly dishware: DishwareModule;
    readonly inventory: InventoryModule;
    readonly targets: readonly DishwareSupplyTargetDefinition[];
  }) {
    const ids = new Set<string>();
    for (const target of options.targets) {
      if (!validId(target.id) || ids.has(target.id) ||
        !validId(target.sourceCleanStorageLocationId) ||
        !validId(target.targetCleanStorageLocationId) ||
        !Number.isSafeInteger(target.targetQuantity) || target.targetQuantity < 0) {
        throw new Error(`Invalid or duplicate dishware supply target: ${target.id}`);
      }
      ids.add(target.id);
    }
    this.#dishware = options.dishware;
    this.#inventory = options.inventory;
    this.#targets = Object.freeze(options.targets.map((target) => Object.freeze({ ...target })));
  }

  getSnapshot(): readonly DishwareSupplyNeedSnapshot[] {
    const dishware = this.#dishware.getSnapshot();
    const inventory = this.#inventory.getSnapshot();
    const statusByPlate = new Map(dishware.plates.map((plate) => [plate.id, plate.status]));
    const reservedPlateIds = new Set(inventory.reservations.flatMap((entry) => entry.instanceIds));
    return Object.freeze(this.#targets.map((target): DishwareSupplyNeedSnapshot => {
      const currentTargetQuantity = inventory.locations
        .find((location) => location.id === target.targetCleanStorageLocationId)
        ?.instances.filter((entry) => statusByPlate.get(entry.id) === "clean").length ?? 0;
      const arrangedIncomingQuantity = inventory.capacityReservations
        .filter((reservation) =>
          reservation.ownerType === "dishware-supply" &&
          reservation.ownerId === target.id &&
          reservation.locationId === target.targetCleanStorageLocationId,
        )
        .reduce((sum, reservation) => sum + reservation.quantity, 0);
      const missingQuantity = Math.max(
        0,
        target.targetQuantity - currentTargetQuantity - arrangedIncomingQuantity,
      );
      const availableSourcePlateIds = inventory.locations
        .find((location) => location.id === target.sourceCleanStorageLocationId)
        ?.instances
        .filter((entry) => statusByPlate.get(entry.id) === "clean" && !reservedPlateIds.has(entry.id))
        .map((entry) => entry.id)
        .sort((left, right) => left.localeCompare(right)) ?? [];
      const requestableQuantity = Math.min(missingQuantity, availableSourcePlateIds.length);
      return Object.freeze({
        targetId: target.id,
        sourceLocationId: target.sourceCleanStorageLocationId,
        targetLocationId: target.targetCleanStorageLocationId,
        targetQuantity: target.targetQuantity,
        currentTargetQuantity,
        arrangedIncomingQuantity,
        missingQuantity,
        availableSourcePlateIds: Object.freeze(availableSourcePlateIds),
        requestableQuantity,
        blockReason: missingQuantity > 0 && availableSourcePlateIds.length === 0
          ? "NO_CLEAN_SOURCE"
          : "NONE",
      });
    }));
  }
}
