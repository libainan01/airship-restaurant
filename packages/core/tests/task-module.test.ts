import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  TaskModule,
  TransactionScope,
  instanceId,
  type TaskCandidate,
  type TaskRequest,
} from "../src";

const waiter = instanceId("instance.character.waiter_task");
const chef = instanceId("instance.character.chef_task");

function candidate(overrides: Partial<TaskCandidate> = {}): TaskCandidate {
  return {
    characterId: waiter,
    available: true,
    tags: ["employee"],
    learnedJobIds: ["job.waiter", "job.local_procurer"],
    primaryJobId: "job.waiter",
    skills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
    ...overrides,
  };
}

function request(taskId: string, overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    taskId,
    taskType: "service.deliver-meal",
    source: { type: "order", id: "order.demo" },
    target: { type: "table", id: "table.one" },
    basePriority: 100,
    requiredTags: ["employee"],
    eligibleJobIds: ["job.waiter"],
    requiredSkills: [{ skill: "charm", minimumLevel: 1 }],
    urgency: 0,
    urgent: false,
    interruptible: true,
    createdAtUtcMs: 0,
    ...overrides,
  };
}

function add(tasks: TaskModule, task: TaskRequest) {
  const result = tasks.createTask(`create:${task.taskId}`, task);
  if (!result.accepted) throw new Error(result.message);
  return result.value;
}

describe("TaskModule", () => {
  it("hard-filters tags, learned jobs, skills and availability before scoring", () => {
    const tasks = new TaskModule();
    const task = add(tasks, request("task.service.one"));
    expect(tasks.isEligible(task, candidate())).toBe(true);
    expect(tasks.isEligible(task, candidate({ tags: ["customer"] }))).toBe(false);
    expect(tasks.isEligible(task, candidate({ learnedJobIds: ["job.chef"], primaryJobId: "job.chef" }))).toBe(false);
    expect(tasks.isEligible(task, candidate({ skills: { cooking: 1, charm: 0, movement: 2, repair: 1, piloting: 1 } }))).toBe(false);
    expect(tasks.isEligible(task, candidate({ available: false }))).toBe(false);
  });

  it("keeps secondary jobs eligible but gives the primary job a clear priority bonus", () => {
    const tasks = new TaskModule();
    add(tasks, request("task.service.primary", { basePriority: 80 }));
    add(tasks, request("task.procurement.secondary", {
      taskType: "procurement.local",
      basePriority: 150,
      eligibleJobIds: ["job.local_procurer"],
    }));
    expect(tasks.rankWaitingTasks(candidate(), 0).map((entry) => entry.task.taskId)).toEqual([
      "task.service.primary",
      "task.procurement.secondary",
    ]);
  });

  it("raises waiting work over time and uses stable oldest/id ordering for ties", () => {
    const tasks = new TaskModule({
      primaryJobBonus: 0,
      waitingPerMinute: 10,
      maximumWaitingBonus: 300,
      urgencyMultiplier: 0,
      distanceCostMultiplier: 1,
    });
    add(tasks, request("task.old", { basePriority: 10, createdAtUtcMs: 0 }));
    add(tasks, request("task.new", { basePriority: 100, createdAtUtcMs: 10 * 60_000 }));
    expect(tasks.rankWaitingTasks(candidate(), 20 * 60_000)[0]?.task.taskId).toBe("task.old");
  });

  it("locks both a task and a character when work is claimed", () => {
    const tasks = new TaskModule();
    add(tasks, request("task.one"));
    add(tasks, request("task.two"));
    expect(tasks.claimTask("claim-one", "task.one", candidate(), 1)).toMatchObject({ accepted: true });
    expect(tasks.claimTask("claim-same", "task.one", candidate({ characterId: chef }), 2)).toMatchObject({ accepted: false, code: "TASK_NOT_WAITING" });
    expect(tasks.claimTask("claim-other", "task.two", candidate(), 2)).toMatchObject({ accepted: false, code: "CHARACTER_BUSY" });
  });

  it("only auto-preempts an interruptible task for a strictly higher urgent task", () => {
    const tasks = new TaskModule();
    add(tasks, request("task.current", { basePriority: 100, interruptible: true }));
    tasks.claimTask("claim-current", "task.current", candidate(), 1);
    add(tasks, request("task.routine", { basePriority: 1_000, urgent: false }));
    expect(tasks.tryAutoPreempt("routine-preempt", candidate({ available: false }), 2)).toMatchObject({ accepted: false, code: "PREEMPTION_NOT_ALLOWED" });
    add(tasks, request("task.emergency", { basePriority: 500, urgency: 10, urgent: true }));
    const preempted = tasks.tryAutoPreempt("urgent-preempt", candidate({ available: false }), 3);
    expect(preempted).toMatchObject({ accepted: true, value: { task: { taskId: "task.emergency", status: "in-progress" } } });
    expect(tasks.getTask("task.current")).toMatchObject({ status: "interrupted", result: { interruptedByTaskId: "task.emergency" } });
    if (preempted.accepted) expect(preempted.events.map((event) => event.type)).toEqual(["task.interrupted", "task.claimed"]);
  });

  it("broadcasts complete, fail, cancel and interrupt lifecycle facts with business references", () => {
    const tasks = new TaskModule();
    add(tasks, request("task.complete"));
    tasks.claimTask("claim-complete", "task.complete", candidate(), 1);
    const completed = tasks.completeTask("complete", "task.complete", waiter, { quality: 4 }, 2);
    expect(completed).toMatchObject({
      accepted: true,
      events: [{
        type: "task.completed",
        payload: {
          taskId: "task.complete",
          taskType: "service.deliver-meal",
          characterId: waiter,
          source: { type: "order", id: "order.demo" },
          target: { type: "table", id: "table.one" },
          finishedAtUtcMs: 2,
          result: { quality: 4 },
        },
      }],
    });
    expect(tasks.completeTask("complete", "task.complete", waiter, { quality: 4 }, 2)).toMatchObject({ accepted: false, code: "DUPLICATE_OPERATION" });

    add(tasks, request("task.cancel"));
    expect(tasks.cancelTask("cancel", "task.cancel", "source-invalidated", 3)).toMatchObject({ accepted: true, events: [{ type: "task.cancelled" }] });
    add(tasks, request("task.fail"));
    tasks.claimTask("claim-fail", "task.fail", candidate(), 4);
    expect(tasks.failTask("fail", "task.fail", waiter, "unreachable", 5)).toMatchObject({ accepted: true, events: [{ type: "task.failed" }] });
  });

  it("restores state and rolls lifecycle changes back transactionally", () => {
    const tasks = new TaskModule();
    add(tasks, request("task.rollback"));
    tasks.claimTask("claim", "task.rollback", candidate(), 1);
    const scope = new TransactionScope(new DomainEventBus());
    expect(() => scope.run([tasks], () => {
      tasks.completeTask("finish-in-tx", "task.rollback", waiter, { done: true }, 2);
      throw new Error("abort");
    })).toThrow("abort");
    expect(tasks.getTask("task.rollback")?.status).toBe("in-progress");
    const restored = new TaskModule(undefined, tasks.exportState());
    expect(restored.getTask("task.rollback")).toMatchObject({ status: "in-progress", assignedCharacterId: waiter });
  });
});
