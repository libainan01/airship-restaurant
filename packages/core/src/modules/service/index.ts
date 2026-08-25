import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { DomainEventBus, TransactionScope } from "../../kernel";
import type { CustomerModule } from "../customer";
import type { DomainModule } from "../domain-module";
import type { OrderLinePriceSnapshotRequest, OrderModule, OrderState, PendingOrderLineState } from "../order";
import type { TaskCandidate, TaskRequest, TaskResultValue } from "../task";
import { TaskModule, createStableTaskKey, type TaskSourceSnapshot } from "../task";

export const SERVICE_MODULE_ID = "module.service";
export const SERVICE_SCHEMA_VERSION = 1;

export type ServiceTaskKind = "reception" | "take-order" | "deliver-meal" | "checkout" | "clean-table" | "supply-plate";
export type ServiceWorkflowStage = "active" | "transmitting-order" | "external-handoff";

export interface ServiceWorkflowState {
  readonly taskId: string;
  readonly kind: ServiceTaskKind;
  readonly sourceId: string;
  readonly request: TaskRequest;
  readonly assignedCharacterId: InstanceId;
  readonly claimedAtUtcMs: number;
  readonly stage: ServiceWorkflowStage;
  readonly pendingOrderId: string | null;
  readonly recordedSubmission?: Omit<ServiceOrderSubmissionRequest, "occurredAtUtcMs"> | null;
}

export interface ServiceModuleState {
  readonly schemaVersion: typeof SERVICE_SCHEMA_VERSION;
  readonly revision: number;
  readonly workflows: readonly ServiceWorkflowState[];
  readonly receivedVisitIds: readonly string[];
  readonly processedOperationIds: readonly string[];
}

export interface ServiceMealPickupPort {
  isReadyAtGroundPickup(mealId: string): boolean;
}

export class StaticServiceMealPickup implements ServiceMealPickupPort {
  readonly #readyMealIds: ReadonlySet<string>;
  constructor(readyMealIds: readonly string[]) {
    if (readyMealIds.some((id) => !valid(id)) || new Set(readyMealIds).size !== readyMealIds.length) {
      throw new Error("Ground pickup meal ids are invalid.");
    }
    this.#readyMealIds = new Set(readyMealIds);
  }
  isReadyAtGroundPickup(mealId: string): boolean { return this.#readyMealIds.has(mealId); }
}

export interface ServiceDishwareSupplyNeed {
  readonly id: string;
  readonly plateId: InstanceId;
  readonly targetId: string;
  readonly sourceLocationId: string;
  readonly handoffLocationId: string;
  readonly orderBlocking: boolean;
  readonly createdAtUtcMs: number;
}

export interface ServiceDishwareSupplyPort {
  listSupplyNeeds(): readonly ServiceDishwareSupplyNeed[];
}

const NO_SERVICE_DISHWARE_SUPPLY: ServiceDishwareSupplyPort = Object.freeze({
  listSupplyNeeds: () => Object.freeze([]),
});

export interface ServiceOrderSubmissionRequest {
  readonly orderId: string;
  readonly linePrices: readonly OrderLinePriceSnapshotRequest[];
  readonly focusBonusRateBasisPoints?: number;
  readonly occurredAtUtcMs: number;
}

export type ServiceRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "UNKNOWN_TASK"
  | "INVALID_WORKFLOW"
  | "TASK_REJECTED"
  | "CUSTOMER_REJECTED"
  | "ORDER_REJECTED"
  | "SOURCE_STILL_ACTIVE";

export type ServiceOperationResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: ServiceRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 4_096;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const integer = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
function childOperationId(parent: string, action: string, discriminator = ""): string {
  let hash = 0x811c9dc5;
  const source = parent + "|" + discriminator;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
  }
  return "service:" + action + ":" + (hash >>> 0).toString(16).padStart(8, "0");
}
const cloneRequest = (value: TaskRequest): TaskRequest => Object.freeze({
  ...value,
  source: Object.freeze({ ...value.source }),
  target: Object.freeze({ ...value.target }),
  requiredTags: Object.freeze([...value.requiredTags]),
  eligibleJobIds: Object.freeze([...value.eligibleJobIds]),
  requiredSkills: Object.freeze(value.requiredSkills.map((entry) => Object.freeze({ ...entry }))),
});
const cloneSubmission = (value: Omit<ServiceOrderSubmissionRequest, "occurredAtUtcMs">): Omit<ServiceOrderSubmissionRequest, "occurredAtUtcMs"> => Object.freeze({
  ...value,
  linePrices: Object.freeze(value.linePrices.map((entry) => Object.freeze({ ...entry }))),
});
const cloneWorkflow = (value: ServiceWorkflowState): ServiceWorkflowState => Object.freeze({
  ...value,
  request: cloneRequest(value.request),
  recordedSubmission: value.recordedSubmission == null ? null : cloneSubmission(value.recordedSubmission),
});
const cloneState = (value: ServiceModuleState): ServiceModuleState => Object.freeze({
  ...value,
  workflows: Object.freeze(value.workflows.map(cloneWorkflow)),
  receivedVisitIds: Object.freeze([...value.receivedVisitIds]),
  processedOperationIds: Object.freeze([...value.processedOperationIds]),
});

