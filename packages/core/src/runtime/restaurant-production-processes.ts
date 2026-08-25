import type { InstanceId } from "../kernel";
import {
  type AutomaticProcurementModule,
  type CharacterModule,
  type CustomerModule,
  type CustomerOrderableMenuItem,
  type CustomerVisitState,
  type DishwareModule,
  type DishwareServiceModule,
  type EmploymentModule,
  type FleetModule,
  type FreightElevatorModule,
  type KitchenProductModule,
  type KitchenStepExecutionModule,
  type LocalProcurementModule,
  type LogisticsDemandModule,
  type MovementModule,
  type MovementTargetReference,
  type OrderLinePriceSnapshotRequest,
  type OrderModule,
  type PendingOrderLineState,
  type PersonnelElevatorModule,
  type RecipeExecutionModule,
  type ServiceModule,
  type ServiceWorkflowState,
  type TaskCandidate,
  type TaskModule,
  type TaskState,
  type TrayDeliveryModule,
} from "../modules";
import { projectCharacterTaskCandidate } from "../projections";
import type {
  RestaurantApplicationProcess,
  RestaurantApplicationProcessContext,
  RestaurantApplicationProcessResult,
} from "./restaurant-application-runtime";

type OrderPort = Pick<OrderModule, "getReadModel">;
type RecipePort = Pick<
  RecipeExecutionModule,
  "getExecutionForMeal" | "createExecutionsForOrder"
>;
type KitchenTaskSyncPort = Pick<
  KitchenStepExecutionModule,
  "synchronizeWaitingTasks"
>;

export interface RestaurantOrderRecipeProcessOptions {
  readonly orders: OrderPort;
  readonly recipes: RecipePort;
  readonly kitchenSteps: KitchenTaskSyncPort;
}

function acceptedOrThrow(
  result: { readonly accepted: boolean; readonly message?: string },
  action: string,
): void {
  if (!result.accepted) {
    throw new Error(`${action} failed: ${result.message ?? "unknown rejection"}`);
  }
}

function stableOperationHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function processOperationId(
  context: RestaurantApplicationProcessContext,
  action: string,
  discriminator = "",
): string {
  return `restaurant:${action}:${stableOperationHash(
    `${context.operationId}|${discriminator}`,
  )}`;
}

/** Creates recipe DAGs and kitchen tasks for every newly submitted order. */
export class RestaurantOrderRecipeProcess
  implements RestaurantApplicationProcess
{
  readonly id = "10-order-recipe";
  readonly #options: RestaurantOrderRecipeProcessOptions;

  constructor(options: RestaurantOrderRecipeProcessOptions) {
    this.#options = options;
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    let changed = false;
    const orders = this.#options.orders
      .getReadModel()
      .openOrders
      .filter((order) =>
        order.meals.some(
          (meal) => this.#options.recipes.getExecutionForMeal(meal.id) === null,
        ),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const order of orders) {
      const created = this.#options.recipes.createExecutionsForOrder(
        processOperationId(context, "recipe", order.id),
        order,
        context.targetUtcMs,
      );
      acceptedOrThrow(created, `create recipe executions for ${order.id}`);
      changed ||= created.changed;
    }
    const synchronized = this.#options.kitchenSteps.synchronizeWaitingTasks(
      processOperationId(context, "tasks"),
      context.targetUtcMs,
    );
    acceptedOrThrow(synchronized, "synchronize kitchen tasks");
    changed ||= synchronized.changed;
    return Object.freeze({ changed, nextTransitionUtcMs: null });
  }
}

export interface RestaurantTaskCandidateProvider {
  listCandidates(nowUtcMs: number): readonly TaskCandidate[];
}

export interface EmploymentRestaurantTaskCandidateProviderOptions {
  readonly characters: Pick<CharacterModule, "createReadModel">;
  readonly employment: Pick<EmploymentModule, "getWorkContext">;
  readonly customers?: Pick<CustomerModule, "isCustomerVisitActive">;
  readonly isVoyageActive?: (characterId: InstanceId) => boolean;
  readonly minuteOfDayAt?: (nowUtcMs: number) => number;
}

/** Applies employee schedules, customer visits and voyages to task eligibility. */
export class EmploymentRestaurantTaskCandidateProvider
  implements RestaurantTaskCandidateProvider
{
  readonly #options: EmploymentRestaurantTaskCandidateProviderOptions;

  constructor(options: EmploymentRestaurantTaskCandidateProviderOptions) {
    this.#options = options;
  }

  listCandidates(nowUtcMs: number): readonly TaskCandidate[] {
    const minuteOfDay =
      this.#options.minuteOfDayAt?.(nowUtcMs) ??
      Math.floor(nowUtcMs / 60_000) % (24 * 60);
    return Object.freeze(
      this.#options.characters
        .createReadModel()
        .characters.map((character) =>
          projectCharacterTaskCandidate(
            character,
            this.#options.employment.getWorkContext(character.id, {
              minuteOfDay,
              customerVisitActive:
                this.#options.customers?.isCustomerVisitActive(character.id) ??
                false,
              voyageActive:
                this.#options.isVoyageActive?.(character.id) ?? false,
            }),
          ),
        )
        .sort((left, right) => left.characterId.localeCompare(right.characterId)),
    );
  }
}

type KitchenPort = Pick<
  KitchenStepExecutionModule,
  | "createReadModel"
  | "createTaskSourceSnapshot"
  | "synchronizeWaitingTasks"
  | "claimStep"
  | "releaseClaim"
  | "startStep"
  | "advance"
  | "expireClaims"
>;

