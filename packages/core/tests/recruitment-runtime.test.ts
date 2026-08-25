import { describe, expect, it, vi } from "vitest";
import {
  CharacterModule,
  EmploymentModule,
  FinanceModule,
  GameRuntime,
  RuntimeReadModelFacade,
  RecruitmentModule,
  RecruitmentRuntime,
  RuntimeCommandExtensionChain,
  SeededRandom,
  type RecruitmentDefinition,
} from "../src";

const definition: RecruitmentDefinition = {
  templateCharacterId: "character.recruit_template",
  candidateNames: ["艾达", "诺拉", "米洛"],
  candidateCount: 2,
  freeRefreshIntervalMs: 1_000,
  manualRefreshBaseCostCopper: 10,
  manualRefreshCostStepCopper: 10,
  hireBaseCostCopper: 40,
  jobOptions: [{
    learnedJobIds: ["job.chef", "job.waiter"],
    primaryJobId: "job.chef",
  }],
  qualityTiers: [{
    tier: 0,
    minimumSkill: 1,
    maximumSkill: 2,
    maximumTalentQuality: 1,
    talentCountWeights: [0, 100, 0, 0],
  }],
};

function setup() {
  const finance = new FinanceModule(100);
  const characters = new CharacterModule([{
    id: "character.recruit_template",
    name: "普通求职者",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  }], [{
    id: "talent.patient",
    name: "耐心",
    exclusiveCharacterId: null,
    effectKeys: [],
  }]);
  const employment = new EmploymentModule(characters);
  const progression = {
    getEffect(key: "recruitment.quality-tier" | "employment.employee-limit") {
      return key === "recruitment.quality-tier" ? 0 : 2;
    },
  };
  const random = new SeededRandom(7);
  const recruitment = new RecruitmentModule({
    definition,
    talents: [{ id: "talent.patient", qualityTier: 1 }],
    finance,
    characters,
    employment,
    progression,
    random: { next: () => random.nextFloat() },
  });
  let now = 0;
  const currentTasks = new Map<string, string>();
  const activeVoyages = new Set<string>();
  const onChanged = vi.fn();
  const onCharacterHired = vi.fn();
  const beforeEmploymentMutation = vi.fn();
  const runtime = new RecruitmentRuntime({
    recruitment,
    characters,
    employment,
    progression,
    clock: { nowUtcMs: () => now },
    activity: {
      getCurrentTaskId: (characterId) => currentTasks.get(characterId) ?? null,
      isVoyageActive: (characterId) => activeVoyages.has(characterId),
    },
    beforeEmploymentMutation,
    onChanged,
    onCharacterHired,
  });
  return {
    finance,
    characters,
    employment,
    recruitment,
    runtime,
    onChanged,
    onCharacterHired,
    beforeEmploymentMutation,
    setNow(value: number) { now = value; },
    setCurrentTask(characterId: string, taskId: string | null) {
      if (taskId === null) currentTasks.delete(characterId);
      else currentTasks.set(characterId, taskId);
    },
    setVoyageActive(characterId: string, active: boolean) {
      if (active) activeVoyages.add(characterId);
      else activeVoyages.delete(characterId);
    },
  };
}

