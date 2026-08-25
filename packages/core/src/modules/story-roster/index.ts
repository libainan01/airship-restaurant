import type { DomainEvent, InstanceId } from "../../kernel";
import { DomainEventBus } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const STORY_ROSTER_MODULE_ID = "module.story-roster";
export const STORY_ROSTER_SCHEMA_VERSION = 1;

export interface RelationshipTierDefinition {
  readonly id: string;
  readonly minimumAffinity: number;
}
export interface StoryRosterCharacterDefinition {
  readonly characterId: string;
  readonly identity: string;
  readonly relationshipTiers: readonly RelationshipTierDefinition[];
}
export interface StoryRosterNodeDefinition {
  readonly id: string;
  readonly characterId: string;
  readonly sequence: number;
  readonly hint: string;
  readonly summary: string;
  readonly prerequisiteNodeIds: readonly string[];
  readonly rewardContentIds: readonly string[];
}
export interface StoryRosterCharacterState {
  readonly characterId: string;
  readonly discoveredAtUtcMs: number;
  readonly affinity: number;
  readonly availableNodeIds: readonly string[];
  readonly completedNodes: readonly { readonly nodeId: string; readonly completedAtUtcMs: number }[];
}
export interface StoryRosterState {
  readonly schemaVersion: typeof STORY_ROSTER_SCHEMA_VERSION;
  readonly revision: number;
  readonly characters: readonly StoryRosterCharacterState[];
  readonly processedOperationIds: readonly string[];
}
export interface StoryRosterNodeReadModel {
  readonly id: string;
  readonly status: "locked" | "available" | "completed";
  readonly hint: string | null;
  readonly summary: string | null;
  readonly rewardContentIds: readonly string[];
}
export interface StoryRosterCharacterReadModel {
  readonly characterId: string;
  readonly identity: string;
  readonly affinity: number;
  readonly relationshipTierId: string;
  readonly completedNodeCount: number;
  readonly totalNodeCount: number;
  readonly nodes: readonly StoryRosterNodeReadModel[];
}
export interface StoryRosterReadModel {
  readonly revision: number;
  readonly characters: readonly StoryRosterCharacterReadModel[];
}
export type StoryRosterRejectionCode =
  | "INVALID_REQUEST" | "DUPLICATE_OPERATION" | "UNKNOWN_CHARACTER" | "UNKNOWN_NODE"
  | "CHARACTER_UNDISCOVERED" | "NODE_NOT_AVAILABLE";
export type StoryRosterResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly code: StoryRosterRejectionCode; readonly message: string; readonly events: readonly [] };

const HISTORY_LIMIT = 2048;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 240;
const integer = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const cloneCharacter = (value: StoryRosterCharacterState): StoryRosterCharacterState => Object.freeze({
  ...value,
  availableNodeIds: Object.freeze([...value.availableNodeIds]),
  completedNodes: Object.freeze(value.completedNodes.map((entry) => Object.freeze({ ...entry }))),
});
const cloneState = (value: StoryRosterState): StoryRosterState => Object.freeze({
  ...value,
  characters: Object.freeze(value.characters.map(cloneCharacter)),
  processedOperationIds: Object.freeze([...value.processedOperationIds]),
});

export function isStoryRosterState(value: unknown): value is StoryRosterState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<StoryRosterState>;
  if (state.schemaVersion !== STORY_ROSTER_SCHEMA_VERSION || !integer(state.revision as number) ||
    !Array.isArray(state.characters) || !Array.isArray(state.processedOperationIds) ||
    state.processedOperationIds.some((id) => typeof id !== "string" || !valid(id)) ||
    new Set(state.processedOperationIds).size !== state.processedOperationIds.length) return false;
  const ids = new Set<string>();
  return state.characters.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const entry = candidate as Partial<StoryRosterCharacterState>;
    if (typeof entry.characterId !== "string" || !valid(entry.characterId) || ids.has(entry.characterId) ||
      !integer(entry.discoveredAtUtcMs as number) || !integer(entry.affinity as number) ||
      !Array.isArray(entry.availableNodeIds) || entry.availableNodeIds.some((id) => typeof id !== "string" || !valid(id)) ||
      new Set(entry.availableNodeIds).size !== entry.availableNodeIds.length ||
      !Array.isArray(entry.completedNodes) || entry.completedNodes.some((node) =>
        typeof node !== "object" || node === null || !("nodeId" in node) || typeof node.nodeId !== "string" ||
        !valid(node.nodeId) || !("completedAtUtcMs" in node) || !integer(node.completedAtUtcMs as number))) return false;
    ids.add(entry.characterId);
    return new Set(entry.completedNodes.map((node) => node.nodeId)).size === entry.completedNodes.length;
  });
}

