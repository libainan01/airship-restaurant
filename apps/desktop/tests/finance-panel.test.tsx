import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FinanceReadModel } from "@airship-restaurant/contracts";
import { OperationsPanel } from "../src/renderer/management/features/operations/OperationsPanel";

const finance: FinanceReadModel = {
  sourceRevision: 3,
  balanceCopper: 82,
  reservedCopper: 0,
  availableCopper: 82,
  totalCopperSpent: 38,
  recentSales: [],
  currentDay: {
    gameDay: 2,
    closed: false,
    openingBalanceCopper: 80,
    incomeGroups: [{
      category: "dish-sales",
      totalCopper: 30,
      details: [{
        occurredAtUtcMs: 2_000,
        amountCopper: 30,
        category: "dish-sales",
        regionId: "region.restaurant",
        sourceName: "顾客订单",
        note: null,
      }],
    }],
    expenseGroups: [{
      category: "employee-wages",
      totalCopper: 28,
      details: [{
        occurredAtUtcMs: 2_100,
        amountCopper: 28,
        category: "employee-wages",
        regionId: "region.restaurant",
        sourceName: "员工薪资",
        note: "艾达",
      }],
    }],
    totalIncomeCopper: 30,
    totalExpenseCopper: 28,
    netCopper: 2,
    closingBalanceCopper: 82,
    closedAtUtcMs: null,
  },
  historicalDays: [{
    gameDay: 1,
    closed: true,
    openingBalanceCopper: 100,
    incomeGroups: [],
    expenseGroups: [],
    totalIncomeCopper: 0,
    totalExpenseCopper: 20,
    netCopper: -20,
    closingBalanceCopper: 80,
    closedAtUtcMs: 1_440,
  }],
};

describe("OperationsPanel finance report", () => {
  it("renders current profit, wage details and historical closures", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        operations={null}
        finance={finance}
        inventory={null}
        pending={false}
        actions={{
          selectRecipe: vi.fn(async () => true),
          setAutoRepeat: vi.fn(async () => true),
        }}
      />,
    );
    expect(html).toContain("今日盈亏 · 第 2 日");
    expect(html).toContain("+2 铜币");
    expect(html).toContain("员工工资");
    expect(html).toContain("员工薪资 · 艾达");
    expect(html).toContain("历史日结 · 1 日");
    expect(html).toContain("第 1 日");
  });
});