export interface RestaurantKitchenWorkProcessOptions {
  readonly kitchenSteps: KitchenPort;
  readonly tasks: Pick<TaskModule, "createReadModel" | "rankWaitingTasks">;
  readonly movement: Pick<MovementModule, "getCharacter" | "advanceCharacter">;
  readonly candidates: RestaurantTaskCandidateProvider;
  readonly baseMovementSpeedUnitsPerSecond?: number;
  readonly movementSpeedUnitsPerLevel?: number;
  readonly reservationTtlMs?: number;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

/**
 * Advances, starts and assigns kitchen work from current domain state.
 * It never interprets recipe names, step names, order ids or character ids.
 */
export class RestaurantKitchenWorkProcess
  implements RestaurantApplicationProcess
{
  readonly id = "20-kitchen-work";
  readonly #options: RestaurantKitchenWorkProcessOptions;
  readonly #baseSpeed: number;
  readonly #speedPerLevel: number;
  readonly #reservationTtlMs: number;

  constructor(options: RestaurantKitchenWorkProcessOptions) {
    this.#options = options;
    this.#baseSpeed = positiveFinite(
      options.baseMovementSpeedUnitsPerSecond ?? 30,
      "baseMovementSpeedUnitsPerSecond",
    );
    this.#speedPerLevel = positiveFinite(
      options.movementSpeedUnitsPerLevel ?? 0.3,
      "movementSpeedUnitsPerLevel",
    );
    this.#reservationTtlMs = positiveInteger(
      options.reservationTtlMs ?? 120_000,
      "reservationTtlMs",
    );
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    let changed = false;
    const kitchen = this.#options.kitchenSteps;

    const expired = kitchen.expireClaims(
      processOperationId(context, "expire"),
      context.targetUtcMs,
    );
    acceptedOrThrow(expired, "expire kitchen claims");
    changed ||= expired.changed;

    if (
      kitchen
        .createReadModel()
        .running.some(
          (step) => step.lastAdvancedAtUtcMs! < context.targetUtcMs,
        )
    ) {
      const progressed = kitchen.advance(
        processOperationId(context, "progress"),
        context.targetUtcMs,
      );
      acceptedOrThrow(progressed, "advance kitchen work");
      changed ||= progressed.changed;
    }

    for (const step of kitchen.createReadModel().claimed) {
      const movement = this.#options.movement.getCharacter(step.characterId);
      if (
        movement?.status === "moving" &&
        movement.plan !== null &&
        movement.plan.lastAdvancedAtUtcMs < context.targetUtcMs
      ) {
        const advanced = this.#options.movement.advanceCharacter(
          processOperationId(context, "move", step.stepInstanceId),
          step.characterId,
          context.targetUtcMs,
        );
        if (!advanced.accepted) {
          throw new Error(
            `advance chef for ${step.stepInstanceId} failed: ${advanced.message}`,
          );
        }
        changed ||= advanced.changed;
        if (advanced.value.status === "blocked") {
          const released = kitchen.releaseClaim(
            processOperationId(context, "blocked", step.stepInstanceId),
            step.stepInstanceId,
            advanced.value.blockedReason ?? "movement-blocked",
            context.targetUtcMs,
          );
          acceptedOrThrow(released, `release blocked step ${step.stepInstanceId}`);
          changed ||= released.changed;
        }
      }
    }

    for (const step of kitchen.createReadModel().claimed) {
      if (
        this.#options.movement.getCharacter(step.characterId)?.status !==
        "arrived"
      ) {
        continue;
      }
      const started = kitchen.startStep(
        processOperationId(context, "start", step.stepInstanceId),
        step.stepInstanceId,
        context.targetUtcMs,
      );
      if (started.accepted) {
        changed ||= started.changed;
      } else if (started.code === "INGREDIENTS_NOT_READY") {
        // startStep releases its still-interruptible claim in this case.
        changed = true;
      } else {
        throw new Error(
          `start kitchen step ${step.stepInstanceId} failed: ${started.message}`,
        );
      }
    }

    const synchronized = kitchen.synchronizeWaitingTasks(
      processOperationId(context, "tasks"),
      context.targetUtcMs,
    );
    acceptedOrThrow(synchronized, "synchronize kitchen tasks");
    changed ||= synchronized.changed;
    const claimedWork = this.#claimAvailableWork(context);
    changed = claimedWork || changed;

    return Object.freeze({
      changed,
      nextTransitionUtcMs: this.#nextTransitionUtcMs(),
    });
  }

  #claimAvailableWork(context: RestaurantApplicationProcessContext): boolean {
    const kitchen = this.#options.kitchenSteps;
    const kitchenTaskIds = new Set(
      kitchen.createTaskSourceSnapshot().waitingTasks.map((task) => task.taskId),
    );
    if (kitchenTaskIds.size === 0) return false;

    const busy = new Set(
      this.#options.tasks
        .createReadModel()
        .inProgress.map((task) => task.assignedCharacterId)
        .filter((id): id is InstanceId => id !== null),
    );
    const candidates = this.#options.candidates
      .listCandidates(context.targetUtcMs)
      .filter(
        (candidate) =>
          candidate.available &&
          !busy.has(candidate.characterId) &&
          this.#options.movement.getCharacter(candidate.characterId)?.plan ===
            null,
      );
    const pairs = candidates
      .flatMap((candidate) =>
        this.#options.tasks
          .rankWaitingTasks(candidate, context.targetUtcMs)
          .filter((ranked) => kitchenTaskIds.has(ranked.task.taskId))
          .map((ranked) => ({ candidate, ranked })),
      )
      .sort(
        (left, right) =>
          right.ranked.score - left.ranked.score ||
          left.ranked.task.taskId.localeCompare(right.ranked.task.taskId) ||
          left.candidate.characterId.localeCompare(right.candidate.characterId),
      );

    const assignedCharacters = new Set<InstanceId>();
    const assignedTasks = new Set<string>();
    const unavailableTasks = new Set<string>();
    let changed = false;
    for (const { candidate, ranked } of pairs) {
      if (
        assignedCharacters.has(candidate.characterId) ||
        assignedTasks.has(ranked.task.taskId) ||
        unavailableTasks.has(ranked.task.taskId)
      ) {
        continue;
      }
      const claimed = kitchen.claimStep(
        processOperationId(context, "claim", `${ranked.task.taskId}|${candidate.characterId}`),
        {
          stepInstanceId: ranked.task.target.id,
          candidate,
          speedUnitsPerSecond:
            this.#baseSpeed +
            candidate.skills.movement * this.#speedPerLevel,
          reservationExpiresAtUtcMs:
            context.targetUtcMs + this.#reservationTtlMs,
          occurredAtUtcMs: context.targetUtcMs,
        },
      );
      if (claimed.accepted) {
        changed ||= claimed.changed;
        assignedCharacters.add(candidate.characterId);
        assignedTasks.add(ranked.task.taskId);
      } else if (claimed.code === "RESOURCES_UNAVAILABLE") {
        unavailableTasks.add(ranked.task.taskId);
      } else if (claimed.code !== "TASK_REJECTED") {
        throw new Error(
          `claim kitchen step ${ranked.task.target.id} failed: ${claimed.message}`,
        );
      }
    }
    return changed;
  }

  #nextTransitionUtcMs(): number | null {
    const transitions: number[] = [];
    const readModel = this.#options.kitchenSteps.createReadModel();
    for (const step of readModel.running) {
      transitions.push(
        step.lastAdvancedAtUtcMs! +
          (step.performance!.effectiveDurationMs - step.progressMs),
      );
    }
    for (const step of readModel.claimed) {
      const movement = this.#options.movement.getCharacter(step.characterId);
      if (movement?.status === "arrived") {
        transitions.push(step.claimedAtUtcMs);
      } else if (movement?.status === "moving" && movement.plan !== null) {
        const distance = Math.hypot(
          movement.plan.destination.x - movement.position.x,
          movement.plan.destination.y - movement.position.y,
        );
        transitions.push(
          movement.plan.lastAdvancedAtUtcMs +
            Math.ceil((distance / movement.plan.speedUnitsPerSecond) * 1_000),
        );
      }
    }
    return transitions.length === 0 ? null : Math.min(...transitions);
  }
}
export interface RestaurantMealLogisticsProcessOptions {
  readonly products: Pick<KitchenProductModule, "createReadModel">;
  readonly logistics: Pick<
    LogisticsDemandModule,
    "exportState" | "createDemand" | "listCandidates"
  >;
  readonly freightElevators: Pick<
    FreightElevatorModule,
    "exportState" | "advanceTo"
  >;
  readonly groundMealLocationId: string;
}

/** Publishes and advances standard one-instance meal transport demands. */
export class RestaurantMealLogisticsProcess
  implements RestaurantApplicationProcess
{
  readonly id = "30-meal-logistics";
  readonly #options: RestaurantMealLogisticsProcessOptions;

  constructor(options: RestaurantMealLogisticsProcessOptions) {
    if (options.groundMealLocationId.trim().length === 0) {
      throw new Error("Ground meal location id is invalid.");
    }
    this.#options = options;
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    let changed = false;
    const existing = this.#options.logistics.exportState().groups;
    for (const meal of this.#options.products.createReadModel().finishedMeals) {
      if (
        meal.locationId === this.#options.groundMealLocationId ||
        existing.some(
          (group) =>
            group.ownerType === "finished-meal" &&
            group.ownerId === meal.mealId &&
            group.status !== "stopped",
        )
      ) {
        continue;
      }
      const demand = this.#options.logistics.createDemand(
        processOperationId(context, "meal-demand", meal.mealId),
        {
          id: "demand.finished-meal." + stableOperationHash(meal.mealId),
          kind: "finished-meal",
          sourceLocationId: meal.locationId,
          targetLocationId: this.#options.groundMealLocationId,
          itemId: meal.itemId,
          instanceId: meal.id,
          ownerType: "finished-meal",
          ownerId: meal.mealId,
          quantity: 1,
          occurredAtUtcMs: context.targetUtcMs,
        },
      );
      acceptedOrThrow(demand, "create finished-meal transport demand");
      changed ||= demand.changed;
    }

    const freightState = this.#options.freightElevators.exportState();
    const hasDispatchableWork =
      freightState.elevators.some(
        (elevator) =>
          elevator.phase === "idle" &&
          elevator.repair === null &&
          elevator.durability > 0,
      ) &&
      this.#options.logistics.listCandidates(context.targetUtcMs).some(
        (candidate) =>
          freightState.stationIds.includes(candidate.sourceLocationId) &&
          freightState.stationIds.includes(candidate.targetLocationId),
      );
    if (
      freightState.lastAdvancedAtUtcMs < context.targetUtcMs ||
      hasDispatchableWork
    ) {
      const advanced = this.#options.freightElevators.advanceTo(
        processOperationId(context, "freight"),
        context.targetUtcMs,
      );
      acceptedOrThrow(advanced, "advance freight elevators");
      changed ||= advanced.changed;
    }

    const transitions = this.#options.freightElevators
      .exportState()
      .elevators.flatMap((elevator) => {
        const values: number[] = [];
        if (elevator.motionEndsAtUtcMs !== null) {
          values.push(elevator.motionEndsAtUtcMs);
        }
        if (elevator.repair?.endsAtUtcMs !== undefined) {
          values.push(elevator.repair.endsAtUtcMs);
        }
        return values;
      });
    return Object.freeze({
      changed,
      nextTransitionUtcMs:
        transitions.length === 0 ? null : Math.min(...transitions),
    });
  }
}
export interface RestaurantFreightRepairProcessOptions {
  readonly freightElevators: Pick<
    FreightElevatorModule,
    "exportState" | "createTaskSourceSnapshot" | "createRepairTaskSources" | "startRepair"
  >;
  readonly tasks: Pick<
    TaskModule,
    | "createReadModel"
    | "getTask"
    | "createTask"
    | "cancelTask"
    | "claimTask"
    | "completeTask"
    | "releaseClaim"
    | "rankWaitingTasks"
  >;
  readonly candidates: RestaurantTaskCandidateProvider;
  readonly repairUnitsPerSkillLevel?: number;
}

