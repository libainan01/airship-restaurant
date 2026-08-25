import type { GameCommand, ManualLogisticsReadModel } from "@airship-restaurant/contracts";
import type { InventoryModule, LogisticsDemandModule } from "../modules";
import type { RuntimeCommandExtensionPort, RuntimeCommandExtensionResult } from "./instance-upgrade-runtime";

const MAX_COMMAND_HISTORY = 4_096;
export class ManualLogisticsRuntime implements RuntimeCommandExtensionPort {
  readonly #logistics: LogisticsDemandModule;
  readonly #inventory: InventoryModule;
  readonly #stationLocationIds: ReadonlySet<string>;
  readonly #clock: { nowUtcMs(): number };
  readonly #onChanged: () => void;
  readonly #processed = new Set<string>();
  readonly #history: string[] = [];
  constructor(options: {
    readonly logistics: LogisticsDemandModule;
    readonly inventory: InventoryModule;
    readonly stationLocationIds: readonly string[];
    readonly clock: { nowUtcMs(): number };
    readonly onChanged?: () => void;
  }) {
    if (options.stationLocationIds.length < 2 || new Set(options.stationLocationIds).size !== options.stationLocationIds.length || options.stationLocationIds.some((id) => id.trim().length === 0)) {
      throw new Error("Manual logistics stations are invalid.");
    }
    this.#logistics = options.logistics;
    this.#inventory = options.inventory;
    this.#stationLocationIds = new Set(options.stationLocationIds);
    this.#clock = options.clock;
    this.#onChanged = options.onChanged ?? (() => undefined);
  }
  getSnapshot(): ManualLogisticsReadModel {
    const logistics = this.#logistics.exportState();
    const inventory = this.#inventory.getSnapshot();
    return Object.freeze({
      sourceRevision: logistics.revision + inventory.revision,
      commandsAvailable: true,
      stationLocationIds: Object.freeze([...this.#stationLocationIds]),
      demands: Object.freeze(logistics.groups.filter((group) => group.kind === "manual").sort((a, b) => a.manualOrder - b.manualOrder || a.createdAtUtcMs - b.createdAtUtcMs || a.id.localeCompare(b.id)).map((group) => Object.freeze({
        id: group.id,
        sourceLocationId: group.sourceLocationId,
        targetLocationId: group.targetLocationId,
        itemId: group.itemId,
        requestedQuantity: group.requestedQuantity,
        claimedQuantity: group.claimedQuantity,
        deliveredQuantity: group.deliveredQuantity,
        remainingQuantity: group.remainingQuantity,
        status: group.status,
        blockReason: group.blockReason,
        manualOrder: group.manualOrder,
      }))),
    });
  }
  dispatch(command: GameCommand): RuntimeCommandExtensionResult {
    if (!command.type.startsWith("logistics.")) return Object.freeze({ handled: false });
    if (this.#processed.has(command.id)) return Object.freeze({ handled: true, accepted: false, message: "The manual logistics command id has already been processed." });
    this.#remember(command.id);
    const now = this.#clock.nowUtcMs();
    let result;
    switch (command.type) {
      case "logistics.create-manual": {
        if (!this.#stationLocationIds.has(command.payload.sourceLocationId) || !this.#stationLocationIds.has(command.payload.targetLocationId)) {
          return Object.freeze({ handled: true, accepted: false, message: "Manual logistics can only run between exchange stations." });
        }
        result = this.#logistics.createDemand(command.id, {
          id: command.payload.groupId,
          kind: "manual",
          sourceLocationId: command.payload.sourceLocationId,
          targetLocationId: command.payload.targetLocationId,
          itemId: command.payload.itemId,
          ownerType: "player",
          ownerId: "manual-logistics",
          quantity: command.payload.quantity,
          occurredAtUtcMs: now,
        });
        break;
      }
      case "logistics.update-manual":
        result = this.#logistics.updateManualDemand(command.id, command.payload.groupId, { remainingQuantity: command.payload.remainingQuantity, occurredAtUtcMs: now });
        break;
      case "logistics.stop-manual":
        result = this.#logistics.stopDemand(command.id, command.payload.groupId, now);
        break;
      default:
        return Object.freeze({ handled: true, accepted: false, message: "Unknown manual logistics command." });
    }
    if (!result.accepted) return Object.freeze({ handled: true, accepted: false, message: result.message });
    if (result.changed) this.#onChanged();
    return Object.freeze({ handled: true, accepted: true, message: "Manual logistics command completed." });
  }
  #remember(id: string): void {
    this.#processed.add(id); this.#history.push(id);
    if (this.#history.length <= MAX_COMMAND_HISTORY) return;
    const removed = this.#history.shift(); if (removed !== undefined) this.#processed.delete(removed);
  }
}