export class StoryRosterModule implements DomainModule {
  readonly moduleId = STORY_ROSTER_MODULE_ID;
  readonly #characters = new Map<string, StoryRosterCharacterDefinition>();
  readonly #nodes = new Map<string, StoryRosterNodeDefinition>();
  readonly #affinityByQuality = new Map<number, number>();
  #state: StoryRosterState;

  constructor(options: {
    readonly characters: readonly StoryRosterCharacterDefinition[];
    readonly nodes: readonly StoryRosterNodeDefinition[];
    readonly affinityByQuality: Readonly<Record<number, number>>;
    readonly initialState?: StoryRosterState;
  }) {
    for (const character of options.characters) {
      if (!valid(character.characterId) || !valid(character.identity) || this.#characters.has(character.characterId) ||
        character.relationshipTiers.length === 0 || character.relationshipTiers.some((tier, index) =>
          !valid(tier.id) || !integer(tier.minimumAffinity) ||
          (index === 0 ? tier.minimumAffinity !== 0 : tier.minimumAffinity <= character.relationshipTiers[index - 1]!.minimumAffinity)))
        throw new Error("Invalid story roster character: " + character.characterId);
      this.#characters.set(character.characterId, Object.freeze({
        ...character,
        relationshipTiers: Object.freeze(character.relationshipTiers.map((tier) => Object.freeze({ ...tier }))),
      }));
    }
    for (const node of options.nodes) {
      if (!valid(node.id) || !this.#characters.has(node.characterId) || !integer(node.sequence) ||
        !valid(node.hint) || !valid(node.summary) || this.#nodes.has(node.id))
        throw new Error("Invalid story roster node: " + node.id);
      this.#nodes.set(node.id, Object.freeze({
        ...node,
        prerequisiteNodeIds: Object.freeze([...node.prerequisiteNodeIds]),
        rewardContentIds: Object.freeze([...node.rewardContentIds]),
      }));
    }
    for (const node of this.#nodes.values()) {
      if (node.prerequisiteNodeIds.some((id) => !this.#nodes.has(id) || this.#nodes.get(id)!.characterId !== node.characterId))
        throw new Error("Invalid story roster prerequisites: " + node.id);
    }
    for (const [quality, affinity] of Object.entries(options.affinityByQuality)) {
      const qualityTier = Number(quality);
      if (!integer(qualityTier) || !integer(affinity) || affinity === 0) throw new Error("Invalid meal affinity mapping.");
      this.#affinityByQuality.set(qualityTier, affinity);
    }
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: STORY_ROSTER_SCHEMA_VERSION, revision: 0, characters: [], processedOperationIds: [] })
      : cloneState(options.initialState);
    if (!isStoryRosterState(this.#state)) throw new Error("Story roster state is invalid.");
    for (const entry of this.#state.characters) {
      if (!this.#characters.has(entry.characterId) ||
        [...entry.availableNodeIds, ...entry.completedNodes.map((node) => node.nodeId)]
          .some((id) => this.#nodes.get(id)?.characterId !== entry.characterId))
        throw new Error("Story roster state references unknown content.");
    }
  }

  exportState(): StoryRosterState { return cloneState(this.#state); }
  createReadModel(): StoryRosterReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      characters: Object.freeze(this.#state.characters.map((entry) => {
        const definition = this.#characters.get(entry.characterId)!;
        const completed = new Set(entry.completedNodes.map((node) => node.nodeId));
        const nodes = [...this.#nodes.values()].filter((node) => node.characterId === entry.characterId)
          .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
        const tier = [...definition.relationshipTiers].reverse().find((candidate) => entry.affinity >= candidate.minimumAffinity)!;
        return Object.freeze({
          characterId: entry.characterId,
          identity: definition.identity,
          affinity: entry.affinity,
          relationshipTierId: tier.id,
          completedNodeCount: completed.size,
          totalNodeCount: nodes.length,
          nodes: Object.freeze(nodes.map((node) => Object.freeze({
            id: node.id,
            status: completed.has(node.id) ? "completed" as const : entry.availableNodeIds.includes(node.id) ? "available" as const : "locked" as const,
            hint: completed.has(node.id) ? null : node.hint,
            summary: completed.has(node.id) ? node.summary : null,
            rewardContentIds: Object.freeze(completed.has(node.id) ? [...node.rewardContentIds] : []),
          }))),
        });
      })),
    });
  }

  discover(operationId: string, characterId: string, time: number): StoryRosterResult<StoryRosterCharacterState> {
    const issue = this.#issue(operationId, time);
    if (issue !== null || !this.#characters.has(characterId)) return issue ?? this.#reject("UNKNOWN_CHARACTER", "Unknown story character.");
    const current = this.#find(characterId);
    if (current !== null) return this.#accept(current, false);
    const value = cloneCharacter({ characterId, discoveredAtUtcMs: time, affinity: 0, availableNodeIds: [], completedNodes: [] });
    this.#replace({ characters: [...this.#state.characters, value] }, operationId);
    return this.#accept(value, true, [this.#event(operationId, "story-roster.character-discovered", time, { characterId })]);
  }

  recordMealEaten(operationId: string, characterId: string, qualityTier: number, time: number): StoryRosterResult<number> {
    const issue = this.#issue(operationId, time);
    const increment = this.#affinityByQuality.get(qualityTier);
    const current = this.#find(characterId);
    if (issue !== null || increment === undefined || !this.#characters.has(characterId))
      return issue ?? this.#reject("INVALID_REQUEST", "Invalid meal affinity request.");
    if (current === null) return this.#reject("CHARACTER_UNDISCOVERED", "Story character has not been discovered.");
    const affinity = current.affinity + increment;
    this.#updateCharacter(cloneCharacter({ ...current, affinity }), operationId);
    return this.#accept(affinity, true, [this.#event(operationId, "story-roster.affinity-increased", time, { characterId, qualityTier, increment, affinity })]);
  }

  makeNodeAvailable(operationId: string, nodeId: string, time: number): StoryRosterResult<StoryRosterCharacterState> {
    const issue = this.#issue(operationId, time);
    const node = this.#nodes.get(nodeId);
    if (issue !== null || node === undefined) return issue ?? this.#reject("UNKNOWN_NODE", "Unknown story node.");
    const current = this.#find(node.characterId);
    if (current === null) return this.#reject("CHARACTER_UNDISCOVERED", "Story character has not been discovered.");
    if (current.availableNodeIds.includes(nodeId) || current.completedNodes.some((entry) => entry.nodeId === nodeId)) return this.#accept(current, false);
    const value = cloneCharacter({ ...current, availableNodeIds: [...current.availableNodeIds, nodeId] });
    this.#updateCharacter(value, operationId);
    return this.#accept(value, true, [this.#event(operationId, "story-roster.node-available", time, { characterId: node.characterId, nodeId })]);
  }

  completeNode(operationId: string, nodeId: string, time: number): StoryRosterResult<readonly string[]> {
    const issue = this.#issue(operationId, time);
    const node = this.#nodes.get(nodeId);
    if (issue !== null || node === undefined) return issue ?? this.#reject("UNKNOWN_NODE", "Unknown story node.");
    const current = this.#find(node.characterId);
    if (current === null) return this.#reject("CHARACTER_UNDISCOVERED", "Story character has not been discovered.");
    if (current.completedNodes.some((entry) => entry.nodeId === nodeId))
      return this.#accept(Object.freeze([...node.rewardContentIds]), false);
    const completed = new Set(current.completedNodes.map((entry) => entry.nodeId));
    if (!current.availableNodeIds.includes(nodeId) || node.prerequisiteNodeIds.some((id) => !completed.has(id)))
      return this.#reject("NODE_NOT_AVAILABLE", "Story node is not available.");
    this.#updateCharacter(cloneCharacter({
      ...current,
      availableNodeIds: current.availableNodeIds.filter((id) => id !== nodeId),
      completedNodes: [...current.completedNodes, Object.freeze({ nodeId, completedAtUtcMs: time })],
    }), operationId);
    const rewards = Object.freeze([...node.rewardContentIds]);
    return this.#accept(rewards, true, [
      this.#event(operationId, "story-roster.node-completed", time, { characterId: node.characterId, nodeId }),
      this.#event(operationId, "story-roster.rewards-declared", time, { characterId: node.characterId, nodeId, contentIds: rewards }),
    ]);
  }

  #find(characterId: string): StoryRosterCharacterState | null { return this.#state.characters.find((entry) => entry.characterId === characterId) ?? null; }
  #updateCharacter(value: StoryRosterCharacterState, operationId: string): void {
    this.#replace({ characters: this.#state.characters.map((entry) => entry.characterId === value.characterId ? value : entry) }, operationId);
  }
  #replace(update: Partial<StoryRosterState>, operationId: string): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
  }
  #issue(operationId: string, time: number): StoryRosterResult<never> | null {
    if (!valid(operationId) || !integer(time)) return this.#reject("INVALID_REQUEST", "Invalid story roster operation.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Story roster operation already processed.");
    return null;
  }
  #event(operationId: string, type: string, time: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: type + ":" + operationId, type, occurredAtUtcMs: time, causationId: operationId, correlationId: operationId, payload });
  }
  #accept<T>(value: T, changed: boolean, events: readonly DomainEvent[] = []): StoryRosterResult<T> {
    return Object.freeze({ accepted: true, changed, value, events: Object.freeze([...events]) });
  }
  #reject(code: StoryRosterRejectionCode, message: string): StoryRosterResult<never> {
    return Object.freeze({ accepted: false, changed: false, code, message, events: [] as const });
  }
}