/** Keeps freight wear repairable through the same employee task pool as restaurant work. */
export class RestaurantFreightRepairProcess
  implements RestaurantApplicationProcess
{
  readonly id = "35-freight-repair";
  readonly #options: RestaurantFreightRepairProcessOptions;
  readonly #repairUnitsPerSkillLevel: number;

  constructor(options: RestaurantFreightRepairProcessOptions) {
    this.#options = options;
    this.#repairUnitsPerSkillLevel = positiveFinite(
      options.repairUnitsPerSkillLevel ?? 1,
      "repairUnitsPerSkillLevel",
    );
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    let changed = false;
    let source = this.#options.freightElevators.createTaskSourceSnapshot();
    const activeIds = new Set(source.activeTasks.map((entry) => entry.request.taskId));
    const freightState = this.#options.freightElevators.exportState();

    for (const task of this.#options.tasks.createReadModel().inProgress) {
      if (!this.#isFreightRepairTask(task) || activeIds.has(task.taskId)) continue;
      const elevator = freightState.elevators.find((entry) => entry.id === task.target.id);
      if (elevator === undefined || elevator.repair !== null || elevator.durability < elevator.maxDurability || task.assignedCharacterId === null) {
        continue;
      }
      const completed = this.#options.tasks.completeTask(
        processOperationId(context, "repair-complete", task.taskId),
        task.taskId,
        task.assignedCharacterId,
        { elevatorId: elevator.id, durability: elevator.durability },
        context.targetUtcMs,
      );
      acceptedOrThrow(completed, `complete freight repair task ${task.taskId}`);
      changed ||= completed.changed;
    }

    source = this.#options.freightElevators.createTaskSourceSnapshot();
    const desired = new Map(source.waitingTasks.map((request) => [request.taskId, request]));
    for (const task of this.#options.tasks.createReadModel().waiting) {
      if (!this.#isFreightRepairTask(task) || desired.has(task.taskId)) continue;
      const cancelled = this.#options.tasks.cancelTask(
        processOperationId(context, "repair-cancel", task.taskId),
        task.taskId,
        "freight-repair-source-advanced",
        context.targetUtcMs,
      );
      acceptedOrThrow(cancelled, `cancel stale freight repair task ${task.taskId}`);
      changed ||= cancelled.changed;
    }
    for (const request of desired.values()) {
      if (this.#options.tasks.getTask(request.taskId) !== null) continue;
      const created = this.#options.tasks.createTask(
        processOperationId(context, "repair-create", request.taskId),
        request,
      );
      acceptedOrThrow(created, `create freight repair task ${request.taskId}`);
      changed ||= created.changed;
    }

    const repairSources = new Map(
      this.#options.freightElevators.createRepairTaskSources().map((entry) => [entry.taskId, entry]),
    );
    const busyCharacters = new Set(
      this.#options.tasks.createReadModel().inProgress
        .map((task) => task.assignedCharacterId)
        .filter((id): id is InstanceId => id !== null),
    );
    const pairs = this.#options.candidates.listCandidates(context.targetUtcMs)
      .filter((candidate) => candidate.available && !busyCharacters.has(candidate.characterId))
      .flatMap((candidate) => this.#options.tasks.rankWaitingTasks(candidate, context.targetUtcMs)
        .filter((ranked) => repairSources.has(ranked.task.taskId))
        .map((ranked) => ({ candidate, ranked })))
      .sort((left, right) =>
        right.ranked.score - left.ranked.score ||
        left.ranked.task.taskId.localeCompare(right.ranked.task.taskId) ||
        left.candidate.characterId.localeCompare(right.candidate.characterId));
    const assignedCharacters = new Set<InstanceId>();
    const assignedTasks = new Set<string>();
    for (const { candidate, ranked } of pairs) {
      if (assignedCharacters.has(candidate.characterId) || assignedTasks.has(ranked.task.taskId)) continue;
      const repairSource = repairSources.get(ranked.task.taskId);
      if (repairSource === undefined) continue;
      const claimed = this.#options.tasks.claimTask(
        processOperationId(context, "repair-claim", `${ranked.task.taskId}|${candidate.characterId}`),
        ranked.task.taskId,
        candidate,
        context.targetUtcMs,
      );
      if (!claimed.accepted) {
        if (claimed.code === "CHARACTER_BUSY" || claimed.code === "TASK_NOT_WAITING") continue;
        throw new Error(`claim freight repair task failed: ${claimed.message}`);
      }
      changed ||= claimed.changed;
      const started = this.#options.freightElevators.startRepair(
        processOperationId(context, "repair-start", ranked.task.taskId),
        {
          elevatorId: repairSource.elevatorId,
          taskId: ranked.task.taskId,
          characterId: candidate.characterId,
          repairUnitsPerSecond: Math.max(
            Number.EPSILON,
            candidate.skills.repair * this.#repairUnitsPerSkillLevel,
          ),
          occurredAtUtcMs: context.targetUtcMs,
        },
      );
      if (!started.accepted) {
        const released = this.#options.tasks.releaseClaim(
          processOperationId(context, "repair-release", ranked.task.taskId),
          ranked.task.taskId,
          candidate.characterId,
          started.code,
          context.targetUtcMs,
        );
        acceptedOrThrow(released, `release rejected freight repair task ${ranked.task.taskId}`);
        changed ||= released.changed;
        continue;
      }
      changed ||= started.changed;
      assignedCharacters.add(candidate.characterId);
      assignedTasks.add(ranked.task.taskId);
    }

    const transitions = this.#options.freightElevators.exportState().elevators
      .map((entry) => entry.repair?.endsAtUtcMs ?? null)
      .filter((value): value is number => value !== null);
    return Object.freeze({
      changed,
      nextTransitionUtcMs: transitions.length === 0 ? null : Math.min(...transitions),
    });
  }

  #isFreightRepairTask(task: TaskState): boolean {
    return task.taskType === "equipment.repair" &&
      task.source.type === "freight-elevator-group" &&
      task.target.type === "freight-elevator";
  }
}
export interface RestaurantOrderSelection {
  readonly pendingOrderId: string;
  readonly ingredientReservationId: string;
  readonly orderId: string;
  readonly lines: readonly PendingOrderLineState[];
  readonly linePrices: readonly OrderLinePriceSnapshotRequest[];
  readonly focusBonusRateBasisPoints: number;
}

export interface RestaurantOrderSelectionPolicy {
  select(
    visit: CustomerVisitState,
    menu: readonly CustomerOrderableMenuItem[],
    nowUtcMs: number,
  ): RestaurantOrderSelection | null;
}

