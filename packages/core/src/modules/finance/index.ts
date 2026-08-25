import type {
  DomainEvent,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import type { DomainModule } from "../domain-module";

export const FINANCE_MODULE_ID = "module.finance";
export const FINANCE_SCHEMA_VERSION = 1;

export type FinanceIncomeCategory =
  | "dish-sales"
  | "tips"
  | "focus-bonus"
  | "other-income";

export type FinanceExpenseCategory =
  | "ingredient-procurement"
  | "employee-wages"
  | "employee-recruitment"
  | "recruitment-refresh"
  | "airship-voyage"
  | "equipment-repair"
  | "technology-upgrade"
  | "building-purchase"
  | "vehicle-upgrade"
  | "other-expense";

export type FinanceCategory = FinanceIncomeCategory | FinanceExpenseCategory;

export interface FinanceSource {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly regionId: string;
  readonly note?: string;
}

export interface FinanceReservationState extends FinanceSource {
  readonly id: string;
  readonly amountCopper: number;
  readonly createdAtUtcMs: number;
}

export interface FinanceLedgerEntryState extends FinanceSource {
  readonly id: string;
  readonly gameDay: number;
  readonly occurredAtUtcMs: number;
  readonly amountCopper: number;
  readonly category: FinanceCategory;
  readonly settlementBatchId: string | null;
}

export interface FinanceSettlementBatchState {
  readonly id: string;
  readonly settlementKey: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly entryIds: readonly string[];
  readonly settledAtUtcMs: number;
}

export interface FinanceDailyClosureState {
  readonly gameDay: number;
  readonly openingBalanceCopper: number;
  readonly incomeByCategory: Readonly<Partial<Record<FinanceIncomeCategory, number>>>;
  readonly expenseByCategory: Readonly<Partial<Record<FinanceExpenseCategory, number>>>;
  readonly totalIncomeCopper: number;
  readonly totalExpenseCopper: number;
  readonly netCopper: number;
  readonly closingBalanceCopper: number;
  readonly closedAtUtcMs: number;
}

export interface FinanceState {
  readonly schemaVersion: typeof FINANCE_SCHEMA_VERSION;
  readonly revision: number;
  readonly initialBalanceCopper: number;
  readonly balanceCopper: number;
  readonly currentGameDay: number;
  readonly currentDayOpeningBalanceCopper: number;
  readonly reservations: readonly FinanceReservationState[];
  readonly ledger: readonly FinanceLedgerEntryState[];
  readonly settlementBatches: readonly FinanceSettlementBatchState[];
  readonly dailyClosures: readonly FinanceDailyClosureState[];
  readonly processedOperationIds: readonly string[];
}

export interface FinanceSnapshot extends FinanceState {
  readonly reservedCopper: number;
  readonly availableCopper: number;
  readonly currentDay: FinanceDailyClosureState;
}

export type FinanceRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_ID"
  | "INSUFFICIENT_FUNDS"
  | "UNKNOWN_RESERVATION"
  | "RESERVATION_AMOUNT_MISMATCH"
  | "DAY_MISMATCH";

export type FinanceOperationResult<TValue = undefined> =
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
      readonly code: FinanceRejectionCode;
      readonly message: string;
      readonly events: readonly [];
    };

export interface FinanceEntryRequest extends FinanceSource {
  readonly entryId: string;
  readonly amountCopper: number;
  readonly category: FinanceCategory;
  readonly occurredAtUtcMs: number;
}

export interface FinanceSettlementLine extends FinanceEntryRequest {}

/** Minimum atomic payment boundary used by modules that coordinate finance with other state. */
export interface TransactionalFinancePort extends TransactionalParticipant {
  getSnapshot(): Pick<FinanceSnapshot, "availableCopper">;
  payExpense(
    operationId: string,
    request: FinanceEntryRequest,
  ): FinanceOperationResult<FinanceLedgerEntryState>;
}

