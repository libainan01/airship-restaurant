import type { InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope, instanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { TransactionalFinancePort } from "../finance";
import { CHARACTER_MAX_SKILL_LEVEL, CHARACTER_SKILL_KEYS, type CharacterModule, type CharacterSkillLevels } from "../character";
import type { DailyShift, EmploymentModule } from "../employment";

export const RECRUITMENT_MODULE_ID = "module.recruitment";
export const RECRUITMENT_SCHEMA_VERSION = 1;

export interface RecruitmentQualityTierDefinition { readonly tier: number; readonly minimumSkill: number; readonly maximumSkill: number; readonly maximumTalentQuality: number; readonly talentCountWeights: readonly [number, number, number, number] }
export interface RecruitmentJobOptionDefinition { readonly learnedJobIds: readonly string[]; readonly primaryJobId: string }
export interface RecruitmentTalentPoolDefinition { readonly id: string; readonly qualityTier: number }
export interface RecruitmentDefinition {
  readonly templateCharacterId: string; readonly candidateNames: readonly string[]; readonly candidateCount: number;
  readonly freeRefreshIntervalMs: number; readonly manualRefreshBaseCostCopper: number; readonly manualRefreshCostStepCopper: number; readonly hireBaseCostCopper: number;
  readonly jobOptions: readonly RecruitmentJobOptionDefinition[]; readonly qualityTiers: readonly RecruitmentQualityTierDefinition[];
}
export interface RecruitmentProgressionPort { getEffect(effectKey: "recruitment.quality-tier" | "employment.employee-limit"): number | null }
export interface RecruitmentRandomPort { next(): number }
export interface RecruitmentCandidateState {
  readonly id: string; readonly name: string; readonly definitionId: string; readonly skillLevels: CharacterSkillLevels; readonly talentIds: readonly string[];
  readonly learnedJobIds: readonly string[]; readonly primaryJobId: string; readonly hireCostCopper: number; readonly qualityTierSnapshot: number;
}
export interface RecruitmentState {
  readonly schemaVersion: typeof RECRUITMENT_SCHEMA_VERSION; readonly revision: number; readonly candidates: readonly RecruitmentCandidateState[];
  readonly nextFreeRefreshAtUtcMs: number; readonly manualRefreshCount: number; readonly nextRefreshSequence: number; readonly processedOperationIds: readonly string[];
}
export type RecruitmentRefreshKind = "free" | "manual";
export type RecruitmentRejectionCode = "INVALID_REQUEST" | "DUPLICATE_OPERATION" | "FREE_REFRESH_NOT_DUE" | "UNKNOWN_CANDIDATE" | "EMPLOYEE_LIMIT_REACHED" | "FINANCE_REJECTED" | "DEPENDENCY_REJECTED";
export type RecruitmentResult<T> = { readonly accepted: true; readonly changed: true; readonly value: T; readonly committedEventIds: readonly string[] } | { readonly accepted: false; readonly changed: false; readonly code: RecruitmentRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 2_048;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 180;
const integer = (value: number, minimum = 0): boolean => Number.isSafeInteger(value) && value >= minimum;
const freezeCandidate = (candidate: RecruitmentCandidateState): RecruitmentCandidateState => Object.freeze({ ...candidate, skillLevels: Object.freeze({ ...candidate.skillLevels }), talentIds: Object.freeze([...candidate.talentIds]), learnedJobIds: Object.freeze([...candidate.learnedJobIds]) });
const cloneState = (state: RecruitmentState): RecruitmentState => Object.freeze({ ...state, candidates: Object.freeze(state.candidates.map(freezeCandidate)), processedOperationIds: Object.freeze([...state.processedOperationIds]) });

export function isRecruitmentState(value: unknown): value is RecruitmentState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<RecruitmentState>;
  if (state.schemaVersion !== RECRUITMENT_SCHEMA_VERSION || typeof state.revision !== "number" || !integer(state.revision) ||
    !Array.isArray(state.candidates) || typeof state.nextFreeRefreshAtUtcMs !== "number" || !integer(state.nextFreeRefreshAtUtcMs) ||
    typeof state.manualRefreshCount !== "number" || !integer(state.manualRefreshCount) || typeof state.nextRefreshSequence !== "number" || !integer(state.nextRefreshSequence, 1) ||
    !Array.isArray(state.processedOperationIds) || state.processedOperationIds.some((id) => typeof id !== "string" || !valid(id)) || new Set(state.processedOperationIds).size !== state.processedOperationIds.length) return false;
  const candidateIds = new Set<string>();
  return state.candidates.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null || !valid(candidate.id) || candidateIds.has(candidate.id) ||
      !valid(candidate.name) || !valid(candidate.definitionId) || !integer(candidate.hireCostCopper, 1) || !integer(candidate.qualityTierSnapshot) ||
      !Array.isArray(candidate.talentIds) || candidate.talentIds.length > 3 || candidate.talentIds.some((id: unknown) => typeof id !== "string" || !valid(id)) || new Set(candidate.talentIds).size !== candidate.talentIds.length ||
      !Array.isArray(candidate.learnedJobIds) || candidate.learnedJobIds.length === 0 || candidate.learnedJobIds.some((id: unknown) => typeof id !== "string" || !valid(id)) || new Set(candidate.learnedJobIds).size !== candidate.learnedJobIds.length ||
      !valid(candidate.primaryJobId) || !candidate.learnedJobIds.includes(candidate.primaryJobId) || typeof candidate.skillLevels !== "object" || candidate.skillLevels === null ||
      CHARACTER_SKILL_KEYS.some((key) => !integer(candidate.skillLevels[key], 1) || candidate.skillLevels[key] > CHARACTER_MAX_SKILL_LEVEL)) {
      return false;
    }
    candidateIds.add(candidate.id);
    return true;
  });
}