/** Deterministic baseline NPC choice: each diner takes the first orderable dish. */
export class FirstOrderableRestaurantOrderSelectionPolicy
  implements RestaurantOrderSelectionPolicy
{
  select(
    visit: CustomerVisitState,
    menu: readonly CustomerOrderableMenuItem[],
    _nowUtcMs: number,
  ): RestaurantOrderSelection | null {
    const selected = menu.find((item) => item.orderable);
    if (selected === undefined) return null;
    const key = stableOperationHash(visit.id);
    const lineId = "line.customer." + key;
    return Object.freeze({
      pendingOrderId: "pending.customer." + key,
      ingredientReservationId: "reservation.customer." + key,
      orderId: "order.customer." + key,
      lines: Object.freeze([
        Object.freeze({
          id: lineId,
          recipeId: selected.recipeId,
          quantity: visit.memberCharacterIds.length,
          dinerCharacterIds: Object.freeze([...visit.memberCharacterIds]),
        }),
      ]),
      linePrices: Object.freeze([
        Object.freeze({
          lineId,
          baseUnitPriceCopper: selected.baseUnitPriceCopper,
          businessAdjustmentCopper: 0,
          transactionUnitPriceCopper: selected.baseUnitPriceCopper,
        }),
      ]),
      focusBonusRateBasisPoints: 0,
    });
  }
}

type RestaurantServicePort = Pick<
  ServiceModule,
  | "exportState"
  | "createTaskSourceSnapshot"
  | "synchronizeTasks"
  | "startTask"
  | "completeReception"
  | "recordOrderAtTable"
  | "submitRecordedOrder"
  | "completeCheckout"
>;

export type RestaurantServiceMovementPhase =
  | "work-target"
  | "order-transfer"
  | "meal-pickup"
  | "dishware-source"
  | "dishware-handoff";

export interface RestaurantServiceMovementTargetPolicy {
  resolveTarget(
    workflow: ServiceWorkflowState,
    phase: RestaurantServiceMovementPhase,
    logicalTarget: MovementTargetReference,
  ): MovementTargetReference | null;
}

export interface RestaurantServiceAreaTransferOptions {
  readonly elevator: Pick<
    PersonnelElevatorModule,
    "exportState" | "createCrossAreaPlan" | "requestTransfer"
  >;
  readonly stationTarget: (stationId: string) => MovementTargetReference;
}
export interface RestaurantServiceMovementOptions {
  readonly movement: Pick<
    MovementModule,
    "getCharacter" | "beginMovement" | "advanceCharacter" | "releaseTask"
  >;
  readonly targets: RestaurantServiceMovementTargetPolicy;
  readonly defaultSpeedUnitsPerSecond: number;
  readonly speedForCharacter?: (characterId: InstanceId) => number;
  readonly areaTransfer?: RestaurantServiceAreaTransferOptions;
}
export class RestaurantServiceMovementGate {
  readonly #options: RestaurantServiceMovementOptions;
  #nextTransitionUtcMs: number | null = null;

  constructor(options: RestaurantServiceMovementOptions) {
    if (!Number.isFinite(options.defaultSpeedUnitsPerSecond) || options.defaultSpeedUnitsPerSecond <= 0) {
      throw new Error("Restaurant service movement speed is invalid.");
    }
    this.#options = options;
  }

  startCycle(): void { this.#nextTransitionUtcMs = null; }
  getNextTransitionUtcMs(): number | null { return this.#nextTransitionUtcMs; }

  reach(
    workflow: ServiceWorkflowState,
    phase: RestaurantServiceMovementPhase,
    context: RestaurantApplicationProcessContext,
    logicalTarget: MovementTargetReference = workflow.request.target,
  ): { readonly ready: boolean; readonly changed: boolean } {
    const target = this.#options.targets.resolveTarget(workflow, phase, logicalTarget);
    if (target === null) return Object.freeze({ ready: true, changed: false });
    const movementTaskId = this.#movementTaskId(workflow, phase);
    let character = this.#options.movement.getCharacter(workflow.assignedCharacterId);
    if (character === null) {
      throw new Error(`Service character is not registered for movement: ${workflow.assignedCharacterId}`);
    }
    const elevatorState = this.#options.areaTransfer?.elevator.exportState();
    const elevatorRequest = elevatorState === undefined
      ? undefined
      : [elevatorState.activeRequest, ...elevatorState.queue]
          .find((entry) => entry?.characterId === workflow.assignedCharacterId);
    if (elevatorRequest !== undefined && elevatorRequest !== null) {
      this.#schedule(elevatorState?.phaseEndsAtUtcMs ?? context.targetUtcMs + 1);
      return Object.freeze({ ready: false, changed: false });
    }

    let changed = false;
    if (character.plan !== null) {
      if (character.plan.taskId !== movementTaskId) {
        throw new Error(`Service character owns another movement task: ${workflow.assignedCharacterId}`);
      }
      const isOriginalTarget = this.#sameTarget(character.plan.target, target);
      if (character.status !== "arrived") {
        if (character.plan.lastAdvancedAtUtcMs >= context.targetUtcMs) {
          this.#scheduleArrival(character, context.targetUtcMs);
          return Object.freeze({ ready: false, changed: false });
        }
        const advanced = this.#options.movement.advanceCharacter(
          processOperationId(context, "service-move-advance", movementTaskId),
          workflow.assignedCharacterId,
          context.targetUtcMs,
        );
        if (!advanced.accepted) throw new Error(`advance service movement failed: ${advanced.message}`);
        character = advanced.value;
        changed ||= advanced.changed;
        if (character.status !== "arrived") {
          this.#scheduleArrival(character, context.targetUtcMs);
          return Object.freeze({ ready: false, changed });
        }
      }
      if (isOriginalTarget) return Object.freeze({ ready: true, changed });
      const released = this.#options.movement.releaseTask(
        processOperationId(context, "service-station-release", movementTaskId),
        workflow.assignedCharacterId,
        movementTaskId,
        context.targetUtcMs,
      );
      if (!released.accepted) throw new Error(`release personnel-elevator station approach failed: ${released.message}`);
      changed ||= released.changed;
      character = released.value;
    }

    const speed = this.#options.speedForCharacter?.(workflow.assignedCharacterId) ?? this.#options.defaultSpeedUnitsPerSecond;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(`Service character movement speed is invalid: ${workflow.assignedCharacterId}`);
    }
    const begun = this.#options.movement.beginMovement(
      processOperationId(context, "service-move-begin", movementTaskId),
      {
        characterId: workflow.assignedCharacterId,
        taskId: movementTaskId,
        target,
        speedUnitsPerSecond: speed,
        occurredAtUtcMs: context.targetUtcMs,
      },
    );
    if (!begun.accepted) {
      if (begun.code === "INTERACTION_CAPACITY_FULL") {
        this.#schedule(context.targetUtcMs + 250);
        return Object.freeze({ ready: false, changed });
      }
      if (begun.code === "REGION_CONNECTION_REQUIRED") {
        const fromAreaId = begun.details?.fromAreaId;
        const toAreaId = begun.details?.toAreaId;
        if (fromAreaId === undefined || toAreaId === undefined) {
          throw new Error("Movement did not identify the required area connection.");
        }
        const transfer = this.#beginAreaTransfer(
          workflow,
          movementTaskId,
          speed,
          fromAreaId,
          toAreaId,
          context,
        );
        return Object.freeze({ ready: false, changed: transfer || changed });
      }
      throw new Error(`begin service movement failed: ${begun.code}: ${begun.message}`);
    }
    character = begun.value;
    changed ||= begun.changed;
    if (character.status === "arrived") return Object.freeze({ ready: true, changed });
    this.#scheduleArrival(character, context.targetUtcMs);
    return Object.freeze({ ready: false, changed });
  }

  #beginAreaTransfer(
    workflow: ServiceWorkflowState,
    movementTaskId: string,
    speedUnitsPerSecond: number,
    fromAreaId: string,
    toAreaId: string | undefined,
    context: RestaurantApplicationProcessContext,
  ): boolean {
    const areaTransfer = this.#options.areaTransfer;
    if (areaTransfer === undefined || toAreaId === undefined) {
      throw new Error(`Service route requires an unconfigured area connection: ${fromAreaId} -> ${toAreaId ?? "unknown"}`);
    }
    const crossAreaPlan = areaTransfer.elevator.createCrossAreaPlan(fromAreaId, toAreaId);
    const walk = crossAreaPlan.steps.find((step) => step.type === "walk-to-station");
    const ride = crossAreaPlan.steps.find((step) => step.type === "ride-elevator");
    if (walk === undefined || ride === undefined) throw new Error("Personnel elevator route plan is incomplete.");
    const stationMovement = this.#options.movement.beginMovement(
      processOperationId(context, "service-station-begin", movementTaskId),
      {
        characterId: workflow.assignedCharacterId,
        taskId: movementTaskId,
        target: areaTransfer.stationTarget(walk.stationId),
        speedUnitsPerSecond,
        occurredAtUtcMs: context.targetUtcMs,
      },
    );
    if (!stationMovement.accepted) {
      throw new Error(`begin personnel-elevator approach failed: ${stationMovement.message}`);
    }
    if (stationMovement.value.status !== "arrived") {
      this.#scheduleArrival(stationMovement.value, context.targetUtcMs);
      return stationMovement.changed;
    }
    const released = this.#options.movement.releaseTask(
      processOperationId(context, "service-station-ready-release", movementTaskId),
      workflow.assignedCharacterId,
      movementTaskId,
      context.targetUtcMs,
    );
    acceptedOrThrow(released, "release personnel-elevator station approach");
    const requestId = `personnel-route.${stableOperationHash(`${movementTaskId}|${fromAreaId}|${toAreaId}`)}`;
    const requested = areaTransfer.elevator.requestTransfer(
      processOperationId(context, "service-elevator-request", requestId),
      {
        id: requestId,
        characterId: workflow.assignedCharacterId,
        fromStationId: ride.fromStationId,
        toStationId: ride.toStationId,
        requestedAtUtcMs: context.targetUtcMs,
      },
    );
    if (!requested.accepted) throw new Error(`request personnel elevator failed: ${requested.message}`);
    this.#schedule(context.targetUtcMs + 1);
    return stationMovement.changed || released.changed || requested.changed;
  }

  #sameTarget(left: MovementTargetReference, right: MovementTargetReference): boolean {
    return left.type === right.type && left.id === right.id && left.interactionId === right.interactionId;
  }
  release(
    workflow: ServiceWorkflowState,
    phase: RestaurantServiceMovementPhase,
    context: RestaurantApplicationProcessContext,
  ): boolean {
    const movementTaskId = this.#movementTaskId(workflow, phase);
    const character = this.#options.movement.getCharacter(workflow.assignedCharacterId);
    if (character?.plan?.taskId !== movementTaskId) return false;
    const released = this.#options.movement.releaseTask(
      processOperationId(context, "service-move-release", movementTaskId),
      workflow.assignedCharacterId,
      movementTaskId,
      context.targetUtcMs,
    );
    acceptedOrThrow(released, "release service movement");
    return released.changed;
  }

  #movementTaskId(workflow: ServiceWorkflowState, phase: RestaurantServiceMovementPhase): string {
    return `service-route.${phase}.${stableOperationHash(workflow.taskId)}`;
  }

  #scheduleArrival(character: NonNullable<ReturnType<MovementModule["getCharacter"]>>, nowUtcMs: number): void {
    if (character.plan === null) return;
    const distance = Math.hypot(
      character.plan.destination.x - character.position.x,
      character.plan.destination.y - character.position.y,
    );
    const travelMs = Math.max(1, Math.ceil(distance / character.plan.speedUnitsPerSecond * 1_000));
    this.#schedule(Math.max(nowUtcMs + 1, character.plan.lastAdvancedAtUtcMs + travelMs));
  }

  #schedule(atUtcMs: number): void {
    this.#nextTransitionUtcMs = this.#nextTransitionUtcMs === null
      ? atUtcMs
      : Math.min(this.#nextTransitionUtcMs, atUtcMs);
  }
}
export interface RestaurantServiceWorkProcessOptions {
  readonly customers: Pick<
    CustomerModule,
    | "exportState"
    | "createReadModel"
    | "getVisit"
    | "getOrderableMenu"
    | "advanceTo"
    | "confirmDeparted"
  >;
  readonly orders: Pick<OrderModule, "exportState">;
  readonly service: RestaurantServicePort;
  readonly trayDelivery: Pick<
    TrayDeliveryModule,
    "createReadModel" | "getNextTableId" | "pickupBatch" | "deliverNextTable"
  >;
  readonly tasks: Pick<TaskModule, "createReadModel" | "rankWaitingTasks">;
  readonly candidates: RestaurantTaskCandidateProvider;
  readonly orderSelection?: RestaurantOrderSelectionPolicy;
  readonly settlementRegionId: string;
  readonly movement?: RestaurantServiceMovementOptions;
}

