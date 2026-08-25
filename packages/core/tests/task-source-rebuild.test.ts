import { describe, expect, it } from "vitest";
import {
  TaskModule,
  createStableTaskKey,
  exportTaskPersistenceState,
  instanceId,
  restoreTaskModuleFromSources,
  type TaskCandidate,
  type TaskRequest,
} from "../src";

const characterId = instanceId("instance.character.restore_task");
const candidate: TaskCandidate = {
  characterId,
  available: true,
  tags: ["employee"],
  learnedJobIds: ["job.waiter"],
  primaryJobId: "job.waiter",
  skills: { cooking: 1, charm: 2, movement: 1, repair: 1, piloting: 1 },
};

function request(discriminator: string): TaskRequest {
  return {
    taskId: createStableTaskKey({
      sourceType: "table",
      sourceId: "table.one",
      taskType: "service.take-order",
      targetType: "table",
      targetId: "table.one",
      discriminator,
    }),
    taskType: "service.take-order",
    source: { type: "table", id: "table.one" },
    target: { type: "table", id: "table.one" },
    basePriority: 100,
    requiredTags: ["employee"],
    eligibleJobIds: ["job.waiter"],
    requiredSkills: [],
    urgency: 0,
    urgent: false,
    interruptible: true,
    createdAtUtcMs: 10,
  };
}

describe("task source reconstruction", () => {
  it("creates deterministic distinct keys from authoritative business stages", () => {
    expect(request("visit-1").taskId).toBe(request("visit-1").taskId);
    expect(request("visit-1").taskId).not.toBe(request("visit-2").taskId);
  });

  it("persists no waiting queue, priority cache, candidate, or execution binding", () => {
    const tasks = new TaskModule();
    const waiting = request("waiting");
    const active = request("active");
    tasks.createTask("create-waiting", waiting);
    tasks.createTask("create-active", active);
    tasks.claimTask("claim-active", active.taskId, candidate, 20);
    const persisted = exportTaskPersistenceState(tasks);
    expect(Object.keys(persisted).sort()).toEqual([
      "moduleRevision",
      "processedOperationIds",
      "schemaVersion",
    ]);
  });

  it("rebuilds waiting tasks and active bindings from their authoritative sources", () => {
    const waiting = request("waiting");
    const active = request("active");
    const restored = restoreTaskModuleFromSources({
      persistence: null,
      sources: [{
        sourceId: "source.tables",
        sourceRevision: 4,
        waitingTasks: [waiting],
        activeTasks: [{ request: active, assignedCharacterId: characterId, claimedAtUtcMs: 20 }],
      }],
    });
    expect(restored.rebuiltWaitingTaskIds).toEqual([waiting.taskId]);
    expect(restored.rebuiltActiveTaskIds).toEqual([active.taskId]);
    expect(restored.module.createReadModel()).toMatchObject({
      inProgress: [{ taskId: active.taskId, assignedCharacterId: characterId }],
      waiting: [{ taskId: waiting.taskId }],
    });
    expect(restored.module.claimTask("claim-another", waiting.taskId, candidate, 30)).toMatchObject({
      accepted: false,
      code: "CHARACTER_BUSY",
    });
  });

  it("removes completed work after the source advances and stops projecting it", () => {
    const active = request("completed");
    const first = restoreTaskModuleFromSources({
      persistence: null,
      sources: [{
        sourceId: "source.tables",
        sourceRevision: 5,
        waitingTasks: [],
        activeTasks: [{ request: active, assignedCharacterId: characterId, claimedAtUtcMs: 20 }],
      }],
    }).module;
    expect(first.completeTask("complete", active.taskId, characterId, { served: true }, 30)).toMatchObject({
      accepted: true,
    });
    const restored = restoreTaskModuleFromSources({
      persistence: exportTaskPersistenceState(first),
      sources: [{
        sourceId: "source.tables",
        sourceRevision: 6,
        waitingTasks: [],
        activeTasks: [],
      }],
    });
    expect(restored.module.exportState().tasks).toHaveLength(0);
  });

  it("drops an old waiting task when the authoritative source no longer requests it", () => {
    const before = new TaskModule();
    before.createTask("create-old", request("old-waiting"));
    const restored = restoreTaskModuleFromSources({
      persistence: exportTaskPersistenceState(before),
      sources: [{
        sourceId: "source.tables",
        sourceRevision: 7,
        waitingTasks: [],
        activeTasks: [],
      }],
    });
    expect(restored.module.exportState().tasks).toHaveLength(0);
  });

  it("rejects duplicate stable keys across waiting and active source projections", () => {
    const duplicate = request("duplicate");
    expect(() => restoreTaskModuleFromSources({
      persistence: null,
      sources: [
        {
          sourceId: "source.one",
          sourceRevision: 1,
          waitingTasks: [duplicate],
          activeTasks: [],
        },
        {
          sourceId: "source.two",
          sourceRevision: 1,
          waitingTasks: [],
          activeTasks: [{ request: duplicate, assignedCharacterId: characterId, claimedAtUtcMs: 2 }],
        },
      ],
    })).toThrow("Duplicate stable task key");
  });
});