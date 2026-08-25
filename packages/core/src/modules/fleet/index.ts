import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { DomainEventBus } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const FLEET_MODULE_ID = "module.fleet";
export const FLEET_SCHEMA_VERSION = 1;

export interface ProcurementAirshipLevelDefinition {
  readonly level: number;
  readonly upgradeCostCopper: number;
  readonly cargoCapacity: number;
  readonly speedUnitsPerSecond: number;
  readonly maxDurability: number;
  readonly cooldownEfficiency: number;
}

export interface ProcurementAirshipDefinition {
  readonly id: string;
  readonly name: string;
  readonly purchaseCostCopper: number;
  readonly defaultStyleId: string;
  readonly styleIds: readonly string[];
  readonly levels: readonly ProcurementAirshipLevelDefinition[];
}

export interface InitialProcurementAirship {
  readonly id: string;
  readonly definitionId: string;
  readonly level?: number;
  readonly styleId?: string;
  readonly durability?: number;
}

export interface FleetCaptainSnapshot {
  readonly eligible: boolean;
  readonly pilotingLevel: number;
}

export interface FleetCaptainPort {
  getCaptainSnapshot(characterId: InstanceId): FleetCaptainSnapshot | null;
}

export interface FleetRoutePort {
  isRouteUnlocked(routeId: string): boolean;
}

export interface FleetFinancePort {
  payExpense(
    operationId: string,
    request: {
      readonly entryId: string;
      readonly amountCopper: number;
      readonly category: "vehicle-upgrade";
      readonly occurredAtUtcMs: number;
      readonly sourceType: "fleet";
      readonly sourceId: string;
      readonly regionId: "global";
    },
  ):
    | { readonly accepted: true }
    | { readonly accepted: false; readonly code: string; readonly message: string };
}
export interface FleetVoyagePolicy {
  calculateVoyageDurationMs(input: {
    readonly roundTripDistanceUnits: number;
    readonly shipSpeedUnitsPerSecond: number;
    readonly captainPilotingLevel: number;
  }): number;
  calculateDurabilityLoss(input: {
    readonly roundTripDistanceUnits: number;
    readonly captainPilotingLevel: number;
  }): number;
  calculateCooldownDurationMs(input: {
    readonly roundTripDistanceUnits: number;
    readonly cooldownEfficiency: number;
  }): number;
}

export interface ProcurementAirshipState {
  readonly id: string;
  readonly definitionId: string;
  readonly level: number;
  readonly styleId: string;
  readonly durability: number;
  readonly activeVoyageId: string | null;
  readonly cooldownEndsAtUtcMs: number;
}

export type FleetVoyageStatus = "in-transit" | "awaiting-handoff" | "completed";

export interface FleetVoyageState {
  readonly id: string;
  readonly batchId: string;
  readonly routeId: string;
  readonly shipId: string;
  readonly captainId: InstanceId;
  readonly cargoQuantity: number;
  readonly roundTripDistanceUnits: number;
  readonly cargoCapacitySnapshot: number;
  readonly shipLevelSnapshot: number;
  readonly shipSpeedSnapshot: number;
  readonly captainPilotingLevelSnapshot: number;
  readonly durabilityLossSnapshot: number;
  readonly cooldownDurationMsSnapshot: number;
  readonly departedAtUtcMs: number;
  readonly returnsAtUtcMs: number;
  readonly returnedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
  readonly status: FleetVoyageStatus;
}

export interface FleetState {
  readonly schemaVersion: typeof FLEET_SCHEMA_VERSION;
  readonly revision: number;
  readonly lastMutationAtUtcMs: number;
  readonly ships: readonly ProcurementAirshipState[];
  readonly voyages: readonly FleetVoyageState[];
  readonly processedOperationIds: readonly string[];
}

export interface FleetShipReadModel extends ProcurementAirshipState {
  readonly name: string;
  readonly cargoCapacity: number;
  readonly speedUnitsPerSecond: number;
  readonly maxDurability: number;
  readonly cooldownEfficiency: number;
  readonly available: boolean;
  readonly unavailableReason: "ACTIVE_VOYAGE" | "DAMAGED" | "COOLDOWN" | null;
}

export interface FleetReadModel {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly ships: readonly FleetShipReadModel[];
  readonly voyages: readonly FleetVoyageState[];
}