/**
 * Logical restaurant service coordinator. Physical waiter routing is attached
 * separately, while this process preserves the Service/Task workflow stages.
 */
export class RestaurantServiceWorkProcess
  implements RestaurantApplicationProcess
{
  readonly id = "40-service-work";
  readonly #options: RestaurantServiceWorkProcessOptions;
  readonly #orderSelection: RestaurantOrderSelectionPolicy;
  #observedCustomerRevision = -1;
  #observedOrderRevision = -1;
  #lastCustomerAdvanceCycle = -1;
  readonly #movementGate: RestaurantServiceMovementGate | null;

  constructor(options: RestaurantServiceWorkProcessOptions) {
    if (options.settlementRegionId.trim().length === 0) {
      throw new Error("Settlement region id is invalid.");
    }
    if (
      options.movement !== undefined &&
      (!Number.isFinite(options.movement.defaultSpeedUnitsPerSecond) ||
        options.movement.defaultSpeedUnitsPerSecond <= 0)
    ) {
      throw new Error("Restaurant service movement speed is invalid.");
    }
    this.#options = options;
    this.#movementGate = options.movement === undefined ? null : new RestaurantServiceMovementGate(options.movement);
    this.#orderSelection =
      options.orderSelection ??
      new FirstOrderableRestaurantOrderSelectionPolicy();
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    this.#movementGate?.startCycle();
    const customerChanged = this.#advanceCustomers(context);
    const workflowChanged = this.#completeWorkflows(context);
    const taskSyncChanged = this.#synchronizeTasks(context);
    const claimChanged = this.#claimAvailableWork(context);
    const changed =
      customerChanged || workflowChanged || taskSyncChanged || claimChanged;

    const transitions = this.#options.customers
      .createReadModel()
      .activeVisits.flatMap((visit) =>
        visit.mealProgress
          .filter((progress) => progress.consumedAtUtcMs === null)
          .map((progress) => progress.completesAtUtcMs),
      );
    const movementTransitionUtcMs = this.#movementGate?.getNextTransitionUtcMs() ?? null;
    if (movementTransitionUtcMs !== null) transitions.push(movementTransitionUtcMs);
    return Object.freeze({
      changed,
      nextTransitionUtcMs:
        transitions.length === 0 ? null : Math.min(...transitions),
    });
  }

  #advanceCustomers(context: RestaurantApplicationProcessContext): boolean {
    let changed = false;
    const customerState = this.#options.customers.exportState();
    const orderState = this.#options.orders.exportState();
    if (
      this.#lastCustomerAdvanceCycle !== context.cycle &&
      (customerState.lastAdvancedAtUtcMs < context.targetUtcMs ||
      customerState.revision !== this.#observedCustomerRevision ||
      orderState.revision !== this.#observedOrderRevision)
    ) {
      const advanced = this.#options.customers.advanceTo(
        processOperationId(context, "customers"),
        context.targetUtcMs,
      );
      acceptedOrThrow(advanced, "advance customers");
      changed ||= advanced.changed;
      this.#observedCustomerRevision =
        this.#options.customers.exportState().revision;
      this.#observedOrderRevision = this.#options.orders.exportState().revision;
      this.#lastCustomerAdvanceCycle = context.cycle;
    }

    for (const visit of this.#options.customers
      .createReadModel()
      .activeVisits.filter((entry) => entry.phase === "departing")) {
      const departed = this.#options.customers.confirmDeparted(
        processOperationId(context, "depart", visit.id),
        visit.id,
        context.targetUtcMs,
      );
      acceptedOrThrow(departed, "confirm customer departure");
      changed ||= departed.changed;
    }
    this.#observedCustomerRevision =
      this.#options.customers.exportState().revision;
    return changed;
  }

  #completeWorkflows(context: RestaurantApplicationProcessContext): boolean {
    let changed = false;
    const workflows = [...this.#options.service.exportState().workflows].sort(
      (left, right) => left.taskId.localeCompare(right.taskId),
    );
    for (const workflow of workflows) {
      if (workflow.kind === "reception") {
        const reached = this.#reachServiceTarget(workflow, "work-target", context);
        changed ||= reached.changed;
        if (!reached.ready) continue;
        const completed = this.#options.service.completeReception(
          processOperationId(context, "reception", workflow.taskId),
          workflow.taskId,
          context.targetUtcMs,
        );
        acceptedOrThrow(completed, "complete reception");
        changed ||= completed.changed;
        changed = this.#releaseServiceTarget(workflow, "work-target", context) || changed;
        continue;
      }
      if (workflow.kind === "take-order") {
        if (workflow.stage === "active") {
          const reached = this.#reachServiceTarget(workflow, "work-target", context);
          changed ||= reached.changed;
          if (!reached.ready) continue;
          const visit = this.#options.customers.getVisit(workflow.sourceId);
          if (visit === null) continue;
          const selection = this.#orderSelection.select(
            visit,
            this.#options.customers.getOrderableMenu(visit.id),
            context.targetUtcMs,
          );
          if (selection === null) continue;
          const recorded = this.#options.service.recordOrderAtTable(
            processOperationId(context, "record-order", workflow.taskId),
            workflow.taskId,
            {
              pendingOrderId: selection.pendingOrderId,
              ingredientReservationId: selection.ingredientReservationId,
              lines: selection.lines,
              submission: {
                orderId: selection.orderId,
                linePrices: selection.linePrices,
                focusBonusRateBasisPoints: selection.focusBonusRateBasisPoints,
              },
              occurredAtUtcMs: context.targetUtcMs,
            },
          );
          acceptedOrThrow(recorded, "record customer order");
          changed ||= recorded.changed;
          changed = this.#releaseServiceTarget(workflow, "work-target", context) || changed;
          continue;
        }
        const reached = this.#reachServiceTarget(workflow, "order-transfer", context);
        changed ||= reached.changed;
        if (!reached.ready) continue;
        const submission = workflow.recordedSubmission ?? null;
        if (submission === null) {
          throw new Error("Recorded restaurant order is missing its submission snapshot.");
        }
        const submitted = this.#options.service.submitRecordedOrder(
          processOperationId(context, "submit-order", workflow.taskId),
          workflow.taskId,
          { ...submission, occurredAtUtcMs: context.targetUtcMs },
        );
        acceptedOrThrow(submitted, "submit customer order");
        changed ||= submitted.changed;
        changed = this.#releaseServiceTarget(workflow, "order-transfer", context) || changed;
        continue;
      }
      if (workflow.kind === "checkout") {
        const reached = this.#reachServiceTarget(workflow, "work-target", context);
        changed ||= reached.changed;
        if (!reached.ready) continue;
        const checkout = this.#options.service.completeCheckout(
          processOperationId(context, "checkout", workflow.taskId),
          workflow.taskId,
          {
            settlementBatchId: "settlement." + stableOperationHash(workflow.sourceId),
            regionId: this.#options.settlementRegionId,
            occurredAtUtcMs: context.targetUtcMs,
          },
        );
        acceptedOrThrow(checkout, "complete checkout");
        changed ||= checkout.changed;
        changed = this.#releaseServiceTarget(workflow, "work-target", context) || changed;
        continue;
      }
      if (workflow.kind === "deliver-meal") {
        let batch = this.#options.trayDelivery
          .createReadModel()
          .activeBatches.find((entry) => entry.leadServiceTaskId === workflow.taskId);
        if (batch === undefined) {
          const reached = this.#reachServiceTarget(workflow, "meal-pickup", context);
          changed ||= reached.changed;
          if (!reached.ready) continue;
          const pickedUp = this.#options.trayDelivery.pickupBatch(
            processOperationId(context, "tray-pickup", workflow.taskId),
            "tray." + stableOperationHash(workflow.taskId),
            workflow.taskId,
            context.targetUtcMs,
          );
          if (!pickedUp.accepted) {
            throw new Error("pick up tray batch failed: " + pickedUp.message);
          }
          batch = pickedUp.value;
          changed ||= pickedUp.changed;
          changed = this.#releaseServiceTarget(workflow, "meal-pickup", context) || changed;
        }
        if (batch.status === "delivering") {
          const nextTableId = this.#options.trayDelivery.getNextTableId(batch.id);
          if (nextTableId === null) continue;
          const reached = this.#reachServiceTarget(
            workflow,
            "work-target",
            context,
            { type: "table", id: nextTableId },
          );
          changed ||= reached.changed;
          if (!reached.ready) continue;
          const delivered = this.#options.trayDelivery.deliverNextTable(
            processOperationId(context, "tray-deliver", batch.id),
            batch.id,
            context.targetUtcMs,
          );
          acceptedOrThrow(delivered, "deliver tray batch");
          changed ||= delivered.changed;
          changed = this.#releaseServiceTarget(workflow, "work-target", context) || changed;
        }
      }
    }
    return changed;
  }

  #reachServiceTarget(
    workflow: ServiceWorkflowState,
    phase: RestaurantServiceMovementPhase,
    context: RestaurantApplicationProcessContext,
    logicalTarget: MovementTargetReference = workflow.request.target,
  ): { readonly ready: boolean; readonly changed: boolean } {
    return this.#movementGate?.reach(workflow, phase, context, logicalTarget) ??
      Object.freeze({ ready: true, changed: false });
  }

  #releaseServiceTarget(
    workflow: ServiceWorkflowState,
    phase: RestaurantServiceMovementPhase,
    context: RestaurantApplicationProcessContext,
  ): boolean {
    return this.#movementGate?.release(workflow, phase, context) ?? false;
  }
  #synchronizeTasks(context: RestaurantApplicationProcessContext): boolean {
    const desired = new Set(
      this.#options.service
        .createTaskSourceSnapshot()
        .waitingTasks.map((task) => task.taskId),
    );
    const waiting = this.#options.tasks.createReadModel().waiting;
    const needsSync =
      [...desired].some(
        (taskId) => !waiting.some((task) => task.taskId === taskId),
      ) ||
      waiting.some(
        (task) =>
          task.taskType.startsWith("service.") && !desired.has(task.taskId),
      );
    if (!needsSync) return false;
    const synchronized = this.#options.service.synchronizeTasks(
      processOperationId(context, "service-tasks"),
      context.targetUtcMs,
    );
    acceptedOrThrow(synchronized, "synchronize service tasks");
    return synchronized.changed;
  }

  #claimAvailableWork(context: RestaurantApplicationProcessContext): boolean {
    const supportedKinds = new Set([
      "service.reception",
      "service.take-order",
      "service.deliver-meal",
      "service.checkout",
      "service.clean-table",
      "service.supply-plate",
    ]);
    const busy = new Set(
      this.#options.tasks
        .createReadModel()
        .inProgress.map((task) => task.assignedCharacterId)
        .filter((id): id is InstanceId => id !== null),
    );
    const pairs = this.#options.candidates
      .listCandidates(context.targetUtcMs)
      .filter((candidate) => candidate.available && !busy.has(candidate.characterId))
      .flatMap((candidate) =>
        this.#options.tasks
          .rankWaitingTasks(candidate, context.targetUtcMs)
          .filter((ranked) => supportedKinds.has(ranked.task.taskType))
          .map((ranked) => ({ candidate, ranked })),
      )
      .sort(
        (left, right) =>
          right.ranked.score - left.ranked.score ||
          left.ranked.task.taskId.localeCompare(right.ranked.task.taskId) ||
          left.candidate.characterId.localeCompare(right.candidate.characterId),
      );

    const assignedCharacters = new Set<InstanceId>();
    const assignedTasks = new Set<string>();
    let changed = false;
    for (const { candidate, ranked } of pairs) {
      if (
        assignedCharacters.has(candidate.characterId) ||
        assignedTasks.has(ranked.task.taskId)
      ) {
        continue;
      }
      const started = this.#options.service.startTask(
        processOperationId(
          context,
          "service-start",
          ranked.task.taskId + "|" + candidate.characterId,
        ),
        ranked.task.taskId,
        candidate,
        context.targetUtcMs,
      );
      if (!started.accepted) {
        if (started.code === "TASK_REJECTED") continue;
        throw new Error("start service task failed: " + started.message);
      }
      changed ||= started.changed;
      assignedCharacters.add(candidate.characterId);
      assignedTasks.add(ranked.task.taskId);
    }
    return changed;
  }
}
export interface RestaurantDishwareWorkProcessOptions {
  readonly dishwareService: Pick<
    DishwareServiceModule,
    | "exportState"
    | "synchronizeConsumedMeals"
    | "pickupSupplyPlate"
    | "pickupDirtyTable"
    | "deliverDirtyToCabinet"
    | "refreshSupplyJobs"
    | "handoffSupplyPlate"
    | "advanceWashing"
  >;
  readonly dishware: Pick<DishwareModule, "getSnapshot">;
  readonly service: Pick<ServiceModule, "exportState">;
  readonly movement?: RestaurantServiceMovementOptions;
}

