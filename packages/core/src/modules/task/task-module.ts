import type {
  DomainEvent,
  InstanceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { isInstanceId } from "../../kernel";
import type { CharacterSkillKey } from "../character";
import type { DomainModule } from "../domain-module";

export const TASK_MODULE_ID = "module.task";
export const TASK_SCHEMA_VERSION = 1;

export type TaskStatus = "waiting" | "in-progress" | "completed" | "failed" | "cancelled" | "interrupted";
export type TaskTerminalStatus = Extract<TaskStatus, "completed" | "failed" | "cancelled" | "interrupted">;
export type TaskResultValue = string | number | boolean | null;

export interface TaskObjectReference {
  readonly type: string;
  readonly id: string;
}

export interface TaskSkillRequirement {
  readonly skill: CharacterSkillKey;
  readonly minimumLevel: number;
}

export interface TaskRequest {
  readonly taskId: string;
  readonly taskType: string;
  readonly source: TaskObjectReference;
  readonly target: TaskObjectReference;
  readonly basePriority: number;
  readonly requiredTags: readonly string[];
  /** At least one of these jobs is required; an empty list means no job restriction. */
  readonly eligibleJobIds: readonly string[];
  readonly requiredSkills: readonly TaskSkillRequirement[];
  readonly urgency: number;
  readonly urgent: boolean;
  readonly interruptible: boolean;
  readonly createdAtUtcMs: number;
}

export interface TaskState extends TaskRequest {
  readonly status: TaskStatus;
  readonly assignedCharacterId: InstanceId | null;
  readonly claimedAtUtcMs: number | null;
  readonly finishedAtUtcMs: number | null;
  readonly result: Readonly<Record<string, TaskResultValue>>;
}

export interface TaskModuleState {
  readonly schemaVersion: typeof TASK_SCHEMA_VERSION;
  readonly revision: number;
  readonly tasks: readonly TaskState[];
  readonly processedOperationIds: readonly string[];
}

export interface TaskCandidate {
  readonly characterId: InstanceId;
  readonly available: boolean;
  readonly tags: readonly string[];
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string | null;
  readonly skills: Readonly<Record<CharacterSkillKey, number>>;
}

export interface TaskPriorityWeights {
  readonly primaryJobBonus: number;
  readonly waitingPerMinute: number;
  readonly maximumWaitingBonus: number;
  readonly urgencyMultiplier: number;
  readonly distanceCostMultiplier: number;
}

export const DEFAULT_TASK_PRIORITY_WEIGHTS: TaskPriorityWeights = Object.freeze({
  primaryJobBonus: 100,
  waitingPerMinute: 1,
  maximumWaitingBonus: 240,
  urgencyMultiplier: 10,
  distanceCostMultiplier: 1,
});

export interface RankedTask {
  readonly task: TaskState;
  readonly score: number;
  readonly primaryJobMatched: boolean;
  readonly waitingBonus: number;
  readonly distanceCost: number;
}

export interface TaskReadModel {
  readonly revision: number;
  readonly waiting: readonly TaskState[];
  readonly inProgress: readonly TaskState[];
  readonly recentTerminal: readonly TaskState[];
}

export type TaskRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_TASK"
  | "UNKNOWN_TASK"
  | "TASK_NOT_WAITING"
  | "TASK_NOT_IN_PROGRESS"
  | "CHARACTER_BUSY"
  | "CHARACTER_NOT_ELIGIBLE"
  | "TASK_NOT_INTERRUPTIBLE"
  | "NO_ELIGIBLE_TASK"
  | "PREEMPTION_NOT_ALLOWED";

export type TaskOperationResult<TValue = undefined> =
  | { readonly accepted: true; readonly changed: true; readonly operationId: string; readonly value: TValue; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly operationId: string; readonly code: TaskRejectionCode; readonly message: string; readonly events: readonly [] };

const OPERATION_HISTORY_LIMIT = 2_048;
const TERMINAL_READ_MODEL_LIMIT = 100;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const finiteNumber = (value: number): boolean => Number.isFinite(value);

function freezeReference(reference: TaskObjectReference): TaskObjectReference {
  return Object.freeze({ ...reference });
}

function freezeTask(task: TaskState): TaskState {
  return Object.freeze({
    ...task,
    source: freezeReference(task.source),
    target: freezeReference(task.target),
    requiredTags: Object.freeze([...task.requiredTags]),
    eligibleJobIds: Object.freeze([...task.eligibleJobIds]),
    requiredSkills: Object.freeze(task.requiredSkills.map((requirement) => Object.freeze({ ...requirement }))),
    result: Object.freeze({ ...task.result }),
  });
}

function cloneState(state: TaskModuleState): TaskModuleState {
  return Object.freeze({
    ...state,
    tasks: Object.freeze(state.tasks.map(freezeTask)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function validStringSet(values: readonly string[]): boolean {
  return values.every(validId) && new Set(values).size === values.length;
}

function validResult(result: Readonly<Record<string, TaskResultValue>>): boolean {
  return Object.entries(result).every(([key, value]) => validId(key) &&
    (value === null || typeof value === "string" || typeof value === "boolean" || finiteNumber(value)));
}

export class TaskModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = TASK_MODULE_ID;
  readonly transactionParticipantId = TASK_MODULE_ID;
  readonly #weights: TaskPriorityWeights;
  #state: TaskModuleState;
  #transactionActive = false;

  constructor(weights: TaskPriorityWeights = DEFAULT_TASK_PRIORITY_WEIGHTS, initialState?: TaskModuleState) {
    if (Object.values(weights).some((value) => !finiteNumber(value) || value < 0)) {
      throw new RangeError("Task priority weights must be finite non-negative numbers.");
    }
    this.#weights = Object.freeze({ ...weights });
    this.#state = initialState === undefined
      ? cloneState({ schemaVersion: TASK_SCHEMA_VERSION, revision: 0, tasks: [], processedOperationIds: [] })
      : cloneState(initialState);
    this.#validateState();
  }

  exportState(): TaskModuleState { return cloneState(this.#state); }
  getTask(taskId: string): TaskState | null { return this.#state.tasks.find((task) => task.taskId === taskId) ?? null; }

  createReadModel(): TaskReadModel {
    const terminal = this.#state.tasks.filter((task) => task.status !== "waiting" && task.status !== "in-progress");
    return Object.freeze({
      revision: this.#state.revision,
      waiting: Object.freeze(this.#state.tasks.filter((task) => task.status === "waiting")),
      inProgress: Object.freeze(this.#state.tasks.filter((task) => task.status === "in-progress")),
      recentTerminal: Object.freeze(terminal.slice(-TERMINAL_READ_MODEL_LIMIT)),
    });
  }

  createTask(operationId: string, request: TaskRequest): TaskOperationResult<TaskState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    if (!this.#validRequest(request)) return this.#reject(operationId, "INVALID_REQUEST", "Task request is invalid.");
    if (this.getTask(request.taskId) !== null) return this.#reject(operationId, "DUPLICATE_TASK", `Task already exists: ${request.taskId}`);
    const task = freezeTask({ ...request, status: "waiting", assignedCharacterId: null, claimedAtUtcMs: null, finishedAtUtcMs: null, result: {} });
    this.#replace({ tasks: [...this.#state.tasks, task] });
    return this.#accept(operationId, task, [this.#event(operationId, "task.created", request.createdAtUtcMs, this.#lifecyclePayload(task))]);
  }

  isEligible(task: TaskState, candidate: TaskCandidate): boolean {
    return candidate.available && task.status === "waiting" &&
      task.requiredTags.every((tag) => candidate.tags.includes(tag)) &&
      (task.eligibleJobIds.length === 0 || task.eligibleJobIds.some((jobId) => candidate.learnedJobIds.includes(jobId))) &&
      task.requiredSkills.every((requirement) => candidate.skills[requirement.skill] >= requirement.minimumLevel);
  }

  calculatePriority(task: TaskState, candidate: TaskCandidate, nowUtcMs: number, distanceCost: number): RankedTask {
    if (!nonNegativeInteger(nowUtcMs) || !finiteNumber(distanceCost) || distanceCost < 0) throw new RangeError("Task scoring inputs are invalid.");
    const waitedMinutes = Math.max(0, Math.floor((nowUtcMs - task.createdAtUtcMs) / 60_000));
    const waitingBonus = Math.min(this.#weights.maximumWaitingBonus, waitedMinutes * this.#weights.waitingPerMinute);
    const primaryJobMatched = candidate.primaryJobId !== null && task.eligibleJobIds.includes(candidate.primaryJobId);
    const score = task.basePriority +
      (primaryJobMatched ? this.#weights.primaryJobBonus : 0) +
      waitingBonus + task.urgency * this.#weights.urgencyMultiplier -
      distanceCost * this.#weights.distanceCostMultiplier;
    return Object.freeze({ task, score, primaryJobMatched, waitingBonus, distanceCost });
  }

  rankWaitingTasks(candidate: TaskCandidate, nowUtcMs: number, distanceCosts: ReadonlyMap<string, number> = new Map()): readonly RankedTask[] {
    return Object.freeze(this.#state.tasks
      .filter((task) => this.isEligible(task, candidate))
      .map((task) => this.calculatePriority(task, candidate, nowUtcMs, distanceCosts.get(task.taskId) ?? 0))
      .sort((left, right) => right.score - left.score || left.task.createdAtUtcMs - right.task.createdAtUtcMs || left.task.taskId.localeCompare(right.task.taskId)));
  }

  claimTask(operationId: string, taskId: string, candidate: TaskCandidate, claimedAtUtcMs: number, distanceCost = 0): TaskOperationResult<RankedTask> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const task = this.getTask(taskId);
    if (task === null) return this.#reject(operationId, "UNKNOWN_TASK", `Unknown task: ${taskId}`);
    if (task.status !== "waiting") return this.#reject(operationId, "TASK_NOT_WAITING", `Task is not waiting: ${taskId}`);
    if (this.#activeTaskFor(candidate.characterId) !== null) return this.#reject(operationId, "CHARACTER_BUSY", `Character already owns an active task: ${candidate.characterId}`);
    if (!this.isEligible(task, candidate)) return this.#reject(operationId, "CHARACTER_NOT_ELIGIBLE", "Character does not satisfy task requirements.");
    const ranked = this.calculatePriority(task, candidate, claimedAtUtcMs, distanceCost);
    const updated = freezeTask({ ...task, status: "in-progress", assignedCharacterId: candidate.characterId, claimedAtUtcMs });
    this.#replaceTask(updated);
    return this.#accept(operationId, Object.freeze({ ...ranked, task: updated }), [this.#event(operationId, "task.claimed", claimedAtUtcMs, this.#lifecyclePayload(updated))]);
  }

  claimBestTask(operationId: string, candidate: TaskCandidate, claimedAtUtcMs: number, distanceCosts: ReadonlyMap<string, number> = new Map()): TaskOperationResult<RankedTask> {
    if (this.#activeTaskFor(candidate.characterId) !== null) return this.#reject(operationId, "CHARACTER_BUSY", `Character already owns an active task: ${candidate.characterId}`);
    const best = this.rankWaitingTasks(candidate, claimedAtUtcMs, distanceCosts)[0];
    if (best === undefined) return this.#reject(operationId, "NO_ELIGIBLE_TASK", "No eligible waiting task exists.");
    return this.claimTask(operationId, best.task.taskId, candidate, claimedAtUtcMs, best.distanceCost);
  }

releaseClaim(
    operationId: string,
    taskId: string,
    characterId: InstanceId,
    reason: string,
    occurredAtUtcMs: number,
  ): TaskOperationResult<TaskState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const task = this.getTask(taskId);
    if (task === null) return this.#reject(operationId, "UNKNOWN_TASK", `Unknown task: ${taskId}`);
    if (task.status !== "in-progress" || task.assignedCharacterId !== characterId) {
      return this.#reject(operationId, "TASK_NOT_IN_PROGRESS", "Task is not assigned to this character.");
    }
    if (!task.interruptible) {
      return this.#reject(operationId, "TASK_NOT_INTERRUPTIBLE", "A non-interruptible task cannot return to waiting.");
    }
    if (!validId(reason) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Task claim release request is invalid.");
    }
    const updated = freezeTask({
      ...task,
      status: "waiting",
      assignedCharacterId: null,
      claimedAtUtcMs: null,
      finishedAtUtcMs: null,
      result: {},
    });
    this.#replaceTask(updated);
    return this.#accept(operationId, updated, [this.#event(
      operationId,
      "task.claim-released",
      occurredAtUtcMs,
      { ...this.#lifecyclePayload(updated), previousCharacterId: characterId, reason },
    )]);
  }

  setTaskInterruptible(
    operationId: string,
    taskId: string,
    characterId: InstanceId,
    interruptible: boolean,
    occurredAtUtcMs: number,
  ): TaskOperationResult<TaskState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const task = this.getTask(taskId);
    if (task === null) return this.#reject(operationId, "UNKNOWN_TASK", `Unknown task: ${taskId}`);
    if (task.status !== "in-progress" || task.assignedCharacterId !== characterId) {
      return this.#reject(operationId, "TASK_NOT_IN_PROGRESS", "Task is not assigned to this character.");
    }
    if (typeof interruptible !== "boolean" || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Task interruptibility request is invalid.");
    }
    const updated = freezeTask({ ...task, interruptible });
    this.#replaceTask(updated);
    return this.#accept(operationId, updated, [this.#event(
      operationId,
      "task.interruptibility-changed",
      occurredAtUtcMs,
      { ...this.#lifecyclePayload(updated), interruptible },
    )]);
  }

  tryAutoPreempt(operationId: string, candidate: TaskCandidate, occurredAtUtcMs: number, distanceCosts: ReadonlyMap<string, number> = new Map()): TaskOperationResult<RankedTask> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const current = this.#activeTaskFor(candidate.characterId);
    if (current === null) return this.#reject(operationId, "PREEMPTION_NOT_ALLOWED", "Character has no active task to preempt.");
    const best = this.rankWaitingTasks({ ...candidate, available: true }, occurredAtUtcMs, distanceCosts).find((ranked) => ranked.task.urgent);
    if (best === undefined || !current.interruptible) return this.#reject(operationId, "PREEMPTION_NOT_ALLOWED", "No urgent task can interrupt the current task.");
    const currentScore = this.calculatePriority(current, candidate, current.claimedAtUtcMs!, distanceCosts.get(current.taskId) ?? 0).score;
    if (best.score <= currentScore) return this.#reject(operationId, "PREEMPTION_NOT_ALLOWED", "Urgent task priority does not exceed the current task.");
    const interrupted = freezeTask({ ...current, status: "interrupted", finishedAtUtcMs: occurredAtUtcMs, result: { reason: "automatic-urgent-preemption", interruptedByTaskId: best.task.taskId } });
    const claimed = freezeTask({ ...best.task, status: "in-progress", assignedCharacterId: candidate.characterId, claimedAtUtcMs: occurredAtUtcMs });
    this.#replaceTasks([interrupted, claimed]);
    const ranked = Object.freeze({ ...best, task: claimed });
    return this.#accept(operationId, ranked, [
      this.#event(operationId, "task.interrupted", occurredAtUtcMs, this.#lifecyclePayload(interrupted)),
      this.#event(operationId, "task.claimed", occurredAtUtcMs, this.#lifecyclePayload(claimed)),
    ]);
  }

  completeTask(operationId: string, taskId: string, characterId: InstanceId, result: Readonly<Record<string, TaskResultValue>>, occurredAtUtcMs: number): TaskOperationResult<TaskState> {
    return this.#finish(operationId, taskId, "completed", characterId, result, occurredAtUtcMs);
  }

  failTask(operationId: string, taskId: string, characterId: InstanceId, reason: string, occurredAtUtcMs: number): TaskOperationResult<TaskState> {
    return this.#finish(operationId, taskId, "failed", characterId, { reason }, occurredAtUtcMs);
  }

  interruptTask(operationId: string, taskId: string, characterId: InstanceId, source: string, occurredAtUtcMs: number): TaskOperationResult<TaskState> {
    const task = this.getTask(taskId);
    if (task !== null && !task.interruptible) return this.#reject(operationId, "TASK_NOT_INTERRUPTIBLE", `Task is not interruptible: ${taskId}`);
    return this.#finish(operationId, taskId, "interrupted", characterId, { source }, occurredAtUtcMs);
  }

  cancelTask(operationId: string, taskId: string, reason: string, occurredAtUtcMs: number): TaskOperationResult<TaskState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const task = this.getTask(taskId);
    if (task === null) return this.#reject(operationId, "UNKNOWN_TASK", `Unknown task: ${taskId}`);
    if (task.status !== "waiting") return this.#reject(operationId, "TASK_NOT_WAITING", "Only a waiting task can be cancelled by its source.");
    if (!validId(reason) || !nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Task cancellation is invalid.");
    const updated = freezeTask({ ...task, status: "cancelled", finishedAtUtcMs: occurredAtUtcMs, result: { reason } });
    this.#replaceTask(updated);
    return this.#accept(operationId, updated, [this.#event(operationId, "task.cancelled", occurredAtUtcMs, this.#lifecyclePayload(updated))]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Task transaction is already active.");
    this.#transactionActive = true; const checkpoint = this.exportState();
    return { validateTransaction: () => this.#validateState(), commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = cloneState(checkpoint); this.#transactionActive = false; } };
  }

  #finish(operationId: string, taskId: string, status: Exclude<TaskTerminalStatus, "cancelled">, characterId: InstanceId,
    result: Readonly<Record<string, TaskResultValue>>, occurredAtUtcMs: number): TaskOperationResult<TaskState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const task = this.getTask(taskId);
    if (task === null) return this.#reject(operationId, "UNKNOWN_TASK", `Unknown task: ${taskId}`);
    if (task.status !== "in-progress" || task.assignedCharacterId !== characterId) return this.#reject(operationId, "TASK_NOT_IN_PROGRESS", "Task is not assigned to this character.");
    if (!validResult(result) || !nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Task result is invalid.");
    const updated = freezeTask({ ...task, status, finishedAtUtcMs: occurredAtUtcMs, result });
    this.#replaceTask(updated);
    return this.#accept(operationId, updated, [this.#event(operationId, `task.${status}`, occurredAtUtcMs, this.#lifecyclePayload(updated))]);
  }

  #activeTaskFor(characterId: InstanceId): TaskState | null {
    return this.#state.tasks.find((task) => task.status === "in-progress" && task.assignedCharacterId === characterId) ?? null;
  }
  #replaceTask(task: TaskState): void { this.#replaceTasks([task]); }
  #replaceTasks(tasks: readonly TaskState[]): void {
    const replacements = new Map(tasks.map((task) => [task.taskId, task]));
    this.#replace({ tasks: this.#state.tasks.map((task) => replacements.get(task.taskId) ?? task) });
  }
  #prepare(operationId: string): TaskOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Task operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject(operationId, "DUPLICATE_OPERATION", "Task operation was already processed.");
    this.#state = cloneState({ ...this.#state, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT) }); return null;
  }
  #replace(update: Partial<TaskModuleState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #accept<TValue>(operationId: string, value: TValue, events: readonly DomainEvent[]): TaskOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value, events: Object.freeze([...events]) });
  }
  #reject(operationId: string, code: TaskRejectionCode, message: string): TaskOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: `${type}:${operationId}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #lifecyclePayload(task: TaskState): Readonly<Record<string, unknown>> {
    return Object.freeze({ taskId: task.taskId, taskType: task.taskType, characterId: task.assignedCharacterId, source: task.source, target: task.target,
      status: task.status, finishedAtUtcMs: task.finishedAtUtcMs, result: task.result });
  }
  #validRequest(request: TaskRequest): boolean {
    return validId(request.taskId) && validId(request.taskType) && validId(request.source.type) && validId(request.source.id) && validId(request.target.type) && validId(request.target.id) &&
      finiteNumber(request.basePriority) && validStringSet(request.requiredTags) && validStringSet(request.eligibleJobIds) &&
      request.requiredSkills.every((item) => Number.isSafeInteger(item.minimumLevel) && item.minimumLevel >= 1) &&
      new Set(request.requiredSkills.map((item) => item.skill)).size === request.requiredSkills.length &&
      finiteNumber(request.urgency) && request.urgency >= 0 && request.urgency <= 100 && typeof request.urgent === "boolean" && typeof request.interruptible === "boolean" && nonNegativeInteger(request.createdAtUtcMs);
  }
  #validateState(): void {
    if (this.#state.schemaVersion !== TASK_SCHEMA_VERSION || !nonNegativeInteger(this.#state.revision) || new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length) throw new Error("Task state metadata is invalid.");
    const taskIds = new Set<string>(); const activeCharacters = new Set<InstanceId>();
    for (const task of this.#state.tasks) {
      if (taskIds.has(task.taskId) || !this.#validRequest(task) || !validResult(task.result)) throw new Error(`Invalid task state: ${task.taskId}`);
      taskIds.add(task.taskId);
      if (task.status === "waiting" && (task.assignedCharacterId !== null || task.claimedAtUtcMs !== null || task.finishedAtUtcMs !== null)) throw new Error(`Waiting task has execution metadata: ${task.taskId}`);
      if (task.status === "in-progress") {
        if (!isInstanceId(task.assignedCharacterId) || task.claimedAtUtcMs === null || task.finishedAtUtcMs !== null || activeCharacters.has(task.assignedCharacterId)) throw new Error(`Invalid active task: ${task.taskId}`);
        activeCharacters.add(task.assignedCharacterId);
      }
      if (task.status !== "waiting" && task.status !== "in-progress" && task.finishedAtUtcMs === null) throw new Error(`Terminal task has no finish time: ${task.taskId}`);
    }
  }
}
