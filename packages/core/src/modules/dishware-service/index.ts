import {
  DomainEventBus,
  TransactionScope,
  type DomainEvent,
  type InstanceId,
  type TransactionParticipantSession,
  type TransactionalParticipant,
} from "../../kernel";
import type { CustomerModule } from "../customer";
import type { DishwareModule, DishwareSupplyTargetDefinition } from "../dishware";
import type { DomainModule } from "../domain-module";
import type { InventoryModule } from "../inventory";
import type { KitchenProductModule } from "../kitchen-product";
import type { LogisticsDemandModule } from "../logistics-demand";
import type { OrderModule } from "../order";
import type { ServiceDishwareSupplyNeed, ServiceDishwareSupplyPort, ServiceModule } from "../service";
import type { TrayCarrierLocationPort } from "../tray-delivery";

export const DISHWARE_SERVICE_MODULE_ID = "module.dishware-service";
export const DISHWARE_SERVICE_SCHEMA_VERSION = 1;

export interface DishwareMealPlatePort {
  getPlateId(mealId: string): InstanceId | null;
}

export class KitchenProductMealPlateLookup implements DishwareMealPlatePort {
  constructor(readonly products: KitchenProductModule) {}
  getPlateId(mealId: string): InstanceId | null {
    return this.products.getFinishedMealByMealId(mealId)?.plateId ?? null;
  }
}

export interface DishwareServiceTableDefinition {
  readonly tableId: string;
  readonly dirtyPlateLocationId: string;
  readonly cabinetId: string;
}

export interface DishwareServiceSupplyTargetDefinition extends DishwareSupplyTargetDefinition {
  readonly handoffLocationId: string;
  readonly plateItemId: string;
}

export interface DishwareOrderBlockPort {
  isTargetOrderBlocking(targetId: string): boolean;
}

const NO_ORDER_BLOCK: DishwareOrderBlockPort = Object.freeze({ isTargetOrderBlocking: () => false });

export class DishwareServiceSupplyBridge implements ServiceDishwareSupplyPort {
  #source: ServiceDishwareSupplyPort | null = null;
  connect(source: ServiceDishwareSupplyPort): void {
    if (this.#source !== null) throw new Error("Dishware service supply bridge is already connected.");
    this.#source = source;
  }
  listSupplyNeeds(): readonly ServiceDishwareSupplyNeed[] {
    return this.#source?.listSupplyNeeds() ?? Object.freeze([]);
  }
}

export interface DishwareCleanupWorkflowState {
  readonly serviceTaskId: string;
  readonly tableId: string;
  readonly cabinetId: string;
  readonly assignedCharacterId: InstanceId;
  readonly carrierLocationId: string;
  readonly plateIds: readonly InstanceId[];
  readonly returnedPlateIds: readonly InstanceId[];
  readonly pickedUpAtUtcMs: number;
  readonly completedAtUtcMs: number | null;
}

export type DishwareSupplyJobStatus = "waiting-service" | "carried-by-service" | "handed-to-logistics";

export interface DishwareSupplyJobState {
  readonly id: string;
  readonly targetId: string;
  readonly plateId: InstanceId;
  readonly sourceLocationId: string;
  readonly handoffLocationId: string;
  readonly targetLocationId: string;
  readonly plateItemId: string;
  readonly reservationId: string;
  readonly logisticsDemandId: string;
  readonly status: DishwareSupplyJobStatus;
  readonly createdAtUtcMs: number;
  readonly handedOffAtUtcMs: number | null;
  readonly assignedCharacterId?: InstanceId | null;
  readonly pickedUpAtUtcMs?: number | null;
}

export interface DishwareServiceState {
  readonly schemaVersion: typeof DISHWARE_SERVICE_SCHEMA_VERSION;
  readonly revision: number;
  readonly consumedMealIds: readonly string[];
  readonly cleanupWorkflows: readonly DishwareCleanupWorkflowState[];
  readonly supplyJobs: readonly DishwareSupplyJobState[];
  readonly processedOperationIds: readonly string[];
}

export type DishwareServiceRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "INVALID_SERVICE_WORKFLOW"
  | "UNKNOWN_TABLE"
  | "UNKNOWN_SUPPLY_JOB"
  | "NO_DIRTY_PLATE"
  | "DEPENDENCY_REJECTED";

export type DishwareServiceResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly committedEventIds: readonly string[] }
  | { readonly accepted: false; readonly changed: false; readonly code: DishwareServiceRejectionCode; readonly message: string; readonly committedEventIds: readonly [] };

