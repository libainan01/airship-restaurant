import { describe, expect, it } from "vitest";
import { CharacterModule, EmploymentModule, FinanceModule, RecruitmentModule, SeededRandom, isRecruitmentState, type RecruitmentDefinition } from "../src";

const definition: RecruitmentDefinition = {
  templateCharacterId: "character.recruit_template",
  candidateNames: ["艾达", "诺拉", "米洛", "伊芙", "莱恩"],
  candidateCount: 3,
  freeRefreshIntervalMs: 1_000,
  manualRefreshBaseCostCopper: 10,
  manualRefreshCostStepCopper: 10,
  hireBaseCostCopper: 40,
  jobOptions: [
    { learnedJobIds: ["job.chef"], primaryJobId: "job.chef" },
    { learnedJobIds: ["job.waiter", "job.local_procurer"], primaryJobId: "job.local_procurer" },
  ],
  qualityTiers: [
    { tier: 0, minimumSkill: 1, maximumSkill: 2, maximumTalentQuality: 1, talentCountWeights: [0, 100, 0, 0] },
    { tier: 1, minimumSkill: 1, maximumSkill: 3, maximumTalentQuality: 2, talentCountWeights: [0, 0, 100, 0] },
    { tier: 2, minimumSkill: 2, maximumSkill: 4, maximumTalentQuality: 3, talentCountWeights: [0, 0, 100, 0] },
    { tier: 3, minimumSkill: 3, maximumSkill: 5, maximumTalentQuality: 3, talentCountWeights: [0, 0, 0, 100] },
  ],
};
const talents = [
  { id: "talent.patient", qualityTier: 1 },
  { id: "talent.quick", qualityTier: 2 },
  { id: "talent.skywise", qualityTier: 3 },
] as const;

function fixture(initialCopper = 100) {
  const finance = new FinanceModule(initialCopper);
  const characters = new CharacterModule([{
    id: "character.recruit_template",
    name: "普通求职者",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  }], talents.map((talent) => ({ id: talent.id, name: talent.id, exclusiveCharacterId: null, effectKeys: [] })));
  const employment = new EmploymentModule(characters);
  const progression = {
    tier: 0,
    employeeLimit: 3,
    getEffect(key: "recruitment.quality-tier" | "employment.employee-limit") {
      return key === "recruitment.quality-tier" ? this.tier : this.employeeLimit;
    },
  };
  const seeded = new SeededRandom(0x71503);
  const recruitment = new RecruitmentModule({
    definition,
    talents,
    finance,
    characters,
    employment,
    progression,
    random: { next: () => seeded.nextFloat() },
  });
  return { finance, characters, employment, progression, recruitment };
}

