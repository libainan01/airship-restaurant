import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { isInstanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const CHARACTER_MODULE_ID = "module.character";
export const CHARACTER_SCHEMA_VERSION = 2;
export const CHARACTER_MAX_TALENTS = 3;
export const CHARACTER_MAX_SKILL_LEVEL = 100;
export const CHARACTER_SKILL_EXPERIENCE_PER_LEVEL = 100;

export const CHARACTER_SKILL_KEYS = [
  "cooking",
  "charm",
  "movement",
  "repair",
  "piloting",
] as const;

export type CharacterSkillKey = typeof CHARACTER_SKILL_KEYS[number];
export type CharacterSkillProgressSource = "work" | "training";
export type CharacterSkillLevels = Readonly<Record<CharacterSkillKey, number>>;

export interface CharacterDefinition {
  readonly id: string;
  readonly name: string;
  readonly baseSkills: CharacterSkillLevels;
  readonly defaultTalentIds: readonly string[];
}

export interface CharacterTalentDefinition {
  readonly id: string;
  readonly name: string;
  readonly exclusiveCharacterId: string | null;
  readonly effectKeys: readonly string[];
}

export interface CharacterSkillState {
  readonly level: number;
  readonly experience: number;
}

export type CharacterSkillsState = Readonly<Record<CharacterSkillKey, CharacterSkillState>>;

export interface CharacterInstanceState {
  readonly id: InstanceId;
  readonly definitionId: string;
  readonly name: string;
  readonly coreMember: boolean;
  readonly skills: CharacterSkillsState;
  readonly talentIds: readonly string[];
  readonly createdAtUtcMs: number;
}

export interface CharacterState {
  readonly schemaVersion: typeof CHARACTER_SCHEMA_VERSION;
  readonly revision: number;
  readonly characters: readonly CharacterInstanceState[];
  readonly processedOperationIds: readonly string[];
}

export interface CharacterReadModelItem {
  readonly id: InstanceId;
  readonly definitionId: string;
  readonly name: string;
  readonly coreMember: boolean;
  readonly skills: CharacterSkillsState;
  readonly talents: readonly {
    readonly id: string;
    readonly name: string;
    readonly effectKeys: readonly string[];
  }[];
}

export interface CharacterReadModel {
  readonly revision: number;
  readonly characters: readonly CharacterReadModelItem[];
}

export interface CreateCharacterRequest {
  readonly instanceId: InstanceId;
  readonly definitionId: string;
  readonly coreMember: boolean;
  /** Omit both fields to use the definition snapshot. */
  readonly name?: string;
  readonly skillLevels?: CharacterSkillLevels;
  /** Omit to use the definition's fixed default talents. */
  readonly talentIds?: readonly string[];
  readonly occurredAtUtcMs: number;
}

export interface AddCharacterSkillExperienceRequest {
  readonly characterId: InstanceId;
  readonly skill: CharacterSkillKey;
  readonly amount: number;
  readonly source: CharacterSkillProgressSource;
  readonly occurredAtUtcMs: number;
}

export type CharacterRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_DEFINITION"
  | "DUPLICATE_CHARACTER"
  | "UNKNOWN_CHARACTER"
  | "INVALID_TALENTS";

export type CharacterOperationResult<TValue = undefined> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: CharacterRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 1_024;

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validSkillLevel(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= CHARACTER_MAX_SKILL_LEVEL;
}

function freezeSkills(skills: CharacterSkillsState): CharacterSkillsState {
  return Object.freeze(Object.fromEntries(
    CHARACTER_SKILL_KEYS.map((key) => [key, Object.freeze({ ...skills[key] })]),
  ) as Record<CharacterSkillKey, CharacterSkillState>);
}

function initialSkills(levels: CharacterSkillLevels): CharacterSkillsState {
  return Object.freeze(Object.fromEntries(
    CHARACTER_SKILL_KEYS.map((key) => [key, Object.freeze({ level: levels[key], experience: 0 })]),
  ) as Record<CharacterSkillKey, CharacterSkillState>);
}

function freezeCharacter(character: CharacterInstanceState): CharacterInstanceState {
  return Object.freeze({
    ...character,
    skills: freezeSkills(character.skills),
    talentIds: Object.freeze([...character.talentIds]),
  });
}

function cloneState(state: CharacterState): CharacterState {
  return Object.freeze({
    ...state,
    characters: Object.freeze(state.characters.map(freezeCharacter)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

export function isCharacterState(value: unknown): value is CharacterState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<CharacterState>;
  if (state.schemaVersion !== CHARACTER_SCHEMA_VERSION ||
    typeof state.revision !== "number" || !nonNegativeInteger(state.revision) ||
    !Array.isArray(state.characters) ||
    !Array.isArray(state.processedOperationIds) ||
    state.processedOperationIds.some((id) => typeof id !== "string" || !validId(id)) ||
    new Set(state.processedOperationIds).size !== state.processedOperationIds.length) {
    return false;
  }
  const characterIds = new Set<string>();
  return state.characters.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const character = candidate as Partial<CharacterInstanceState>;
    if (typeof character.id !== "string" || !isInstanceId(character.id) || characterIds.has(character.id) ||
      typeof character.definitionId !== "string" || !validId(character.definitionId) ||
      typeof character.name !== "string" || !validId(character.name) ||
      typeof character.coreMember !== "boolean" ||
      typeof character.createdAtUtcMs !== "number" || !nonNegativeInteger(character.createdAtUtcMs) ||
      !Array.isArray(character.talentIds) || character.talentIds.length > CHARACTER_MAX_TALENTS ||
      character.talentIds.some((id) => typeof id !== "string" || !validId(id)) ||
      new Set(character.talentIds).size !== character.talentIds.length ||
      typeof character.skills !== "object" || character.skills === null) {
      return false;
    }
    characterIds.add(character.id);
    return CHARACTER_SKILL_KEYS.every((skill) => {
      const progress = (character.skills as Partial<CharacterSkillsState>)[skill];
      return typeof progress === "object" && progress !== null &&
        typeof progress.level === "number" && validSkillLevel(progress.level) &&
        typeof progress.experience === "number" && nonNegativeInteger(progress.experience) &&
        progress.experience < CHARACTER_SKILL_EXPERIENCE_PER_LEVEL &&
        (progress.level < CHARACTER_MAX_SKILL_LEVEL || progress.experience === 0);
    });
  });
}

export class CharacterTalentLibrary {
  readonly #talents = new Map<string, CharacterTalentDefinition>();

  constructor(talents: readonly CharacterTalentDefinition[]) {
    for (const talent of talents) {
      if (!validId(talent.id) || !validId(talent.name) || this.#talents.has(talent.id) ||
        (talent.exclusiveCharacterId !== null && !validId(talent.exclusiveCharacterId)) ||
        talent.effectKeys.some((key) => !validId(key)) ||
        new Set(talent.effectKeys).size !== talent.effectKeys.length) {
        throw new Error(`Invalid or duplicate character talent: ${talent.id}`);
      }
      this.#talents.set(talent.id, Object.freeze({
        ...talent,
        effectKeys: Object.freeze([...talent.effectKeys]),
      }));
    }
  }

  get(talentId: string): CharacterTalentDefinition | null {
    return this.#talents.get(talentId) ?? null;
  }

  list(): readonly CharacterTalentDefinition[] {
    return Object.freeze([...this.#talents.values()]);
  }

  validateAssignment(characterDefinitionId: string, talentIds: readonly string[]): string | null {
    if (talentIds.length > CHARACTER_MAX_TALENTS || new Set(talentIds).size !== talentIds.length) {
      return `A character can have at most ${CHARACTER_MAX_TALENTS} unique talents.`;
    }
    for (const talentId of talentIds) {
      const talent = this.#talents.get(talentId);
      if (talent === undefined) return `Unknown character talent: ${talentId}`;
      if (talent.exclusiveCharacterId !== null && talent.exclusiveCharacterId !== characterDefinitionId) {
        return `Talent ${talentId} is exclusive to ${talent.exclusiveCharacterId}.`;
      }
    }
    return null;
  }

  /** Rolls only general talents. The returned assignment is intended to be persisted unchanged. */
  rollGeneralTalents(random: () => number, count: number): readonly string[] {
    if (!Number.isSafeInteger(count) || count < 0 || count > CHARACTER_MAX_TALENTS) {
      throw new RangeError(`Talent count must be between 0 and ${CHARACTER_MAX_TALENTS}.`);
    }
    const candidates = [...this.#talents.values()]
      .filter((talent) => talent.exclusiveCharacterId === null)
      .map((talent) => talent.id);
    if (count > candidates.length) throw new RangeError("Not enough general talents to satisfy the roll.");
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError("Talent random source must return a number in [0, 1).");
      }
      const target = Math.floor(sample * (index + 1));
      [candidates[index], candidates[target]] = [candidates[target]!, candidates[index]!];
    }
    return Object.freeze(candidates.slice(0, count));
  }
}