const HISTORY_LIMIT = 4_096;
const valid = (value: string): boolean => value.trim().length > 0 && value.length <= 240;
const integer = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const cloneCleanup = (value: DishwareCleanupWorkflowState): DishwareCleanupWorkflowState => Object.freeze({
  ...value,
  plateIds: Object.freeze([...value.plateIds]),
  returnedPlateIds: Object.freeze([...value.returnedPlateIds]),
});
const cloneSupply = (value: DishwareSupplyJobState): DishwareSupplyJobState => Object.freeze({
  ...value,
  assignedCharacterId: value.assignedCharacterId ?? null,
  pickedUpAtUtcMs: value.pickedUpAtUtcMs ?? null,
});
const cloneState = (value: DishwareServiceState): DishwareServiceState => Object.freeze({
  ...value,
  consumedMealIds: Object.freeze([...value.consumedMealIds]),
  cleanupWorkflows: Object.freeze(value.cleanupWorkflows.map(cloneCleanup)),
  supplyJobs: Object.freeze(value.supplyJobs.map(cloneSupply)),
  processedOperationIds: Object.freeze([...value.processedOperationIds]),
});

export class DishwareServiceModule implements DomainModule, TransactionalParticipant, ServiceDishwareSupplyPort {
  readonly moduleId = DISHWARE_SERVICE_MODULE_ID;
  readonly transactionParticipantId = DISHWARE_SERVICE_MODULE_ID;
  readonly #customers: CustomerModule;
  readonly #dishware: DishwareModule;
  readonly #inventory: InventoryModule;
  readonly #logistics: LogisticsDemandModule;
  readonly #orders: OrderModule;
  readonly #mealPlates: DishwareMealPlatePort;
  readonly #service: ServiceModule;
  readonly #carrierLocations: TrayCarrierLocationPort;
  readonly #orderBlock: DishwareOrderBlockPort;
  readonly #tables = new Map<string, DishwareServiceTableDefinition>();
  readonly #targets = new Map<string, DishwareServiceSupplyTargetDefinition>();
  readonly #transaction: TransactionScope;
  #state: DishwareServiceState;
  #transactionActive = false;

  constructor(options: {
    readonly customers: CustomerModule;
    readonly dishware: DishwareModule;
    readonly inventory: InventoryModule;
    readonly logistics: LogisticsDemandModule;
    readonly orders: OrderModule;
    readonly mealPlates: DishwareMealPlatePort;
    readonly service: ServiceModule;
    readonly carrierLocations: TrayCarrierLocationPort;
    readonly tables: readonly DishwareServiceTableDefinition[];
    readonly supplyTargets: readonly DishwareServiceSupplyTargetDefinition[];
    readonly orderBlock?: DishwareOrderBlockPort;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: DishwareServiceState;
  }) {
    if (options.tables.length === 0 || options.supplyTargets.length === 0) throw new Error("Dishware service definitions are required.");
    for (const table of options.tables) {
      if (!valid(table.tableId) || !valid(table.dirtyPlateLocationId) || !valid(table.cabinetId) || this.#tables.has(table.tableId)) {
        throw new Error(`Invalid dishware service table: ${table.tableId}`);
      }
      this.#tables.set(table.tableId, Object.freeze({ ...table }));
    }
    for (const target of options.supplyTargets) {
      if (!valid(target.id) || !valid(target.sourceCleanStorageLocationId) || !valid(target.targetCleanStorageLocationId) ||
        !valid(target.handoffLocationId) || !valid(target.plateItemId) || !integer(target.targetQuantity) || this.#targets.has(target.id)) {
        throw new Error(`Invalid dishware service target: ${target.id}`);
      }
      this.#targets.set(target.id, Object.freeze({ ...target }));
    }
    this.#customers = options.customers;
    this.#dishware = options.dishware;
    this.#inventory = options.inventory;
    this.#logistics = options.logistics;
    this.#orders = options.orders;
    this.#mealPlates = options.mealPlates;
    this.#service = options.service;
    this.#carrierLocations = options.carrierLocations;
    this.#orderBlock = options.orderBlock ?? NO_ORDER_BLOCK;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: DISHWARE_SERVICE_SCHEMA_VERSION, revision: 0, consumedMealIds: [], cleanupWorkflows: [], supplyJobs: [], processedOperationIds: [] })
      : cloneState(options.initialState);
    this.#validate();
  }