describe("RecruitmentModule", () => {
  it("freezes names, skills, talents, jobs and the current technology quality for one refresh", () => {
    const { recruitment, progression } = fixture();
    const refreshed = recruitment.refresh("free-1", "free", 0);
    expect(refreshed).toMatchObject({ accepted: true, value: { nextFreeRefreshAtUtcMs: 1_000, manualRefreshCount: 0 } });
    const first = recruitment.exportState();
    expect(first.candidates).toHaveLength(3);
    expect(new Set(first.candidates.map((candidate) => candidate.name)).size).toBe(3);
    expect(first.candidates.every((candidate) => candidate.qualityTierSnapshot === 0 && candidate.talentIds.length === 1 && candidate.talentIds[0] === "talent.patient")).toBe(true);
    expect(first.candidates.flatMap((candidate) => Object.values(candidate.skillLevels)).every((level) => level >= 1 && level <= 2)).toBe(true);

    progression.tier = 3;
    expect(recruitment.exportState().candidates).toEqual(first.candidates);
    expect(recruitment.refresh("free-too-early", "free", 999)).toMatchObject({ accepted: false, code: "FREE_REFRESH_NOT_DUE" });
    expect(recruitment.refresh("free-2", "free", 1_000)).toMatchObject({ accepted: true });
    expect(recruitment.exportState().candidates.every((candidate) => candidate.qualityTierSnapshot === 3 && candidate.talentIds.length === 3)).toBe(true);
  });

  it("increases manual refresh fees within a free cycle and resets them on the next free refresh", () => {
    const { recruitment, finance } = fixture();
    recruitment.refresh("free", "free", 0);
    expect(recruitment.getManualRefreshCostCopper()).toBe(10);
    recruitment.refresh("manual-1", "manual", 100);
    expect(finance.getSnapshot().balanceCopper).toBe(90);
    expect(recruitment.getManualRefreshCostCopper()).toBe(20);
    recruitment.refresh("manual-2", "manual", 200);
    expect(finance.getSnapshot().balanceCopper).toBe(70);
    expect(recruitment.exportState().manualRefreshCount).toBe(2);
    recruitment.refresh("next-free", "free", 1_000);
    expect(recruitment.getManualRefreshCostCopper()).toBe(10);
  });

  it("hires one frozen candidate into Character and Employment through one atomic payment", () => {
    const { recruitment, finance, characters, employment } = fixture();
    recruitment.refresh("free", "free", 0);
    const candidate = recruitment.exportState().candidates[0]!;
    const hired = recruitment.hire("hire-1", candidate.id, { startMinuteInclusive: 480, endMinuteExclusive: 1_020 }, 10);
    expect(hired).toMatchObject({ accepted: true, value: { candidateId: candidate.id } });
    if (!hired.accepted) throw new Error(hired.message);
    expect(finance.getSnapshot().balanceCopper).toBe(60);
    expect(characters.getCharacter(hired.value.characterId)).toMatchObject({
      name: candidate.name,
      skills: { cooking: { level: candidate.skillLevels.cooking } },
      talentIds: candidate.talentIds,
      coreMember: false,
    });
    expect(employment.getRecord(hired.value.characterId)).toMatchObject({
      kind: "recruited",
      learnedJobIds: candidate.learnedJobIds,
      primaryJobId: candidate.primaryJobId,
    });
    expect(recruitment.exportState().candidates.find((entry) => entry.id === candidate.id)).toBeUndefined();
  });

  it("keeps the candidate when capacity is full or the recruitment payment fails", () => {
    const full = fixture();
    full.recruitment.refresh("free-full", "free", 0);
    const fullCandidate = full.recruitment.exportState().candidates[0]!;
    full.progression.employeeLimit = 0;
    expect(full.recruitment.hire("hire-full", fullCandidate.id, { startMinuteInclusive: 480, endMinuteExclusive: 1_020 }, 10)).toMatchObject({ accepted: false, code: "EMPLOYEE_LIMIT_REACHED" });
    expect(full.finance.getSnapshot().balanceCopper).toBe(100);
    expect(full.recruitment.exportState().candidates).toContainEqual(fullCandidate);

    const poor = fixture(39);
    poor.recruitment.refresh("free-poor", "free", 0);
    const poorCandidate = poor.recruitment.exportState().candidates[0]!;
    expect(poor.recruitment.hire("hire-poor", poorCandidate.id, { startMinuteInclusive: 480, endMinuteExclusive: 1_020 }, 10)).toMatchObject({ accepted: false, code: "FINANCE_REJECTED" });
    expect(poor.characters.createReadModel().characters).toEqual([]);
    expect(poor.employment.exportState().records).toEqual([]);
    expect(poor.recruitment.exportState().candidates).toContainEqual(poorCandidate);
  });
  it("rolls back candidates, counters and finance when a manual refresh cannot be paid", () => {
    const { recruitment, finance } = fixture(5);
    recruitment.refresh("free", "free", 0);
    const before = recruitment.exportState();
    expect(recruitment.refresh("manual-poor", "manual", 100)).toMatchObject({ accepted: false, code: "FINANCE_REJECTED" });
    expect(recruitment.exportState()).toEqual(before);
    expect(finance.getSnapshot().balanceCopper).toBe(5);
  });
  it("rejects duplicate candidate ids and out-of-range frozen skills", () => {
    const { recruitment } = fixture();
    recruitment.refresh("free-for-validation", "free", 0);
    const state = recruitment.exportState();
    expect(isRecruitmentState(state)).toBe(true);
    expect(isRecruitmentState({ ...state, candidates: [state.candidates[0], state.candidates[0]] })).toBe(false);
    expect(isRecruitmentState({
      ...state,
      candidates: [{
        ...state.candidates[0]!,
        skillLevels: { ...state.candidates[0]!.skillLevels, cooking: 101 },
      }],
    })).toBe(false);
  });
});