import type {
  FinanceCategory,
  FinanceDailyClosureState,
  FinanceExpenseCategory,
  FinanceIncomeCategory,
  FinanceLedgerEntryState,
  FinanceModule,
} from "./index";

export interface FinanceSourcePresentation {
  readonly displayName: string;
  readonly note?: string;
}

export interface FinanceSourcePresentationPort {
  resolve(sourceType: string, sourceId: string): FinanceSourcePresentation | null;
}

export class StaticFinanceSourcePresentations implements FinanceSourcePresentationPort {
  readonly #entries: ReadonlyMap<string, FinanceSourcePresentation>;
  constructor(entries: readonly { readonly sourceType: string; readonly sourceId: string; readonly displayName: string; readonly note?: string }[]) {
    const values = new Map<string, FinanceSourcePresentation>();
    for (const entry of entries) {
      const key = `${entry.sourceType}|${entry.sourceId}`;
      if (!valid(entry.sourceType) || !valid(entry.sourceId) || !valid(entry.displayName) || values.has(key)) {
        throw new Error(`Invalid finance source presentation: ${key}`);
      }
      values.set(key, Object.freeze({ displayName: entry.displayName, ...(entry.note === undefined ? {} : { note: entry.note }) }));
    }
    this.#entries = values;
  }
  resolve(sourceType: string, sourceId: string): FinanceSourcePresentation | null {
    return this.#entries.get(`${sourceType}|${sourceId}`) ?? null;
  }
}

export interface FinanceReportDetail {
  readonly occurredAtUtcMs: number;
  readonly amountCopper: number;
  readonly category: FinanceCategory;
  readonly regionId: string;
  readonly sourceName: string;
  readonly note: string | null;
}

export interface FinanceIncomeReportGroup {
  readonly category: FinanceIncomeCategory;
  readonly totalCopper: number;
  readonly details: readonly FinanceReportDetail[];
}

export interface FinanceExpenseReportGroup {
  readonly category: FinanceExpenseCategory;
  readonly totalCopper: number;
  readonly details: readonly FinanceReportDetail[];
}

export interface FinanceDayReport {
  readonly gameDay: number;
  readonly closed: boolean;
  readonly openingBalanceCopper: number;
  readonly incomeGroups: readonly FinanceIncomeReportGroup[];
  readonly expenseGroups: readonly FinanceExpenseReportGroup[];
  readonly totalIncomeCopper: number;
  readonly totalExpenseCopper: number;
  readonly netCopper: number;
  readonly closingBalanceCopper: number;
  readonly closedAtUtcMs: number | null;
}

export interface FinanceReportReadModel {
  readonly revision: number;
  readonly balanceCopper: number;
  readonly reservedCopper: number;
  readonly availableCopper: number;
  readonly currentDay: FinanceDayReport;
  readonly historicalDays: readonly FinanceDayReport[];
}

const INCOME_ORDER: readonly FinanceIncomeCategory[] = ["dish-sales", "tips", "focus-bonus", "other-income"];
const EXPENSE_ORDER: readonly FinanceExpenseCategory[] = [
  "ingredient-procurement",
  "employee-wages",
  "employee-recruitment",
  "recruitment-refresh",
  "airship-voyage",
  "equipment-repair",
  "technology-upgrade",
  "building-purchase",
  "other-expense",
];
const DEFAULT_SOURCE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  order: "顾客订单",
  "local-procurement": "本地采购",
  employment: "员工薪资",
  recruitment: "员工招募",
  technology: "科技升级",
  building: "建筑设施",
  repair: "设备维修",
  voyage: "飞艇航行",
});
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 200;

export class FinanceReportProjector {
  readonly #finance: FinanceModule;
  readonly #presentations: FinanceSourcePresentationPort;

  constructor(options: { readonly finance: FinanceModule; readonly presentations?: FinanceSourcePresentationPort }) {
    this.#finance = options.finance;
    this.#presentations = options.presentations ?? { resolve: () => null };
  }

