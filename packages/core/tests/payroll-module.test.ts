import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  DomainEventBus,
  EmploymentModule,
  FinanceModule,
  FinanceReportProjector,
  PayrollModule,
  instanceId,
  isPayrollState,
  type CharacterDefinition,
  type PayrollState,
} from "../src";

const definitions: readonly CharacterDefinition[] = [
  {
    id: "character.core",
    name: "白夜城",
    baseSkills: { cooking: 5, charm: 5, movement: 5, repair: 5, piloting: 5 },
    defaultTalentIds: [],
  },
  {
    id: "character.worker",
    name: "艾达",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
];

function setup(initial?: {
  readonly finance?: ReturnType<FinanceModule["exportState"]>;
  readonly payroll?: PayrollState;
}) {
  const characters = new CharacterModule(definitions, [{
    id: "talent.quick",
    name: "领悟迅速",
    exclusiveCharacterId: null,
    effectKeys: [],
  }]);
  const core = instanceId("instance.character.payroll_core");
  const worker = instanceId("instance.character.payroll_worker");
  characters.createCharacter("create-core", {
    instanceId: core,
    definitionId: "character.core",
    coreMember: true,
    occurredAtUtcMs: 0,
  });
  characters.createCharacter("create-worker", {
    instanceId: worker,
    definitionId: "character.worker",
    name: "艾达",
    skillLevels: { cooking: 2, charm: 3, movement: 1, repair: 1, piloting: 1 },
    talentIds: ["talent.quick"],
    coreMember: false,
    occurredAtUtcMs: 0,
  });
  const employment = new EmploymentModule(characters);
  employment.addEmployee("employ-core", {
    characterId: core,
    kind: "core",
    learnedJobIds: ["job.chef"],
    primaryJobId: "job.chef",
    dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
    occurredAtUtcMs: 0,
  });
  employment.addEmployee("employ-worker", {
    characterId: worker,
    kind: "recruited",
    learnedJobIds: ["job.waiter", "job.captain"],
    primaryJobId: "job.waiter",
    dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
    occurredAtUtcMs: 0,
  });
  const finance = new FinanceModule(
    initial?.finance === undefined ? 5 : 0,
    1,
    initial?.finance,
  );
  const activeVoyages = new Set<string>();
  const events: string[] = [];
  const eventBus = new DomainEventBus();
  eventBus.subscribe("*", (event) => events.push(event.type));
  const payroll = new PayrollModule({
    characters,
    employment,
    finance,
    talentQuality: {
      getTalentQuality: (talentId) => talentId === "talent.quick" ? 2 : null,
    },
    activity: {
      isVoyageActive: (characterId) => activeVoyages.has(characterId),
    },
    wagePolicy: {
      baseDailyWageCopper: 10,
      copperPerSkillLevel: {
        cooking: 1,
        charm: 1,
        movement: 1,
        repair: 1,
        piloting: 1,
      },
      copperPerTalentQuality: 5,
    },
    dayDurationMs: 1_440,
    initialState: initial?.payroll,
    eventBus,
  });
  return { characters, employment, finance, payroll, core, worker, activeVoyages, events };
}

describe("PayrollModule", () => {
  it("snapshots a recruited employee wage and still pays it after dismissal", () => {
    const target = setup();
    const observed = target.payroll.advanceTo(500);
    expect(observed.state.attendance).toEqual([{
      gameDay: 1,
      characterId: target.worker,
      characterName: "艾达",
      firstEnteredShiftAtUtcMs: 480,
      dailyWageCopper: 28,
    }]);
    expect(target.payroll.calculateDailyWage(target.worker)).toBe(28);

    expect(target.employment.requestDismissal(
      "dismiss-worker",
      target.worker,
      false,
      600,
    )).toMatchObject({ accepted: true, value: { pending: false } });
    const closed = target.payroll.advanceTo(1_440);
    expect(closed.closedGameDays).toEqual([1]);
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: -23,
      currentGameDay: 2,
      dailyClosures: [{
        gameDay: 1,
        expenseByCategory: { "employee-wages": 28 },
        closingBalanceCopper: -23,
      }],
    });
    expect(target.finance.getSnapshot().ledger).toHaveLength(1);
    const report = new FinanceReportProjector({ finance: target.finance }).getReadModel(1_440);
    expect(report.historicalDays[0]).toMatchObject({
      gameDay: 1,
      totalExpenseCopper: 28,
      netCopper: -28,
      expenseGroups: [{ category: "employee-wages", totalCopper: 28 }],
    });
    expect(target.finance.getSnapshot().ledger[0]).toMatchObject({
      amountCopper: -28,
      category: "employee-wages",
      note: "艾达",
    });
    expect(target.events).toContain("payroll.attendance-recorded");
    expect(target.events).toContain("finance.ledger-entry-posted");
    expect(target.events).toContain("payroll.day-closed");
  });

  it("does not pay core members or a recruited employee who remains on a voyage", () => {
    const target = setup();
    target.activeVoyages.add(target.worker);
    target.payroll.advanceTo(1_440);
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: 5,
      currentGameDay: 2,
      ledger: [],
      dailyClosures: [{ totalExpenseCopper: 0 }],
    });
  });

  it("starts counting again after a voyage ends and closes multiple offline days once", () => {
    const target = setup();
    target.activeVoyages.add(target.worker);
    target.payroll.advanceTo(500);
    expect(target.payroll.exportState().attendance).toHaveLength(0);
    target.activeVoyages.delete(target.worker);
    target.payroll.advanceTo(600);
    expect(target.payroll.exportState().attendance[0]).toMatchObject({
      firstEnteredShiftAtUtcMs: 500,
      dailyWageCopper: 28,
    });
    target.payroll.advanceTo(2_880);
    expect(target.finance.getSnapshot()).toMatchObject({
      balanceCopper: -51,
      currentGameDay: 3,
    });
    expect(target.finance.getSnapshot().ledger).toHaveLength(2);
    expect(target.finance.getSnapshot().dailyClosures.map((day) => day.gameDay)).toEqual([1, 2]);
  });

  it("restores a frozen attendance snapshot without losing an already-earned wage", () => {
    const first = setup();
    first.payroll.advanceTo(500);
    const financeState = first.finance.exportState();
    const payrollState = first.payroll.exportState();
    expect(isPayrollState(payrollState)).toBe(true);

    const restored = setup({ finance: financeState, payroll: payrollState });
    restored.employment.requestDismissal(
      "dismiss-after-restore",
      restored.worker,
      false,
      600,
    );
    restored.payroll.advanceTo(1_440);
    expect(restored.finance.getSnapshot()).toMatchObject({
      balanceCopper: -23,
      currentGameDay: 2,
    });
    expect(restored.finance.getSnapshot().ledger).toHaveLength(1);

    const duplicate = {
      ...payrollState,
      attendance: [
        payrollState.attendance[0]!,
        payrollState.attendance[0]!,
      ],
    };
    expect(isPayrollState(duplicate)).toBe(false);
  });
});