describe("RecruitmentRuntime", () => {
  it("projects frozen candidates and registers a hired character through the command boundary", () => {
    const target = setup();
    expect(target.runtime.dispatch({
      id: "runtime-free-refresh",
      type: "recruitment.refresh",
      payload: { kind: "free" },
    })).toMatchObject({ handled: true, accepted: true });
    const candidate = target.runtime.getSnapshot().candidates[0]!;
    expect(candidate).toMatchObject({
      talents: [{ id: "talent.patient", name: "耐心" }],
      primaryJobId: "job.chef",
      qualityTier: 0,
    });

    target.setNow(10);
    expect(target.runtime.dispatch({
      id: "runtime-hire",
      type: "recruitment.hire",
      payload: {
        candidateId: candidate.id,
        shiftStartMinuteInclusive: 480,
        shiftEndMinuteExclusive: 1_020,
      },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.onCharacterHired).toHaveBeenCalledOnce();
    expect(target.onChanged).toHaveBeenCalledTimes(2);
    expect(target.runtime.getSnapshot()).toMatchObject({
      recruitedEmployeeCount: 1,
      employeeLimit: 2,
      candidates: [{ id: expect.not.stringMatching(candidate.id) }],
      employees: [{ name: candidate.name, kind: "recruited", primaryJobId: "job.chef" }],
    });
    expect(target.finance.getSnapshot().balanceCopper).toBe(60);
  });

  it("changes jobs and shifts, then finishes a pending dismissal after current work", () => {
    const target = setup();
    target.runtime.dispatch({
      id: "staff-refresh",
      type: "recruitment.refresh",
      payload: { kind: "free" },
    });
    const candidate = target.runtime.getSnapshot().candidates[0]!;
    target.runtime.dispatch({
      id: "staff-hire",
      type: "recruitment.hire",
      payload: {
        candidateId: candidate.id,
        shiftStartMinuteInclusive: 480,
        shiftEndMinuteExclusive: 1_020,
      },
    });
    const employee = target.runtime.getSnapshot().employees.find(
      (item) => !item.coreMember,
    )!;
    expect(target.runtime.dispatch({
      id: "staff-job",
      type: "employment.set-primary-job",
      payload: { characterId: employee.characterId, jobId: "job.waiter" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.runtime.dispatch({
      id: "staff-shift",
      type: "employment.set-daily-shift",
      payload: {
        characterId: employee.characterId,
        startMinuteInclusive: 720,
        endMinuteExclusive: 1_260,
      },
    })).toMatchObject({ handled: true, accepted: true });

    target.setCurrentTask(employee.characterId, "task.service.table-1");
    expect(target.runtime.dispatch({
      id: "staff-dismiss",
      type: "employment.request-dismissal",
      payload: { characterId: employee.characterId },
    })).toMatchObject({ handled: true, accepted: true });
    expect(target.runtime.getSnapshot().employees[0]).toMatchObject({
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 720, endMinuteExclusive: 1_260 },
      dismissalPending: true,
      currentTaskId: "task.service.table-1",
    });
    expect(target.beforeEmploymentMutation).toHaveBeenCalledTimes(3);
    expect(target.runtime.reconcilePendingDismissals()).toBe(0);

    target.setCurrentTask(employee.characterId, null);
    expect(target.runtime.reconcilePendingDismissals()).toBe(1);
    expect(target.runtime.getSnapshot().employees).toHaveLength(0);
  });

  it("rejects dismissal while the employee is on an active voyage", () => {
    const target = setup();
    target.runtime.dispatch({
      id: "voyage-refresh",
      type: "recruitment.refresh",
      payload: { kind: "free" },
    });
    const candidate = target.runtime.getSnapshot().candidates[0]!;
    target.runtime.dispatch({
      id: "voyage-hire",
      type: "recruitment.hire",
      payload: {
        candidateId: candidate.id,
        shiftStartMinuteInclusive: 480,
        shiftEndMinuteExclusive: 1_020,
      },
    });
    const characterId = target.runtime.getSnapshot().employees[0]!.characterId;
    target.setVoyageActive(characterId, true);
    expect(target.runtime.dispatch({
      id: "voyage-dismiss",
      type: "employment.request-dismissal",
      payload: { characterId },
    })).toMatchObject({
      handled: true,
      accepted: false,
      rejectionCode: "EMPLOYMENT_REJECTED",
    });
    expect(target.runtime.getSnapshot().employees[0]).toMatchObject({
      characterId,
      voyageActive: true,
      dismissalPending: false,
    });
  });

  it("routes through an extension chain and preserves the recruitment rejection code", () => {
    const target = setup();
    const game = new GameRuntime({ nowUtcMs: () => 0 });
    game.markReady();
    const commands = new RuntimeCommandExtensionChain([
      { dispatch: () => ({ handled: false as const }) },
      target.runtime,
    ]);
    const facade = new RuntimeReadModelFacade(game, null, commands);

    expect(facade.dispatch({
      id: "runtime-free-refresh",
      type: "recruitment.refresh",
      payload: { kind: "free" },
    })).toMatchObject({ accepted: true });
    expect(facade.dispatch({
      id: "runtime-free-too-early",
      type: "recruitment.refresh",
      payload: { kind: "free" },
    })).toMatchObject({
      accepted: false,
      code: "RECRUITMENT_REJECTED",
    });
  });
});