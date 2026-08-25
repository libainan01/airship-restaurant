import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { isInstanceId } from "../../kernel";
import type { CharacterModule } from "../character";
import type { DomainModule } from "../domain-module";

export const EMPLOYMENT_MODULE_ID = "module.employment";
export const EMPLOYMENT_SCHEMA_VERSION = 1;
export type CharacterJobWorkMode = "shift" | "voyage";
export type EmploymentKind = "core" | "recruited";

export interface CharacterJobDefinition {
  readonly id: string;
  readonly name: string;
  readonly workMode: CharacterJobWorkMode;
}

export const DEFAULT_CHARACTER_JOB_DEFINITIONS = Object.freeze([
  { id: "job.chef", name: "厨师", workMode: "shift" },
  { id: "job.waiter", name: "服务员", workMode: "shift" },
  { id: "job.local_procurer", name: "本地采购员", workMode: "shift" },
  { id: "job.repairer", name: "维修员", workMode: "shift" },
  { id: "job.restaurant_manager", name: "餐厅管理员", workMode: "shift" },
  { id: "job.captain", name: "船长", workMode: "voyage" },
] as const satisfies readonly CharacterJobDefinition[]);

export interface DailyShift {
  readonly startMinuteInclusive: number;
  readonly endMinuteExclusive: number;
}

export interface EmploymentRecordState {
  readonly characterId: InstanceId;
  readonly kind: EmploymentKind;
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string;
  readonly dailyShift: DailyShift | null;
  readonly dismissalRequestedAtUtcMs: number | null;
  readonly employedAtUtcMs: number;
}

export interface EmploymentState {
  readonly schemaVersion: typeof EMPLOYMENT_SCHEMA_VERSION;
  readonly revision: number;
  readonly records: readonly EmploymentRecordState[];
  readonly processedOperationIds: readonly string[];
}

export interface CharacterActivityFacts {
  readonly minuteOfDay: number;
  readonly customerVisitActive: boolean;
  readonly voyageActive: boolean;
}

export type CharacterEligibilityTag = "employee" | "customer" | "captain-qualified";

export interface CharacterWorkContext {
  readonly characterId: InstanceId;
  readonly employed: boolean;
  readonly onShift: boolean;
  readonly acceptingNewWork: boolean;
  readonly voyageActive: boolean;
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string | null;
  readonly tags: readonly CharacterEligibilityTag[];
}

export interface EmploymentReadModelItem extends CharacterWorkContext {
  readonly name: string;
  readonly kind: EmploymentKind;
  readonly dailyShift: DailyShift | null;
  readonly dismissalPending: boolean;
}

export interface EmploymentReadModel {
  readonly revision: number;
  readonly employees: readonly EmploymentReadModelItem[];
}

export interface AddEmployeeRequest {
  readonly characterId: InstanceId;
  readonly kind: EmploymentKind;
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string;
  readonly dailyShift: DailyShift | null;
  readonly occurredAtUtcMs: number;
}

export type EmploymentRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_CHARACTER"
  | "DUPLICATE_EMPLOYEE"
  | "UNKNOWN_EMPLOYEE"
  | "UNKNOWN_JOB"
  | "JOB_NOT_LEARNED"
  | "CORE_KIND_MISMATCH"
  | "CORE_MEMBER_CANNOT_BE_DISMISSED"
  | "DISMISSAL_ALREADY_PENDING"
  | "DISMISSAL_NOT_PENDING";

export type EmploymentOperationResult<TValue = undefined> =
  | { readonly accepted: true; readonly changed: true; readonly operationId: string; readonly value: TValue; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly operationId: string; readonly code: EmploymentRejectionCode; readonly message: string; readonly events: readonly [] };

const OPERATION_HISTORY_LIMIT = 1_024;
const MINUTES_PER_DAY = 1_440;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 180;
const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validMinute = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value < MINUTES_PER_DAY;