/** Completes dirty-table, washing and clean-plate replenishment workflows. */
export class RestaurantDishwareWorkProcess
  implements RestaurantApplicationProcess
{
  readonly id = "50-dishware-work";
  readonly #options: RestaurantDishwareWorkProcessOptions;
  readonly #movementGate: RestaurantServiceMovementGate | null;
  #lastRefreshCycle = -1;

  constructor(options: RestaurantDishwareWorkProcessOptions) {
    this.#options = options;
    this.#movementGate = options.movement === undefined ? null : new RestaurantServiceMovementGate(options.movement);
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    this.#movementGate?.startCycle();
    let changed = false;
    const dishwareBefore = this.#options.dishware.getSnapshot();
    if (dishwareBefore.currentUtcMs < context.targetUtcMs) {
      const washed = this.#options.dishwareService.advanceWashing(
        processOperationId(context, "washing"),
        context.targetUtcMs,
      );
      acceptedOrThrow(washed, "advance dishware washing");
      changed ||= washed.changed;
    }

    const consumed = this.#options.dishwareService.synchronizeConsumedMeals(
      processOperationId(context, "dirty-meals"),
      context.targetUtcMs,
    );
    acceptedOrThrow(consumed, "synchronize consumed meal plates");
    changed ||= consumed.changed;

    if (this.#lastRefreshCycle !== context.cycle) {
      const refreshed = this.#options.dishwareService.refreshSupplyJobs(
        processOperationId(context, "plate-supply"),
        context.targetUtcMs,
      );
      if (!refreshed.accepted) {
        throw new Error(
          "refresh clean plate supply jobs failed: " + refreshed.message,
        );
      }
      changed ||= refreshed.value.length > 0;
      this.#lastRefreshCycle = context.cycle;
    }

    for (const workflow of this.#options.service
      .exportState()
      .workflows.filter(
        (entry) => entry.kind === "clean-table" || entry.kind === "supply-plate",
      )) {
      if (workflow.kind === "supply-plate") {
        let job = this.#options.dishwareService
          .exportState()
          .supplyJobs.find((entry) => entry.id === workflow.sourceId);
        if (job === undefined) continue;
        if (job.status === "waiting-service") {
          const reachedSource = this.#movementGate?.reach(
            workflow,
            "dishware-source",
            context,
            { type: "inventory-location", id: job.sourceLocationId },
          ) ?? Object.freeze({ ready: true, changed: false });
          changed ||= reachedSource.changed;
          if (!reachedSource.ready) continue;
          if (this.#movementGate !== null) {
            const pickedUp = this.#options.dishwareService.pickupSupplyPlate(
              processOperationId(context, "plate-pickup", workflow.taskId),
              workflow.taskId,
              context.targetUtcMs,
            );
            if (!pickedUp.accepted) throw new Error(`pick up clean plate failed: ${pickedUp.message}`);
            changed ||= pickedUp.changed;
            changed = this.#movementGate.release(workflow, "dishware-source", context) || changed;
            job = pickedUp.value;
          }
        }
        const reachedHandoff = this.#movementGate?.reach(
          workflow,
          "dishware-handoff",
          context,
          { type: "inventory-location", id: job.handoffLocationId },
        ) ?? Object.freeze({ ready: true, changed: false });
        changed ||= reachedHandoff.changed;
        if (!reachedHandoff.ready) continue;
        const handed = this.#options.dishwareService.handoffSupplyPlate(
          processOperationId(context, "plate-handoff", workflow.taskId),
          workflow.taskId,
          context.targetUtcMs,
        );
        acceptedOrThrow(handed, "hand off clean plate");
        changed ||= handed.changed;
        if (this.#movementGate !== null) {
          changed = this.#movementGate.release(workflow, "dishware-handoff", context) || changed;
        }
        continue;
      }

      let existing = this.#options.dishwareService
        .exportState()
        .cleanupWorkflows.find((entry) => entry.serviceTaskId === workflow.taskId);
      if (existing === undefined) {
        const reachedTable = this.#movementGate?.reach(workflow, "work-target", context) ??
          Object.freeze({ ready: true, changed: false });
        changed ||= reachedTable.changed;
        if (!reachedTable.ready) continue;
        const pickedUp = this.#options.dishwareService.pickupDirtyTable(
          processOperationId(context, "dirty-pickup", workflow.taskId),
          workflow.taskId,
          context.targetUtcMs,
        );
        if (!pickedUp.accepted) throw new Error(`pick up dirty table failed: ${pickedUp.message}`);
        changed ||= pickedUp.changed;
        if (this.#movementGate !== null) {
          changed = this.#movementGate.release(workflow, "work-target", context) || changed;
        }
        existing = pickedUp.value;
      }
      const reachedCabinet = this.#movementGate?.reach(
        workflow,
        "dishware-source",
        context,
        { type: "cabinet", id: existing.cabinetId },
      ) ?? Object.freeze({ ready: true, changed: false });
      changed ||= reachedCabinet.changed;
      if (!reachedCabinet.ready) continue;
      const delivered = this.#options.dishwareService.deliverDirtyToCabinet(
        processOperationId(context, "dirty-return", workflow.taskId),
        workflow.taskId,
        context.targetUtcMs,
      );
      acceptedOrThrow(delivered, "return dirty plates to cabinet");
      changed ||= delivered.changed;
      if (this.#movementGate !== null) {
        changed = this.#movementGate.release(workflow, "dishware-source", context) || changed;
      }
    }
    const transitions = this.#options.dishware
      .getSnapshot()
      .washJobs.map((job) => job.completesAtUtcMs);
    const movementTransitionUtcMs = this.#movementGate?.getNextTransitionUtcMs() ?? null;
    if (movementTransitionUtcMs !== null) transitions.push(movementTransitionUtcMs);
    return Object.freeze({
      changed,
      nextTransitionUtcMs: transitions.length === 0 ? null : Math.min(...transitions),
    });
  }
}
export interface RestaurantPersonnelElevatorProcessOptions {
  readonly elevator: Pick<
    PersonnelElevatorModule,
    "exportState" | "advanceTo"
  >;
  readonly movement: Pick<MovementModule, "completeAreaTransfer">;
}

