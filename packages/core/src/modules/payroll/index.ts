import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import { CHARACTER_SKILL_KEYS, type CharacterModule, type CharacterSkillKey } from "../character";
import type { DomainModule } from "../domain-module";
import type { EmploymentModule, EmploymentRecordState } from "../employment";
import type { FinanceDailyClosureState, FinanceOperationResult, MandatoryExpenseRequest } from "../finance";

export const PAYROLL_MODULE_ID = "module.payroll";
export const PAYROLL_SCHEMA_VERSION = 1;
export const DEFAULT_PAYROLL_DAY_DURATION_MS = 86_400_000;

export interface PayrollWagePolicy {
  readonly baseDailyWageCopper: number;
  readonly copperPerSkillLevel: Readonly<Record<CharacterSkillKey, number>>;
  readonly copperPerTalentQuality: number;
}
export const DEFAULT_PAYROLL_WAGE_POLICY: PayrollWagePolicy = Object.freeze({
  baseDailyWageCopper: 10,
  copperPerSkillLevel: Object.freeze({ cooking: 2, charm: 2, movement: 2, repair: 2, piloting: 2 }),
  copperPerTalentQuality: 5,
});
export interface PayrollTalentQualityPort { getTalentQuality(talentId: string): number | null }
export interface PayrollActivityPort { isVoyageActive(characterId: InstanceId, atUtcMs: number): boolean }
const NO_ACTIVE_VOYAGES: PayrollActivityPort = Object.freeze({ isVoyageActive: () => false });

export interface PayrollAttendanceState {
  readonly gameDay: number;
  readonly characterId: InstanceId;
  readonly characterName: string;
  readonly firstEnteredShiftAtUtcMs: number;
  readonly dailyWageCopper: number;
}
export interface PayrollState {
  readonly schemaVersion: typeof PAYROLL_SCHEMA_VERSION;
  readonly revision: number;
  readonly currentGameDay: number;
  readonly currentDayStartedAtUtcMs: number;
  readonly lastObservedUtcMs: number;
  readonly attendance: readonly PayrollAttendanceState[];
}
export interface PayrollAdvanceResult {
  readonly changed: boolean;
  readonly clockRollbackDetected: boolean;
  readonly closedGameDays: readonly number[];
  readonly committedEventIds: readonly string[];
  readonly state: PayrollState;
}
export interface PayrollFinancePort extends TransactionalParticipant {
  getSnapshot(): { readonly currentGameDay: number };
  closeDay(
    operationId: string,
    gameDay: number,
    nextGameDay: number,
    closedAtUtcMs: number,
    mandatoryExpenses?: readonly MandatoryExpenseRequest[],
  ): FinanceOperationResult<FinanceDailyClosureState>;
}

const integer = (value: number, minimum = 0): boolean => Number.isSafeInteger(value) && value >= minimum;
const validText = (value: string, maximum = 200): boolean => value.trim().length > 0 && value.length <= maximum;
const freezeAttendance = (value: PayrollAttendanceState): PayrollAttendanceState => Object.freeze({ ...value });
const cloneState = (value: PayrollState): PayrollState => Object.freeze({
  ...value,
  attendance: Object.freeze(value.attendance.map(freezeAttendance)),
});

export function isPayrollState(value: unknown): value is PayrollState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<PayrollState>;
  if (state.schemaVersion !== PAYROLL_SCHEMA_VERSION || !integer(state.revision ?? -1) ||
    !integer(state.currentGameDay ?? 0, 1) || !integer(state.currentDayStartedAtUtcMs ?? -1) ||
    !integer(state.lastObservedUtcMs ?? -1) || state.lastObservedUtcMs! < state.currentDayStartedAtUtcMs! ||
    !Array.isArray(state.attendance)) return false;
  const ids = new Set<string>();
  return state.attendance.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const item = candidate as Partial<PayrollAttendanceState>;
    if (item.gameDay !== state.currentGameDay || typeof item.characterId !== "string" ||
      !validText(item.characterId) || ids.has(item.characterId) ||
      typeof item.characterName !== "string" || !validText(item.characterName) ||
      !integer(item.firstEnteredShiftAtUtcMs ?? -1) || !integer(item.dailyWageCopper ?? 0, 1)) return false;
    ids.add(item.characterId);
    return true;
  });
}

