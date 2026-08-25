import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  DomainEventBus,
  EmploymentModule,
  TransactionScope,
  instanceId,
  isEmploymentState,
  type CharacterDefinition,
} from "../src";

const definitions: readonly CharacterDefinition[] = [
  {
    id: "character.baiyecheng",
    name: "白夜城",
    baseSkills: { cooking: 3, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.otto",
    name: "奥托",
    baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
    defaultTalentIds: [],
  },
  {
    id: "character.worker",
    name: "普通员工",
    baseSkills: { cooking: 1, charm: 1, movement: 1, repair: 1, piloting: 2 },
    defaultTalentIds: [],
  },
];

function setup() {
  const characters = new CharacterModule(definitions, []);
  const baiye = instanceId("instance.character.baiye_employment");
  const otto = instanceId("instance.character.otto_employment");
  const worker = instanceId("instance.character.worker_employment");
  characters.createCharacter("create-baiye", { instanceId: baiye, definitionId: "character.baiyecheng", coreMember: true, occurredAtUtcMs: 0 });
  characters.createCharacter("create-otto", { instanceId: otto, definitionId: "character.otto", coreMember: true, occurredAtUtcMs: 0 });
  characters.createCharacter("create-worker", { instanceId: worker, definitionId: "character.worker", coreMember: false, occurredAtUtcMs: 0 });
  const employment = new EmploymentModule(characters);
  return { characters, employment, baiye, otto, worker };
}

describe("EmploymentModule", () => {
  it("supports multiple learned jobs while only the primary job affects task weighting", () => {
    const target = setup();
    target.employment.addEmployee("employ-otto", {
      characterId: target.otto,
      kind: "core",
      learnedJobIds: ["job.waiter", "job.local_procurer"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    expect(target.employment.isPrimaryJob(target.otto, "job.waiter")).toBe(true);
    expect(target.employment.getRecord(target.otto)?.learnedJobIds).toEqual(["job.waiter", "job.local_procurer"]);
    expect(target.employment.setPrimaryJob("switch", target.otto, "job.local_procurer", 2)).toMatchObject({ accepted: true });
    expect(target.employment.setPrimaryJob("unknown-skill", target.otto, "job.chef", 3)).toMatchObject({ accepted: false, code: "JOB_NOT_LEARNED" });
  });

  it("derives employee only during the shift and permits a customer visit outside it", () => {
    const target = setup();
    target.employment.addEmployee("employ-worker", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.waiter"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 540, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    expect(target.employment.getWorkContext(target.worker, {
      minuteOfDay: 600,
      customerVisitActive: true,
      voyageActive: false,
    }).tags).toEqual(["customer"]);
    expect(target.employment.getWorkContext(target.worker, {
      minuteOfDay: 1_100,
      customerVisitActive: true,
      voyageActive: false,
    }).tags).toEqual(["customer"]);
  });

  it("supports one continuous overnight shift", () => {
    const target = setup();
    target.employment.addEmployee("employ-night", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.repairer"],
      primaryJobId: "job.repairer",
      dailyShift: { startMinuteInclusive: 1_200, endMinuteExclusive: 240 },
      occurredAtUtcMs: 1,
    });
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 60, customerVisitActive: false, voyageActive: false }).onShift).toBe(true);
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 600, customerVisitActive: false, voyageActive: false }).onShift).toBe(false);
  });

  it("makes a captain eligible outside restaurant shifts and immediately reusable after a voyage", () => {
    const target = setup();
    target.employment.addEmployee("employ-captain", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.captain"],
      primaryJobId: "job.captain",
      dailyShift: null,
      occurredAtUtcMs: 1,
    });
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 600, customerVisitActive: false, voyageActive: false }).tags).toContain("captain-qualified");
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 600, customerVisitActive: false, voyageActive: true }).tags).not.toContain("captain-qualified");
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 601, customerVisitActive: false, voyageActive: false }).tags).toContain("captain-qualified");
  });

  it("protects core members and defers recruited dismissal until current work completes", () => {
    const target = setup();
    target.employment.addEmployee("employ-core", {
      characterId: target.baiye,
      kind: "core",
      learnedJobIds: ["job.chef"],
      primaryJobId: "job.chef",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    target.employment.addEmployee("employ-worker", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.waiter"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    expect(target.employment.requestDismissal("dismiss-core", target.baiye, false, 2)).toMatchObject({ accepted: false, code: "CORE_MEMBER_CANNOT_BE_DISMISSED" });
    expect(target.employment.requestDismissal("dismiss-worker", target.worker, true, 2)).toMatchObject({ accepted: true, value: { pending: true } });
    expect(target.employment.getWorkContext(target.worker, { minuteOfDay: 600, customerVisitActive: false, voyageActive: false }).acceptingNewWork).toBe(false);
    expect(target.employment.completePendingDismissal("dismiss-complete", target.worker, 3)).toMatchObject({ accepted: true });
    expect(target.employment.getRecord(target.worker)).toBeNull();
  });

  it("restores schedules and rolls roster changes back transactionally", () => {
    const target = setup();
    target.employment.addEmployee("employ", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.waiter"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    const transaction = new TransactionScope(new DomainEventBus());
    expect(() => transaction.run([target.employment], () => {
      target.employment.setDailyShift("shift-change", target.worker, { startMinuteInclusive: 0, endMinuteExclusive: 120 }, 2);
      throw new Error("abort");
    })).toThrow("abort");
    expect(target.employment.getRecord(target.worker)?.dailyShift).toEqual({ startMinuteInclusive: 480, endMinuteExclusive: 1_020 });
    const restored = new EmploymentModule(target.characters, undefined, target.employment.exportState());
    expect(restored.createReadModel(600).employees[0]).toMatchObject({ name: "普通员工", onShift: true, tags: ["employee"] });
  });
  it("rejects employment save records with a missing shift field", () => {
    const target = setup();
    target.employment.addEmployee("employ-for-validation", {
      characterId: target.worker,
      kind: "recruited",
      learnedJobIds: ["job.waiter"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    });
    const state = target.employment.exportState();
    expect(isEmploymentState(state)).toBe(true);
    const { dailyShift: _omitted, ...recordWithoutShift } = state.records[0]!;
    expect(isEmploymentState({ ...state, records: [recordWithoutShift] })).toBe(false);
  });
});