/** Advances queued personnel rides and commits completed area handoffs. */
export class RestaurantPersonnelElevatorProcess
  implements RestaurantApplicationProcess
{
  readonly id = "60-personnel-elevator";
  readonly #options: RestaurantPersonnelElevatorProcessOptions;

  constructor(options: RestaurantPersonnelElevatorProcessOptions) {
    this.#options = options;
  }

  advance(
    context: RestaurantApplicationProcessContext,
  ): RestaurantApplicationProcessResult {
    const state = this.#options.elevator.exportState();
    const queuedReady =
      state.phase === "idle" &&
      state.queue.some(
        (request) => request.requestedAtUtcMs <= context.targetUtcMs,
      );
    let changed = false;
    if (state.lastAdvancedAtUtcMs < context.targetUtcMs || queuedReady) {
      const advanced = this.#options.elevator.advanceTo(
        processOperationId(context, "personnel-elevator"),
        context.targetUtcMs,
      );
      if (!advanced.accepted) {
        throw new Error("advance personnel elevator failed: " + advanced.message);
      }
      changed ||= advanced.changed;
      for (const event of advanced.events.filter(
        (entry) => entry.type === "personnel-elevator.transfer-completed",
      )) {
        const payload = event.payload as {
          readonly requestId: string;
          readonly characterId: InstanceId;
          readonly navigationAreaId: string;
          readonly exitPoint: { readonly x: number; readonly y: number };
        };
        const handedOff = this.#options.movement.completeAreaTransfer(
          processOperationId(context, "area-handoff", payload.requestId),
          payload.characterId,
          payload.navigationAreaId,
          payload.exitPoint,
          event.occurredAtUtcMs,
        );
        acceptedOrThrow(handedOff, "complete personnel area transfer");
        changed ||= handedOff.changed;
      }
    }

    const current = this.#options.elevator.exportState();
    const nextTransitionUtcMs =
      current.phaseEndsAtUtcMs ??
      (current.queue.length === 0
        ? null
        : Math.min(...current.queue.map((request) => request.requestedAtUtcMs)));
    return Object.freeze({ changed, nextTransitionUtcMs });
  }
}
export interface RestaurantProcurementProcessOptions {
  readonly procurement: Pick<
    LocalProcurementModule,
    "exportState" | "advanceTo" | "startBatch" | "startRemoteBatch"
  >;
  readonly automatic: Pick<AutomaticProcurementModule, "exportState" | "reconcile">;
  readonly fleet: Pick<FleetModule, "createReadModel" | "advanceTo" | "getVoyage">;
  readonly candidates: RestaurantTaskCandidateProvider;
  readonly activeRegionId: string;
  readonly minuteOfDayAt: (utcMs: number) => number;
  readonly automaticIntervalMs?: number;
}