export interface MandatoryExpenseRequest extends FinanceSource {
  readonly entryId: string;
  readonly amountCopper: number;
  readonly category: FinanceExpenseCategory;
}

const OPERATION_HISTORY_LIMIT = 2_048;
const INCOME_CATEGORIES = new Set<FinanceCategory>([
  "dish-sales",
  "tips",
  "focus-bonus",
  "other-income",
]);
const EXPENSE_CATEGORIES = new Set<FinanceCategory>([
  "ingredient-procurement",
  "employee-wages",
  "employee-recruitment",
  "recruitment-refresh",
  "airship-voyage",
  "equipment-repair",
  "technology-upgrade",
  "building-purchase",
  "vehicle-upgrade",
  "other-expense",
]);

function isInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

function isPositiveInteger(value: number): boolean {
  return isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return isInteger(value) && value >= 0;
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 160;
}

function frozenSource(source: FinanceSource): FinanceSource {
  return Object.freeze({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    regionId: source.regionId,
    ...(source.note === undefined ? {} : { note: source.note }),
  });
}

function cloneState(state: FinanceState): FinanceState {
  return Object.freeze({
    ...state,
    reservations: Object.freeze(state.reservations.map((value) => Object.freeze({ ...value }))),
    ledger: Object.freeze(state.ledger.map((value) => Object.freeze({ ...value }))),
    settlementBatches: Object.freeze(state.settlementBatches.map((value) => Object.freeze({
      ...value,
      entryIds: Object.freeze([...value.entryIds]),
    }))),
    dailyClosures: Object.freeze(state.dailyClosures.map((value) => Object.freeze({
      ...value,
      incomeByCategory: Object.freeze({ ...value.incomeByCategory }),
      expenseByCategory: Object.freeze({ ...value.expenseByCategory }),
    }))),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function aggregateDay(
  gameDay: number,
  openingBalanceCopper: number,
  ledger: readonly FinanceLedgerEntryState[],
  closingBalanceCopper: number,
  closedAtUtcMs: number,
): FinanceDailyClosureState {
  const incomeByCategory: Partial<Record<FinanceIncomeCategory, number>> = {};
  const expenseByCategory: Partial<Record<FinanceExpenseCategory, number>> = {};
  let totalIncomeCopper = 0;
  let totalExpenseCopper = 0;
  for (const entry of ledger) {
    if (entry.gameDay !== gameDay) continue;
    if (entry.amountCopper > 0) {
      const category = entry.category as FinanceIncomeCategory;
      incomeByCategory[category] = (incomeByCategory[category] ?? 0) + entry.amountCopper;
      totalIncomeCopper += entry.amountCopper;
    } else {
      const category = entry.category as FinanceExpenseCategory;
      const amount = -entry.amountCopper;
      expenseByCategory[category] = (expenseByCategory[category] ?? 0) + amount;
      totalExpenseCopper += amount;
    }
  }
  return Object.freeze({
    gameDay,
    openingBalanceCopper,
    incomeByCategory: Object.freeze(incomeByCategory),
    expenseByCategory: Object.freeze(expenseByCategory),
    totalIncomeCopper,
    totalExpenseCopper,
    netCopper: totalIncomeCopper - totalExpenseCopper,
    closingBalanceCopper,
    closedAtUtcMs,
  });
}

export class FinanceModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = FINANCE_MODULE_ID;
  readonly transactionParticipantId = FINANCE_MODULE_ID;
  #state: FinanceState;
  #transactionActive = false;

  constructor(initialBalanceCopper: number, currentGameDay = 1, initialState?: FinanceState) {
    if (initialState !== undefined) {
      this.#state = cloneState(initialState);
      this.#validateState();
      return;
    }
    if (!isInteger(initialBalanceCopper) || !isPositiveInteger(currentGameDay)) {
      throw new RangeError("Finance initial balance and game day are invalid.");
    }
    this.#state = cloneState({
      schemaVersion: FINANCE_SCHEMA_VERSION,
      revision: 0,
      initialBalanceCopper,
      balanceCopper: initialBalanceCopper,
      currentGameDay,
      currentDayOpeningBalanceCopper: initialBalanceCopper,
      reservations: [],
      ledger: [],
      settlementBatches: [],
      dailyClosures: [],
      processedOperationIds: [],
    });
  }

  exportState(): FinanceState {
    return cloneState(this.#state);
  }

  getSnapshot(nowUtcMs = 0): FinanceSnapshot {
    const reservedCopper = this.#state.reservations.reduce(
      (sum, reservation) => sum + reservation.amountCopper,
      0,
    );
    return Object.freeze({
      ...cloneState(this.#state),
      reservedCopper,
      availableCopper: this.#state.balanceCopper - reservedCopper,
      currentDay: aggregateDay(
        this.#state.currentGameDay,
        this.#state.currentDayOpeningBalanceCopper,
        this.#state.ledger,
        this.#state.balanceCopper,
        nowUtcMs,
      ),
    });
  }

  reserveFunds(
    operationId: string,
    reservationId: string,
    amountCopper: number,
    source: FinanceSource,
    createdAtUtcMs: number,
  ): FinanceOperationResult<FinanceReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (!validId(reservationId) || !isPositiveInteger(amountCopper) ||
      !isNonNegativeInteger(createdAtUtcMs) || !this.#validSource(source)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Finance reservation request is invalid.");
    }
    if (this.#state.reservations.some((value) => value.id === reservationId)) {
      return this.#reject(operationId, "DUPLICATE_ID", `Finance reservation already exists: ${reservationId}`);
    }
    if (this.getSnapshot().availableCopper < amountCopper) {
      return this.#reject(operationId, "INSUFFICIENT_FUNDS", "Available balance is insufficient.");
    }
    const reservation = Object.freeze({
      id: reservationId,
      amountCopper,
      createdAtUtcMs,
      ...frozenSource(source),
    });
    this.#replace({ reservations: [...this.#state.reservations, reservation] });
    return this.#accept(operationId, reservation, [
      this.#event(operationId, "finance.funds-reserved", createdAtUtcMs, {
        reservationId,
        amountCopper,
        availableCopper: this.getSnapshot().availableCopper,
      }),
    ]);
  }

  releaseReservation(
    operationId: string,
    reservationId: string,
    occurredAtUtcMs: number,
  ): FinanceOperationResult<FinanceReservationState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const reservation = this.#state.reservations.find((value) => value.id === reservationId);
    if (reservation === undefined) {
      return this.#reject(operationId, "UNKNOWN_RESERVATION", `Unknown finance reservation: ${reservationId}`);
    }
    if (!isNonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Finance event time is invalid.");
    }
    this.#replace({
      reservations: this.#state.reservations.filter((value) => value.id !== reservationId),
    });
    return this.#accept(operationId, reservation, [
      this.#event(operationId, "finance.reservation-released", occurredAtUtcMs, {
        reservationId,
        amountCopper: reservation.amountCopper,
      }),
    ]);
  }

  commitReservation(
    operationId: string,
    reservationId: string,
    entryId: string,
    category: FinanceExpenseCategory,
    occurredAtUtcMs: number,
    expectedAmountCopper?: number,
  ): FinanceOperationResult<FinanceLedgerEntryState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const reservation = this.#state.reservations.find((value) => value.id === reservationId);
    if (reservation === undefined) {
      return this.#reject(operationId, "UNKNOWN_RESERVATION", `Unknown finance reservation: ${reservationId}`);
    }
    if (expectedAmountCopper !== undefined && reservation.amountCopper !== expectedAmountCopper) {
      return this.#reject(operationId, "RESERVATION_AMOUNT_MISMATCH", "Reserved amount does not match the expected cost.");
    }
    if (!this.#validNewEntry(entryId, -reservation.amountCopper, category, occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Reserved expense entry is invalid.");
    }
    const entry = this.#entry(
      entryId,
      -reservation.amountCopper,
      category,
      occurredAtUtcMs,
      reservation,
      null,
    );
    this.#replace({
      balanceCopper: this.#state.balanceCopper - reservation.amountCopper,
      reservations: this.#state.reservations.filter((value) => value.id !== reservationId),
      ledger: [...this.#state.ledger, entry],
    });
    return this.#accept(operationId, entry, this.#entryEvents(operationId, entry));
  }

  postIncome(
    operationId: string,
    request: FinanceEntryRequest,
  ): FinanceOperationResult<FinanceLedgerEntryState> {
    return this.#postEntry(operationId, request, false, true);
  }

  payExpense(
    operationId: string,
    request: FinanceEntryRequest,
  ): FinanceOperationResult<FinanceLedgerEntryState> {
    return this.#postEntry(operationId, request, false, false);
  }

  postMandatoryExpense(
    operationId: string,
    request: FinanceEntryRequest,
  ): FinanceOperationResult<FinanceLedgerEntryState> {
    return this.#postEntry(operationId, request, true, false);
  }

  settleBatch(
    operationId: string,
    batchId: string,
    settlementKey: string,
    lines: readonly FinanceSettlementLine[],
    settledAtUtcMs: number,
    sourceType: string,
    sourceId: string,
  ): FinanceOperationResult<FinanceSettlementBatchState> {
    const existing = this.#state.settlementBatches.find(
      (batch) => batch.settlementKey === settlementKey,
    );
    if (existing !== undefined) {
      return Object.freeze({
        accepted: true,
        changed: false,
        operationId,
        value: existing,
        events: [] as const,
      });
    }
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (!validId(batchId) || !validId(settlementKey) || !validId(sourceType) ||
      !validId(sourceId) || !isNonNegativeInteger(settledAtUtcMs) || lines.length === 0 ||
      this.#state.settlementBatches.some((batch) => batch.id === batchId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Settlement batch request is invalid.");
    }
    const requestedEntryIds = new Set<string>();
    for (const line of lines) {
      if (requestedEntryIds.has(line.entryId) ||
        !this.#validNewEntry(line.entryId, line.amountCopper, line.category, line.occurredAtUtcMs) ||
        !this.#validSource(line)) {
        return this.#reject(operationId, "INVALID_REQUEST", "Settlement batch contains an invalid or duplicate line.");
      }
      requestedEntryIds.add(line.entryId);
    }
    const entries = lines.map((line) => this.#entry(
      line.entryId,
      line.amountCopper,
      line.category,
      line.occurredAtUtcMs,
      line,
      batchId,
    ));
    const batch = Object.freeze({
      id: batchId,
      settlementKey,
      sourceType,
      sourceId,
      entryIds: Object.freeze(entries.map((entry) => entry.id)),
      settledAtUtcMs,
    });
    this.#replace({
      balanceCopper: this.#state.balanceCopper + entries.reduce((sum, entry) => sum + entry.amountCopper, 0),
      ledger: [...this.#state.ledger, ...entries],
      settlementBatches: [...this.#state.settlementBatches, batch],
    });
    const events = entries.flatMap((entry) => this.#entryEvents(operationId, entry));
    events.push(this.#event(operationId, "finance.settlement-batch-posted", settledAtUtcMs, {
      batchId,
      settlementKey,
      entryIds: batch.entryIds,
    }));
    return this.#accept(operationId, batch, events);
  }

  closeDay(
    operationId: string,
    gameDay: number,
    nextGameDay: number,
    closedAtUtcMs: number,
    mandatoryExpenses: readonly MandatoryExpenseRequest[] = [],
  ): FinanceOperationResult<FinanceDailyClosureState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (gameDay !== this.#state.currentGameDay || nextGameDay !== gameDay + 1) {
      return this.#reject(operationId, "DAY_MISMATCH", "Finance close-day request does not match the current day.");
    }
    if (!isNonNegativeInteger(closedAtUtcMs) ||
      this.#state.dailyClosures.some((closure) => closure.gameDay === gameDay)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Finance day has already closed or time is invalid.");
    }
    const entryIds = new Set<string>();
    for (const expense of mandatoryExpenses) {
      if (entryIds.has(expense.entryId) || !isPositiveInteger(expense.amountCopper) ||
        !this.#validNewEntry(expense.entryId, -expense.amountCopper, expense.category, closedAtUtcMs) ||
        !this.#validSource(expense)) {
        return this.#reject(operationId, "INVALID_REQUEST", "Mandatory day-close expense is invalid.");
      }
      entryIds.add(expense.entryId);
    }
    const entries = mandatoryExpenses.map((expense) => this.#entry(
      expense.entryId,
      -expense.amountCopper,
      expense.category,
      closedAtUtcMs,
      expense,
      null,
    ));
    const closingBalanceCopper = this.#state.balanceCopper - mandatoryExpenses.reduce(
      (sum, expense) => sum + expense.amountCopper,
      0,
    );
    const ledger = [...this.#state.ledger, ...entries];
    const closure = aggregateDay(
      gameDay,
      this.#state.currentDayOpeningBalanceCopper,
      ledger,
      closingBalanceCopper,
      closedAtUtcMs,
    );
    this.#replace({
      balanceCopper: closingBalanceCopper,
      currentGameDay: nextGameDay,
      currentDayOpeningBalanceCopper: closingBalanceCopper,
      ledger,
      dailyClosures: [...this.#state.dailyClosures, closure],
    });
    const events = entries.flatMap((entry) => this.#entryEvents(operationId, entry));
    events.push(this.#event(operationId, "finance.day-closed", closedAtUtcMs, closure));
    events.push(this.#event(operationId, "finance.day-started", closedAtUtcMs, {
      gameDay: nextGameDay,
      openingBalanceCopper: closingBalanceCopper,
    }));
    return this.#accept(operationId, closure, events);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Finance transaction is already active.");
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

  #postEntry(
    operationId: string,
    request: FinanceEntryRequest,
    allowNegativeBalance: boolean,
    income: boolean,
  ): FinanceOperationResult<FinanceLedgerEntryState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const amountCopper = income ? request.amountCopper : -request.amountCopper;
    if (!isPositiveInteger(request.amountCopper) ||
      !this.#validNewEntry(request.entryId, amountCopper, request.category, request.occurredAtUtcMs) ||
      !this.#validSource(request)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Finance ledger request is invalid.");
    }
    if (!income && !allowNegativeBalance && this.getSnapshot().availableCopper < request.amountCopper) {
      return this.#reject(operationId, "INSUFFICIENT_FUNDS", "Available balance is insufficient.");
    }
    const entry = this.#entry(
      request.entryId,
      amountCopper,
      request.category,
      request.occurredAtUtcMs,
      request,
      null,
    );
    this.#replace({
      balanceCopper: this.#state.balanceCopper + amountCopper,
      ledger: [...this.#state.ledger, entry],
    });
    return this.#accept(operationId, entry, this.#entryEvents(operationId, entry));
  }

  #entry(
    id: string,
    amountCopper: number,
    category: FinanceCategory,
    occurredAtUtcMs: number,
    source: FinanceSource,
    settlementBatchId: string | null,
  ): FinanceLedgerEntryState {
    return Object.freeze({
      id,
      gameDay: this.#state.currentGameDay,
      occurredAtUtcMs,
      amountCopper,
      category,
      settlementBatchId,
      ...frozenSource(source),
    });
  }

  #entryEvents(operationId: string, entry: FinanceLedgerEntryState): DomainEvent[] {
    return [
      this.#event(operationId, "finance.ledger-entry-posted", entry.occurredAtUtcMs, entry, entry.id),
      this.#event(operationId, "finance.balance-changed", entry.occurredAtUtcMs, {
        entryId: entry.id,
        amountCopper: entry.amountCopper,
        balanceCopper: this.#state.balanceCopper,
      }, entry.id),
    ];
  }

  #validNewEntry(
    entryId: string,
    signedAmountCopper: number,
    category: FinanceCategory,
    occurredAtUtcMs: number,
  ): boolean {
    return validId(entryId) && isInteger(signedAmountCopper) && signedAmountCopper !== 0 &&
      isNonNegativeInteger(occurredAtUtcMs) &&
      !this.#state.ledger.some((entry) => entry.id === entryId) &&
      (signedAmountCopper > 0 ? INCOME_CATEGORIES.has(category) : EXPENSE_CATEGORIES.has(category));
  }

  #validSource(source: FinanceSource): boolean {
    return validId(source.sourceType) && validId(source.sourceId) && validId(source.regionId) &&
      (source.note === undefined || source.note.length <= 500);
  }

  #prepare(operationId: string): FinanceOperationResult<never> | null {
    if (!validId(operationId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Finance operation id is invalid.");
    }
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Finance operation was already processed.");
    }
    const processed = [...this.#state.processedOperationIds, operationId];
    this.#state = cloneState({
      ...this.#state,
      processedOperationIds: processed.slice(-OPERATION_HISTORY_LIMIT),
    });
    return null;
  }

  #replace(update: Partial<FinanceState>): void {
    this.#state = cloneState({
      ...this.#state,
      ...update,
      revision: this.#state.revision + 1,
    });
  }

  #accept<TValue>(
    operationId: string,
    value: TValue,
    events: readonly DomainEvent[],
  ): FinanceOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: true,
      operationId,
      value,
      events: Object.freeze([...events]),
    });
  }

  #reject(
    operationId: string,
    code: FinanceRejectionCode,
    message: string,
  ): FinanceOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      events: [] as const,
    });
  }

  #event(
    operationId: string,
    type: string,
    occurredAtUtcMs: number,
    payload: unknown,
    eventDiscriminator?: string,
  ): DomainEvent {
    return Object.freeze({
      id: `${type}:${eventDiscriminator ?? operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #validateState(): void {
    if (this.#state.schemaVersion !== FINANCE_SCHEMA_VERSION ||
      !isNonNegativeInteger(this.#state.revision) ||
      !isInteger(this.#state.initialBalanceCopper) ||
      !isInteger(this.#state.balanceCopper) ||
      !isPositiveInteger(this.#state.currentGameDay)) {
      throw new Error("Finance state header is invalid.");
    }
    const reservationIds = new Set(this.#state.reservations.map((value) => value.id));
    const entryIds = new Set(this.#state.ledger.map((value) => value.id));
    const batchIds = new Set(this.#state.settlementBatches.map((value) => value.id));
    const settlementKeys = new Set(this.#state.settlementBatches.map((value) => value.settlementKey));
    if (reservationIds.size !== this.#state.reservations.length ||
      entryIds.size !== this.#state.ledger.length ||
      batchIds.size !== this.#state.settlementBatches.length ||
      settlementKeys.size !== this.#state.settlementBatches.length) {
      throw new Error("Finance state contains duplicate stable ids.");
    }
    const expectedBalance = this.#state.initialBalanceCopper + this.#state.ledger.reduce(
      (sum, entry) => sum + entry.amountCopper,
      0,
    );
    if (expectedBalance !== this.#state.balanceCopper) {
      throw new Error("Finance balance does not equal the immutable ledger total.");
    }
    for (const batch of this.#state.settlementBatches) {
      if (batch.entryIds.some((entryId) => !entryIds.has(entryId))) {
        throw new Error(`Finance settlement references an unknown entry: ${batch.id}`);
      }
    }
  }
}

export function isFinanceState(value: unknown): value is FinanceState {
  try {
    if (typeof value !== "object" || value === null) return false;
    new FinanceModule(0, 1, value as FinanceState);
    return true;
  } catch {
    return false;
  }
}

export * from "./reporting";