export interface StartFleetVoyageRequest {
  readonly voyageId: string;
  readonly batchId: string;
  readonly routeId: string;
  readonly shipId: string;
  readonly captainId: InstanceId;
  readonly cargoQuantity: number;
  readonly roundTripDistanceUnits: number;
  readonly occurredAtUtcMs: number;
}

export type FleetRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_SHIP"
  | "UNKNOWN_DEFINITION"
  | "DUPLICATE_SHIP"
  | "UNKNOWN_VOYAGE"
  | "ROUTE_LOCKED"
  | "CAPTAIN_INELIGIBLE"
  | "CAPTAIN_BUSY"
  | "SHIP_BUSY"
  | "SHIP_DAMAGED"
  | "SHIP_COOLDOWN"
  | "MAX_LEVEL"
  | "ALREADY_REPAIRED"
  | "INVALID_STYLE"
  | "INSUFFICIENT_FUNDS"
  | "TRANSACTION_FAILED"
  | "CARGO_OVER_CAPACITY"
  | "VOYAGE_NOT_RETURNED"
  | "CLOCK_ROLLBACK";

export type FleetResult<T> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly value: T;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly code: FleetRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const integer = (value: number, minimum = 0): boolean => Number.isSafeInteger(value) && value >= minimum;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const nullableInteger = (value: unknown): boolean => value === null || (typeof value === "number" && integer(value));
const nullableId = (value: unknown): boolean => value === null || (typeof value === "string" && validId(value));

function cloneShip(ship: ProcurementAirshipState): ProcurementAirshipState {
  return Object.freeze({ ...ship });
}

function cloneVoyage(voyage: FleetVoyageState): FleetVoyageState {
  return Object.freeze({ ...voyage });
}

