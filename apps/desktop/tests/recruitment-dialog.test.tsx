import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FinanceReadModel, RecruitmentReadModel } from "@airship-restaurant/contracts";
import { RecruitmentDialog } from "../src/renderer/management/features/recruitment/RecruitmentDialog";

const recruitment: RecruitmentReadModel = {
  sourceRevision: 1,
  currentUtcMs: 10_000,
  nextFreeRefreshAtUtcMs: 20_000,
  freeRefreshAvailable: false,
  manualRefreshCostCopper: 20,
  recruitedEmployeeCount: 1,
  employeeLimit: 3,
  commandsAvailable: true,
  candidates: [{
    id: "candidate.recruitment.1.1",
    name: "艾达",
    skillLevels: { cooking: 2, charm: 3, movement: 1, repair: 1, piloting: 2 },
    talents: [{ id: "talent.patient", name: "从容不迫" }],
    learnedJobIds: ["job.waiter", "job.local_procurer"],
    primaryJobId: "job.waiter",
    hireCostCopper: 40,
    qualityTier: 1,
  }],
  employees: [{
    characterId: "instance.character.baiyecheng_core",
    name: "白夜城",
    coreMember: true,
    kind: "core",
    learnedJobIds: ["job.chef"],
    primaryJobId: "job.chef",
    dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
    dismissalPending: false,
    onShift: true,
    voyageActive: false,
    currentTaskId: null,
    skillLevels: { cooking: 3, charm: 1, movement: 1, repair: 1, piloting: 1 },
  }],
};

const finance = {
  sourceRevision: 1,
  balanceCopper: 100,
  reservedCopper: 0,
  availableCopper: 100,
  totalCopperSpent: 0,
  recentSales: [],
  currentDay: {
    gameDay: 1,
    closed: false,
    openingBalanceCopper: 100,
    incomeGroups: [],
    expenseGroups: [],
    totalIncomeCopper: 0,
    totalExpenseCopper: 0,
    netCopper: 0,
    closingBalanceCopper: 100,
    closedAtUtcMs: null,
  },
  historicalDays: [],
} satisfies FinanceReadModel;

describe("RecruitmentDialog", () => {
  it("renders candidate skills, talents, role, costs, capacity and the current roster", () => {
    const html = renderToStaticMarkup(
      <RecruitmentDialog
        open
        recruitment={recruitment}
        finance={finance}
        pending={false}
        onClose={vi.fn()}
        onRefresh={vi.fn(async () => true)}
        onHire={vi.fn(async () => true)}
        onSetPrimaryJob={vi.fn(async () => true)}
        onSetDailyShift={vi.fn(async () => true)}
        onRequestDismissal={vi.fn(async () => true)}
      />,
    );
    expect(html).toContain("员工服务中心");
    expect(html).toContain("艾达");
    expect(html).toContain("烹饪 2 · 魅力 3");
    expect(html).toContain("从容不迫");
    expect(html).toContain("主动刷新 · 20 铜币");
    expect(html).toContain("录用 · 40 铜币");
    expect(html).toContain("普通员工 <strong>1/3</strong>");
    expect(html).toContain("白夜城");
    expect(html).toContain("核心成员不可解雇");
    expect(html).toContain("在班 · 等待任务");
  });

  it("disables hiring when ordinary employee capacity is full", () => {
    const html = renderToStaticMarkup(
      <RecruitmentDialog
        open
        recruitment={{ ...recruitment, recruitedEmployeeCount: 3 }}
        finance={finance}
        pending={false}
        onClose={vi.fn()}
        onRefresh={vi.fn(async () => true)}
        onHire={vi.fn(async () => true)}
        onSetPrimaryJob={vi.fn(async () => true)}
        onSetDailyShift={vi.fn(async () => true)}
        onRequestDismissal={vi.fn(async () => true)}
      />,
    );
    expect(html).toContain("员工容量已满");
    expect(html).toMatch(/<button disabled="" type="button">员工容量已满<\/button>/);
  });
});