export class PayrollModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = PAYROLL_MODULE_ID;
  readonly transactionParticipantId = PAYROLL_MODULE_ID;
  readonly #characters: CharacterModule;
  readonly #employment: EmploymentModule;
  readonly #finance: PayrollFinancePort;
  readonly #talentQuality: PayrollTalentQualityPort;
  readonly #activity: PayrollActivityPort;
  readonly #policy: PayrollWagePolicy;
  readonly #dayDurationMs: number;
  readonly #transactions: TransactionScope;
  #state: PayrollState;
  #transactionActive = false;

  constructor(options: {
    readonly characters: CharacterModule;
    readonly employment: EmploymentModule;
    readonly finance: PayrollFinancePort;
    readonly talentQuality: PayrollTalentQualityPort;
    readonly activity?: PayrollActivityPort;
    readonly wagePolicy?: PayrollWagePolicy;
    readonly dayDurationMs?: number;
    readonly initialGameDay?: number;
    readonly initialUtcMs?: number;
    readonly initialState?: PayrollState;
    readonly eventBus?: DomainEventBus;
  }) {
    this.#characters = options.characters;
    this.#employment = options.employment;
    this.#finance = options.finance;
    this.#talentQuality = options.talentQuality;
    this.#activity = options.activity ?? NO_ACTIVE_VOYAGES;
    this.#policy = this.#validatedPolicy(options.wagePolicy ?? DEFAULT_PAYROLL_WAGE_POLICY);
    this.#dayDurationMs = options.dayDurationMs ?? DEFAULT_PAYROLL_DAY_DURATION_MS;
    if (!integer(this.#dayDurationMs, 1) || this.#dayDurationMs % 1_440 !== 0) {
      throw new RangeError("Payroll day duration must contain 1,440 whole minute units.");
    }
    const initialUtcMs = options.initialUtcMs ?? 0;
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: PAYROLL_SCHEMA_VERSION,
          revision: 0,
          currentGameDay: options.initialGameDay ?? 1,
          currentDayStartedAtUtcMs: initialUtcMs,
          lastObservedUtcMs: initialUtcMs,
          attendance: [],
        })
      : cloneState(options.initialState);
    this.#transactions = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#validateState();
  }

  exportState(): PayrollState { return cloneState(this.#state); }

  calculateDailyWage(characterId: InstanceId): number {
    const character = this.#characters.getCharacter(characterId);
    if (character === null) throw new Error(`Unknown payroll character: ${characterId}`);
    const skills = CHARACTER_SKILL_KEYS.reduce(
      (sum, key) => sum + character.skills[key].level * this.#policy.copperPerSkillLevel[key],
      0,
    );
    const talents = character.talentIds.reduce((sum, talentId) => {
      const quality = this.#talentQuality.getTalentQuality(talentId);
      if (quality === null || !integer(quality)) throw new Error(`Invalid payroll talent quality: ${talentId}`);
      return sum + quality * this.#policy.copperPerTalentQuality;
    }, 0);
    return this.#policy.baseDailyWageCopper + skills + talents;
  }

  captureCurrentAttendance(atUtcMs: number): PayrollAdvanceResult { return this.advanceTo(atUtcMs); }

  advanceTo(observedUtcMs: number): PayrollAdvanceResult {
    if (!integer(observedUtcMs)) throw new RangeError("Payroll observation time is invalid.");
    if (observedUtcMs < this.#state.lastObservedUtcMs) {
      return Object.freeze({
        changed: false,
        clockRollbackDetected: true,
        closedGameDays: Object.freeze([]),
        committedEventIds: Object.freeze([]),
        state: this.exportState(),
      });
    }
    const beforeRevision = this.#state.revision;
    const transaction = this.#transactions.run([this.#finance, this], ({ emit }) => {
      const closed: number[] = [];
      let cursor = this.#state.lastObservedUtcMs;
      while (cursor < observedUtcMs) {
        const boundary = this.#state.currentDayStartedAtUtcMs + this.#dayDurationMs;
        const segmentEnd = Math.min(observedUtcMs, boundary);
        this.#captureInterval(cursor, segmentEnd, emit);
        cursor = segmentEnd;
        if (cursor === boundary) closed.push(this.#closeDay(boundary, emit));
      }
      this.#capturePoint(observedUtcMs, emit);
      if (this.#state.lastObservedUtcMs !== observedUtcMs) this.#replace({ lastObservedUtcMs: observedUtcMs });
      return Object.freeze(closed);
    });
    return Object.freeze({
      changed: this.#state.revision !== beforeRevision,
      clockRollbackDetected: false,
      closedGameDays: transaction.value,
      committedEventIds: transaction.committedEventIds,
      state: this.exportState(),
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Payroll transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return Object.freeze({
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = checkpoint; this.#transactionActive = false; },
    });
  }

  #captureInterval(fromUtcMs: number, toUtcMs: number, emit: (event: DomainEvent) => void): void {
    if (toUtcMs <= fromUtcMs) return;
    for (const record of this.#employment.exportState().records) {
      const effectiveStart = Math.max(fromUtcMs, record.employedAtUtcMs);
      if (!this.#shouldPay(record) || effectiveStart >= toUtcMs ||
        this.#activity.isVoyageActive(record.characterId, toUtcMs)) continue;
      const firstEnteredAtUtcMs = this.#firstShiftOverlap(
        effectiveStart,
        toUtcMs,
        record.dailyShift!,
      );
      if (firstEnteredAtUtcMs === null) continue;
      this.#record(record, firstEnteredAtUtcMs, emit);
    }
  }

  #capturePoint(atUtcMs: number, emit: (event: DomainEvent) => void): void {
    for (const record of this.#employment.exportState().records) {
      if (!this.#shouldPay(record) || record.employedAtUtcMs > atUtcMs ||
        this.#activity.isVoyageActive(record.characterId, atUtcMs) ||
        !this.#inShift(this.#minuteOfDay(atUtcMs), record.dailyShift!)) continue;
      this.#record(record, atUtcMs, emit);
    }
  }

  #record(record: EmploymentRecordState, atUtcMs: number, emit: (event: DomainEvent) => void): void {
    if (this.#state.attendance.some((item) => item.characterId === record.characterId)) return;
    const character = this.#characters.getCharacter(record.characterId);
    if (character === null) throw new Error(`Unknown employed character: ${record.characterId}`);
    const attendance = freezeAttendance({
      gameDay: this.#state.currentGameDay,
      characterId: record.characterId,
      characterName: character.name,
      firstEnteredShiftAtUtcMs: atUtcMs,
      dailyWageCopper: this.calculateDailyWage(record.characterId),
    });
    this.#replace({ attendance: [...this.#state.attendance, attendance] });
    emit(this.#event(
      `payroll.attendance-recorded:${attendance.gameDay}:${attendance.characterId}`,
      "payroll.attendance-recorded",
      atUtcMs,
      attendance,
    ));
  }

  #closeDay(closedAtUtcMs: number, emit: (event: DomainEvent) => void): number {
    const gameDay = this.#state.currentGameDay;
    const expenses = this.#state.attendance.map((item, index): MandatoryExpenseRequest => Object.freeze({
      entryId: `ledger.wage.day.${gameDay}.${index + 1}`,
      amountCopper: item.dailyWageCopper,
      category: "employee-wages",
      sourceType: "employment",
      sourceId: `payroll.employee.${this.#hash(item.characterId)}`,
      regionId: "region.restaurant",
      note: item.characterName,
    }));
    const result = this.#finance.closeDay(
      `payroll.close-day.${gameDay}`,
      gameDay,
      gameDay + 1,
      closedAtUtcMs,
      expenses,
    );
    if (!result.accepted) throw new Error(`Payroll finance day close failed: ${result.message}`);
    for (const event of result.events) emit(event);
    const totalWagesCopper = expenses.reduce((sum, item) => sum + item.amountCopper, 0);
    emit(this.#event(`payroll.day-closed:${gameDay}`, "payroll.day-closed", closedAtUtcMs, Object.freeze({
      gameDay,
      employeeCount: expenses.length,
      totalWagesCopper,
      characterIds: Object.freeze(this.#state.attendance.map((item) => item.characterId)),
    })));
    this.#replace({
      currentGameDay: gameDay + 1,
      currentDayStartedAtUtcMs: closedAtUtcMs,
      attendance: [],
    });
    return gameDay;
  }

  #shouldPay(record: EmploymentRecordState): boolean {
    return record.kind === "recruited" && record.dailyShift !== null;
  }

  #firstShiftOverlap(
    fromUtcMs: number,
    toUtcMs: number,
    shift: NonNullable<EmploymentRecordState["dailyShift"]>,
  ): number | null {
    const dayStart = this.#state.currentDayStartedAtUtcMs;
    const minuteDurationMs = this.#dayDurationMs / 1_440;
    const start = dayStart + shift.startMinuteInclusive * minuteDurationMs;
    const end = dayStart + shift.endMinuteExclusive * minuteDurationMs;
    const intervals = shift.startMinuteInclusive < shift.endMinuteExclusive
      ? [[start, end] as const]
      : [[dayStart, end] as const, [start, dayStart + this.#dayDurationMs] as const];
    for (const [intervalStart, intervalEnd] of intervals) {
      const overlapStart = Math.max(fromUtcMs, intervalStart);
      if (overlapStart < Math.min(toUtcMs, intervalEnd)) return overlapStart;
    }
    return null;
  }

  #minuteOfDay(atUtcMs: number): number {
    const elapsed = Math.max(0, atUtcMs - this.#state.currentDayStartedAtUtcMs);
    return Math.floor((elapsed % this.#dayDurationMs) / this.#dayDurationMs * 1_440);
  }

  #inShift(minute: number, shift: NonNullable<EmploymentRecordState["dailyShift"]>): boolean {
    return shift.startMinuteInclusive < shift.endMinuteExclusive
      ? minute >= shift.startMinuteInclusive && minute < shift.endMinuteExclusive
      : minute >= shift.startMinuteInclusive || minute < shift.endMinuteExclusive;
  }

  #hash(value: string): string {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
  }

  #replace(update: Partial<PayrollState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #event(id: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id,
      type,
      occurredAtUtcMs,
      causationId: id,
      correlationId: `payroll.day.${this.#state.currentGameDay}`,
      payload,
    });
  }

  #validatedPolicy(policy: PayrollWagePolicy): PayrollWagePolicy {
    if (!integer(policy.baseDailyWageCopper) || !integer(policy.copperPerTalentQuality) ||
      CHARACTER_SKILL_KEYS.some((key) => !integer(policy.copperPerSkillLevel[key]))) {
      throw new RangeError("Payroll wage policy is invalid.");
    }
    return Object.freeze({ ...policy, copperPerSkillLevel: Object.freeze({ ...policy.copperPerSkillLevel }) });
  }

  #validateState(): void {
    if (!isPayrollState(this.#state)) throw new Error("Payroll state is invalid.");
    if (this.#state.lastObservedUtcMs >= this.#state.currentDayStartedAtUtcMs + this.#dayDurationMs) {
      throw new Error("Payroll observation crossed an unclosed day boundary.");
    }
    if (this.#finance.getSnapshot().currentGameDay !== this.#state.currentGameDay) {
      throw new Error("Payroll and finance game days do not match.");
    }
  }
}