function validShift(shift: DailyShift | null): boolean {
  return shift === null || (validMinute(shift.startMinuteInclusive) && validMinute(shift.endMinuteExclusive) && shift.startMinuteInclusive !== shift.endMinuteExclusive);
}

function isOnShift(shift: DailyShift | null, minuteOfDay: number): boolean {
  if (shift === null || !validMinute(minuteOfDay)) return false;
  if (shift.startMinuteInclusive < shift.endMinuteExclusive) {
    return minuteOfDay >= shift.startMinuteInclusive && minuteOfDay < shift.endMinuteExclusive;
  }
  return minuteOfDay >= shift.startMinuteInclusive || minuteOfDay < shift.endMinuteExclusive;
}

const freezeShift = (shift: DailyShift | null): DailyShift | null => shift === null ? null : Object.freeze({ ...shift });

function freezeRecord(record: EmploymentRecordState): EmploymentRecordState {
  return Object.freeze({ ...record, learnedJobIds: Object.freeze([...record.learnedJobIds]), dailyShift: freezeShift(record.dailyShift) });
}

function cloneState(state: EmploymentState): EmploymentState {
  return Object.freeze({ ...state, records: Object.freeze(state.records.map(freezeRecord)), processedOperationIds: Object.freeze([...state.processedOperationIds]) });
}

export function isEmploymentState(value: unknown): value is EmploymentState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<EmploymentState>;
  if (state.schemaVersion !== EMPLOYMENT_SCHEMA_VERSION ||
    typeof state.revision !== "number" || !nonNegativeInteger(state.revision) ||
    !Array.isArray(state.records) ||
    !Array.isArray(state.processedOperationIds) ||
    state.processedOperationIds.some((id) => typeof id !== "string" || !validId(id)) ||
    new Set(state.processedOperationIds).size !== state.processedOperationIds.length) {
    return false;
  }
  const characterIds = new Set<string>();
  return state.records.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const record = candidate as Partial<EmploymentRecordState>;
    if (typeof record.characterId !== "string" || !isInstanceId(record.characterId) || characterIds.has(record.characterId) ||
      (record.kind !== "core" && record.kind !== "recruited") ||
      !Array.isArray(record.learnedJobIds) || record.learnedJobIds.length === 0 ||
      record.learnedJobIds.some((id) => typeof id !== "string" || !validId(id)) ||
      new Set(record.learnedJobIds).size !== record.learnedJobIds.length ||
      typeof record.primaryJobId !== "string" || !record.learnedJobIds.includes(record.primaryJobId) ||
      !(record.dailyShift === null || (typeof record.dailyShift === "object" && validShift(record.dailyShift))) ||
      typeof record.employedAtUtcMs !== "number" || !nonNegativeInteger(record.employedAtUtcMs) ||
      (record.dismissalRequestedAtUtcMs !== null &&
        (typeof record.dismissalRequestedAtUtcMs !== "number" || !nonNegativeInteger(record.dismissalRequestedAtUtcMs)))) {
      return false;
    }
    characterIds.add(record.characterId);
    return true;
  });
}

type LocatedRecord = { readonly index: number; readonly record: EmploymentRecordState };