function cloneState(state: FleetState): FleetState {
  return Object.freeze({
    schemaVersion: FLEET_SCHEMA_VERSION,
    revision: state.revision,
    lastMutationAtUtcMs: state.lastMutationAtUtcMs,
    ships: Object.freeze(state.ships.map(cloneShip)),
    voyages: Object.freeze(state.voyages.map(cloneVoyage)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export function isFleetState(value: unknown): value is FleetState {
  if (!record(value) || value.schemaVersion !== FLEET_SCHEMA_VERSION ||
      typeof value.revision !== "number" || !integer(value.revision) ||
      typeof value.lastMutationAtUtcMs !== "number" || !integer(value.lastMutationAtUtcMs) ||
      !Array.isArray(value.ships) || !Array.isArray(value.voyages) ||
      !Array.isArray(value.processedOperationIds)) return false;
  if (value.processedOperationIds.some((id) => typeof id !== "string" || !validId(id)) ||
      new Set(value.processedOperationIds).size !== value.processedOperationIds.length) return false;
  if (value.ships.some((ship) => !record(ship) ||
      typeof ship.id !== "string" || !validId(ship.id) ||
      typeof ship.definitionId !== "string" || !validId(ship.definitionId) ||
      typeof ship.level !== "number" || !integer(ship.level, 1) ||
      typeof ship.styleId !== "string" || !validId(ship.styleId) ||
      typeof ship.durability !== "number" || !integer(ship.durability) ||
      !nullableId(ship.activeVoyageId) ||
      typeof ship.cooldownEndsAtUtcMs !== "number" || !integer(ship.cooldownEndsAtUtcMs)) ||
      new Set(value.ships.map((ship) => ship.id)).size !== value.ships.length) return false;
  if (value.voyages.some((voyage) => !record(voyage) ||
      typeof voyage.id !== "string" || !validId(voyage.id) ||
      typeof voyage.batchId !== "string" || !validId(voyage.batchId) ||
      typeof voyage.routeId !== "string" || !validId(voyage.routeId) ||
      typeof voyage.shipId !== "string" || !validId(voyage.shipId) ||
      typeof voyage.captainId !== "string" || !validId(voyage.captainId) ||
      typeof voyage.cargoQuantity !== "number" || !integer(voyage.cargoQuantity, 1) ||
      typeof voyage.roundTripDistanceUnits !== "number" || !positive(voyage.roundTripDistanceUnits) ||
      typeof voyage.cargoCapacitySnapshot !== "number" || !integer(voyage.cargoCapacitySnapshot, 1) ||
      typeof voyage.shipLevelSnapshot !== "number" || !integer(voyage.shipLevelSnapshot, 1) ||
      typeof voyage.shipSpeedSnapshot !== "number" || !positive(voyage.shipSpeedSnapshot) ||
      typeof voyage.captainPilotingLevelSnapshot !== "number" || !integer(voyage.captainPilotingLevelSnapshot) ||
      typeof voyage.durabilityLossSnapshot !== "number" || !integer(voyage.durabilityLossSnapshot) ||
      typeof voyage.cooldownDurationMsSnapshot !== "number" || !integer(voyage.cooldownDurationMsSnapshot) ||
      typeof voyage.departedAtUtcMs !== "number" || !integer(voyage.departedAtUtcMs) ||
      typeof voyage.returnsAtUtcMs !== "number" || !integer(voyage.returnsAtUtcMs) ||
      !nullableInteger(voyage.returnedAtUtcMs) || !nullableInteger(voyage.completedAtUtcMs) ||
      !["in-transit", "awaiting-handoff", "completed"].includes(voyage.status as string)) ||
      new Set(value.voyages.map((voyage) => voyage.id)).size !== value.voyages.length ||
      new Set(value.voyages.map((voyage) => voyage.batchId)).size !== value.voyages.length) return false;
  return true;
}

export class FleetModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = FLEET_MODULE_ID;
  readonly transactionParticipantId = FLEET_MODULE_ID;
  readonly #definitions = new Map<string, ProcurementAirshipDefinition>();
  readonly #captains: FleetCaptainPort;
  readonly #routes: FleetRoutePort;
  readonly #policy: FleetVoyagePolicy;
  readonly #finance: FleetFinancePort | null;
  readonly #eventBus: DomainEventBus;
  #state: FleetState;
  #transactionActive = false;

  constructor(options: {
    readonly definitions: readonly ProcurementAirshipDefinition[];
    readonly initialShips: readonly InitialProcurementAirship[];
    readonly captains: FleetCaptainPort;
    readonly routes: FleetRoutePort;
    readonly policy: FleetVoyagePolicy;
    readonly finance?: FleetFinancePort;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: FleetState;
  }) {
    this.#validateDefinitions(options.definitions);
    for (const definition of options.definitions) {
      this.#definitions.set(definition.id, Object.freeze({
        ...definition,
        styleIds: Object.freeze([...definition.styleIds]),
        levels: Object.freeze(definition.levels.map((level) => Object.freeze({ ...level }))),
      }));
    }
    this.#captains = options.captains;
    this.#routes = options.routes;
    this.#policy = options.policy;
    this.#finance = options.finance ?? null;
    this.#eventBus = options.eventBus ?? new DomainEventBus();
    this.#state = options.initialState === undefined
      ? this.#createInitialState(options.initialShips)
      : cloneState(options.initialState);
    this.#validateState();
  }

  listShipDefinitions(): readonly ProcurementAirshipDefinition[] {
    return Object.freeze([...this.#definitions.values()].map((definition) => Object.freeze({
      ...definition,
      styleIds: Object.freeze([...definition.styleIds]),
      levels: Object.freeze(definition.levels.map((level) => Object.freeze({ ...level }))),
    })));
  }

  exportState(): FleetState {
    return cloneState(this.#state);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Fleet transaction is already active.");
    this.#transactionActive = true;
    const saved = this.#state;
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = saved;
        this.#transactionActive = false;
      },
    };
  }

  createReadModel(currentUtcMs: number): FleetReadModel {
    if (!integer(currentUtcMs)) throw new RangeError("Fleet read-model time is invalid.");
    return Object.freeze({
      revision: this.#state.revision,
      currentUtcMs,
      ships: Object.freeze(this.#state.ships.map((ship) => {
        const definition = this.#definitions.get(ship.definitionId)!;
        const level = definition.levels[ship.level - 1]!;
        const unavailableReason = ship.activeVoyageId !== null
          ? "ACTIVE_VOYAGE" as const
          : ship.durability === 0
            ? "DAMAGED" as const
            : currentUtcMs < ship.cooldownEndsAtUtcMs
              ? "COOLDOWN" as const
              : null;
        return Object.freeze({
          ...ship,
          name: definition.name,
          cargoCapacity: level.cargoCapacity,
          speedUnitsPerSecond: level.speedUnitsPerSecond,
          maxDurability: level.maxDurability,
          cooldownEfficiency: level.cooldownEfficiency,
          available: unavailableReason === null,
          unavailableReason,
        });
      })),
      voyages: Object.freeze(this.#state.voyages.map(cloneVoyage)),
    });
  }

  isCaptainVoyageActive(characterId: InstanceId): boolean {
    return this.#state.voyages.some((voyage) =>
      voyage.captainId === characterId && voyage.status !== "completed",
    );
  }

  isRouteUnlocked(routeId: string): boolean {
    return validId(routeId) && this.#routes.isRouteUnlocked(routeId);
  }

  getVoyage(voyageId: string): FleetVoyageState | null {
    const voyage = this.#state.voyages.find((entry) => entry.id === voyageId);
    return voyage === undefined ? null : cloneVoyage(voyage);
  }

  purchaseShip(
    operationId: string,
    shipId: string,
    definitionId: string,
    occurredAtUtcMs: number,
  ): FleetResult<ProcurementAirshipState> {
    const issue = this.#operationIssue(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    if (!validId(shipId) || !validId(definitionId)) return this.#reject("INVALID_REQUEST", "Fleet purchase request is invalid.");
    if (this.#state.ships.some((ship) => ship.id === shipId)) return this.#reject("DUPLICATE_SHIP", "Procurement airship instance already exists.");
    const definition = this.#definitions.get(definitionId);
    if (definition === undefined) return this.#reject("UNKNOWN_DEFINITION", "Unknown procurement airship definition.");
    const paid = this.#pay(operationId, definition.purchaseCostCopper, shipId, occurredAtUtcMs, "purchase");
    if (!paid.accepted) return paid;
    const level = definition.levels[0]!;
    const ship = cloneShip({
      id: shipId,
      definitionId,
      level: 1,
      styleId: definition.defaultStyleId,
      durability: level.maxDurability,
      activeVoyageId: null,
      cooldownEndsAtUtcMs: 0,
    });
    this.#commit(operationId, occurredAtUtcMs, { ships: [...this.#state.ships, ship] });
    const event = this.#event("fleet.ship-purchased", operationId, occurredAtUtcMs, {
      shipId,
      definitionId,
      costCopper: definition.purchaseCostCopper,
    });
    this.#eventBus.publish(event);
    return this.#accept(ship, [event]);
  }

  upgradeShip(
    operationId: string,
    shipId: string,
    occurredAtUtcMs: number,
  ): FleetResult<ProcurementAirshipState> {
    const issue = this.#operationIssue(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    const ship = this.#state.ships.find((entry) => entry.id === shipId);
    if (ship === undefined) return this.#reject("UNKNOWN_SHIP", "Unknown procurement airship.");
    if (ship.activeVoyageId !== null) return this.#reject("SHIP_BUSY", "An active procurement airship cannot be upgraded.");
    const definition = this.#definitions.get(ship.definitionId)!;
    const next = definition.levels[ship.level];
    if (next === undefined) return this.#reject("MAX_LEVEL", "Procurement airship is already at maximum level.");
    const paid = this.#pay(operationId, next.upgradeCostCopper, shipId, occurredAtUtcMs, "upgrade");
    if (!paid.accepted) return paid;
    const upgraded = cloneShip({ ...ship, level: next.level });
    this.#commit(operationId, occurredAtUtcMs, {
      ships: this.#state.ships.map((entry) => entry.id === ship.id ? upgraded : entry),
    });
    const event = this.#event("fleet.ship-upgraded", operationId, occurredAtUtcMs, {
      shipId,
      previousLevel: ship.level,
      level: upgraded.level,
      costCopper: next.upgradeCostCopper,
    });
    this.#eventBus.publish(event);
    return this.#accept(upgraded, [event]);
  }

  repairShip(
    operationId: string,
    shipId: string,
    durabilityRestored: number,
    occurredAtUtcMs: number,
  ): FleetResult<ProcurementAirshipState> {
    const issue = this.#operationIssue(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    if (!integer(durabilityRestored, 1)) return this.#reject("INVALID_REQUEST", "Fleet repair amount is invalid.");
    const ship = this.#state.ships.find((entry) => entry.id === shipId);
    if (ship === undefined) return this.#reject("UNKNOWN_SHIP", "Unknown procurement airship.");
    if (ship.activeVoyageId !== null) return this.#reject("SHIP_BUSY", "An active procurement airship cannot be repaired.");
    const definition = this.#definitions.get(ship.definitionId)!;
    const maxDurability = definition.levels[ship.level - 1]!.maxDurability;
    if (ship.durability >= maxDurability) return this.#reject("ALREADY_REPAIRED", "Procurement airship is already fully repaired.");
    const repaired = cloneShip({ ...ship, durability: Math.min(maxDurability, ship.durability + durabilityRestored) });
    this.#commit(operationId, occurredAtUtcMs, {
      ships: this.#state.ships.map((entry) => entry.id === ship.id ? repaired : entry),
    });
    const event = this.#event("fleet.ship-repaired", operationId, occurredAtUtcMs, {
      shipId,
      durabilityRestored: repaired.durability - ship.durability,
      durability: repaired.durability,
    });
    this.#eventBus.publish(event);
    return this.#accept(repaired, [event]);
  }

  changeShipStyle(
    operationId: string,
    shipId: string,
    styleId: string,
    occurredAtUtcMs: number,
  ): FleetResult<ProcurementAirshipState> {
    const issue = this.#operationIssue(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    const ship = this.#state.ships.find((entry) => entry.id === shipId);
    if (ship === undefined) return this.#reject("UNKNOWN_SHIP", "Unknown procurement airship.");
    const definition = this.#definitions.get(ship.definitionId)!;
    if (!definition.styleIds.includes(styleId)) return this.#reject("INVALID_STYLE", "Style is unavailable for this procurement airship.");
    if (ship.styleId === styleId) return this.#accept(ship, [], false);
    const styled = cloneShip({ ...ship, styleId });
    this.#commit(operationId, occurredAtUtcMs, {
      ships: this.#state.ships.map((entry) => entry.id === ship.id ? styled : entry),
    });
    const event = this.#event("fleet.ship-style-changed", operationId, occurredAtUtcMs, { shipId, styleId });
    this.#eventBus.publish(event);
    return this.#accept(styled, [event]);
  }
  startVoyage(
    operationId: string,
    request: StartFleetVoyageRequest,
  ): FleetResult<FleetVoyageState> {
    const issue = this.#operationIssue(operationId, request.occurredAtUtcMs);
    if (issue !== null) return issue;
    if (![request.voyageId, request.batchId, request.routeId, request.shipId, request.captainId]
      .every(validId) || !integer(request.cargoQuantity, 1) ||
      !positive(request.roundTripDistanceUnits)) {
      return this.#reject("INVALID_REQUEST", "Fleet voyage request is invalid.");
    }
    if (this.#state.voyages.some((voyage) =>
      voyage.id === request.voyageId || voyage.batchId === request.batchId)) {
      return this.#reject("INVALID_REQUEST", "Fleet voyage or procurement batch is already registered.");
    }
    if (!this.#routes.isRouteUnlocked(request.routeId)) {
      return this.#reject("ROUTE_LOCKED", "The procurement route is not permanently unlocked.");
    }
    const ship = this.#state.ships.find((entry) => entry.id === request.shipId);
    if (ship === undefined) return this.#reject("UNKNOWN_SHIP", "Unknown procurement airship.");
    if (ship.activeVoyageId !== null) return this.#reject("SHIP_BUSY", "The procurement airship is already assigned.");
    if (ship.durability === 0) return this.#reject("SHIP_DAMAGED", "The procurement airship must be repaired before departure.");
    if (request.occurredAtUtcMs < ship.cooldownEndsAtUtcMs) {
      return this.#reject("SHIP_COOLDOWN", "The procurement airship is still cooling down.");
    }
    if (this.isCaptainVoyageActive(request.captainId)) {
      return this.#reject("CAPTAIN_BUSY", "The captain is already assigned to another voyage.");
    }
    const captain = this.#captains.getCaptainSnapshot(request.captainId);
    if (captain === null || !captain.eligible || !integer(captain.pilotingLevel)) {
      return this.#reject("CAPTAIN_INELIGIBLE", "The selected character cannot captain this voyage.");
    }
    const definition = this.#definitions.get(ship.definitionId)!;
    const level = definition.levels[ship.level - 1]!;
    if (request.cargoQuantity > level.cargoCapacity) {
      return this.#reject("CARGO_OVER_CAPACITY", "The procurement batch exceeds the airship cargo capacity.");
    }
    const durationMs = this.#policy.calculateVoyageDurationMs({
      roundTripDistanceUnits: request.roundTripDistanceUnits,
      shipSpeedUnitsPerSecond: level.speedUnitsPerSecond,
      captainPilotingLevel: captain.pilotingLevel,
    });
    const durabilityLoss = this.#policy.calculateDurabilityLoss({
      roundTripDistanceUnits: request.roundTripDistanceUnits,
      captainPilotingLevel: captain.pilotingLevel,
    });
    const cooldownDurationMs = this.#policy.calculateCooldownDurationMs({
      roundTripDistanceUnits: request.roundTripDistanceUnits,
      cooldownEfficiency: level.cooldownEfficiency,
    });
    if (!integer(durationMs, 1) || !integer(durabilityLoss) || !integer(cooldownDurationMs)) {
      return this.#reject("INVALID_REQUEST", "Fleet voyage policy returned invalid snapshots.");
    }
    const voyage = cloneVoyage({
      id: request.voyageId,
      batchId: request.batchId,
      routeId: request.routeId,
      shipId: ship.id,
      captainId: request.captainId,
      cargoQuantity: request.cargoQuantity,
      roundTripDistanceUnits: request.roundTripDistanceUnits,
      cargoCapacitySnapshot: level.cargoCapacity,
      shipLevelSnapshot: ship.level,
      shipSpeedSnapshot: level.speedUnitsPerSecond,
      captainPilotingLevelSnapshot: captain.pilotingLevel,
      durabilityLossSnapshot: durabilityLoss,
      cooldownDurationMsSnapshot: cooldownDurationMs,
      departedAtUtcMs: request.occurredAtUtcMs,
      returnsAtUtcMs: request.occurredAtUtcMs + durationMs,
      returnedAtUtcMs: null,
      completedAtUtcMs: null,
      status: "in-transit",
    });
    this.#commit(operationId, request.occurredAtUtcMs, {
      ships: this.#state.ships.map((entry) => entry.id === ship.id
        ? cloneShip({ ...entry, activeVoyageId: voyage.id })
        : entry),
      voyages: [...this.#state.voyages, voyage],
    });
    const event = this.#event(
      "fleet.voyage-started",
      operationId,
      request.occurredAtUtcMs,
      { voyageId: voyage.id, batchId: voyage.batchId, routeId: voyage.routeId, shipId: voyage.shipId, captainId: voyage.captainId },
    );
    this.#eventBus.publish(event);
    return this.#accept(voyage, [event]);
  }

  advanceTo(
    operationId: string,
    currentUtcMs: number,
  ): FleetResult<readonly FleetVoyageState[]> {
    const issue = this.#operationIssue(operationId, currentUtcMs);
    if (issue !== null) return issue;
    const returned = this.#state.voyages.filter((voyage) =>
      voyage.status === "in-transit" && voyage.returnsAtUtcMs <= currentUtcMs,
    );
    if (returned.length === 0) return this.#accept([], [], false);
    const returnedIds = new Set(returned.map((voyage) => voyage.id));
    const voyages = this.#state.voyages.map((voyage) => returnedIds.has(voyage.id)
      ? cloneVoyage({ ...voyage, status: "awaiting-handoff", returnedAtUtcMs: voyage.returnsAtUtcMs })
      : voyage);
    this.#commit(operationId, currentUtcMs, { voyages });
    const events = returned.map((voyage) => this.#event(
      "fleet.voyage-returned",
      operationId,
      voyage.returnsAtUtcMs,
      { voyageId: voyage.id, batchId: voyage.batchId, shipId: voyage.shipId, captainId: voyage.captainId },
      voyage.id,
    ));
    this.#eventBus.publishAll(events);
    return this.#accept(
      voyages.filter((voyage) => returnedIds.has(voyage.id)),
      events,
    );
  }

  completeHandoff(
    operationId: string,
    voyageId: string,
    occurredAtUtcMs: number,
  ): FleetResult<FleetVoyageState> {
    const issue = this.#operationIssue(operationId, occurredAtUtcMs);
    if (issue !== null) return issue;
    if (!validId(voyageId)) return this.#reject("INVALID_REQUEST", "Fleet voyage id is invalid.");
    const voyage = this.#state.voyages.find((entry) => entry.id === voyageId);
    if (voyage === undefined) return this.#reject("UNKNOWN_VOYAGE", "Unknown fleet voyage.");
    if (voyage.status !== "awaiting-handoff" || voyage.returnedAtUtcMs === null ||
        occurredAtUtcMs < voyage.returnedAtUtcMs) {
      return this.#reject("VOYAGE_NOT_RETURNED", "The voyage has not returned for cargo handoff.");
    }
    const ship = this.#state.ships.find((entry) => entry.id === voyage.shipId)!;
    const completedVoyage = cloneVoyage({
      ...voyage,
      status: "completed",
      completedAtUtcMs: occurredAtUtcMs,
    });
    const nextShip = cloneShip({
      ...ship,
      durability: Math.max(0, ship.durability - voyage.durabilityLossSnapshot),
      activeVoyageId: null,
      cooldownEndsAtUtcMs: voyage.returnedAtUtcMs + voyage.cooldownDurationMsSnapshot,
    });
    this.#commit(operationId, occurredAtUtcMs, {
      ships: this.#state.ships.map((entry) => entry.id === ship.id ? nextShip : entry),
      voyages: this.#state.voyages.map((entry) => entry.id === voyage.id ? completedVoyage : entry),
    });
    const event = this.#event(
      "fleet.voyage-completed",
      operationId,
      occurredAtUtcMs,
      {
        voyageId: voyage.id,
        batchId: voyage.batchId,
        shipId: voyage.shipId,
        captainId: voyage.captainId,
        durabilityLoss: voyage.durabilityLossSnapshot,
        durability: nextShip.durability,
        cooldownEndsAtUtcMs: nextShip.cooldownEndsAtUtcMs,
      },
    );
    this.#eventBus.publish(event);
    return this.#accept(completedVoyage, [event]);
  }

  #pay(
    operationId: string,
    amountCopper: number,
    shipId: string,
    occurredAtUtcMs: number,
    purpose: "purchase" | "upgrade",
  ): FleetResult<never> | { readonly accepted: true } {
    if (amountCopper === 0) return Object.freeze({ accepted: true });
    if (this.#finance === null) return this.#reject("TRANSACTION_FAILED", "Fleet finance is unavailable.");
    const paid = this.#finance.payExpense(`${operationId}:finance`, {
      entryId: `ledger.fleet_${purpose}_${shipId.replaceAll(".", "_")}`,
      amountCopper,
      category: "vehicle-upgrade",
      occurredAtUtcMs,
      sourceType: "fleet",
      sourceId: shipId,
      regionId: "global",
    });
    if (!paid.accepted) {
      return this.#reject(paid.code === "INSUFFICIENT_FUNDS" ? "INSUFFICIENT_FUNDS" : "TRANSACTION_FAILED", paid.message);
    }
    return Object.freeze({ accepted: true });
  }
  #createInitialState(initialShips: readonly InitialProcurementAirship[]): FleetState {
    if (new Set(initialShips.map((ship) => ship.id)).size !== initialShips.length) {
      throw new Error("Initial procurement airship ids must be unique.");
    }
    const ships = initialShips.map((ship) => {
      const definition = this.#definitions.get(ship.definitionId);
      const levelNumber = ship.level ?? 1;
      const level = definition?.levels[levelNumber - 1];
      const styleId = ship.styleId ?? definition?.defaultStyleId;
      if (!validId(ship.id) || definition === undefined || level === undefined ||
          styleId === undefined || !definition.styleIds.includes(styleId) ||
          (ship.durability !== undefined && (!integer(ship.durability) || ship.durability > level.maxDurability))) {
        throw new Error(`Invalid initial procurement airship: ${ship.id}`);
      }
      return cloneShip({
        id: ship.id,
        definitionId: ship.definitionId,
        level: levelNumber,
        styleId,
        durability: ship.durability ?? level.maxDurability,
        activeVoyageId: null,
        cooldownEndsAtUtcMs: 0,
      });
    });
    return cloneState({
      schemaVersion: FLEET_SCHEMA_VERSION,
      revision: 0,
      lastMutationAtUtcMs: 0,
      ships,
      voyages: [],
      processedOperationIds: [],
    });
  }

  #validateDefinitions(definitions: readonly ProcurementAirshipDefinition[]): void {
    if (definitions.length === 0 || new Set(definitions.map((entry) => entry.id)).size !== definitions.length) {
      throw new Error("Fleet definitions must be non-empty and unique.");
    }
    for (const definition of definitions) {
      if (!validId(definition.id) || !validId(definition.name) || !integer(definition.purchaseCostCopper) ||
          !validId(definition.defaultStyleId) || definition.styleIds.length === 0 ||
          new Set(definition.styleIds).size !== definition.styleIds.length ||
          !definition.styleIds.includes(definition.defaultStyleId) || definition.levels.length === 0) {
        throw new Error(`Invalid procurement airship definition: ${definition.id}`);
      }
      for (const [index, level] of definition.levels.entries()) {
        if (level.level !== index + 1 || !integer(level.upgradeCostCopper, index === 0 ? 0 : 1) ||
            (index === 0 && level.upgradeCostCopper !== 0) || !integer(level.cargoCapacity, 1) ||
            !positive(level.speedUnitsPerSecond) || !integer(level.maxDurability, 1) ||
            !positive(level.cooldownEfficiency)) {
          throw new Error(`Invalid procurement airship level: ${definition.id}/${level.level}`);
        }
      }
    }
  }

  #validateState(): void {
    if (!isFleetState(this.#state)) throw new Error("Fleet state is structurally invalid.");
    for (const ship of this.#state.ships) {
      const definition = this.#definitions.get(ship.definitionId);
      const level = definition?.levels[ship.level - 1];
      if (definition === undefined || level === undefined || !definition.styleIds.includes(ship.styleId) ||
          ship.durability > level.maxDurability) {
        throw new Error(`Fleet ship invariant failed: ${ship.id}`);
      }
      const activeVoyage = ship.activeVoyageId === null
        ? null
        : this.#state.voyages.find((voyage) => voyage.id === ship.activeVoyageId);
      if (ship.activeVoyageId !== null &&
          (activeVoyage == null || activeVoyage.status === "completed" || activeVoyage.shipId !== ship.id)) {
        throw new Error(`Fleet active voyage invariant failed: ${ship.id}`);
      }
    }
    const active = this.#state.voyages.filter((voyage) => voyage.status !== "completed");
    if (new Set(active.map((voyage) => voyage.shipId)).size !== active.length ||
        new Set(active.map((voyage) => voyage.captainId)).size !== active.length) {
      throw new Error("Fleet active ship or captain assignments are duplicated.");
    }
    for (const voyage of this.#state.voyages) {
      if (!this.#state.ships.some((ship) => ship.id === voyage.shipId) ||
          voyage.returnsAtUtcMs <= voyage.departedAtUtcMs ||
          voyage.cargoQuantity > voyage.cargoCapacitySnapshot ||
          (voyage.status === "in-transit" && (voyage.returnedAtUtcMs !== null || voyage.completedAtUtcMs !== null)) ||
          (voyage.status === "awaiting-handoff" && (voyage.returnedAtUtcMs === null || voyage.completedAtUtcMs !== null)) ||
          (voyage.status === "completed" && (voyage.returnedAtUtcMs === null || voyage.completedAtUtcMs === null))) {
        throw new Error(`Fleet voyage invariant failed: ${voyage.id}`);
      }
    }
  }

  #operationIssue(operationId: string, occurredAtUtcMs: number): FleetResult<never> | null {
    if (!validId(operationId) || !integer(occurredAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Fleet operation is invalid.");
    }
    if (occurredAtUtcMs < this.#state.lastMutationAtUtcMs) {
      return this.#reject("CLOCK_ROLLBACK", "Fleet time cannot move backwards.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject("DUPLICATE_OPERATION", "Fleet operation was already processed.");
    }
    return null;
  }

  #commit(
    operationId: string,
    occurredAtUtcMs: number,
    update: Partial<Pick<FleetState, "ships" | "voyages">>,
  ): void {
    this.#state = cloneState({
      ...this.#state,
      ...update,
      revision: this.#state.revision + 1,
      lastMutationAtUtcMs: occurredAtUtcMs,
      processedOperationIds: [
        ...this.#state.processedOperationIds,
        operationId,
      ].slice(-OPERATION_HISTORY_LIMIT),
    });
    this.#validateState();
  }

  #event(
    type: string,
    operationId: string,
    occurredAtUtcMs: number,
    payload: unknown,
    discriminator = "0",
  ): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}:${discriminator}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #accept<T>(
    value: T,
    events: readonly DomainEvent[],
    changed = true,
  ): FleetResult<T> {
    return Object.freeze({
      accepted: true,
      changed,
      value,
      events: Object.freeze([...events]),
    });
  }

  #reject(code: FleetRejectionCode, message: string): FleetResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      code,
      message,
      events: [] as const,
    });
  }
}