export interface StoryRosterCharacterLookupPort {
  getCharacter(characterId: InstanceId): { readonly definitionId: string } | null;
}

export interface StoryRosterFinishedMealLookupPort {
  getFinishedMealByMealId(mealId: string): { readonly quality: number } | null;
}

export interface StoryRosterMealQualityTier {
  readonly qualityTier: number;
  readonly minimumQuality: number;
}

/** Bridges customer lifecycle broadcasts into the story-roster authority. */
export class StoryRosterCustomerEventAdapter {
  readonly #storyCharacterIds: ReadonlySet<string>;
  readonly #qualityTiers: readonly StoryRosterMealQualityTier[];
  readonly #unsubscribe: readonly (() => void)[];

  constructor(options: {
    readonly eventBus: DomainEventBus;
    readonly roster: StoryRosterModule;
    readonly characters: StoryRosterCharacterLookupPort;
    readonly finishedMeals: StoryRosterFinishedMealLookupPort;
    readonly storyCharacterIds: readonly string[];
    readonly qualityTiers: readonly StoryRosterMealQualityTier[];
    readonly onChanged?: () => void;
  }) {
    if (options.storyCharacterIds.length === 0 || new Set(options.storyCharacterIds).size !== options.storyCharacterIds.length ||
      options.qualityTiers.length === 0 || options.qualityTiers.some((tier, index) =>
        !Number.isSafeInteger(tier.qualityTier) || tier.qualityTier <= 0 || !Number.isFinite(tier.minimumQuality) || tier.minimumQuality < 0 ||
        (index > 0 && tier.minimumQuality <= options.qualityTiers[index - 1]!.minimumQuality))) {
      throw new Error("Story roster customer adapter configuration is invalid.");
    }
    this.#storyCharacterIds = new Set(options.storyCharacterIds);
    this.#qualityTiers = Object.freeze(options.qualityTiers.map((tier) => Object.freeze({ ...tier })));
    const publish = (events: readonly DomainEvent[]): void => { if (events.length > 0) options.eventBus.publishAll(events); };
    this.#unsubscribe = Object.freeze([
      options.eventBus.subscribe("customer.group-arrived", (event) => {
        const payload = event.payload as { readonly memberCharacterIds?: unknown };
        if (!Array.isArray(payload.memberCharacterIds)) return;
        let changed = false;
        for (const characterId of payload.memberCharacterIds) {
          if (typeof characterId !== "string") continue;
          const character = options.characters.getCharacter(characterId as InstanceId);
          if (character === null || !this.#storyCharacterIds.has(character.definitionId)) continue;
          const result = options.roster.discover(
            `story-roster:arrival:${event.id}:${character.definitionId}`,
            character.definitionId,
            event.occurredAtUtcMs,
          );
          if (!result.accepted) continue;
          changed ||= result.changed;
          publish(result.events);
        }
        if (changed) options.onChanged?.();
      }),
      options.eventBus.subscribe("customer.meal-consumed", (event) => {
        const payload = event.payload as { readonly dinerCharacterId?: unknown; readonly mealId?: unknown };
        if (typeof payload.dinerCharacterId !== "string" || typeof payload.mealId !== "string") return;
        const character = options.characters.getCharacter(payload.dinerCharacterId as InstanceId);
        if (character === null || !this.#storyCharacterIds.has(character.definitionId)) return;
        const meal = options.finishedMeals.getFinishedMealByMealId(payload.mealId);
        if (meal === null || !Number.isFinite(meal.quality)) return;
        const tier = [...this.#qualityTiers].reverse().find((candidate) => meal.quality >= candidate.minimumQuality);
        if (tier === undefined) return;
        const result = options.roster.recordMealEaten(
          `story-roster:meal:${event.id}:${character.definitionId}`,
          character.definitionId,
          tier.qualityTier,
          event.occurredAtUtcMs,
        );
        if (!result.accepted) return;
        publish(result.events);
        if (result.changed) options.onChanged?.();
      }),
    ]);
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
  }
}