/** Coordinates local carts, remote airships and manager-driven restocking. */
export class RestaurantProcurementProcess implements RestaurantApplicationProcess {
  readonly id = "70-procurement";
  readonly #options: RestaurantProcurementProcessOptions;
  readonly #automaticIntervalMs: number;

  constructor(options: RestaurantProcurementProcessOptions) {
    const interval = options.automaticIntervalMs ?? 30_000;
    if (options.activeRegionId.trim().length === 0 || !Number.isSafeInteger(interval) || interval <= 0) {
      throw new Error("Restaurant procurement process options are invalid.");
    }
    this.#options = options;
    this.#automaticIntervalMs = interval;
  }

  advance(context: RestaurantApplicationProcessContext): RestaurantApplicationProcessResult {
    let changed = false;
    const fleetAdvance = this.#options.fleet.advanceTo(
      processOperationId(context, "procurement-fleet"),
      context.targetUtcMs,
    );
    acceptedOrThrow(fleetAdvance, "advance procurement fleet");
    changed ||= fleetAdvance.changed;

    const procurementState = this.#options.procurement.exportState();
    const due = procurementState.batches.some((batch) =>
        (batch.status === "preparing" && batch.preparationEndsAtUtcMs <= context.targetUtcMs) ||
        (batch.status === "in-transit" && batch.arrivesAtUtcMs !== null && batch.arrivesAtUtcMs <= context.targetUtcMs &&
          (batch.transportMode === "local" ||
            (batch.voyageId !== null && this.#options.fleet.getVoyage(batch.voyageId)?.status === "awaiting-handoff"))),
      );
    if (due) {
      const advanced = this.#options.procurement.advanceTo(
        processOperationId(context, "procurement-advance"),
        context.targetUtcMs,
      );
      acceptedOrThrow(advanced, "advance procurement");
      changed ||= advanced.changed;
    }

    const automaticState = this.#options.automatic.exportState();
    const automaticRegion = automaticState.regions.find((entry) => entry.regionId === this.#options.activeRegionId);
    if (automaticRegion?.enabled === true &&
      context.targetUtcMs - automaticState.lastReconciledAtUtcMs >= this.#automaticIntervalMs) {
      const reconciled = this.#options.automatic.reconcile(
        processOperationId(context, "procurement-automatic"),
        {
          activeRegionId: this.#options.activeRegionId,
          minuteOfDay: this.#options.minuteOfDayAt(context.targetUtcMs),
          occurredAtUtcMs: context.targetUtcMs,
        },
      );
      acceptedOrThrow(reconciled, "reconcile automatic procurement");
      changed ||= reconciled.changed;
    }

    const dispatched = this.#dispatchWaiting(context);
    changed ||= dispatched;
    const state = this.#options.procurement.exportState();
    const transitions = state.batches.flatMap((batch) => {
      if (batch.status === "preparing") return [batch.preparationEndsAtUtcMs];
      if (batch.status === "in-transit" && batch.arrivesAtUtcMs !== null) return [batch.arrivesAtUtcMs];
      return [];
    });
    const fleetReadModel = this.#options.fleet.createReadModel(context.targetUtcMs);
    transitions.push(...fleetReadModel.voyages
      .filter((voyage) => voyage.status === "in-transit" && voyage.returnsAtUtcMs > context.targetUtcMs)
      .map((voyage) => voyage.returnsAtUtcMs));
    transitions.push(...fleetReadModel.ships
      .filter((ship) => ship.cooldownEndsAtUtcMs > context.targetUtcMs)
      .map((ship) => ship.cooldownEndsAtUtcMs));
    const nextAutomatic = this.#options.automatic.exportState().regions
      .some((entry) => entry.regionId === this.#options.activeRegionId && entry.enabled)
      ? this.#options.automatic.exportState().lastReconciledAtUtcMs + this.#automaticIntervalMs
      : null;
    if (nextAutomatic !== null && nextAutomatic > context.targetUtcMs) transitions.push(nextAutomatic);
    return Object.freeze({
      changed,
      nextTransitionUtcMs: transitions.length === 0 ? null : Math.min(...transitions),
    });
  }

  #dispatchWaiting(context: RestaurantApplicationProcessContext): boolean {
    const state = this.#options.procurement.exportState();
    const waiting = state.batches
      .filter((batch) => batch.status === "waiting")
      .sort((left, right) => left.preparationEndsAtUtcMs - right.preparationEndsAtUtcMs || left.id.localeCompare(right.id));
    if (waiting.length === 0) return false;
    const allCandidates = this.#options.candidates.listCandidates(context.targetUtcMs);
    let changed = false;
    for (const batch of waiting) {
      const jobId = batch.transportMode === "local" ? "job.local_procurer" : "job.captain";
      const candidates = allCandidates.filter((candidate) => candidate.available && candidate.learnedJobIds.includes(jobId));
      if (batch.transportMode === "local") {
        const carts = this.#options.procurement.exportState().carts
          .filter((cart) => cart.activeBatchId === null && cart.capacity >= batch.totalQuantity)
          .sort((left, right) => left.id.localeCompare(right.id));
        let assigned = false;
        for (const cart of carts) {
          for (const candidate of candidates) {
            const started = this.#options.procurement.startBatch(
              processOperationId(context, "procurement-local-start", `${batch.id}|${cart.id}|${candidate.characterId}`),
              { batchId: batch.id, cartId: cart.id, candidate, occurredAtUtcMs: context.targetUtcMs },
            );
            if (!started.accepted) continue;
            changed ||= started.changed;
            assigned = true;
            break;
          }
          if (assigned) break;
        }
      } else {
        const ships = this.#options.fleet.createReadModel(context.targetUtcMs).ships
          .filter((ship) => ship.available && ship.cargoCapacity >= batch.totalQuantity)
          .sort((left, right) => left.id.localeCompare(right.id));
        let assigned = false;
        for (const ship of ships) {
          for (const candidate of candidates) {
            const started = this.#options.procurement.startRemoteBatch(
              processOperationId(context, "procurement-remote-start", `${batch.id}|${ship.id}|${candidate.characterId}`),
              { batchId: batch.id, airshipId: ship.id, candidate, occurredAtUtcMs: context.targetUtcMs },
            );
            if (!started.accepted) continue;
            changed ||= started.changed;
            assigned = true;
            break;
          }
          if (assigned) break;
        }
      }
    }
    return changed;
  }
}