class ServiceRejected extends Error {
  constructor(readonly code: ServiceRejectionCode, message: string) { super(message); }
}

export class ServiceModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = SERVICE_MODULE_ID;
  readonly transactionParticipantId = SERVICE_MODULE_ID;
  readonly #customers: CustomerModule;
  readonly #orders: OrderModule;
  readonly #tasks: TaskModule;
  readonly #mealPickup: ServiceMealPickupPort;
  readonly #dishwareSupply: ServiceDishwareSupplyPort;
  readonly #transaction: TransactionScope;
  #state: ServiceModuleState;
  #transactionActive = false;

  constructor(options: {
    readonly customers: CustomerModule;
    readonly orders: OrderModule;
    readonly tasks: TaskModule;
    readonly mealPickup: ServiceMealPickupPort;
    readonly dishwareSupply?: ServiceDishwareSupplyPort;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: ServiceModuleState;
  }) {
    this.#customers = options.customers;
    this.#orders = options.orders;
    this.#tasks = options.tasks;
    this.#mealPickup = options.mealPickup;
    this.#dishwareSupply = options.dishwareSupply ?? NO_SERVICE_DISHWARE_SUPPLY;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: SERVICE_SCHEMA_VERSION, revision: 0, workflows: [], receivedVisitIds: [], processedOperationIds: [] })
      : cloneState(options.initialState);
    this.#validate();
  }

  exportState(): ServiceModuleState { return cloneState(this.#state); }
  getWorkflow(taskId: string): ServiceWorkflowState | null {
    const value = this.#state.workflows.find((entry) => entry.taskId === taskId);
    return value === undefined ? null : cloneWorkflow(value);
  }

  createTaskSourceSnapshot(): TaskSourceSnapshot {
    const activeIds = new Set(this.#state.workflows.map((entry) => entry.taskId));
    return Object.freeze({
      sourceId: SERVICE_MODULE_ID,
      sourceRevision: this.#state.revision,
      waitingTasks: Object.freeze(this.#waitingRequests().filter((entry) => !activeIds.has(entry.taskId))),
      activeTasks: Object.freeze(this.#state.workflows.map((workflow) => Object.freeze({
        request: cloneRequest(workflow.request),
        assignedCharacterId: workflow.assignedCharacterId,
        claimedAtUtcMs: workflow.claimedAtUtcMs,
      }))),
    });
  }

  synchronizeTasks(operationId: string, occurredAtUtcMs: number): ServiceOperationResult<TaskSourceSnapshot> {
    if (!integer(occurredAtUtcMs)) {
      return this.#reject("INVALID_REQUEST", "Service synchronization time is invalid.");
    }
    const before = this.createTaskSourceSnapshot();
    const desiredBefore = new Set(before.waitingTasks.map((entry) => entry.taskId));
    const hasTaskChanges = this.#tasks.createReadModel().waiting.some((task) =>
      this.#isServiceTask(task.taskId) && !desiredBefore.has(task.taskId)) ||
      before.waitingTasks.some((request) => this.#tasks.getTask(request.taskId) === null);
    if (!hasTaskChanges) {
      return Object.freeze({
        accepted: true,
        changed: false,
        value: before,
        committedEventIds: Object.freeze([]),
      });
    }
    return this.#run(operationId, (emit) => {
      const snapshot = this.createTaskSourceSnapshot();
      const desired = new Map(snapshot.waitingTasks.map((entry) => [entry.taskId, entry]));
      for (const task of this.#tasks.createReadModel().waiting) {
        if (!this.#isServiceTask(task.taskId) || desired.has(task.taskId)) continue;
        const cancelled = this.#tasks.cancelTask(childOperationId(operationId, "cancel", task.taskId), task.taskId, "service-source-advanced", occurredAtUtcMs);
        if (!cancelled.accepted) throw new ServiceRejected("TASK_REJECTED", cancelled.message);
        cancelled.events.forEach(emit);
      }
      for (const request of snapshot.waitingTasks) {
        if (this.#tasks.getTask(request.taskId) !== null) continue;
        const created = this.#tasks.createTask(childOperationId(operationId, "create", request.taskId), request);
        if (!created.accepted) throw new ServiceRejected("TASK_REJECTED", created.message);
        created.events.forEach(emit);
      }
      return this.createTaskSourceSnapshot();
    }, [this, this.#tasks]);
  }

  startTask(operationId: string, taskId: string, candidate: TaskCandidate, occurredAtUtcMs: number, distanceCost = 0): ServiceOperationResult<ServiceWorkflowState> {
    return this.#run(operationId, (emit) => {
      if (!valid(taskId) || !integer(occurredAtUtcMs) || this.#state.workflows.some((entry) => entry.taskId === taskId)) {
        throw new ServiceRejected("INVALID_REQUEST", "Service task start request is invalid.");
      }
      const request = this.#waitingRequests().find((entry) => entry.taskId === taskId);
      if (request === undefined) throw new ServiceRejected("UNKNOWN_TASK", `Unknown service task: ${taskId}`);
      if (this.#tasks.getTask(taskId) === null) {
        const created = this.#tasks.createTask(childOperationId(operationId, "create", taskId), request);
        if (!created.accepted) throw new ServiceRejected("TASK_REJECTED", created.message);
        created.events.forEach(emit);
      }
      const claimed = this.#tasks.claimTask(childOperationId(operationId, "claim", taskId), taskId, candidate, occurredAtUtcMs, distanceCost);
      if (!claimed.accepted) throw new ServiceRejected("TASK_REJECTED", claimed.message);
      claimed.events.forEach(emit);
      const kind = this.#kindFromTaskType(request.taskType);
      const workflow = cloneWorkflow({
        taskId,
        kind,
        sourceId: request.source.id,
        request,
        assignedCharacterId: candidate.characterId,
        claimedAtUtcMs: occurredAtUtcMs,
        stage: kind === "deliver-meal" || kind === "clean-table" || kind === "supply-plate" ? "external-handoff" : "active",
        pendingOrderId: null,
        recordedSubmission: null,
      });
      this.#replace({ workflows: [...this.#state.workflows, workflow] });
      emit(this.#event(operationId, "service.workflow-started", occurredAtUtcMs, workflow));
      return workflow;
    }, [this, this.#tasks]);
  }
  completeReception(operationId: string, taskId: string, occurredAtUtcMs: number): ServiceOperationResult<ServiceWorkflowState> {
    return this.#run(operationId, (emit) => {
      const workflow = this.#requireWorkflow(taskId, "reception");
      const visit = this.#customers.getVisit(workflow.sourceId);
      if (visit === null || visit.phase === "departed" || visit.phase === "departing") {
        throw new ServiceRejected("CUSTOMER_REJECTED", "Reception visit is no longer active.");
      }
      if (visit.phase === "moving-to-table") {
        const seated = this.#customers.confirmSeated(childOperationId(operationId, "customer-seat", visit.id), visit.id, occurredAtUtcMs);
        if (!seated.accepted) throw new ServiceRejected("CUSTOMER_REJECTED", seated.message);
      }
      this.#replace({
        workflows: this.#state.workflows.filter((entry) => entry.taskId !== taskId),
        receivedVisitIds: [...this.#state.receivedVisitIds, visit.id],
      });
      this.#completeTask(workflow, occurredAtUtcMs, { visitId: visit.id }, emit, operationId);
      emit(this.#event(operationId, "service.reception-completed", occurredAtUtcMs, { visitId: visit.id, taskId }));
      return workflow;
    }, [this, this.#tasks]);
  }

  recordOrderAtTable(operationId: string, taskId: string, request: {
    readonly pendingOrderId: string;
    readonly ingredientReservationId: string;
    readonly lines: readonly PendingOrderLineState[];
    readonly submission?: Omit<ServiceOrderSubmissionRequest, "occurredAtUtcMs">;
    readonly occurredAtUtcMs: number;
  }): ServiceOperationResult<ServiceWorkflowState> {
    return this.#run(operationId, (emit) => {
      const workflow = this.#requireWorkflow(taskId, "take-order");
      if (workflow.stage !== "active") throw new ServiceRejected("INVALID_WORKFLOW", "Order is already being transmitted.");
      const recorded = this.#customers.recordPendingOrder(childOperationId(operationId, "customer-order", workflow.sourceId), workflow.sourceId, request);
      if (!recorded.accepted) throw new ServiceRejected("CUSTOMER_REJECTED", recorded.message);
      const locked = this.#tasks.setTaskInterruptible(childOperationId(operationId, "lock", taskId), taskId, workflow.assignedCharacterId, false, request.occurredAtUtcMs);
      if (!locked.accepted) throw new ServiceRejected("TASK_REJECTED", locked.message);
      locked.events.forEach(emit);
      const updated = cloneWorkflow({
        ...workflow,
        request: { ...workflow.request, interruptible: false },
        stage: "transmitting-order",
        pendingOrderId: request.pendingOrderId,
        recordedSubmission: request.submission === undefined ? null : cloneSubmission(request.submission),
      });
      this.#replace({ workflows: this.#state.workflows.map((entry) => entry.taskId === taskId ? updated : entry) });
      emit(this.#event(operationId, "service.order-recorded", request.occurredAtUtcMs, {
        taskId, visitId: workflow.sourceId, pendingOrderId: request.pendingOrderId,
      }));
      return updated;
    }, [this, this.#tasks]);
  }

  submitRecordedOrder(operationId: string, taskId: string, request: ServiceOrderSubmissionRequest): ServiceOperationResult<OrderState> {
    return this.#run(operationId, (emit) => {
      const workflow = this.#requireWorkflow(taskId, "take-order");
      if (workflow.stage !== "transmitting-order" || workflow.pendingOrderId === null) {
        throw new ServiceRejected("INVALID_WORKFLOW", "The table order has not been recorded.");
      }
      const recordedSubmission = workflow.recordedSubmission ?? null;
      if (recordedSubmission !== null && (
        recordedSubmission.orderId !== request.orderId ||
        JSON.stringify(recordedSubmission.linePrices) !== JSON.stringify(request.linePrices) ||
        (recordedSubmission.focusBonusRateBasisPoints ?? 0) !== (request.focusBonusRateBasisPoints ?? 0)
      )) {
        throw new ServiceRejected("INVALID_WORKFLOW", "Submitted order does not match the table-side price snapshot.");
      }
      const submitted = this.#orders.submitPendingOrder({
        operationId: childOperationId(operationId, "order-submit", workflow.pendingOrderId),
        pendingOrderId: workflow.pendingOrderId,
        orderId: request.orderId,
        linePrices: request.linePrices,
        ...(request.focusBonusRateBasisPoints === undefined
          ? {}
          : { focusBonusRateBasisPoints: request.focusBonusRateBasisPoints }),
        submittedAtUtcMs: request.occurredAtUtcMs,
      });
      if (!submitted.accepted) throw new ServiceRejected("ORDER_REJECTED", submitted.message);
      this.#replace({ workflows: this.#state.workflows.filter((entry) => entry.taskId !== taskId) });
      this.#completeTask(workflow, request.occurredAtUtcMs, {
        visitId: workflow.sourceId,
        pendingOrderId: workflow.pendingOrderId,
        orderId: submitted.value.id,
      }, emit, operationId);
      emit(this.#event(operationId, "service.order-transmitted", request.occurredAtUtcMs, {
        taskId, visitId: workflow.sourceId, orderId: submitted.value.id,
      }));
      return submitted.value;
    }, [this, this.#tasks]);
  }

  completeCheckout(operationId: string, taskId: string, request: {
    readonly settlementBatchId: string;
    readonly regionId: string;
    readonly occurredAtUtcMs: number;
  }): ServiceOperationResult<OrderState> {
    return this.#run(operationId, (emit) => {
      const workflow = this.#requireWorkflow(taskId, "checkout");
      const settled = this.#orders.settleOrder({
        operationId: childOperationId(operationId, "order-settle", workflow.sourceId),
        orderId: workflow.sourceId,
        settlementBatchId: request.settlementBatchId,
        regionId: request.regionId,
        settledAtUtcMs: request.occurredAtUtcMs,
      });
      if (!settled.accepted) throw new ServiceRejected("ORDER_REJECTED", settled.message);
      this.#replace({ workflows: this.#state.workflows.filter((entry) => entry.taskId !== taskId) });
      this.#completeTask(workflow, request.occurredAtUtcMs, { orderId: settled.value.id }, emit, operationId);
      emit(this.#event(operationId, "service.checkout-completed", request.occurredAtUtcMs, {
        taskId, orderId: settled.value.id, tableId: settled.value.tableId,
      }));
      return settled.value;
    }, [this, this.#tasks]);
  }

  completeExternalHandoff(operationId: string, taskId: string, result: Readonly<Record<string, TaskResultValue>>, occurredAtUtcMs: number): ServiceOperationResult<ServiceWorkflowState> {
    return this.#run(operationId, (emit) => {
      const workflow = this.#state.workflows.find((entry) => entry.taskId === taskId);
      if (workflow === undefined || (workflow.kind !== "deliver-meal" && workflow.kind !== "clean-table" && workflow.kind !== "supply-plate")) {
        throw new ServiceRejected("INVALID_WORKFLOW", "Task is not an external service handoff.");
      }
      if (this.#waitingRequests().some((entry) => entry.taskId === taskId)) {
        throw new ServiceRejected("SOURCE_STILL_ACTIVE", "Authoritative delivery or cleaning source has not advanced.");
      }
      this.#replace({ workflows: this.#state.workflows.filter((entry) => entry.taskId !== taskId) });
      this.#completeTask(workflow, occurredAtUtcMs, result, emit, operationId);
      emit(this.#event(operationId, "service.external-handoff-completed", occurredAtUtcMs, {
        taskId, kind: workflow.kind, sourceId: workflow.sourceId,
      }));
      return workflow;
    }, [this, this.#tasks]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Service transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validate(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = checkpoint; this.#transactionActive = false; },
    };
  }

  #waitingRequests(): TaskRequest[] {
    const customer = this.#customers.createReadModel();
    const requests: TaskRequest[] = [];
    for (const visit of customer.activeVisits) {
      if (!this.#state.receivedVisitIds.includes(visit.id) && visit.phase !== "departing") {
        requests.push(this.#request("reception", visit.id, "customer-visit", visit.id,
          visit.tableId === null ? "waiting-area" : "table", visit.tableId ?? visit.waitingAreaId,
          250, false, true, visit.arrivedAtUtcMs));
      }
      if (this.#state.receivedVisitIds.includes(visit.id) && visit.phase === "awaiting-order") {
        requests.push(this.#request("take-order", visit.id, "customer-visit", visit.id, "table", visit.tableId!,
          250, false, true, visit.seatedAtUtcMs ?? visit.arrivedAtUtcMs));
      }
    }
    for (const order of this.#orders.getReadModel(0).openOrders) {
      for (const meal of order.meals.filter((entry) => entry.status === "awaiting-pickup" &&
        this.#mealPickup.isReadyAtGroundPickup(entry.id))) {
        requests.push(this.#request("deliver-meal", meal.id, "order-meal", meal.id, "table", order.tableId,
          400, true, false, meal.updatedAtUtcMs));
      }
      if (order.status === "awaiting-payment") {
        requests.push(this.#request("checkout", order.id, "order", order.id, "table", order.tableId,
          300, false, true, Math.max(...order.meals.map((meal) => meal.updatedAtUtcMs))));
      }
    }
    for (const need of this.#dishwareSupply.listSupplyNeeds()) {
      requests.push(this.#request("supply-plate", need.id, "dishware-supply", need.id,
        "inventory-location", need.handoffLocationId,
        need.orderBlocking ? 400 : 100, need.orderBlocking, false, need.createdAtUtcMs,
        need.orderBlocking ? 20 : 0));
    }
    const waitingPeople = Object.values(customer.waitingPeopleByScene).reduce((sum, value) => sum + value, 0);
    const noCleanFreeTable = customer.tables.every((table) => table.cleanliness !== "clean" || table.assignedVisitId !== null);
    for (const table of customer.tables.filter((entry) => entry.cleanliness === "dirty" && entry.assignedVisitId === null)) {
      const departed = this.#customers.exportState().visits
        .filter((visit) => visit.tableId === table.tableId && visit.departedAtUtcMs !== null)
        .sort((left, right) => right.departedAtUtcMs! - left.departedAtUtcMs!)[0];
      const dirtiedLifecycleId = `${table.tableId}:dirty-at-${departed?.departedAtUtcMs ?? 0}`;
      requests.push(this.#request("clean-table", table.tableId, "table", dirtiedLifecycleId, "table", table.tableId,
        300, waitingPeople > 0 && noCleanFreeTable, false, departed?.departedAtUtcMs ?? 0,
        waitingPeople > 0 && noCleanFreeTable ? 20 : 0));
    }
    return requests.sort((left, right) => right.basePriority - left.basePriority || left.createdAtUtcMs - right.createdAtUtcMs || left.taskId.localeCompare(right.taskId));
  }

  #request(kind: ServiceTaskKind, sourceId: string, sourceType: string, stableSourceId: string,
    targetType: string, targetId: string, basePriority: number, urgent: boolean,
    interruptible: boolean, createdAtUtcMs: number, urgency = 0): TaskRequest {
    const taskType = `service.${kind}`;
    return cloneRequest({
      taskId: createStableTaskKey({ sourceType: "service", sourceId: stableSourceId, taskType, targetType, targetId, discriminator: "current" }),
      taskType,
      source: { type: sourceType, id: sourceId },
      target: { type: targetType, id: targetId },
      basePriority,
      requiredTags: ["employee"],
      eligibleJobIds: ["job.waiter"],
      requiredSkills: [],
      urgency,
      urgent,
      interruptible,
      createdAtUtcMs,
    });
  }

  #kindFromTaskType(taskType: string): ServiceTaskKind {
    const kind = taskType.replace("service.", "") as ServiceTaskKind;
    if (!["reception", "take-order", "deliver-meal", "checkout", "clean-table", "supply-plate"].includes(kind)) {
      throw new ServiceRejected("INVALID_REQUEST", `Unknown service task type: ${taskType}`);
    }
    return kind;
  }

  #requireWorkflow(taskId: string, kind: ServiceTaskKind): ServiceWorkflowState {
    const workflow = this.#state.workflows.find((entry) => entry.taskId === taskId);
    if (workflow === undefined || workflow.kind !== kind) throw new ServiceRejected("INVALID_WORKFLOW", `Service workflow mismatch: ${taskId}`);
    return workflow;
  }

  #completeTask(workflow: ServiceWorkflowState, time: number, result: Readonly<Record<string, TaskResultValue>>,
    emit: (event: DomainEvent) => void, operationId: string): void {
    const completed = this.#tasks.completeTask(childOperationId(operationId, "task-complete", workflow.taskId), workflow.taskId, workflow.assignedCharacterId, result, time);
    if (!completed.accepted) throw new ServiceRejected("TASK_REJECTED", completed.message);
    completed.events.forEach(emit);
  }
  #isServiceTask(taskId: string): boolean { return taskId.startsWith("task|service|"); }
  #replace(update: Partial<ServiceModuleState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }
  #event(operationId: string, type: string, time: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: `${type}:${operationId}`, type, occurredAtUtcMs: time, causationId: operationId, correlationId: operationId, payload });
  }
  #run<T>(operationId: string, work: (emit: (event: DomainEvent) => void) => T,
    participants: readonly TransactionalParticipant[]): ServiceOperationResult<T> {
    if (!valid(operationId)) return this.#reject("INVALID_REQUEST", "Service operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Service operation was already processed.");
    try {
      const result = this.#transaction.run(participants, ({ emit }) => {
        this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        return work(emit);
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) {
      return error instanceof ServiceRejected
        ? this.#reject(error.code, error.message)
        : this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Service operation failed.");
    }
  }
  #reject(code: ServiceRejectionCode, message: string): ServiceOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const });
  }
  #validate(): void {
    const state = this.#state;
    if (state.schemaVersion !== SERVICE_SCHEMA_VERSION || !integer(state.revision) ||
      new Set(state.processedOperationIds).size !== state.processedOperationIds.length ||
      new Set(state.receivedVisitIds).size !== state.receivedVisitIds.length ||
      new Set(state.workflows.map((entry) => entry.taskId)).size !== state.workflows.length) {
      throw new Error("Service state metadata is invalid.");
    }
    const assigned = new Set<InstanceId>();
    for (const workflow of state.workflows) {
      if (!valid(workflow.taskId) || !valid(workflow.sourceId) ||
        this.#kindFromTaskType(workflow.request.taskType) !== workflow.kind ||
        workflow.request.taskId !== workflow.taskId || !integer(workflow.claimedAtUtcMs) ||
        assigned.has(workflow.assignedCharacterId) ||
        (workflow.kind === "take-order" && workflow.stage === "transmitting-order" && workflow.pendingOrderId === null) ||
        (workflow.kind !== "take-order" && (workflow.pendingOrderId !== null || (workflow.recordedSubmission ?? null) !== null)) ||
        ((workflow.recordedSubmission ?? null) !== null && (!valid(workflow.recordedSubmission!.orderId) || workflow.recordedSubmission!.linePrices.length === 0))) {
        throw new Error(`Service workflow invariant failed: ${workflow.taskId}`);
      }
      assigned.add(workflow.assignedCharacterId);
    }
  }
}