export class CharacterModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = CHARACTER_MODULE_ID;
  readonly transactionParticipantId = CHARACTER_MODULE_ID;
  readonly #definitions = new Map<string, CharacterDefinition>();
  readonly #talents: CharacterTalentLibrary;
  #state: CharacterState;
  #transactionActive = false;

  constructor(
    definitions: readonly CharacterDefinition[],
    talents: readonly CharacterTalentDefinition[],
    initialState?: CharacterState,
  ) {
    for (const definition of definitions) {
      if (!validId(definition.id) || !validId(definition.name) || this.#definitions.has(definition.id) ||
        CHARACTER_SKILL_KEYS.some((key) => !validSkillLevel(definition.baseSkills[key]))) {
        throw new Error(`Invalid or duplicate character definition: ${definition.id}`);
      }
      this.#definitions.set(definition.id, Object.freeze({
        ...definition,
        baseSkills: Object.freeze({ ...definition.baseSkills }),
        defaultTalentIds: Object.freeze([...definition.defaultTalentIds]),
      }));
    }
    this.#talents = new CharacterTalentLibrary(talents);
    for (const definition of this.#definitions.values()) {
      const issue = this.#talents.validateAssignment(definition.id, definition.defaultTalentIds);
      if (issue !== null) throw new Error(`Invalid talents for ${definition.id}: ${issue}`);
    }
    this.#state = initialState === undefined
      ? cloneState({
          schemaVersion: CHARACTER_SCHEMA_VERSION,
          revision: 0,
          characters: [],
          processedOperationIds: [],
        })
      : this.#restore(initialState);
    this.#validateState();
  }

  get talentLibrary(): CharacterTalentLibrary {
    return this.#talents;
  }

  exportState(): CharacterState {
    return cloneState(this.#state);
  }

  getCharacter(characterId: InstanceId): CharacterInstanceState | null {
    return this.#state.characters.find((character) => character.id === characterId) ?? null;
  }

  createReadModel(): CharacterReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      characters: Object.freeze(this.#state.characters.map((character) => {
        return Object.freeze({
          id: character.id,
          definitionId: character.definitionId,
          name: character.name,
          coreMember: character.coreMember,
          skills: freezeSkills(character.skills),
          talents: Object.freeze(character.talentIds.map((talentId) => {
            const talent = this.#talents.get(talentId)!;
            return Object.freeze({
              id: talent.id,
              name: talent.name,
              effectKeys: Object.freeze([...talent.effectKeys]),
            });
          })),
        });
      })),
    });
  }

  createCharacter(
    operationId: string,
    request: CreateCharacterRequest,
  ): CharacterOperationResult<CharacterInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const definition = this.#definitions.get(request.definitionId);
    if (definition === undefined) {
      return this.#reject(operationId, "UNKNOWN_DEFINITION", `Unknown character definition: ${request.definitionId}`);
    }
    const name = request.name ?? definition.name;
    const skillLevels = request.skillLevels ?? definition.baseSkills;
    if (!isInstanceId(request.instanceId) || !nonNegativeInteger(request.occurredAtUtcMs) ||
      typeof request.coreMember !== "boolean" || !validId(name) ||
      CHARACTER_SKILL_KEYS.some((key) => !validSkillLevel(skillLevels[key]))) {
      return this.#reject(operationId, "INVALID_REQUEST", "Character creation request is invalid.");
    }
    if (this.getCharacter(request.instanceId) !== null) {
      return this.#reject(operationId, "DUPLICATE_CHARACTER", `Character already exists: ${request.instanceId}`);
    }
    const talentIds = request.talentIds ?? definition.defaultTalentIds;
    const talentIssue = this.#talents.validateAssignment(definition.id, talentIds);
    if (talentIssue !== null) return this.#reject(operationId, "INVALID_TALENTS", talentIssue);
    const character = freezeCharacter({
      id: request.instanceId,
      definitionId: definition.id,
      name,
      coreMember: request.coreMember,
      skills: initialSkills(skillLevels),
      talentIds,
      createdAtUtcMs: request.occurredAtUtcMs,
    });
    this.#replace({ characters: [...this.#state.characters, character] });
    return this.#accept(operationId, character, [this.#event(
      operationId,
      "character.created",
      request.occurredAtUtcMs,
      { characterId: character.id, definitionId: character.definitionId, name: character.name, coreMember: character.coreMember },
    )]);
  }

  addSkillExperience(
    operationId: string,
    request: AddCharacterSkillExperienceRequest,
  ): CharacterOperationResult<CharacterSkillState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const characterIndex = this.#state.characters.findIndex((value) => value.id === request.characterId);
    if (characterIndex < 0) {
      return this.#reject(operationId, "UNKNOWN_CHARACTER", `Unknown character: ${request.characterId}`);
    }
    if (!CHARACTER_SKILL_KEYS.includes(request.skill) || !Number.isSafeInteger(request.amount) || request.amount <= 0 ||
      (request.source !== "work" && request.source !== "training") || !nonNegativeInteger(request.occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Character skill experience request is invalid.");
    }
    const character = this.#state.characters[characterIndex]!;
    const previous = character.skills[request.skill];
    let level = previous.level;
    let experience = level >= CHARACTER_MAX_SKILL_LEVEL ? 0 : previous.experience + request.amount;
    while (experience >= CHARACTER_SKILL_EXPERIENCE_PER_LEVEL && level < CHARACTER_MAX_SKILL_LEVEL) {
      experience -= CHARACTER_SKILL_EXPERIENCE_PER_LEVEL;
      level += 1;
    }
    if (level >= CHARACTER_MAX_SKILL_LEVEL) experience = 0;
    const progress = Object.freeze({ level, experience });
    const characters = [...this.#state.characters];
    characters[characterIndex] = freezeCharacter({
      ...character,
      skills: Object.freeze({ ...character.skills, [request.skill]: progress }),
    });
    this.#replace({ characters });
    return this.#accept(operationId, progress, [this.#event(
      operationId,
      "character.skill-experience-added",
      request.occurredAtUtcMs,
      {
        characterId: character.id,
        skill: request.skill,
        amount: request.amount,
        source: request.source,
        level,
        experience,
        levelsGained: level - previous.level,
      },
    )]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Character transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = cloneState(checkpoint);
        this.#transactionActive = false;
      },
    };
  }

  #prepare(operationId: string): CharacterOperationResult<never> | null {
    if (!validId(operationId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Character operation id is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Character operation was already processed.");
    }
    this.#state = cloneState({
      ...this.#state,
      processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
    });
    return null;
  }

  #replace(update: Partial<CharacterState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #accept<TValue>(
    operationId: string,
    value: TValue,
    events: readonly DomainEvent[],
  ): CharacterOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: true,
      operationId,
      value,
      events: Object.freeze([...events]),
    });
  }

  #reject(operationId: string, code: CharacterRejectionCode, message: string): CharacterOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #restore(initialState: CharacterState): CharacterState {
    const source = initialState as unknown as Omit<CharacterState, "schemaVersion" | "characters"> & {
      readonly schemaVersion: number;
      readonly characters: readonly (Omit<CharacterInstanceState, "name"> & { readonly name?: string })[];
    };
    if (source.schemaVersion !== 1 && source.schemaVersion !== CHARACTER_SCHEMA_VERSION) {
      throw new Error(`Unsupported character schema version: ${source.schemaVersion}`);
    }
    return cloneState({
      ...source,
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      characters: source.characters.map((character) => ({
        ...character,
        name: character.name ?? this.#definitions.get(character.definitionId)?.name ?? "",
      })),
    });
  }

  #validateState(): void {
    if (!isCharacterState(this.#state)) {
      throw new Error("Character state metadata is invalid.");
    }
    const ids = new Set<InstanceId>();
    for (const character of this.#state.characters) {
      const definition = this.#definitions.get(character.definitionId);
      if (!isInstanceId(character.id) || ids.has(character.id) || definition === undefined || !validId(character.name) ||
        typeof character.coreMember !== "boolean" || !nonNegativeInteger(character.createdAtUtcMs) ||
        this.#talents.validateAssignment(character.definitionId, character.talentIds) !== null) {
        throw new Error(`Invalid character state: ${character.id}`);
      }
      ids.add(character.id);
      for (const skill of CHARACTER_SKILL_KEYS) {
        const progress = character.skills[skill];
        if (!validSkillLevel(progress.level) || !nonNegativeInteger(progress.experience) ||
          progress.experience >= CHARACTER_SKILL_EXPERIENCE_PER_LEVEL ||
          (progress.level === CHARACTER_MAX_SKILL_LEVEL && progress.experience !== 0)) {
          throw new Error(`Invalid character skill state: ${character.id}/${skill}`);
        }
      }
    }
  }
}