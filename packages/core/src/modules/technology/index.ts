import type { DomainEvent } from "../../kernel";
import { DomainEventBus } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { FinanceEntryRequest } from "../finance";

export const TECHNOLOGY_MODULE_ID = "module.technology";
export const TECHNOLOGY_SCHEMA_VERSION = 1;

export interface TechnologyPrerequisiteDefinition {
  readonly nodeId: string;
  readonly requiredLevel: number;
}

export interface TechnologyLevelDefinition {
  readonly level: number;
  readonly costCopper: number;
  readonly effects: Readonly<Record<string, number>>;
}

export interface TechnologyNodeDefinition {
  readonly id: string;
  readonly name: string;
  readonly prerequisites: readonly TechnologyPrerequisiteDefinition[];
  readonly baseEffects: Readonly<Record<string, number>>;
  readonly levels: readonly TechnologyLevelDefinition[];
}

export interface TechnologyFinancePort {
  payExpense(
    operationId: string,
    request: FinanceEntryRequest,
  ):
    | { readonly accepted: true; readonly events: readonly DomainEvent[] }
    | { readonly accepted: false; readonly code: string; readonly message: string };
}
export interface TechnologyNodeState {
  readonly id: string;
  readonly level: number;
}

export interface TechnologyState {
  readonly schemaVersion: typeof TECHNOLOGY_SCHEMA_VERSION;
  readonly revision: number;
  readonly nodes: readonly TechnologyNodeState[];
  readonly processedOperationIds: readonly string[];
}

export interface TechnologyNodeReadModel extends TechnologyNodeState {
  readonly name: string;
  readonly maxLevel: number;
  readonly nextCostCopper: number | null;
  readonly prerequisites: readonly TechnologyPrerequisiteDefinition[];
  readonly prerequisitesMet: boolean;
  readonly effects: Readonly<Record<string, number>>;
}

export interface TechnologyReadModel {
  readonly revision: number;
  readonly nodes: readonly TechnologyNodeReadModel[];
  readonly effects: Readonly<Record<string, number>>;
}

export type TechnologyRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_NODE"
  | "MAX_LEVEL"
  | "PREREQUISITE_NOT_MET"
  | "INSUFFICIENT_FUNDS"
  | "TRANSACTION_FAILED";

export type TechnologyResult<TValue = TechnologyNodeReadModel> =
  | { readonly accepted: true; readonly changed: true; readonly operationId: string; readonly value: TValue; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly operationId: string; readonly code: TechnologyRejectionCode; readonly message: string; readonly events: readonly [] };

