import type { InstanceId } from "../../kernel";
import type { TaskPriorityWeights, TaskRequest, TaskState } from "./task-module";
import { DEFAULT_TASK_PRIORITY_WEIGHTS, TASK_SCHEMA_VERSION, TaskModule, type TaskModuleState } from "./task-module";

export const TASK_PERSISTENCE_SCHEMA_VERSION = 1;

export interface StableTaskKeyParts {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly taskType: string;
  readonly targetType: string;
  readonly targetId: string;
  /** Stable business stage/item identity; never a random runtime sequence. */
  readonly discriminator: string;
}

/** Task owns no queue or execution binding in persistence. */
export interface TaskPersistenceState {
  readonly schemaVersion: typeof TASK_PERSISTENCE_SCHEMA_VERSION;
  readonly moduleRevision: number;
  readonly processedOperationIds: readonly string[];
}

export interface TaskExecutionProjection {
  readonly request: TaskRequest;
  readonly assignedCharacterId: InstanceId;
  readonly claimedAtUtcMs: number;
}

export interface TaskSourceSnapshot {
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly waitingTasks: readonly TaskRequest[];
  /** Execution binding is authoritative source state, not Task persistence. */
  readonly activeTasks: readonly TaskExecutionProjection[];
}

export interface TaskRestoreReport {
  readonly module: TaskModule;
  readonly rebuiltWaitingTaskIds: readonly string[];
  readonly rebuiltActiveTaskIds: readonly string[];
  readonly sourceRevisions: Readonly<Record<string, number>>;
}

const validPart = (value: string): boolean => value.trim().length > 0;

function encodePart(value: string): string {
  if (!validPart(value)) throw new TypeError("Stable task key parts must not be empty.");
  return encodeURIComponent(value);
}

export function createStableTaskKey(parts: StableTaskKeyParts): string {
  const key = ["task", parts.sourceType, parts.sourceId, parts.taskType, parts.targetType, parts.targetId, parts.discriminator]
    .map(encodePart)
    .join("|");
  if (key.length > 200) throw new RangeError("Stable task key exceeds the Task module id limit.");
  return key;
}

export function exportTaskPersistenceState(module: TaskModule): TaskPersistenceState {
  const state = module.exportState();
  return Object.freeze({
    schemaVersion: TASK_PERSISTENCE_SCHEMA_VERSION,
    moduleRevision: state.revision,
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function taskFromRequest(request: TaskRequest, execution: TaskExecutionProjection | null): TaskState {
  return Object.freeze({
    ...request,
    source: Object.freeze({ ...request.source }),
    target: Object.freeze({ ...request.target }),
    requiredTags: Object.freeze([...request.requiredTags]),
    eligibleJobIds: Object.freeze([...request.eligibleJobIds]),
    requiredSkills: Object.freeze(request.requiredSkills.map((item) => Object.freeze({ ...item }))),
    status: execution === null ? "waiting" : "in-progress",
    assignedCharacterId: execution?.assignedCharacterId ?? null,
    claimedAtUtcMs: execution?.claimedAtUtcMs ?? null,
    finishedAtUtcMs: null,
    result: Object.freeze({}),
  });
}

export function restoreTaskModuleFromSources(options: {
  readonly persistence: TaskPersistenceState | null;
  readonly sources: readonly TaskSourceSnapshot[];
  readonly weights?: TaskPriorityWeights;
}): TaskRestoreReport {
  const persistence = options.persistence ?? Object.freeze({
    schemaVersion: TASK_PERSISTENCE_SCHEMA_VERSION,
    moduleRevision: 0,
    processedOperationIds: [] as const,
  });
  if (persistence.schemaVersion !== TASK_PERSISTENCE_SCHEMA_VERSION ||
    !Number.isSafeInteger(persistence.moduleRevision) || persistence.moduleRevision < 0 ||
    new Set(persistence.processedOperationIds).size !== persistence.processedOperationIds.length) {
    throw new Error("Task persistence metadata is invalid.");
  }

  const sourceIds = new Set<string>();
  const taskIds = new Set<string>();
  const sourceRevisions: Record<string, number> = {};
  const waiting: TaskState[] = [];
  const active: TaskState[] = [];
  for (const source of options.sources) {
    if (!validPart(source.sourceId) || sourceIds.has(source.sourceId) ||
      !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0) {
      throw new Error(`Invalid or duplicate task source snapshot: ${source.sourceId}`);
    }
    sourceIds.add(source.sourceId);
    sourceRevisions[source.sourceId] = source.sourceRevision;
    for (const request of source.waitingTasks) {
      if (taskIds.has(request.taskId)) throw new Error(`Duplicate stable task key from task sources: ${request.taskId}`);
      taskIds.add(request.taskId);
      waiting.push(taskFromRequest(request, null));
    }
    for (const execution of source.activeTasks) {
      if (taskIds.has(execution.request.taskId)) throw new Error(`Duplicate stable task key from task sources: ${execution.request.taskId}`);
      taskIds.add(execution.request.taskId);
      active.push(taskFromRequest(execution.request, execution));
    }
  }

  const state: TaskModuleState = Object.freeze({
    schemaVersion: TASK_SCHEMA_VERSION,
    revision: persistence.moduleRevision + (waiting.length + active.length > 0 ? 1 : 0),
    tasks: Object.freeze([...active, ...waiting]),
    processedOperationIds: Object.freeze([...persistence.processedOperationIds]),
  });
  return Object.freeze({
    module: new TaskModule(options.weights ?? DEFAULT_TASK_PRIORITY_WEIGHTS, state),
    rebuiltWaitingTaskIds: Object.freeze(waiting.map((task) => task.taskId)),
    rebuiltActiveTaskIds: Object.freeze(active.map((task) => task.taskId)),
    sourceRevisions: Object.freeze(sourceRevisions),
  });
}