export class RecruitmentModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = RECRUITMENT_MODULE_ID;
  readonly transactionParticipantId = RECRUITMENT_MODULE_ID;
  readonly #definition: RecruitmentDefinition; readonly #talents: readonly RecruitmentTalentPoolDefinition[]; readonly #finance: TransactionalFinancePort;
  readonly #characters: CharacterModule; readonly #employment: EmploymentModule; readonly #progression: RecruitmentProgressionPort; readonly #random: RecruitmentRandomPort; readonly #events: DomainEventBus; readonly #transaction: TransactionScope;
  #state: RecruitmentState; #transactionActive = false;

  constructor(options: { readonly definition: RecruitmentDefinition; readonly talents: readonly RecruitmentTalentPoolDefinition[]; readonly finance: TransactionalFinancePort; readonly characters: CharacterModule; readonly employment: EmploymentModule; readonly progression: RecruitmentProgressionPort; readonly random: RecruitmentRandomPort; readonly eventBus?: DomainEventBus; readonly initialState?: RecruitmentState }) {
    this.#definition = options.definition; this.#talents = Object.freeze(options.talents.map((entry) => Object.freeze({ ...entry })));
    this.#finance = options.finance; this.#characters = options.characters; this.#employment = options.employment; this.#progression = options.progression; this.#random = options.random; this.#events = options.eventBus ?? new DomainEventBus(); this.#transaction = new TransactionScope(this.#events);
    this.#validateDefinitions();
    this.#state = options.initialState === undefined ? cloneState({ schemaVersion: RECRUITMENT_SCHEMA_VERSION, revision: 0, candidates: [], nextFreeRefreshAtUtcMs: 0, manualRefreshCount: 0, nextRefreshSequence: 1, processedOperationIds: [] }) : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): RecruitmentState { return cloneState(this.#state); }
  getManualRefreshCostCopper(): number { return this.#definition.manualRefreshBaseCostCopper + this.#definition.manualRefreshCostStepCopper * this.#state.manualRefreshCount; }
  refresh(operationId: string, kind: RecruitmentRefreshKind, occurredAtUtcMs: number): RecruitmentResult<RecruitmentState> {
    if (!valid(operationId) || (kind !== "free" && kind !== "manual") || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Recruitment refresh request is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Recruitment operation was already processed.");
    if (kind === "free" && occurredAtUtcMs < this.#state.nextFreeRefreshAtUtcMs) return this.#reject("FREE_REFRESH_NOT_DUE", "The free recruitment refresh is not due.");
    const cost = kind === "manual" ? this.getManualRefreshCostCopper() : 0;
    try {
      const result = this.#transaction.run(cost === 0 ? [this] : [this, this.#finance], ({ emit }) => {
        if (cost > 0) {
          const paid = this.#finance.payExpense(`${operationId}:payment`, { entryId: `ledger.recruitment-refresh.${operationId}`, amountCopper: cost, category: "recruitment-refresh", occurredAtUtcMs, sourceType: "recruitment-refresh", sourceId: operationId, regionId: "local" });
          if (!paid.accepted) throw new Error(`FINANCE:${paid.message}`); for (const event of paid.events) emit(event);
        }
        const qualityTier = Math.max(0, Math.min(this.#definition.qualityTiers.length - 1, Math.floor(this.#progression.getEffect("recruitment.quality-tier") ?? 0)));
        const candidates = this.#generateCandidates(this.#state.nextRefreshSequence, qualityTier);
        this.#state = cloneState({ ...this.#state, revision: this.#state.revision + 1, candidates, nextFreeRefreshAtUtcMs: kind === "free" ? occurredAtUtcMs + this.#definition.freeRefreshIntervalMs : this.#state.nextFreeRefreshAtUtcMs, manualRefreshCount: kind === "free" ? 0 : this.#state.manualRefreshCount + 1, nextRefreshSequence: this.#state.nextRefreshSequence + 1, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        const event = Object.freeze({ id: `recruitment.candidates-refreshed:${operationId}`, type: "recruitment.candidates-refreshed", occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload: { kind, costCopper: cost, qualityTierSnapshot: qualityTier, candidateIds: candidates.map((entry) => entry.id) } }); emit(event); return this.exportState();
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) { const message = error instanceof Error ? error.message : "Recruitment refresh failed."; return this.#reject(message.startsWith("FINANCE:") ? "FINANCE_REJECTED" : "DEPENDENCY_REJECTED", message.replace(/^FINANCE:/, "")); }
  }

  hire(operationId: string, candidateId: string, dailyShift: DailyShift, occurredAtUtcMs: number): RecruitmentResult<{ readonly candidateId: string; readonly characterId: InstanceId }> {
    if (!valid(operationId) || !valid(candidateId) || !integer(occurredAtUtcMs) || !integer(dailyShift.startMinuteInclusive) || !integer(dailyShift.endMinuteExclusive) || dailyShift.startMinuteInclusive >= 1_440 || dailyShift.endMinuteExclusive >= 1_440 || dailyShift.startMinuteInclusive === dailyShift.endMinuteExclusive) return this.#reject("INVALID_REQUEST", "Recruitment hire request is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Recruitment operation was already processed.");
    const candidate = this.#state.candidates.find((entry) => entry.id === candidateId); if (candidate === undefined) return this.#reject("UNKNOWN_CANDIDATE", "Unknown recruitment candidate.");
    const employeeLimit = Math.max(0, Math.floor(this.#progression.getEffect("employment.employee-limit") ?? 0));
    const recruitedCount = this.#employment.exportState().records.filter((entry) => entry.kind === "recruited").length;
    if (recruitedCount >= employeeLimit) return this.#reject("EMPLOYEE_LIMIT_REACHED", "The recruited employee limit has been reached.");
    const characterId = instanceId(`instance.character.recruit_${candidate.id.slice("candidate.recruitment.".length).replaceAll(".", "_")}`);
    try {
      const result = this.#transaction.run([this, this.#finance, this.#characters, this.#employment], ({ emit }) => {
        const paid = this.#finance.payExpense(`${operationId}:payment`, { entryId: `ledger.employee-recruitment.${candidate.id}`, amountCopper: candidate.hireCostCopper, category: "employee-recruitment", occurredAtUtcMs, sourceType: "recruitment-candidate", sourceId: candidate.id, regionId: "local" });
        if (!paid.accepted) throw new Error(`FINANCE:${paid.message}`); for (const event of paid.events) emit(event);
        const created = this.#characters.createCharacter(`${operationId}:character`, { instanceId: characterId, definitionId: candidate.definitionId, name: candidate.name, skillLevels: candidate.skillLevels, coreMember: false, talentIds: candidate.talentIds, occurredAtUtcMs });
        if (!created.accepted) throw new Error(`DEPENDENCY:${created.message}`); for (const event of created.events) emit(event);
        const employed = this.#employment.addEmployee(`${operationId}:employment`, { characterId, kind: "recruited", learnedJobIds: candidate.learnedJobIds, primaryJobId: candidate.primaryJobId, dailyShift, occurredAtUtcMs });
        if (!employed.accepted) throw new Error(`DEPENDENCY:${employed.message}`); for (const event of employed.events) emit(event);
        this.#state = cloneState({ ...this.#state, revision: this.#state.revision + 1, candidates: this.#state.candidates.filter((entry) => entry.id !== candidate.id), processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        emit(Object.freeze({ id: `recruitment.candidate-hired:${operationId}`, type: "recruitment.candidate-hired", occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload: { candidateId, characterId, hireCostCopper: candidate.hireCostCopper } }));
        return Object.freeze({ candidateId, characterId });
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recruitment hire failed.";
      return this.#reject(message.startsWith("FINANCE:") ? "FINANCE_REJECTED" : "DEPENDENCY_REJECTED", message.replace(/^(FINANCE|DEPENDENCY):/, ""));
    }
  }

  beginTransaction(): TransactionParticipantSession { if (this.#transactionActive) throw new Error("Recruitment transaction is already active."); this.#transactionActive = true; const saved = this.exportState(); return { validateTransaction: () => this.#validateState(), commitTransaction: () => { this.#transactionActive = false; }, rollbackTransaction: () => { this.#state = saved; this.#transactionActive = false; } }; }

  #generateCandidates(refreshSequence: number, qualityTier: number): readonly RecruitmentCandidateState[] {
    const tier = this.#definition.qualityTiers[qualityTier]!; const names = this.#shuffle([...this.#definition.candidateNames]).slice(0, this.#definition.candidateCount);
    return Object.freeze(names.map((name, index) => {
      const skills = Object.fromEntries(["cooking", "charm", "movement", "repair", "piloting"].map((key) => [key, this.#integerBetween(tier.minimumSkill, tier.maximumSkill)])) as unknown as CharacterSkillLevels;
      const talentCount = Math.min(this.#weightedIndex(tier.talentCountWeights), this.#talents.filter((talent) => talent.qualityTier <= tier.maximumTalentQuality).length);
      const talentIds = this.#shuffle(this.#talents.filter((talent) => talent.qualityTier <= tier.maximumTalentQuality).map((talent) => talent.id)).slice(0, talentCount);
      const job = this.#definition.jobOptions[Math.floor(this.#sample() * this.#definition.jobOptions.length)]!;
      return freezeCandidate({ id: `candidate.recruitment.${refreshSequence}.${index + 1}`, name, definitionId: this.#definition.templateCharacterId, skillLevels: skills, talentIds, learnedJobIds: job.learnedJobIds, primaryJobId: job.primaryJobId, hireCostCopper: this.#definition.hireBaseCostCopper, qualityTierSnapshot: qualityTier });
    }));
  }
  #sample(): number { const value = this.#random.next(); if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Recruitment random source returned an invalid sample."); return value; }
  #integerBetween(minimum: number, maximum: number): number { return minimum + Math.floor(this.#sample() * (maximum - minimum + 1)); }
  #weightedIndex(weights: readonly number[]): number { let roll = this.#sample() * 100; for (let index = 0; index < weights.length; index += 1) { roll -= weights[index]!; if (roll < 0) return index; } return weights.length - 1; }
  #shuffle<T>(values: T[]): T[] { for (let index = values.length - 1; index > 0; index -= 1) { const selected = Math.floor(this.#sample() * (index + 1)); [values[index], values[selected]] = [values[selected]!, values[index]!]; } return values; }
  #reject(code: RecruitmentRejectionCode, message: string): RecruitmentResult<never> { return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const }); }
  #validateDefinitions(): void {
    const d = this.#definition; if (!valid(d.templateCharacterId) || d.candidateNames.length < d.candidateCount || new Set(d.candidateNames).size !== d.candidateNames.length || d.candidateNames.some((name) => !valid(name)) || !integer(d.candidateCount, 1) || !integer(d.freeRefreshIntervalMs, 1) || !integer(d.manualRefreshBaseCostCopper, 1) || !integer(d.manualRefreshCostStepCopper, 1) || !integer(d.hireBaseCostCopper, 1) || d.jobOptions.length === 0 || d.jobOptions.some((job) => job.learnedJobIds.length === 0 || new Set(job.learnedJobIds).size !== job.learnedJobIds.length || !job.learnedJobIds.includes(job.primaryJobId)) || d.qualityTiers.length === 0 || d.qualityTiers.some((tier, index) => tier.tier !== index || !integer(tier.minimumSkill, 1) || !integer(tier.maximumSkill, tier.minimumSkill) || !integer(tier.maximumTalentQuality, 1) || tier.talentCountWeights.length !== 4 || tier.talentCountWeights.some((weight) => !integer(weight)) || tier.talentCountWeights.reduce((sum, weight) => sum + weight, 0) !== 100) || new Set(this.#talents.map((talent) => talent.id)).size !== this.#talents.length || this.#talents.some((talent) => !valid(talent.id) || !integer(talent.qualityTier, 1))) throw new Error("Recruitment definitions are invalid.");
  }
  #validateState(): void { if (!isRecruitmentState(this.#state) || this.#state.candidates.length > this.#definition.candidateCount || new Set(this.#state.candidates.map((entry) => entry.id)).size !== this.#state.candidates.length || this.#state.candidates.some((entry) => !valid(entry.id) || !valid(entry.name) || entry.definitionId !== this.#definition.templateCharacterId || entry.talentIds.length > 3 || entry.qualityTierSnapshot < 0 || entry.qualityTierSnapshot >= this.#definition.qualityTiers.length)) throw new Error("Recruitment state is invalid."); }
}