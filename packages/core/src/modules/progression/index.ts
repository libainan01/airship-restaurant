import type { DomainEvent } from "../../kernel";
import { DomainEventBus } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const PROGRESSION_MODULE_ID = "module.progression";
export const PROGRESSION_SCHEMA_VERSION = 1;

export type ProgressionContentKind =
  | "region"
  | "route"
  | "recipe"
  | "building"
  | "building-style";

export type ProgressionRequirementDefinition =
  | { readonly kind: "fact"; readonly factId: string; readonly minimumValue?: number }
  | { readonly kind: "content-unlocked"; readonly contentId: string };

/** Every source is an AND group; multiple sources are alternative (OR) paths. */
export interface ProgressionSourceDefinition {
  readonly id: string;
  readonly requirements: readonly ProgressionRequirementDefinition[];
}

export interface ProgressionContentDefinition {
  readonly id: string;
  readonly kind: ProgressionContentKind;
  readonly name: string;
  readonly spoilerSensitive: boolean;
  readonly initiallyRevealed: boolean;
  readonly initiallyUnlocked: boolean;
  readonly revealSources: readonly ProgressionSourceDefinition[];
  readonly unlockSources: readonly ProgressionSourceDefinition[];
}

export interface ProgressionFactPort {
  getFactValue(factId: string): boolean | number | null;
}

export interface ProgressionState {
  readonly schemaVersion: typeof PROGRESSION_SCHEMA_VERSION;
  readonly revision: number;
  readonly revealedContentIds: readonly string[];
  readonly unlockedContentIds: readonly string[];
  readonly processedOperationIds: readonly string[];
}

export type ProgressionContentStatus = "hidden" | "locked" | "unlockable" | "unlocked";

export interface ProgressionContentReadModel {
  readonly id: string;
  readonly kind: ProgressionContentKind;
  readonly name: string | null;
  readonly spoilerSensitive: boolean;
  readonly status: ProgressionContentStatus;
  readonly unlockSourceIds: readonly string[];
}

export interface ProgressionReadModel {
  readonly revision: number;
  readonly contents: readonly ProgressionContentReadModel[];
  readonly revealedCount: number;
  readonly unlockedCount: number;
}

export type ProgressionRejectionCode = "INVALID_REQUEST" | "DUPLICATE_OPERATION" | "UNKNOWN_CONTENT";

