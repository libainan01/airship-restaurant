import { describe, expect, it } from "vitest";
import { TaskModule, instanceId, type TaskCandidate, type TaskRequest } from "../src";

const skills = { cooking: 3, charm: 3, movement: 1, repair: 1, piloting: 1 } as const;

function task(taskId: string, jobId: string, skill: "cooking" | "charm"): TaskRequest {
  return {
    taskId,
    taskType: taskId,
    source: { type: "source", id: "source.test" },
    target: { type: "target", id: "target.test" },
    basePriority: 1,
    requiredTags: ["employee"],
    eligibleJobIds: [jobId],
    requiredSkills: [{ skill, minimumLevel: 1 }],
    urgency: 0,
    urgent: false,
    interruptible: true,
    createdAtUtcMs: 0,
  };
}

function candidate(id: string, jobId: string): TaskCandidate {
  return {
    characterId: instanceId(id),
    available: true,
    tags: ["employee"],
    learnedJobIds: [jobId],
    primaryJobId: jobId,
    skills,
  };
}

describe("task role eligibility", () => {
  it("keeps waiter and chef tasks separated by learned job after the employee tag check", () => {
    const tasks = new TaskModule();
    const service = tasks.createTask("create-service", task("task.service", "job.waiter", "charm"));
    const cooking = tasks.createTask("create-cooking", task("task.cooking", "job.chef", "cooking"));
    if (!service.accepted || !cooking.accepted) throw new Error("Task setup failed.");
    const waiter = candidate("instance.character.waiter_role", "job.waiter");
    const chef = candidate("instance.character.chef_role", "job.chef");
    expect(tasks.isEligible(service.value, waiter)).toBe(true);
    expect(tasks.isEligible(cooking.value, waiter)).toBe(false);
    expect(tasks.isEligible(cooking.value, chef)).toBe(true);
    expect(tasks.isEligible(service.value, chef)).toBe(false);
  });
});