  exportState(): DishwareServiceState { return cloneState(this.#state); }
  listSupplyNeeds(): readonly ServiceDishwareSupplyNeed[] {
    return Object.freeze(this.#state.supplyJobs.filter((entry) => entry.status === "waiting-service").map((entry) => Object.freeze({
      id: entry.id,
      plateId: entry.plateId,
      targetId: entry.targetId,
      sourceLocationId: entry.sourceLocationId,
      handoffLocationId: entry.handoffLocationId,
      orderBlocking: this.#orderBlock.isTargetOrderBlocking(entry.targetId),
      createdAtUtcMs: entry.createdAtUtcMs,
    })));
  }

  synchronizeConsumedMeals(operationId: string, occurredAtUtcMs: number): DishwareServiceResult<readonly string[]> {
    if (!valid(operationId) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Consumed-meal synchronization is invalid.");
    const processed: string[] = [];
    for (const order of this.#orders.exportState().orders) {
      const table = this.#tables.get(order.tableId);
      if (table === undefined) continue;
      for (const meal of order.meals.filter((entry) => entry.status === "consumed" && !this.#state.consumedMealIds.includes(entry.id))) {
        const plateId = this.#mealPlates.getPlateId(meal.id);
        if (plateId === null) return this.#reject("DEPENDENCY_REJECTED", `Consumed meal has no plate binding: ${meal.id}`);
        const dirtied = this.#dishware.markDirty(`${operationId}:dirty:${meal.id}`, plateId, table.dirtyPlateLocationId, occurredAtUtcMs);
        if (!dirtied.accepted) return this.#reject("DEPENDENCY_REJECTED", dirtied.message);
        const recorded = this.#run(`${operationId}:record:${meal.id}`, (emit) => {
          this.#replace({ consumedMealIds: [...this.#state.consumedMealIds, meal.id] });
          emit(this.#event(operationId, "dishware-service.meal-plate-dirtied", occurredAtUtcMs, { mealId: meal.id, plateId, tableId: order.tableId }, meal.id));
          return meal.id;
        });
        if (!recorded.accepted) return recorded;
        processed.push(meal.id);
      }
    }
    return Object.freeze({ accepted: true, changed: processed.length > 0, value: Object.freeze(processed), committedEventIds: Object.freeze([]) });
  }

  pickupDirtyTable(operationId: string, serviceTaskId: string, occurredAtUtcMs: number): DishwareServiceResult<DishwareCleanupWorkflowState> {
    const serviceWorkflow = this.#service.getWorkflow(serviceTaskId);
    if (!valid(operationId) || !valid(serviceTaskId) || !integer(occurredAtUtcMs) || serviceWorkflow?.kind !== "clean-table") {
      return this.#reject("INVALID_SERVICE_WORKFLOW", "Cleanup service workflow is invalid.");
    }
    if (this.#state.cleanupWorkflows.some((entry) => entry.serviceTaskId === serviceTaskId)) {
      return this.#reject("INVALID_REQUEST", "Cleanup workflow already picked up its table.");
    }
    const table = this.#tables.get(serviceWorkflow.sourceId);
    if (table === undefined) return this.#reject("UNKNOWN_TABLE", `Unknown cleanup table: ${serviceWorkflow.sourceId}`);
    let carrierLocationId: string;
    try { carrierLocationId = this.#carrierLocations.getCarrierLocationId(serviceWorkflow.assignedCharacterId); }
    catch (error) { return this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Carrier location is invalid."); }
    const dirtyIds = new Set(this.#dishware.getSnapshot().plates.filter((entry) => entry.status === "dirty").map((entry) => entry.id));
    const plateIds = this.#inventory.getSnapshot().locations.find((entry) => entry.id === table.dirtyPlateLocationId)?.instances
      .filter((entry) => dirtyIds.has(entry.id)).map((entry) => entry.id) ?? [];
    if (plateIds.length === 0) return this.#reject("NO_DIRTY_PLATE", "The table has no dirty plates to collect.");
    return this.#run(operationId, (emit) => {
      for (const plateId of plateIds) {
        const moved = this.#inventory.transferInstance(`${operationId}:inventory:${plateId}`, plateId, carrierLocationId, occurredAtUtcMs);
        if (!moved.accepted) throw new Error(moved.message);
        moved.events.forEach(emit);
      }
      const workflow = cloneCleanup({
        serviceTaskId,
        tableId: table.tableId,
        cabinetId: table.cabinetId,
        assignedCharacterId: serviceWorkflow.assignedCharacterId,
        carrierLocationId,
        plateIds,
        returnedPlateIds: [],
        pickedUpAtUtcMs: occurredAtUtcMs,
        completedAtUtcMs: null,
      });
      this.#replace({ cleanupWorkflows: [...this.#state.cleanupWorkflows, workflow] });
      emit(this.#event(operationId, "dishware-service.dirty-plates-picked-up", occurredAtUtcMs, { serviceTaskId, tableId: table.tableId, plateIds }));
      return workflow;
    }, [this, this.#inventory]);
  }

  deliverDirtyToCabinet(operationId: string, serviceTaskId: string, occurredAtUtcMs: number): DishwareServiceResult<DishwareCleanupWorkflowState> {
    if (!valid(operationId) || !valid(serviceTaskId) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Dirty-plate delivery is invalid.");
    let workflow = this.#state.cleanupWorkflows.find((entry) => entry.serviceTaskId === serviceTaskId);
    if (workflow === undefined) return this.#reject("INVALID_SERVICE_WORKFLOW", "Cleanup workflow has not collected the table.");
    for (const plateId of workflow.plateIds.filter((id) => !workflow!.returnedPlateIds.includes(id))) {
      const returned = this.#dishware.returnDirtyToCabinet(`${operationId}:return:${plateId}`, plateId, workflow.cabinetId, occurredAtUtcMs);
      if (!returned.accepted) return this.#reject("DEPENDENCY_REJECTED", returned.message);
      const recorded = this.#run(`${operationId}:record:${plateId}`, (emit) => {
        const current = this.#state.cleanupWorkflows.find((entry) => entry.serviceTaskId === serviceTaskId)!;
        const next = cloneCleanup({ ...current, returnedPlateIds: [...current.returnedPlateIds, plateId] });
        this.#replace({ cleanupWorkflows: this.#state.cleanupWorkflows.map((entry) => entry.serviceTaskId === serviceTaskId ? next : entry) });
        emit(this.#event(operationId, "dishware-service.dirty-plate-returned", occurredAtUtcMs, { serviceTaskId, tableId: current.tableId, plateId }, plateId));
        return next;
      });
      if (!recorded.accepted) return recorded;
      workflow = recorded.value;
    }
    const table = this.#customers.createReadModel().tables.find((entry) => entry.tableId === workflow.tableId);
    if (table?.cleanliness !== "clean") {
      const cleaned = this.#customers.markTableCleaned(`${operationId}:table-clean`, workflow.tableId, occurredAtUtcMs);
      if (!cleaned.accepted) return this.#reject("DEPENDENCY_REJECTED", cleaned.message);
    }
    const washing = this.#dishware.advanceTo(`${operationId}:washing`, occurredAtUtcMs);
    if (!washing.accepted) return this.#reject("DEPENDENCY_REJECTED", washing.message);
    const completed = this.#service.completeExternalHandoff(`${operationId}:service-complete`, serviceTaskId, {
      tableId: workflow.tableId,
      plateCount: workflow.plateIds.length,
    }, occurredAtUtcMs);
    if (!completed.accepted) return this.#reject("DEPENDENCY_REJECTED", completed.message);
    return this.#run(operationId, (emit) => {
      const next = cloneCleanup({ ...workflow!, completedAtUtcMs: occurredAtUtcMs });
      this.#replace({ cleanupWorkflows: this.#state.cleanupWorkflows.map((entry) => entry.serviceTaskId === serviceTaskId ? next : entry) });
      emit(this.#event(operationId, "dishware-service.table-cleanup-completed", occurredAtUtcMs, { serviceTaskId, tableId: next.tableId, plateIds: next.plateIds }));
      return next;
    });
  }

  refreshSupplyJobs(operationId: string, occurredAtUtcMs: number): DishwareServiceResult<readonly DishwareSupplyJobState[]> {
    if (!valid(operationId) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Dishware supply refresh is invalid.");
    return this.#run(operationId, (emit) => {
      const inventory = this.#inventory.getSnapshot();
      const dishware = this.#dishware.getSnapshot();
      const cleanIds = new Set(dishware.plates.filter((entry) => entry.status === "clean").map((entry) => entry.id));
      const reservedIds = new Set(inventory.reservations.flatMap((entry) => entry.instanceIds));
      const created: DishwareSupplyJobState[] = [];
      const cancelledIds = new Set<string>();
      const activeSupplyIds = new Set(this.#service.exportState().workflows
        .filter((entry) => entry.kind === "supply-plate").map((entry) => entry.sourceId));
      for (const target of this.#targets.values()) {
        const current = inventory.locations.find((entry) => entry.id === target.targetCleanStorageLocationId)?.instances
          .filter((entry) => cleanIds.has(entry.id)).length ?? 0;
        const incoming = this.#logistics.exportState().groups
          .filter((entry) => entry.ownerType === "dishware-supply" && entry.ownerId === target.id && entry.status === "in-progress")
          .reduce((sum, entry) => sum + entry.claimedQuantity + entry.remainingQuantity, 0);
        const desiredWaiting = Math.max(0, target.targetQuantity - current - incoming);
        const existing = this.#state.supplyJobs
          .filter((entry) => entry.targetId === target.id && entry.status === "waiting-service")
          .sort((left, right) => left.createdAtUtcMs - right.createdAtUtcMs || left.id.localeCompare(right.id));
        const kept = existing.filter((entry) => activeSupplyIds.has(entry.id));
        for (const job of existing.filter((entry) => !activeSupplyIds.has(entry.id))) {
          if (kept.length < desiredWaiting) {
            kept.push(job);
            continue;
          }
          const released = this.#inventory.releaseReservation(`${operationId}:cancel:${job.plateId}`, job.reservationId, occurredAtUtcMs);
          if (!released.accepted) throw new Error(released.message);
          released.events.forEach(emit);
          reservedIds.delete(job.plateId);
          cancelledIds.add(job.id);
          emit(this.#event(operationId, "dishware-service.supply-job-cancelled", occurredAtUtcMs, { jobId: job.id, plateId: job.plateId, targetId: job.targetId }, job.id));
        }
        const required = Math.max(0, desiredWaiting - kept.length);
        const used = new Set(kept.map((entry) => entry.plateId));
        const available = inventory.locations.find((entry) => entry.id === target.sourceCleanStorageLocationId)?.instances
          .filter((entry) => cleanIds.has(entry.id) && !reservedIds.has(entry.id) && !used.has(entry.id))
          .map((entry) => entry.id).sort((left, right) => left.localeCompare(right)) ?? [];
        for (const plateId of available.slice(0, required)) {
          // A clean plate may be supplied, used, washed, and supplied again. The
          // occurrence timestamp keeps each durable task/logistics identity unique.
          const id = `dishware-supply:${target.id}:${plateId}:at-${occurredAtUtcMs}`;
          const reservationId = `reservation.${id}`;
          const reserved = this.#inventory.createReservation(`${operationId}:reserve:${plateId}`, {
            reservationId,
            ownerType: "dishware-supply",
            ownerId: target.id,
            instanceIds: [plateId],
            createdAtUtcMs: occurredAtUtcMs,
          });
          if (!reserved.accepted) throw new Error(reserved.message);
          reserved.events.forEach(emit);
          const job = cloneSupply({
            id,
            targetId: target.id,
            plateId,
            sourceLocationId: target.sourceCleanStorageLocationId,
            handoffLocationId: target.handoffLocationId,
            targetLocationId: target.targetCleanStorageLocationId,
            plateItemId: target.plateItemId,
            reservationId,
            logisticsDemandId: `logistics.${id}`,
            status: "waiting-service",
            createdAtUtcMs: occurredAtUtcMs,
            handedOffAtUtcMs: null,
            assignedCharacterId: null,
            pickedUpAtUtcMs: null,
          });
          created.push(job);
          emit(this.#event(operationId, "dishware-service.supply-job-created", occurredAtUtcMs, job, job.id));
        }
      }
      if (created.length > 0 || cancelledIds.size > 0) this.#replace({ supplyJobs: [...this.#state.supplyJobs.filter((entry) => !cancelledIds.has(entry.id)), ...created] });
      return Object.freeze(created.map(cloneSupply));
    }, [this, this.#inventory]);
  }

  pickupSupplyPlate(operationId: string, serviceTaskId: string, occurredAtUtcMs: number): DishwareServiceResult<DishwareSupplyJobState> {
    if (!valid(operationId) || !valid(serviceTaskId) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Dishware supply pickup is invalid.");
    const serviceWorkflow = this.#service.getWorkflow(serviceTaskId);
    if (serviceWorkflow?.kind !== "supply-plate") return this.#reject("INVALID_SERVICE_WORKFLOW", "Service task is not a plate supply.");
    const job = this.#state.supplyJobs.find((entry) => entry.id === serviceWorkflow.sourceId);
    if (job === undefined) return this.#reject("UNKNOWN_SUPPLY_JOB", `Unknown dishware supply job: ${serviceWorkflow.sourceId}`);
    if (job.status !== "waiting-service") return this.#reject("INVALID_REQUEST", "Dishware supply plate was already collected.");
    let carrierLocationId: string;
    try { carrierLocationId = this.#carrierLocations.getCarrierLocationId(serviceWorkflow.assignedCharacterId); }
    catch (error) { return this.#reject("INVALID_REQUEST", error instanceof Error ? error.message : "Carrier location is invalid."); }
    return this.#run(operationId, (emit) => {
      const moved = this.#inventory.transferInstance(`${operationId}:inventory`, job.plateId, carrierLocationId, occurredAtUtcMs);
      if (!moved.accepted) throw new Error(moved.message);
      moved.events.forEach(emit);
      const next = cloneSupply({
        ...job,
        status: "carried-by-service",
        assignedCharacterId: serviceWorkflow.assignedCharacterId,
        pickedUpAtUtcMs: occurredAtUtcMs,
      });
      this.#replace({ supplyJobs: this.#state.supplyJobs.map((entry) => entry.id === next.id ? next : entry) });
      emit(this.#event(operationId, "dishware-service.supply-plate-picked-up", occurredAtUtcMs, next, next.id));
      return next;
    }, [this, this.#inventory]);
  }
  handoffSupplyPlate(operationId: string, serviceTaskId: string, occurredAtUtcMs: number): DishwareServiceResult<DishwareSupplyJobState> {
    if (!valid(operationId) || !valid(serviceTaskId) || !integer(occurredAtUtcMs)) return this.#reject("INVALID_REQUEST", "Dishware supply handoff is invalid.");
    const serviceWorkflow = this.#service.getWorkflow(serviceTaskId);
    if (serviceWorkflow?.kind !== "supply-plate") return this.#reject("INVALID_SERVICE_WORKFLOW", "Service task is not a plate supply.");
    let job = this.#state.supplyJobs.find((entry) => entry.id === serviceWorkflow.sourceId);
    if (job === undefined) return this.#reject("UNKNOWN_SUPPLY_JOB", `Unknown dishware supply job: ${serviceWorkflow.sourceId}`);
    if (job.status !== "handed-to-logistics") {
      if (this.#logistics.getGroup(job.logisticsDemandId) === null) {
        const demand = this.#logistics.createDemand(`${operationId}:logistics`, {
          id: job.logisticsDemandId,
          kind: "replenishment",
          sourceLocationId: job.handoffLocationId,
          targetLocationId: job.targetLocationId,
          itemId: job.plateItemId,
          instanceId: job.plateId,
          ownerType: "dishware-supply",
          ownerId: job.targetId,
          quantity: 1,
          replenishmentCoverageBasisPoints: 0,
          occurredAtUtcMs,
        });
        if (!demand.accepted) return this.#reject("DEPENDENCY_REJECTED", demand.message);
      }
      const handed = this.#run(`${operationId}:handoff`, (emit) => {
        const moved = this.#inventory.transferInstance(`${operationId}:inventory`, job!.plateId, job!.handoffLocationId, occurredAtUtcMs);
        if (!moved.accepted) throw new Error(moved.message);
        const released = this.#inventory.releaseReservation(`${operationId}:release`, job!.reservationId, occurredAtUtcMs);
        if (!released.accepted) throw new Error(released.message);
        [...moved.events, ...released.events].forEach(emit);
        const next = cloneSupply({ ...job!, status: "handed-to-logistics", handedOffAtUtcMs: occurredAtUtcMs });
        this.#replace({ supplyJobs: this.#state.supplyJobs.map((entry) => entry.id === next.id ? next : entry) });
        emit(this.#event(operationId, "dishware-service.supply-handed-to-logistics", occurredAtUtcMs, next, next.id));
        return next;
      }, [this, this.#inventory]);
      if (!handed.accepted) return handed;
      job = handed.value;
    }
    const completed = this.#service.completeExternalHandoff(`${operationId}:service-complete`, serviceTaskId, {
      supplyJobId: job.id,
      plateId: job.plateId,
      logisticsDemandId: job.logisticsDemandId,
    }, occurredAtUtcMs);
    if (!completed.accepted) return this.#reject("DEPENDENCY_REJECTED", completed.message);
    return Object.freeze({ accepted: true, changed: true, value: cloneSupply(job), committedEventIds: completed.committedEventIds });
  }

  advanceWashing(operationId: string, occurredAtUtcMs: number): DishwareServiceResult<ReturnType<DishwareModule["getSnapshot"]>> {
    const advanced = this.#dishware.advanceTo(`${operationId}:dishware`, occurredAtUtcMs);
    return advanced.accepted
      ? Object.freeze({ accepted: true, changed: advanced.changed, value: advanced.value, committedEventIds: advanced.committedEventIds })
      : this.#reject("DEPENDENCY_REJECTED", advanced.message);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Dishware service transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validate(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = checkpoint; this.#transactionActive = false; },
    };
  }

  #run<T>(operationId: string, work: (emit: (event: DomainEvent) => void) => T,
    participants: readonly TransactionalParticipant[] = [this]): DishwareServiceResult<T> {
    if (!valid(operationId)) return this.#reject("INVALID_REQUEST", "Dishware service operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Dishware service operation was already processed.");
    try {
      const result = this.#transaction.run(participants, ({ emit }) => {
        this.#replace({ processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT) });
        return work(emit);
      });
      return Object.freeze({ accepted: true, changed: true, value: result.value, committedEventIds: result.committedEventIds });
    } catch (error) {
      return this.#reject("DEPENDENCY_REJECTED", error instanceof Error ? error.message : "Dishware service operation failed.");
    }
  }
  #replace(update: Partial<DishwareServiceState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #reject(code: DishwareServiceRejectionCode, message: string): DishwareServiceResult<never> {
    return Object.freeze({ accepted: false, changed: false, code, message, committedEventIds: [] as const });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown, discriminator = operationId): DomainEvent {
    return Object.freeze({ id: `${type}:${discriminator}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #validate(): void {
    if (this.#state.schemaVersion !== DISHWARE_SERVICE_SCHEMA_VERSION || !integer(this.#state.revision) ||
      new Set(this.#state.consumedMealIds).size !== this.#state.consumedMealIds.length ||
      new Set(this.#state.cleanupWorkflows.map((entry) => entry.serviceTaskId)).size !== this.#state.cleanupWorkflows.length ||
      new Set(this.#state.supplyJobs.map((entry) => entry.id)).size !== this.#state.supplyJobs.length ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length) {
      throw new Error("Dishware service state header is invalid.");
    }
    for (const workflow of this.#state.cleanupWorkflows) {
      if (!valid(workflow.serviceTaskId) || !valid(workflow.tableId) || workflow.plateIds.length === 0 ||
        new Set(workflow.plateIds).size !== workflow.plateIds.length || workflow.returnedPlateIds.some((id) => !workflow.plateIds.includes(id)) ||
        (workflow.completedAtUtcMs !== null && workflow.returnedPlateIds.length !== workflow.plateIds.length)) {
        throw new Error(`Dishware cleanup workflow invariant failed: ${workflow.serviceTaskId}`);
      }
    }
    for (const job of this.#state.supplyJobs) {
      if (!valid(job.id) || !this.#targets.has(job.targetId) ||
        (job.status === "handed-to-logistics") !== (job.handedOffAtUtcMs !== null) ||
        (job.status === "waiting-service" && ((job.assignedCharacterId ?? null) !== null || (job.pickedUpAtUtcMs ?? null) !== null)) ||
        (job.status === "carried-by-service" && ((job.assignedCharacterId ?? null) === null || (job.pickedUpAtUtcMs ?? null) === null))) {
        throw new Error(`Dishware supply job invariant failed: ${job.id}`);
      }
    }
  }
}