export type ProgressionResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly revealedContentIds: readonly string[];
      readonly unlockedContentIds: readonly string[];
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: ProgressionRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 2_048;
const CONTENT_KINDS = new Set<ProgressionContentKind>([
  "region", "route", "recipe", "building", "building-style",
]);

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 160;
}
function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 152;
}
function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function cloneState(state: ProgressionState): ProgressionState {
  return Object.freeze({
    schemaVersion: PROGRESSION_SCHEMA_VERSION,
    revision: state.revision,
    revealedContentIds: Object.freeze([...state.revealedContentIds]),
    unlockedContentIds: Object.freeze([...state.unlockedContentIds]),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export function isProgressionState(value: unknown): value is ProgressionState {
  if (!isRecord(value) || value.schemaVersion !== PROGRESSION_SCHEMA_VERSION ||
      typeof value.revision !== "number" || !nonNegativeInteger(value.revision) ||
      !Array.isArray(value.revealedContentIds) || !Array.isArray(value.unlockedContentIds) ||
      !Array.isArray(value.processedOperationIds)) return false;
  const validIds = (entries: unknown[], operation = false): entries is string[] =>
    entries.every((entry) => typeof entry === "string" && (operation ? validOperationId(entry) : validId(entry))) &&
    new Set(entries).size === entries.length;
  if (!validIds(value.revealedContentIds) || !validIds(value.unlockedContentIds) ||
      !validIds(value.processedOperationIds, true)) return false;
  const revealed = new Set(value.revealedContentIds);
  return value.unlockedContentIds.every((id) => revealed.has(id));
}

/**
 * Owns permanent content reveal/unlock qualifications only. Runtime usability
 * (ingredients, equipment, ships, placement, etc.) remains with each consumer.
 */
export class ProgressionModule implements DomainModule {
  readonly moduleId = PROGRESSION_MODULE_ID;
  readonly #definitions = new Map<string, ProgressionContentDefinition>();
  readonly #facts: ProgressionFactPort;
  readonly #eventBus: DomainEventBus;
  #state: ProgressionState;

  constructor(options: {
    readonly definitions: readonly ProgressionContentDefinition[];
    readonly facts: ProgressionFactPort;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: ProgressionState;
  }) {
    this.#validateDefinitions(options.definitions);
    for (const definition of options.definitions) {
      this.#definitions.set(definition.id, Object.freeze({
        ...definition,
        revealSources: this.#cloneSources(definition.revealSources),
        unlockSources: this.#cloneSources(definition.unlockSources),
      }));
    }
    this.#facts = options.facts;
    this.#eventBus = options.eventBus ?? new DomainEventBus();
    this.#state = options.initialState === undefined ? this.#initialState() : this.#restore(options.initialState);
  }

  exportState(): ProgressionState { return cloneState(this.#state); }

  createReadModel(): ProgressionReadModel {
    const contents = [...this.#definitions.values()].map((definition) => this.#contentReadModel(definition));
    return Object.freeze({
      revision: this.#state.revision,
      contents: Object.freeze(contents),
      revealedCount: contents.filter((entry) => entry.status !== "hidden").length,
      unlockedCount: contents.filter((entry) => entry.status === "unlocked").length,
    });
  }

  isContentRevealed(kind: ProgressionContentKind, contentId: string): boolean {
    return this.#definitions.get(contentId)?.kind === kind && this.#state.revealedContentIds.includes(contentId);
  }

  isContentUnlocked(kind: ProgressionContentKind, contentId: string): boolean {
    return this.#definitions.get(contentId)?.kind === kind && this.#state.unlockedContentIds.includes(contentId);
  }

  isBuildingUnlocked(definitionId: string): boolean {
    return this.isContentUnlocked("building", definitionId);
  }

  /** Re-evaluates data-driven reveal and unlock sources after business facts change. */
  evaluate(operationId: string, occurredAtUtcMs: number): ProgressionResult {
    const rejected = this.#validateOperation(operationId, occurredAtUtcMs);
    if (rejected !== null) return rejected;
    const revealed = new Set(this.#state.revealedContentIds);
    const unlocked = new Set(this.#state.unlockedContentIds);
    const newlyRevealed: string[] = [];
    const newlyUnlocked: string[] = [];
    this.#cascade(revealed, unlocked, newlyRevealed, newlyUnlocked);
    return this.#commit(operationId, occurredAtUtcMs, revealed, unlocked, newlyRevealed, newlyUnlocked);
  }

  /** Applies a data-mapped reward; it grants qualifications, never instances or items. */
  grantUnlocks(operationId: string, contentIds: readonly string[], sourceId: string, occurredAtUtcMs: number): ProgressionResult {
    const rejected = this.#validateOperation(operationId, occurredAtUtcMs);
    if (rejected !== null) return rejected;
    const requestError = this.#validateContentRequest(operationId, contentIds, sourceId);
    if (requestError !== null) return requestError;
    const uniqueIds = [...new Set(contentIds)];
    const revealed = new Set(this.#state.revealedContentIds);
    const unlocked = new Set(this.#state.unlockedContentIds);
    const newlyRevealed = uniqueIds.filter((id) => !revealed.has(id));
    const newlyUnlocked = uniqueIds.filter((id) => !unlocked.has(id));
    uniqueIds.forEach((id) => { revealed.add(id); unlocked.add(id); });
    this.#cascade(revealed, unlocked, newlyRevealed, newlyUnlocked);
    return this.#commit(operationId, occurredAtUtcMs, revealed, unlocked, newlyRevealed, newlyUnlocked, sourceId);
  }

  reveal(operationId: string, contentIds: readonly string[], sourceId: string, occurredAtUtcMs: number): ProgressionResult {
    const rejected = this.#validateOperation(operationId, occurredAtUtcMs);
    if (rejected !== null) return rejected;
    const requestError = this.#validateContentRequest(operationId, contentIds, sourceId);
    if (requestError !== null) return requestError;
    const uniqueIds = [...new Set(contentIds)];
    const revealed = new Set(this.#state.revealedContentIds);
    const newlyRevealed = uniqueIds.filter((id) => !revealed.has(id));
    uniqueIds.forEach((id) => revealed.add(id));
    return this.#commit(operationId, occurredAtUtcMs, revealed, new Set(this.#state.unlockedContentIds), newlyRevealed, [], sourceId);
  }

  #initialState(): ProgressionState {
    const revealed = [...this.#definitions.values()]
      .filter((entry) => entry.initiallyRevealed || entry.initiallyUnlocked).map((entry) => entry.id);
    const unlocked = [...this.#definitions.values()].filter((entry) => entry.initiallyUnlocked).map((entry) => entry.id);
    return cloneState({ schemaVersion: PROGRESSION_SCHEMA_VERSION, revision: 0, revealedContentIds: revealed, unlockedContentIds: unlocked, processedOperationIds: [] });
  }

  #restore(state: ProgressionState): ProgressionState {
    if (!isProgressionState(state)) throw new Error("Progression state is invalid.");
    const revealed = new Set(state.revealedContentIds);
    const unlocked = new Set(state.unlockedContentIds);
    for (const definition of this.#definitions.values()) {
      if (definition.initiallyRevealed || definition.initiallyUnlocked) revealed.add(definition.id);
      if (definition.initiallyUnlocked) unlocked.add(definition.id);
    }
    return cloneState({ ...state, revealedContentIds: [...revealed], unlockedContentIds: [...unlocked] });
  }

  #contentReadModel(definition: ProgressionContentDefinition): ProgressionContentReadModel {
    const revealed = this.#state.revealedContentIds.includes(definition.id);
    const unlocked = this.#state.unlockedContentIds.includes(definition.id);
    const unlockedSet = new Set(this.#state.unlockedContentIds);
    const unlockable = revealed && definition.unlockSources.some((source) => this.#sourceMet(source, unlockedSet));
    return Object.freeze({
      id: definition.id,
      kind: definition.kind,
      name: revealed || !definition.spoilerSensitive ? definition.name : null,
      spoilerSensitive: definition.spoilerSensitive,
      status: unlocked ? "unlocked" : !revealed ? "hidden" : unlockable ? "unlockable" : "locked",
      unlockSourceIds: Object.freeze(definition.unlockSources.map((source) => source.id)),
    });
  }

  #cascade(revealed: Set<string>, unlocked: Set<string>, newlyRevealed: string[], newlyUnlocked: string[]): void {
    let changedInPass = true;
    while (changedInPass) {
      changedInPass = false;
      for (const definition of this.#definitions.values()) {
        const unlockable = definition.unlockSources.some((source) => this.#sourceMet(source, unlocked));
        const revealable = definition.revealSources.some((source) => this.#sourceMet(source, unlocked));
        if (!revealed.has(definition.id) && (revealable || unlockable)) {
          revealed.add(definition.id); newlyRevealed.push(definition.id); changedInPass = true;
        }
        if (!unlocked.has(definition.id) && unlockable) {
          unlocked.add(definition.id); newlyUnlocked.push(definition.id); changedInPass = true;
        }
      }
    }
  }

  #sourceMet(source: ProgressionSourceDefinition, unlocked: ReadonlySet<string>): boolean {
    return source.requirements.every((requirement) => {
      if (requirement.kind === "content-unlocked") return unlocked.has(requirement.contentId);
      const value = this.#facts.getFactValue(requirement.factId);
      if (typeof requirement.minimumValue === "number") return typeof value === "number" && value >= requirement.minimumValue;
      return value === true || (typeof value === "number" && value > 0);
    });
  }

  #commit(
    operationId: string,
    occurredAtUtcMs: number,
    revealed: Set<string>,
    unlocked: Set<string>,
    newlyRevealed: readonly string[],
    newlyUnlocked: readonly string[],
    sourceId = "condition-evaluation",
  ): ProgressionResult {
    const changed = newlyRevealed.length > 0 || newlyUnlocked.length > 0;
    const recordOperation = changed || sourceId !== "condition-evaluation";
    if (recordOperation) {
      this.#state = cloneState({
        schemaVersion: PROGRESSION_SCHEMA_VERSION,
        revision: this.#state.revision + (changed ? 1 : 0),
        revealedContentIds: [...revealed],
        unlockedContentIds: [...unlocked],
        processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
      });
    }
    const events: DomainEvent[] = [];
    for (const contentId of newlyRevealed) events.push(this.#event("progression.content-revealed", operationId, contentId, sourceId, occurredAtUtcMs));
    for (const contentId of newlyUnlocked) events.push(this.#event("progression.content-unlocked", operationId, contentId, sourceId, occurredAtUtcMs));
    if (newlyUnlocked.length > 0) {
      events.push(this.#unlockBatchEvent(
        operationId,
        newlyUnlocked,
        sourceId,
        occurredAtUtcMs,
      ));
    }
    this.#eventBus.publishAll(events);
    return Object.freeze({ accepted: true, changed, operationId, revealedContentIds: Object.freeze([...newlyRevealed]), unlockedContentIds: Object.freeze([...newlyUnlocked]), events: Object.freeze(events) });
  }

  #validateOperation(operationId: string, occurredAtUtcMs: number): ProgressionResult | null {
    if (!validOperationId(operationId) || !nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Progression operation is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject(operationId, "DUPLICATE_OPERATION", "Progression operation has already been processed.");
    return null;
  }

  #validateContentRequest(operationId: string, contentIds: readonly string[], sourceId: string): ProgressionResult | null {
    if (!validId(sourceId) || contentIds.length === 0 || contentIds.some((id) => !validId(id))) return this.#reject(operationId, "INVALID_REQUEST", "Progression content request is invalid.");
    const unknown = [...new Set(contentIds)].find((id) => !this.#definitions.has(id));
    return unknown === undefined ? null : this.#reject(operationId, "UNKNOWN_CONTENT", `Unknown progression content: ${unknown}`);
  }

  #validateDefinitions(definitions: readonly ProgressionContentDefinition[]): void {
    if (definitions.length === 0) throw new Error("Progression definitions must not be empty.");
    const ids = new Set<string>();
    for (const definition of definitions) {
      if (!validId(definition.id) || ids.has(definition.id) || !validId(definition.name) || !CONTENT_KINDS.has(definition.kind) ||
          (definition.initiallyUnlocked && !definition.initiallyRevealed)) throw new Error(`Invalid progression content: ${definition.id}`);
      ids.add(definition.id);
      const sourceIds = new Set<string>();
      for (const source of [...definition.revealSources, ...definition.unlockSources]) {
        if (!validId(source.id) || sourceIds.has(source.id) || source.requirements.length === 0) throw new Error(`Invalid progression source for ${definition.id}.`);
        sourceIds.add(source.id);
        for (const requirement of source.requirements) {
          if (requirement.kind === "fact") {
            if (!validId(requirement.factId) || (requirement.minimumValue !== undefined && (!Number.isFinite(requirement.minimumValue) || requirement.minimumValue < 0))) throw new Error(`Invalid progression fact requirement for ${definition.id}.`);
          } else if (!validId(requirement.contentId) || requirement.contentId === definition.id) {
            throw new Error(`Invalid progression content requirement for ${definition.id}.`);
          }
        }
      }
    }
    for (const definition of definitions) {
      for (const source of [...definition.revealSources, ...definition.unlockSources]) {
        for (const requirement of source.requirements) {
          if (requirement.kind === "content-unlocked" && !ids.has(requirement.contentId)) throw new Error(`Unknown progression prerequisite ${requirement.contentId}.`);
        }
      }
    }
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error("Progression content prerequisites contain a cycle.");
      if (visited.has(id)) return;
      visiting.add(id);
      const definition = definitions.find((entry) => entry.id === id)!;
      for (const source of [...definition.revealSources, ...definition.unlockSources]) {
        for (const requirement of source.requirements) if (requirement.kind === "content-unlocked") visit(requirement.contentId);
      }
      visiting.delete(id); visited.add(id);
    };
    definitions.forEach((definition) => visit(definition.id));
  }

  #cloneSources(sources: readonly ProgressionSourceDefinition[]): readonly ProgressionSourceDefinition[] {
    return Object.freeze(sources.map((source) => Object.freeze({
      ...source,
      requirements: Object.freeze(source.requirements.map((requirement) => Object.freeze({ ...requirement }))),
    })));
  }

  #event(type: "progression.content-revealed" | "progression.content-unlocked", operationId: string, contentId: string, sourceId: string, occurredAtUtcMs: number): DomainEvent {
    const definition = this.#definitions.get(contentId)!;
    return Object.freeze({ id: `${type}:${operationId}:${contentId}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload: Object.freeze({ contentId, kind: definition.kind, sourceId }) });
  }

  #unlockBatchEvent(
    operationId: string,
    contentIds: readonly string[],
    sourceId: string,
    occurredAtUtcMs: number,
  ): DomainEvent {
    const grouped = new Map<ProgressionContentKind, string[]>();
    for (const contentId of contentIds) {
      const kind = this.#definitions.get(contentId)!.kind;
      const entries = grouped.get(kind) ?? [];
      entries.push(contentId);
      grouped.set(kind, entries);
    }
    return Object.freeze({
      id: `progression.unlock-batch-completed:${operationId}`,
      type: "progression.unlock-batch-completed",
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload: Object.freeze({
        sourceId,
        unlockedContentIds: Object.freeze([...contentIds]),
        groups: Object.freeze([...grouped].map(([kind, ids]) => Object.freeze({
          kind,
          count: ids.length,
          contentIds: Object.freeze([...ids]),
        }))),
      }),
    });
  }
  #reject(operationId: string, code: ProgressionRejectionCode, message: string): ProgressionResult {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }
}