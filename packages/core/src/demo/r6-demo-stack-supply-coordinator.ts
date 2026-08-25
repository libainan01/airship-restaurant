import type { InventoryModule, LogisticsDemandModule } from "../modules";

export interface R6DemoStackSupplyTarget {
  readonly id: string;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly itemId: string;
  readonly targetQuantity: number;
}

export interface R6DemoStackSupplySnapshot extends R6DemoStackSupplyTarget {
  readonly currentQuantity: number;
  readonly incomingQuantity: number;
  readonly missingQuantity: number;
  readonly sourceAvailableQuantity: number;
}

export interface R6DemoSupplySynchronizationResult {
  readonly snapshots: readonly R6DemoStackSupplySnapshot[];
  readonly createdDemandIds: readonly string[];
}

/**
 * Demo application coordinator for stack replenishment targets. It never moves
 * inventory: it only translates an uncovered target into standard Logistics
 * demand groups, leaving reservation and transport to the logistics modules.
 */
export class R6DemoStackSupplyCoordinator {
  readonly #inventory: InventoryModule;
  readonly #logistics: LogisticsDemandModule;
  readonly #targets: readonly R6DemoStackSupplyTarget[];

  constructor(options: {
    readonly inventory: InventoryModule;
    readonly logistics: LogisticsDemandModule;
    readonly targets: readonly R6DemoStackSupplyTarget[];
  }) {
    const ids = new Set<string>();
    for (const target of options.targets) {
      if (target.id.trim().length === 0 || ids.has(target.id) || target.sourceLocationId === target.targetLocationId || !Number.isSafeInteger(target.targetQuantity) || target.targetQuantity < 0) {
        throw new Error(`Invalid R6 Demo stack supply target: ${target.id}`);
      }
      if (options.inventory.getLocationSnapshot(target.sourceLocationId) === null || options.inventory.getLocationSnapshot(target.targetLocationId) === null) {
        throw new Error(`Unknown R6 Demo supply location: ${target.id}`);
      }
      ids.add(target.id);
    }
    this.#inventory = options.inventory;
    this.#logistics = options.logistics;
    this.#targets = Object.freeze(options.targets.map((target) => Object.freeze({ ...target })));
  }

  getSnapshot(): readonly R6DemoStackSupplySnapshot[] {
    const groups = this.#logistics.exportState().groups;
    return Object.freeze(this.#targets.map((target) => {
      const currentQuantity = this.#inventory.getStackQuantity(target.targetLocationId, target.itemId);
      const incomingQuantity = groups
        .filter((group) => group.ownerType === "demo-stack-supply" && group.ownerId === target.id && group.status === "in-progress")
        .reduce((sum, group) => sum + group.requestedQuantity - group.deliveredQuantity, 0);
      const missingQuantity = Math.max(0, target.targetQuantity - currentQuantity - incomingQuantity);
      return Object.freeze({
        ...target,
        currentQuantity,
        incomingQuantity,
        missingQuantity,
        sourceAvailableQuantity: this.#inventory.getLocationSnapshot(target.sourceLocationId)?.stacks.find((stack) => stack.itemId === target.itemId)?.availableQuantity ?? 0,
      });
    }));
  }

  synchronize(operationId: string, occurredAtUtcMs: number): R6DemoSupplySynchronizationResult {
    if (operationId.trim().length === 0 || !Number.isSafeInteger(occurredAtUtcMs) || occurredAtUtcMs < 0) {
      throw new Error("R6 Demo supply synchronization request is invalid.");
    }
    const before = this.getSnapshot();
    const createdDemandIds: string[] = [];
    for (const target of before) {
      const quantity = Math.min(target.missingQuantity, target.sourceAvailableQuantity);
      if (quantity <= 0) continue;
      const previousCount = this.#logistics.exportState().groups.filter((group) => group.ownerType === "demo-stack-supply" && group.ownerId === target.id).length;
      const demandId = `demand.${target.id}.${previousCount + 1}`;
      const created = this.#logistics.createDemand(`${operationId}:${target.id}`, {
        id: demandId,
        kind: "replenishment",
        sourceLocationId: target.sourceLocationId,
        targetLocationId: target.targetLocationId,
        itemId: target.itemId,
        ownerType: "demo-stack-supply",
        ownerId: target.id,
        quantity,
        replenishmentCoverageBasisPoints: target.targetQuantity === 0 ? 10_000 : Math.floor(target.currentQuantity * 10_000 / target.targetQuantity),
        occurredAtUtcMs,
      });
      if (!created.accepted) throw new Error(created.message);
      createdDemandIds.push(demandId);
    }
    return Object.freeze({ snapshots: this.getSnapshot(), createdDemandIds: Object.freeze(createdDemandIds) });
  }
}