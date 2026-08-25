import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  EmploymentModule,
  TaskModule,
  instanceId,
  projectCharacterTaskCandidate,
} from "../src";

describe("character task candidate projection", () => {
  it("allows an on-shift employee task and blocks the same character while visiting off shift", () => {
    const characterId = instanceId("instance.character.otto_candidate");
    const characters = new CharacterModule([{
      id: "character.otto",
      name: "奥托",
      baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
      defaultTalentIds: [],
    }], []);
    characters.createCharacter("create", { instanceId: characterId, definitionId: "character.otto", coreMember: true, occurredAtUtcMs: 0 });
    const employment = new EmploymentModule(characters);
    employment.addEmployee("employ", {
      characterId,
      kind: "core",
      learnedJobIds: ["job.waiter", "job.local_procurer"],
      primaryJobId: "job.waiter",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 0,
    });
    const tasks = new TaskModule();
    const created = tasks.createTask("create-task", {
      taskId: "task.service.otto",
      taskType: "service.take-order",
      source: { type: "table", id: "table.one" },
      target: { type: "table", id: "table.one" },
      basePriority: 100,
      requiredTags: ["employee"],
      eligibleJobIds: ["job.waiter"],
      requiredSkills: [{ skill: "charm", minimumLevel: 2 }],
      urgency: 0,
      urgent: false,
      interruptible: true,
      createdAtUtcMs: 0,
    });
    if (!created.accepted) throw new Error(created.message);
    const character = characters.createReadModel().characters[0]!;
    const onShift = projectCharacterTaskCandidate(character, employment.getWorkContext(characterId, {
      minuteOfDay: 600,
      customerVisitActive: false,
      voyageActive: false,
    }));
    const offShiftCustomer = projectCharacterTaskCandidate(character, employment.getWorkContext(characterId, {
      minuteOfDay: 1_100,
      customerVisitActive: true,
      voyageActive: false,
    }));
    expect(tasks.isEligible(created.value, onShift)).toBe(true);
    expect(offShiftCustomer.tags).toEqual(["customer"]);
    expect(tasks.isEligible(created.value, offShiftCustomer)).toBe(false);
  });
});