export class EmploymentModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = EMPLOYMENT_MODULE_ID;
  readonly transactionParticipantId = EMPLOYMENT_MODULE_ID;
  readonly #characters: CharacterModule;
  readonly #jobs = new Map<string, CharacterJobDefinition>();
  #state: EmploymentState;
  #transactionActive = false;

  constructor(characters: CharacterModule, jobs: readonly CharacterJobDefinition[] = DEFAULT_CHARACTER_JOB_DEFINITIONS, initialState?: EmploymentState) {
    this.#characters = characters;
    for (const job of jobs) {
      if (!validId(job.id) || !validId(job.name) || this.#jobs.has(job.id) || (job.workMode !== "shift" && job.workMode !== "voyage")) {
        throw new Error(`Invalid or duplicate character job: ${job.id}`);
      }
      this.#jobs.set(job.id, Object.freeze({ ...job }));
    }
    this.#state = initialState === undefined
      ? cloneState({ schemaVersion: EMPLOYMENT_SCHEMA_VERSION, revision: 0, records: [], processedOperationIds: [] })
      : cloneState(initialState);
    this.#validateState();
  }

  exportState(): EmploymentState { return cloneState(this.#state); }
  getRecord(characterId: InstanceId): EmploymentRecordState | null { return this.#state.records.find((record) => record.characterId === characterId) ?? null; }
  isPrimaryJob(characterId: InstanceId, jobId: string): boolean { return this.getRecord(characterId)?.primaryJobId === jobId; }

  getWorkContext(characterId: InstanceId, facts: CharacterActivityFacts): CharacterWorkContext {
    if (!validMinute(facts.minuteOfDay)) throw new RangeError("Minute of day is invalid.");
    const record = this.getRecord(characterId);
    const onShift = record !== null && isOnShift(record.dailyShift, facts.minuteOfDay);
    const acceptingNewWork = record !== null && record.dismissalRequestedAtUtcMs === null && !facts.voyageActive;
    const tags: CharacterEligibilityTag[] = [];
    // An active customer visit wins over a shift boundary: the character must finish
    // dining and leave before becoming eligible for restaurant work again.
    if (acceptingNewWork && onShift && !facts.customerVisitActive) tags.push("employee");
    if (facts.customerVisitActive && !facts.voyageActive) tags.push("customer");
    if (acceptingNewWork && record.learnedJobIds.includes("job.captain")) tags.push("captain-qualified");
    return Object.freeze({
      characterId,
      employed: record !== null,
      onShift,
      acceptingNewWork,
      voyageActive: facts.voyageActive,
      learnedJobIds: Object.freeze([...(record?.learnedJobIds ?? [])]),
      primaryJobId: record?.primaryJobId ?? null,
      tags: Object.freeze(tags),
    });
  }

  createReadModel(minuteOfDay: number, activity: ReadonlyMap<InstanceId, Omit<CharacterActivityFacts, "minuteOfDay">> = new Map()): EmploymentReadModel {
    const characterItems = new Map(this.#characters.createReadModel().characters.map((item) => [item.id, item]));
    return Object.freeze({
      revision: this.#state.revision,
      employees: Object.freeze(this.#state.records.map((record) => {
        const facts = activity.get(record.characterId) ?? { customerVisitActive: false, voyageActive: false };
        return Object.freeze({
          ...this.getWorkContext(record.characterId, { minuteOfDay, ...facts }),
          name: characterItems.get(record.characterId)!.name,
          kind: record.kind,
          dailyShift: freezeShift(record.dailyShift),
          dismissalPending: record.dismissalRequestedAtUtcMs !== null,
        });
      })),
    });
  }

  addEmployee(operationId: string, request: AddEmployeeRequest): EmploymentOperationResult<EmploymentRecordState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const character = this.#characters.getCharacter(request.characterId);
    if (character === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", `Unknown character: ${request.characterId}`);
    if (this.getRecord(request.characterId) !== null) return this.#reject(operationId, "DUPLICATE_EMPLOYEE", `Employee already exists: ${request.characterId}`);
    if (!isInstanceId(request.characterId) || !nonNegativeInteger(request.occurredAtUtcMs) || (request.kind !== "core" && request.kind !== "recruited") ||
      !validShift(request.dailyShift) || request.learnedJobIds.length === 0 || new Set(request.learnedJobIds).size !== request.learnedJobIds.length) {
      return this.#reject(operationId, "INVALID_REQUEST", "Employee request is invalid.");
    }
    if ((request.kind === "core") !== character.coreMember) return this.#reject(operationId, "CORE_KIND_MISMATCH", "Employment kind does not match the character core-member fact.");
    const unknownJob = request.learnedJobIds.find((jobId) => !this.#jobs.has(jobId));
    if (unknownJob !== undefined) return this.#reject(operationId, "UNKNOWN_JOB", `Unknown job: ${unknownJob}`);
    if (!request.learnedJobIds.includes(request.primaryJobId)) return this.#reject(operationId, "JOB_NOT_LEARNED", `Primary job is not learned: ${request.primaryJobId}`);
    const record = freezeRecord({ characterId: request.characterId, kind: request.kind, learnedJobIds: request.learnedJobIds, primaryJobId: request.primaryJobId,
      dailyShift: request.dailyShift, dismissalRequestedAtUtcMs: null, employedAtUtcMs: request.occurredAtUtcMs });
    this.#replace({ records: [...this.#state.records, record] });
    return this.#accept(operationId, record, [this.#event(operationId, "employment.employee-added", request.occurredAtUtcMs, record)]);
  }

  learnJob(operationId: string, characterId: InstanceId, jobId: string, occurredAtUtcMs: number): EmploymentOperationResult<EmploymentRecordState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locateRecord(operationId, characterId); if (!this.#isLocated(located)) return located;
    if (!this.#jobs.has(jobId)) return this.#reject(operationId, "UNKNOWN_JOB", `Unknown job: ${jobId}`);
    if (!nonNegativeInteger(occurredAtUtcMs) || located.record.learnedJobIds.includes(jobId)) return this.#reject(operationId, "INVALID_REQUEST", "Learn-job request is invalid or redundant.");
    const updated = freezeRecord({ ...located.record, learnedJobIds: [...located.record.learnedJobIds, jobId] });
    this.#replaceRecord(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, "employment.job-learned", occurredAtUtcMs, { characterId, jobId })]);
  }

  setPrimaryJob(operationId: string, characterId: InstanceId, jobId: string, occurredAtUtcMs: number): EmploymentOperationResult<EmploymentRecordState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locateRecord(operationId, characterId); if (!this.#isLocated(located)) return located;
    if (!this.#jobs.has(jobId)) return this.#reject(operationId, "UNKNOWN_JOB", `Unknown job: ${jobId}`);
    if (!located.record.learnedJobIds.includes(jobId)) return this.#reject(operationId, "JOB_NOT_LEARNED", `Job is not learned: ${jobId}`);
    if (!nonNegativeInteger(occurredAtUtcMs) || located.record.primaryJobId === jobId) return this.#reject(operationId, "INVALID_REQUEST", "Primary-job request is invalid or redundant.");
    const updated = freezeRecord({ ...located.record, primaryJobId: jobId }); this.#replaceRecord(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, "employment.primary-job-changed", occurredAtUtcMs, { characterId, jobId })]);
  }

  setDailyShift(operationId: string, characterId: InstanceId, dailyShift: DailyShift | null, occurredAtUtcMs: number): EmploymentOperationResult<EmploymentRecordState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locateRecord(operationId, characterId); if (!this.#isLocated(located)) return located;
    if (!validShift(dailyShift) || !nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Daily-shift request is invalid.");
    const updated = freezeRecord({ ...located.record, dailyShift }); this.#replaceRecord(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, "employment.daily-shift-changed", occurredAtUtcMs, { characterId, dailyShift })]);
  }

  requestDismissal(operationId: string, characterId: InstanceId, currentWorkMustFinish: boolean, occurredAtUtcMs: number): EmploymentOperationResult<{ readonly pending: boolean }> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locateRecord(operationId, characterId); if (!this.#isLocated(located)) return located;
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Dismissal time is invalid.");
    if (located.record.kind === "core") return this.#reject(operationId, "CORE_MEMBER_CANNOT_BE_DISMISSED", "Core members cannot be dismissed.");
    if (located.record.dismissalRequestedAtUtcMs !== null) return this.#reject(operationId, "DISMISSAL_ALREADY_PENDING", "Dismissal is already pending.");
    if (!currentWorkMustFinish) {
      this.#replace({ records: this.#state.records.filter((record) => record.characterId !== characterId) });
      return this.#accept(operationId, { pending: false }, [this.#event(operationId, "employment.employee-dismissed", occurredAtUtcMs, { characterId })]);
    }
    const updated = freezeRecord({ ...located.record, dismissalRequestedAtUtcMs: occurredAtUtcMs }); this.#replaceRecord(located.index, updated);
    return this.#accept(operationId, { pending: true }, [this.#event(operationId, "employment.dismissal-requested", occurredAtUtcMs, { characterId })]);
  }

  completePendingDismissal(operationId: string, characterId: InstanceId, occurredAtUtcMs: number): EmploymentOperationResult<undefined> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locateRecord(operationId, characterId); if (!this.#isLocated(located)) return located;
    if (located.record.dismissalRequestedAtUtcMs === null) return this.#reject(operationId, "DISMISSAL_NOT_PENDING", "Employee has no pending dismissal.");
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Dismissal time is invalid.");
    this.#replace({ records: this.#state.records.filter((record) => record.characterId !== characterId) });
    return this.#accept(operationId, undefined, [this.#event(operationId, "employment.employee-dismissed", occurredAtUtcMs, { characterId })]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Employment transaction is already active.");
    this.#transactionActive = true; const checkpoint = this.exportState();
    return { validateTransaction: () => this.#validateState(), commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = cloneState(checkpoint); this.#transactionActive = false; } };
  }

  #isLocated(value: LocatedRecord | EmploymentOperationResult<never>): value is LocatedRecord { return !("accepted" in value); }
  #locateRecord(operationId: string, characterId: InstanceId): LocatedRecord | EmploymentOperationResult<never> {
    const index = this.#state.records.findIndex((record) => record.characterId === characterId);
    return index < 0 ? this.#reject(operationId, "UNKNOWN_EMPLOYEE", `Unknown employee: ${characterId}`) : { index, record: this.#state.records[index]! };
  }
  #replaceRecord(index: number, record: EmploymentRecordState): void { const records = [...this.#state.records]; records[index] = record; this.#replace({ records }); }
  #prepare(operationId: string): EmploymentOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Employment operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject(operationId, "DUPLICATE_OPERATION", "Employment operation was already processed.");
    this.#state = cloneState({ ...this.#state, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT) }); return null;
  }
  #replace(update: Partial<EmploymentState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #accept<TValue>(operationId: string, value: TValue, events: readonly DomainEvent[]): EmploymentOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value, events: Object.freeze([...events]) });
  }
  #reject(operationId: string, code: EmploymentRejectionCode, message: string): EmploymentOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: `${type}:${operationId}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #validateState(): void {
    if (!isEmploymentState(this.#state)) {
      throw new Error("Employment state metadata is invalid.");
    }
    const ids = new Set<InstanceId>();
    for (const record of this.#state.records) {
      const character = this.#characters.getCharacter(record.characterId);
      if (!isInstanceId(record.characterId) || ids.has(record.characterId) || character === null || (record.kind === "core") !== character.coreMember ||
        record.learnedJobIds.length === 0 || new Set(record.learnedJobIds).size !== record.learnedJobIds.length || record.learnedJobIds.some((jobId) => !this.#jobs.has(jobId)) ||
        !record.learnedJobIds.includes(record.primaryJobId) || !validShift(record.dailyShift) || !nonNegativeInteger(record.employedAtUtcMs) ||
        (record.dismissalRequestedAtUtcMs !== null && !nonNegativeInteger(record.dismissalRequestedAtUtcMs))) {
        throw new Error(`Invalid employment state: ${record.characterId}`);
      }
      ids.add(record.characterId);
    }
  }
}
