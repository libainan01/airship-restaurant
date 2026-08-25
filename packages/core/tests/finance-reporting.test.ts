import { describe, expect, it } from "vitest";
import {
  FinanceModule,
  FinanceReportProjector,
  LinearTrayTipPolicy,
  StaticFinanceSourcePresentations,
} from "../src";

function createFinance() {
  const finance = new FinanceModule(1_000);
  const procurement = finance.payExpense("pay-procurement", {
    entryId: "ledger.procurement.demo",
    amountCopper: 100,
    category: "ingredient-procurement",
    occurredAtUtcMs: 10,
    sourceType: "local-procurement",
    sourceId: "procurement.demo",
    regionId: "region.demo",
    note: "番茄炒蛋采购",
  });
  if (!procurement.accepted) throw new Error(procurement.message);
  const settled = finance.settleBatch("settle-order", "settlement.order.demo", "order:order.demo", [
    {
      entryId: "ledger.order.demo.sales",
      amountCopper: 30,
      category: "dish-sales",
      occurredAtUtcMs: 20,
      sourceType: "order",
      sourceId: "order.demo",
      regionId: "region.demo",
    },
    {
      entryId: "ledger.order.demo.tips",
      amountCopper: 9,
      category: "tips",
      occurredAtUtcMs: 20,
      sourceType: "order",
      sourceId: "order.demo",
      regionId: "region.demo",
      note: "奥拓送餐小费",
    },
  ], 20, "order", "order.demo");
  if (!settled.accepted) throw new Error(settled.message);
  return finance;
}

const presentations = new StaticFinanceSourcePresentations([
  { sourceType: "order", sourceId: "order.demo", displayName: "一号桌账单" },
  { sourceType: "local-procurement", sourceId: "procurement.demo", displayName: "本地食材采购" },
  { sourceType: "employment", sourceId: "wages.day.1", displayName: "员工日薪" },
]);

describe("FinanceReportProjector", () => {
  it("derives the live profit panel from immutable ledger entries and keeps settlement idempotent", () => {
    const finance = createFinance();
    const retry = finance.settleBatch("settle-order-retry", "settlement.other", "order:order.demo", [{
      entryId: "ledger.should-not-post",
      amountCopper: 999,
      category: "dish-sales",
      occurredAtUtcMs: 21,
      sourceType: "order",
      sourceId: "order.demo",
      regionId: "region.demo",
    }], 21, "order", "order.demo");
    expect(retry).toMatchObject({ accepted: true, changed: false, value: { id: "settlement.order.demo" } });

    const report = new FinanceReportProjector({ finance, presentations }).getReadModel(25);
    expect(report).toMatchObject({
      balanceCopper: 939,
      reservedCopper: 0,
      availableCopper: 939,
      currentDay: {
        gameDay: 1,
        openingBalanceCopper: 1_000,
        totalIncomeCopper: 39,
        totalExpenseCopper: 100,
        netCopper: -61,
        closingBalanceCopper: 939,
        closed: false,
      },
    });
    expect(report.currentDay.incomeGroups.map((entry) => [entry.category, entry.totalCopper])).toEqual([
      ["dish-sales", 30],
      ["tips", 9],
    ]);
    expect(report.currentDay.expenseGroups[0]).toMatchObject({ category: "ingredient-procurement", totalCopper: 100 });
    expect(report.currentDay.incomeGroups[0]?.details[0]).toMatchObject({ sourceName: "一号桌账单", amountCopper: 30 });
    expect(report.currentDay.expenseGroups[0]?.details[0]).toMatchObject({ sourceName: "本地食材采购", note: "番茄炒蛋采购" });
    expect(JSON.stringify(report)).not.toContain("order.demo");
    expect(finance.getSnapshot().settlementBatches).toHaveLength(1);
    expect(finance.getSnapshot().ledger).toHaveLength(3);
  });

  it("locks a historical closure, rolls its balance into the next day and restores the same report", () => {
    const finance = createFinance();
    const closed = finance.closeDay("close-day", 1, 2, 30, [{
      entryId: "ledger.wages.day.1",
      amountCopper: 50,
      category: "employee-wages",
      sourceType: "employment",
      sourceId: "wages.day.1",
      regionId: "region.demo",
      note: "奥拓与白夜城",
    }]);
    expect(closed).toMatchObject({ accepted: true, value: { closingBalanceCopper: 889, netCopper: -111 } });
    expect(finance.closeDay("close-day-again", 1, 2, 31)).toMatchObject({ accepted: false, code: "DAY_MISMATCH" });

    const restored = new FinanceModule(0, 1, finance.exportState());
    const report = new FinanceReportProjector({ finance: restored, presentations }).getReadModel(40);
    expect(report).toMatchObject({
      balanceCopper: 889,
      currentDay: { gameDay: 2, openingBalanceCopper: 889, netCopper: 0, closingBalanceCopper: 889 },
      historicalDays: [{
        gameDay: 1,
        closed: true,
        openingBalanceCopper: 1_000,
        totalIncomeCopper: 39,
        totalExpenseCopper: 150,
        netCopper: -111,
        closingBalanceCopper: 889,
        closedAtUtcMs: 30,
      }],
    });
    expect(report.historicalDays[0]?.expenseGroups.map((entry) => entry.category)).toEqual([
      "ingredient-procurement",
      "employee-wages",
    ]);
    expect(new LinearTrayTipPolicy(333).calculateTipCopper(3, 99)).toBe(10);
  });
});