  getReadModel(nowUtcMs: number): FinanceReportReadModel {
    if (!Number.isSafeInteger(nowUtcMs) || nowUtcMs < 0) throw new RangeError("Finance report time is invalid.");
    const snapshot = this.#finance.getSnapshot(nowUtcMs);
    return Object.freeze({
      revision: snapshot.revision,
      balanceCopper: snapshot.balanceCopper,
      reservedCopper: snapshot.reservedCopper,
      availableCopper: snapshot.availableCopper,
      currentDay: this.#day(snapshot.currentDay, false, snapshot.ledger),
      historicalDays: Object.freeze([...snapshot.dailyClosures]
        .sort((left, right) => right.gameDay - left.gameDay)
        .map((closure) => this.#day(closure, true, snapshot.ledger))),
    });
  }

  #day(closure: FinanceDailyClosureState, closed: boolean, ledger: readonly FinanceLedgerEntryState[]): FinanceDayReport {
    const entries = ledger.filter((entry) => entry.gameDay === closure.gameDay);
    const incomeGroups = INCOME_ORDER.map((category): FinanceIncomeReportGroup | null => {
      const values = entries.filter((entry) => entry.category === category && entry.amountCopper > 0);
      if (values.length === 0) return null;
      return Object.freeze({
        category,
        totalCopper: values.reduce((sum, entry) => sum + entry.amountCopper, 0),
        details: Object.freeze(this.#details(values)),
      });
    }).filter((entry): entry is FinanceIncomeReportGroup => entry !== null);
    const expenseGroups = EXPENSE_ORDER.map((category): FinanceExpenseReportGroup | null => {
      const values = entries.filter((entry) => entry.category === category && entry.amountCopper < 0);
      if (values.length === 0) return null;
      return Object.freeze({
        category,
        totalCopper: values.reduce((sum, entry) => sum - entry.amountCopper, 0),
        details: Object.freeze(this.#details(values)),
      });
    }).filter((entry): entry is FinanceExpenseReportGroup => entry !== null);
    const totalIncomeCopper = incomeGroups.reduce((sum, entry) => sum + entry.totalCopper, 0);
    const totalExpenseCopper = expenseGroups.reduce((sum, entry) => sum + entry.totalCopper, 0);
    if (totalIncomeCopper !== closure.totalIncomeCopper || totalExpenseCopper !== closure.totalExpenseCopper ||
      closure.openingBalanceCopper + closure.netCopper !== closure.closingBalanceCopper) {
      throw new Error(`Finance day report does not reconcile: ${closure.gameDay}`);
    }
    return Object.freeze({
      gameDay: closure.gameDay,
      closed,
      openingBalanceCopper: closure.openingBalanceCopper,
      incomeGroups: Object.freeze(incomeGroups),
      expenseGroups: Object.freeze(expenseGroups),
      totalIncomeCopper,
      totalExpenseCopper,
      netCopper: totalIncomeCopper - totalExpenseCopper,
      closingBalanceCopper: closure.closingBalanceCopper,
      closedAtUtcMs: closed ? closure.closedAtUtcMs : null,
    });
  }

  #details(entries: readonly FinanceLedgerEntryState[]): FinanceReportDetail[] {
    return [...entries]
      .sort((left, right) => right.occurredAtUtcMs - left.occurredAtUtcMs || left.id.localeCompare(right.id))
      .map((entry) => {
        const presentation = this.#presentations.resolve(entry.sourceType, entry.sourceId);
        return Object.freeze({
          occurredAtUtcMs: entry.occurredAtUtcMs,
          amountCopper: Math.abs(entry.amountCopper),
          category: entry.category,
          regionId: entry.regionId,
          sourceName: presentation?.displayName ?? DEFAULT_SOURCE_NAMES[entry.sourceType] ?? "其他经营事项",
          note: entry.note ?? presentation?.note ?? null,
        });
      });
  }
}