const OPERATION_HISTORY_LIMIT = 2_048;

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 160;
}
function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 152;
}
function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}
function cloneEffects(effects: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze({ ...effects });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTechnologyState(value: unknown): value is TechnologyState {
  if (!isRecord(value) || value.schemaVersion !== TECHNOLOGY_SCHEMA_VERSION ||
      typeof value.revision !== "number" || !nonNegativeInteger(value.revision) ||
      !Array.isArray(value.nodes) || !Array.isArray(value.processedOperationIds)) return false;
  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || !validId(node.id) ||
        typeof node.level !== "number" || !nonNegativeInteger(node.level) || nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
  }
  return value.processedOperationIds.every((id) => typeof id === "string" && validOperationId(id)) &&
    new Set(value.processedOperationIds).size === value.processedOperationIds.length;
}
function cloneState(state: TechnologyState): TechnologyState {
  return Object.freeze({
    schemaVersion: TECHNOLOGY_SCHEMA_VERSION,
    revision: state.revision,
    nodes: Object.freeze(state.nodes.map((node) => Object.freeze({ ...node }))),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

/** Owns global technology levels and numeric effects; consumers remain authoritative for their runtime work. */
export class TechnologyModule implements DomainModule {
  readonly moduleId = TECHNOLOGY_MODULE_ID;
  readonly #definitions = new Map<string, TechnologyNodeDefinition>();
  readonly #effectOwners = new Map<string, string>();
  readonly #finance: TechnologyFinancePort;
  readonly #eventBus: DomainEventBus;
  #state: TechnologyState;

  constructor(options: {
    readonly definitions: readonly TechnologyNodeDefinition[];
    readonly finance: TechnologyFinancePort;
    readonly eventBus: DomainEventBus;
    readonly initialState?: TechnologyState;
  }) {
    this.#finance = options.finance;
    this.#eventBus = options.eventBus;
    this.#validateDefinitions(options.definitions);
    for (const definition of options.definitions) {
      this.#definitions.set(definition.id, Object.freeze({
        ...definition,
        prerequisites: Object.freeze(definition.prerequisites.map((entry) => Object.freeze({ ...entry }))),
        baseEffects: cloneEffects(definition.baseEffects),
        levels: Object.freeze(definition.levels.map((level) => Object.freeze({ ...level, effects: cloneEffects(level.effects) }))),
      }));
      for (const key of Object.keys(definition.baseEffects)) this.#effectOwners.set(key, definition.id);
    }
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: TECHNOLOGY_SCHEMA_VERSION, revision: 0, nodes: options.definitions.map((definition) => ({ id: definition.id, level: 0 })), processedOperationIds: [] })
      : this.#restore(options.initialState);
  }

  exportState(): TechnologyState { return cloneState(this.#state); }

  createReadModel(): TechnologyReadModel {
    const nodes = [...this.#definitions.values()].map((definition) => this.#nodeReadModel(definition));
    return Object.freeze({
      revision: this.#state.revision,
      nodes: Object.freeze(nodes),
      effects: Object.freeze(Object.fromEntries([...this.#effectOwners.keys()].sort().map((key) => [key, this.getEffect(key)!]))),
    });
  }

  getLevel(nodeId: string): number | null {
    return this.#state.nodes.find((node) => node.id === nodeId)?.level ?? null;
  }

  getEffect(effectKey: string): number | null {
    const ownerId = this.#effectOwners.get(effectKey);
    if (ownerId === undefined) return null;
    const definition = this.#definitions.get(ownerId)!;
    const level = this.getLevel(ownerId)!;
    return level === 0 ? definition.baseEffects[effectKey] ?? null : definition.levels[level - 1]?.effects[effectKey] ?? null;
  }

  upgrade(operationId: string, nodeId: string, occurredAtUtcMs: number): TechnologyResult {
    if (!validOperationId(operationId) || !validId(nodeId) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Technology upgrade request is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Technology operation has already been processed.");
    }
    const definition = this.#definitions.get(nodeId);
    if (definition === undefined) return this.#reject(operationId, "UNKNOWN_NODE", `Unknown technology node: ${nodeId}`);
    const currentLevel = this.getLevel(nodeId)!;
    const next = definition.levels[currentLevel];
    if (next === undefined) return this.#reject(operationId, "MAX_LEVEL", "Technology is already at maximum level.");
    const missing = definition.prerequisites.find((entry) => (this.getLevel(entry.nodeId) ?? 0) < entry.requiredLevel);
    if (missing !== undefined) {
      return this.#reject(operationId, "PREREQUISITE_NOT_MET", `Technology requires ${missing.nodeId} level ${missing.requiredLevel}.`);
    }
    const paid = this.#finance.payExpense(`${operationId}:finance`, {
      entryId: `ledger.technology_${nodeId.replaceAll(".", "_")}_${next.level}`,
      amountCopper: next.costCopper,
      category: "technology-upgrade",
      occurredAtUtcMs,
      sourceType: "technology",
      sourceId: nodeId,
      regionId: "global",
    });
    if (!paid.accepted) {
      return this.#reject(operationId, paid.code === "INSUFFICIENT_FUNDS" ? "INSUFFICIENT_FUNDS" : "TRANSACTION_FAILED", paid.message);
    }
    this.#state = cloneState({
      ...this.#state,
      revision: this.#state.revision + 1,
      nodes: this.#state.nodes.map((node) => node.id === nodeId ? { ...node, level: next.level } : node),
      processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
    });
    const event = this.#event(operationId, occurredAtUtcMs, {
      nodeId,
      previousLevel: currentLevel,
      level: next.level,
      costCopper: next.costCopper,
      effects: next.effects,
    });
    const events = Object.freeze([...paid.events, event]);
    this.#eventBus.publishAll(events);
    return Object.freeze({ accepted: true, changed: true, operationId, value: this.#nodeReadModel(definition), events });
  }

  #nodeReadModel(definition: TechnologyNodeDefinition): TechnologyNodeReadModel {
    const level = this.getLevel(definition.id)!;
    const currentEffects = level === 0 ? definition.baseEffects : definition.levels[level - 1]!.effects;
    return Object.freeze({
      id: definition.id,
      name: definition.name,
      level,
      maxLevel: definition.levels.length,
      nextCostCopper: definition.levels[level]?.costCopper ?? null,
      prerequisites: Object.freeze(definition.prerequisites.map((entry) => Object.freeze({ ...entry }))),
      prerequisitesMet: definition.prerequisites.every((entry) => (this.getLevel(entry.nodeId) ?? 0) >= entry.requiredLevel),
      effects: cloneEffects(currentEffects),
    });
  }

  #restore(state: TechnologyState): TechnologyState {
    if (!isTechnologyState(state) || new Set(state.nodes.map((node) => node.id)).size !== this.#definitions.size) {
      throw new Error("Technology state is incompatible.");
    }
    for (const [id, definition] of this.#definitions) {
      const node = state.nodes.find((entry) => entry.id === id);
      if (node === undefined || !nonNegativeInteger(node.level) || node.level > definition.levels.length) throw new Error(`Technology state is invalid for ${id}.`);
    }
    for (const [id, definition] of this.#definitions) {
      const level = state.nodes.find((entry) => entry.id === id)!.level;
      if (level > 0 && definition.prerequisites.some((prerequisite) =>
        (state.nodes.find((entry) => entry.id === prerequisite.nodeId)?.level ?? 0) < prerequisite.requiredLevel)) {
        throw new Error(`Technology state has unmet prerequisites for ${id}.`);
      }
    }
    return cloneState(state);
  }

  #validateDefinitions(definitions: readonly TechnologyNodeDefinition[]): void {
    if (definitions.length === 0) throw new Error("Technology definitions must not be empty.");
    const ids = new Set<string>();
    const effectKeys = new Set<string>();
    for (const definition of definitions) {
      if (!validId(definition.id) || ids.has(definition.id) || definition.levels.length === 0) throw new Error(`Invalid technology node: ${definition.id}`);
      ids.add(definition.id);
      for (const [key, value] of Object.entries(definition.baseEffects)) {
        if (!validId(key) || !finiteNumber(value) || effectKeys.has(key)) throw new Error(`Invalid or duplicate technology effect: ${key}`);
        effectKeys.add(key);
      }
      definition.levels.forEach((level, index) => {
        if (level.level !== index + 1 || !positiveInteger(level.costCopper)) throw new Error(`Technology levels must be contiguous for ${definition.id}.`);
        const keys = Object.keys(level.effects).sort();
        if (keys.join("|") !== Object.keys(definition.baseEffects).sort().join("|") || Object.values(level.effects).some((value) => !finiteNumber(value))) throw new Error(`Technology effects must be complete for ${definition.id} level ${level.level}.`);
      });
    }
    for (const definition of definitions) {
      for (const prerequisite of definition.prerequisites) {
        const target = definitions.find((entry) => entry.id === prerequisite.nodeId);
        if (target === undefined || prerequisite.nodeId === definition.id || !positiveInteger(prerequisite.requiredLevel) || prerequisite.requiredLevel > target.levels.length) throw new Error(`Invalid technology prerequisite for ${definition.id}.`);
      }
    }
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error("Technology prerequisites contain a cycle.");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const prerequisite of definitions.find((entry) => entry.id === id)!.prerequisites) visit(prerequisite.nodeId);
      visiting.delete(id); visited.add(id);
    };
    definitions.forEach((definition) => visit(definition.id));
  }

  #event(operationId: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: `technology.level-changed:${operationId}`, type: "technology.level-changed", occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #reject(operationId: string, code: TechnologyRejectionCode, message: string): TechnologyResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }
}