import { createRecipeExecutionStepId } from "../modules";
import { projectCharacterTaskCandidate } from "../projections";
import { R6_DEMO_CURRENT_MINUTE, R6_DEMO_IDS, createR6DemoFixture, type R6DemoFixture } from "./r6-demo-fixture";

export type R6DemoApplicationPhase = "awaiting-procurement" | "ready-to-open" | "operating" | "completed";
export interface R6DemoApplicationSnapshot {
  readonly revision: number;
  readonly phase: R6DemoApplicationPhase;
  readonly currentUtcMs: number;
  readonly balanceCopper: number;
  readonly orderStatus: string | null;
  readonly customerVisitPhase: string | null;
  readonly completedKitchenStepCount: number;
}
export type R6DemoApplicationResult =
  | { readonly accepted: true; readonly commandId: string; readonly snapshot: R6DemoApplicationSnapshot }
  | { readonly accepted: false; readonly commandId: string; readonly code: "DUPLICATE_COMMAND" | "INVALID_PHASE" | "BUSINESS_FAILURE"; readonly message: string; readonly snapshot: R6DemoApplicationSnapshot };
type BusinessResult = { readonly accepted: boolean; readonly message?: string };
function requireAccepted<T extends BusinessResult>(result: T, operation: string): asserts result is T & { readonly accepted: true } {
  if (!result.accepted) throw new Error(`${operation}: ${result.message ?? "rejected"}`);
}

/** Player-facing application boundary for the fixed R6 acceptance scene. */
export class R6DemoApplication {
  readonly fixture: R6DemoFixture;
  readonly #processedCommandIds = new Set<string>();
  readonly #getFocusBonusRateBasisPoints: () => number;
  #phase: R6DemoApplicationPhase = "awaiting-procurement";
  #revision = 0;
  #currentUtcMs = 0;
  #completedKitchenStepCount = 0;

  constructor(
    fixture: R6DemoFixture = createR6DemoFixture(),
    getFocusBonusRateBasisPoints: () => number = () => 0,
  ) {
    this.fixture = fixture;
    this.#getFocusBonusRateBasisPoints = getFocusBonusRateBasisPoints;
  }
  getSnapshot(): R6DemoApplicationSnapshot {
    return Object.freeze({
      revision: this.#revision, phase: this.#phase, currentUtcMs: this.#currentUtcMs,
      balanceCopper: this.fixture.finance.getSnapshot().balanceCopper,
      orderStatus: this.fixture.orders.getOrder("order.r6_demo")?.status ?? null,
      customerVisitPhase: this.fixture.customers.getVisit("visit.r6_demo")?.phase ?? null,
      completedKitchenStepCount: this.#completedKitchenStepCount,
    });
  }

  submitRecipeProcurement(commandId: string): R6DemoApplicationResult {
    const duplicate = this.#begin(commandId); if (duplicate !== null) return duplicate;
    if (this.#phase !== "awaiting-procurement") return this.#reject(commandId, "INVALID_PHASE", "Procurement has already been submitted.");
    const result = this.fixture.localProcurement.placeOrder(`${commandId}:place`, {
      recipeSelections: [{ recipeId: R6_DEMO_IDS.recipe, quantity: 1 }], freeItems: [],
      minuteOfDay: R6_DEMO_CURRENT_MINUTE, destinationRegionId: "region.greyfeather", occurredAtUtcMs: this.#currentUtcMs,
    });
    if (!result.accepted) return this.#reject(commandId, "BUSINESS_FAILURE", result.message);
    this.#phase = "ready-to-open"; this.#revision += 1; return this.#accept(commandId);
  }

  startBusiness(commandId: string): R6DemoApplicationResult {
    const duplicate = this.#begin(commandId); if (duplicate !== null) return duplicate;
    if (this.#phase !== "ready-to-open") return this.#reject(commandId, "INVALID_PHASE", `Submit procurement before opening the restaurant. Current phase: ${this.#phase}.`);
    this.#phase = "operating"; this.#revision += 1;
    try {
      this.#runBusinessDay("r6-demo"); this.#phase = "completed"; this.#revision += 1; return this.#accept(commandId);
    } catch (error) {
      return this.#reject(commandId, "BUSINESS_FAILURE", error instanceof Error ? error.message : String(error));
    }
  }

  #runBusinessDay(scope: string): void {
    const f = this.fixture;
    requireAccepted(f.localProcurement.advanceTo(`${scope}:procurement-prepared`, 500), "prepare procurement");
    const batch = f.localProcurement.exportState().batches[0];
    const otto = f.characters.createReadModel().characters.find((character) => character.id === R6_DEMO_IDS.characters.otto);
    if (batch === undefined || otto === undefined) throw new Error("Procurement actor or batch is missing.");
    const waiter = projectCharacterTaskCandidate(otto, f.employment.getWorkContext(R6_DEMO_IDS.characters.otto, { minuteOfDay: R6_DEMO_CURRENT_MINUTE, customerVisitActive: false, voyageActive: false }));
    requireAccepted(f.localProcurement.startBatch(`${scope}:procurement-start`, { batchId: batch.id, cartId: "cart.otto", candidate: waiter, occurredAtUtcMs: 500 }), "start procurement");
    requireAccepted(f.localProcurement.advanceTo(`${scope}:procurement-arrive`, 5_500), "complete procurement");
    f.stackSupply.synchronize(`${scope}:ingredient-supply`, 5_500);
    for (const time of [5_500, 9_500, 13_500, 17_500]) requireAccepted(f.freightElevators.advanceTo(`${scope}:ingredient-freight:${time}`, time), "advance ingredient freight");

    requireAccepted(f.dishwareService.refreshSupplyJobs(`${scope}:plate-refresh`, 17_500), "refresh plate supply");
    requireAccepted(f.service.synchronizeTasks(`${scope}:plate-task-sync`, 17_500), "synchronize plate tasks");
    for (let index = 0; index < 2; index += 1) {
      const task = this.#waitingServiceTask("service.supply-plate"); const startedAt = 17_501 + index * 2;
      requireAccepted(f.service.startTask(`${scope}:plate-start:${index}`, task.taskId, waiter, startedAt), "start plate supply");
      requireAccepted(f.dishwareService.handoffSupplyPlate(`${scope}:plate-handoff:${index}`, task.taskId, startedAt + 1), "handoff plate");
    }
    for (const time of [17_505, 21_505, 25_505]) requireAccepted(f.freightElevators.advanceTo(`${scope}:plate-freight:${time}`, time), "advance plate freight");

    requireAccepted(f.customers.arriveGroup(`${scope}:customer-arrive`, {
      visitId: "visit.r6_demo", sceneId: R6_DEMO_IDS.scenes.ground, memberCharacterIds: [R6_DEMO_IDS.characters.customer],
      minuteOfDay: R6_DEMO_CURRENT_MINUTE, arrivedAtUtcMs: 25_506,
    }), "customer arrival");
    requireAccepted(f.service.synchronizeTasks(`${scope}:reception-sync`, 25_506), "synchronize reception");
    const reception = this.#waitingServiceTask("service.reception");
    requireAccepted(f.service.startTask(`${scope}:reception-start`, reception.taskId, waiter, 25_507), "start reception");
    requireAccepted(f.service.completeReception(`${scope}:reception-complete`, reception.taskId, 25_508), "complete reception");
    requireAccepted(f.service.synchronizeTasks(`${scope}:order-sync`, 25_508), "synchronize ordering");
    const ordering = this.#waitingServiceTask("service.take-order");
    requireAccepted(f.service.startTask(`${scope}:order-start`, ordering.taskId, waiter, 25_509), "start ordering");
    requireAccepted(f.service.recordOrderAtTable(`${scope}:order-record`, ordering.taskId, {
      pendingOrderId: "pending.r6_demo", ingredientReservationId: "reservation.r6_demo.ingredients",
      lines: [{ id: "line.r6_demo", recipeId: R6_DEMO_IDS.recipe, quantity: 1, dinerCharacterIds: [R6_DEMO_IDS.characters.customer] }], occurredAtUtcMs: 25_510,
    }), "record table order");
    requireAccepted(f.service.submitRecordedOrder(`${scope}:order-submit`, ordering.taskId, {
      orderId: "order.r6_demo", linePrices: [{ lineId: "line.r6_demo", baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
      focusBonusRateBasisPoints: this.#getFocusBonusRateBasisPoints(), occurredAtUtcMs: 25_511,
    }), "submit table order");
    requireAccepted(f.customers.advanceTo(`${scope}:observe-order`, 25_511), "observe submitted order");

    const order = f.orders.getOrder("order.r6_demo"); const mealId = order?.meals[0]?.id;
    if (order === null || mealId === undefined) throw new Error("Submitted meal is missing.");
    requireAccepted(f.recipeExecutions.createExecutionsForOrder(`${scope}:create-recipe`, order, 25_512), "create recipe execution");
    requireAccepted(f.kitchenSteps.synchronizeWaitingTasks(`${scope}:kitchen-root-sync`, 25_512), "synchronize kitchen roots");
    const chef = f.characters.createReadModel().characters.find((character) => character.id === R6_DEMO_IDS.characters.baiyecheng);
    if (chef === undefined) throw new Error("Baiyecheng is missing.");
    const chefCandidate = projectCharacterTaskCandidate(chef, f.employment.getWorkContext(R6_DEMO_IDS.characters.baiyecheng, { minuteOfDay: R6_DEMO_CURRENT_MINUTE, customerVisitActive: false, voyageActive: false }));
    let kitchenTime = 25_513;
    for (const definitionStepId of ["step.process_tomato", "step.whisk_egg", "step.fry_tomato", "step.fry_egg", "step.combine", "step.plate"]) {
      const stepInstanceId = createRecipeExecutionStepId(mealId, definitionStepId);
      requireAccepted(f.kitchenSteps.synchronizeWaitingTasks(`${scope}:kitchen-sync:${definitionStepId}`, kitchenTime), "synchronize kitchen step");
      requireAccepted(f.kitchenSteps.claimStep(`${scope}:kitchen-claim:${definitionStepId}`, {
        stepInstanceId, candidate: chefCandidate, speedUnitsPerSecond: 30, reservationExpiresAtUtcMs: kitchenTime + 120_000, occurredAtUtcMs: kitchenTime,
      }), "claim kitchen step");
      if (f.movement.getCharacter(R6_DEMO_IDS.characters.baiyecheng)?.status === "moving") {
        kitchenTime += 5_000; requireAccepted(f.movement.advanceCharacter(`${scope}:kitchen-move:${definitionStepId}`, R6_DEMO_IDS.characters.baiyecheng, kitchenTime), "move chef");
      }
      const started = f.kitchenSteps.startStep(`${scope}:kitchen-start:${definitionStepId}`, stepInstanceId, kitchenTime); requireAccepted(started, "start kitchen step");
      const duration = started.value.performance?.effectiveDurationMs; if (duration === undefined) throw new Error("Kitchen step duration is missing.");
      kitchenTime += duration; requireAccepted(f.kitchenSteps.advance(`${scope}:kitchen-complete:${definitionStepId}`, kitchenTime), "complete kitchen step");
      this.#completedKitchenStepCount += 1; kitchenTime += 1;
    }

    f.mealDispatch.synchronize(`${scope}:meal-dispatch`, kitchenTime);
    requireAccepted(f.freightElevators.advanceTo(`${scope}:meal-freight-start`, kitchenTime), "start meal freight");
    const mealGroundAt = kitchenTime + 4_000;
    requireAccepted(f.freightElevators.advanceTo(`${scope}:meal-freight-arrive`, mealGroundAt), "complete meal freight");
    requireAccepted(f.service.synchronizeTasks(`${scope}:delivery-sync`, mealGroundAt), "synchronize meal delivery");
    const delivery = this.#waitingServiceTask("service.deliver-meal");
    requireAccepted(f.service.startTask(`${scope}:delivery-start`, delivery.taskId, waiter, mealGroundAt + 1), "start meal delivery");
    requireAccepted(f.trayDelivery.pickupBatch(`${scope}:delivery-pickup`, "tray.r6_demo", delivery.taskId, mealGroundAt + 2), "pick up meal");
    requireAccepted(f.trayDelivery.deliverNextTable(`${scope}:delivery-serve`, "tray.r6_demo", mealGroundAt + 3), "serve meal");
    requireAccepted(f.customers.advanceTo(`${scope}:eating-start`, mealGroundAt + 3), "start eating");
    requireAccepted(f.customers.advanceTo(`${scope}:eating-complete`, mealGroundAt + 1_003), "complete eating");

    const consumedAt = mealGroundAt + 1_004;
    requireAccepted(f.dishwareService.synchronizeConsumedMeals(`${scope}:consumed-plates`, consumedAt), "synchronize consumed plates");
    requireAccepted(f.service.synchronizeTasks(`${scope}:checkout-sync`, consumedAt), "synchronize checkout");
    const checkout = this.#waitingServiceTask("service.checkout");
    requireAccepted(f.service.startTask(`${scope}:checkout-start`, checkout.taskId, waiter, consumedAt + 1), "start checkout");
    requireAccepted(f.service.completeCheckout(`${scope}:checkout-complete`, checkout.taskId, { settlementBatchId: "settlement.r6_demo", regionId: "region.greyfeather", occurredAtUtcMs: consumedAt + 2 }), "complete checkout");
    requireAccepted(f.customers.advanceTo(`${scope}:payment-observed`, consumedAt + 2), "observe payment");
    requireAccepted(f.customers.confirmDeparted(`${scope}:customer-depart`, "visit.r6_demo", consumedAt + 3), "customer departure");

    requireAccepted(f.dishwareService.refreshSupplyJobs(`${scope}:cleanup-refresh`, consumedAt + 4), "refresh cleanup");
    requireAccepted(f.service.synchronizeTasks(`${scope}:cleanup-sync`, consumedAt + 4), "synchronize cleanup");
    const cleanup = this.#waitingServiceTask("service.clean-table");
    requireAccepted(f.service.startTask(`${scope}:cleanup-start`, cleanup.taskId, waiter, consumedAt + 5), "start cleanup");
    requireAccepted(f.dishwareService.pickupDirtyTable(`${scope}:cleanup-pickup`, cleanup.taskId, consumedAt + 6), "pick up dirty plate");
    requireAccepted(f.dishwareService.deliverDirtyToCabinet(`${scope}:cleanup-cabinet`, cleanup.taskId, consumedAt + 7), "deliver dirty plate");
    const replacement = this.#waitingServiceTask("service.supply-plate");
    requireAccepted(f.service.startTask(`${scope}:replacement-start`, replacement.taskId, waiter, consumedAt + 8), "start replacement plate supply");
    requireAccepted(f.dishwareService.handoffSupplyPlate(`${scope}:replacement-handoff`, replacement.taskId, consumedAt + 9), "handoff replacement plate");
    requireAccepted(f.freightElevators.advanceTo(`${scope}:replacement-freight`, consumedAt + 9), "start replacement freight");
    requireAccepted(f.freightElevators.advanceTo(`${scope}:replacement-arrive`, consumedAt + 4_009), "complete replacement freight");
    requireAccepted(f.dishwareService.advanceWashing(`${scope}:washing-complete`, consumedAt + 10_007), "complete washing");
    this.#currentUtcMs = consumedAt + 10_007;
  }

  #waitingServiceTask(taskType: string) {
    const task = this.fixture.service.createTaskSourceSnapshot().waitingTasks.find((candidate) => candidate.taskType === taskType);
    if (task === undefined) throw new Error(`${taskType} task is missing.`); return task;
  }
  #begin(commandId: string): R6DemoApplicationResult | null {
    if (this.#processedCommandIds.has(commandId)) return this.#reject(commandId, "DUPLICATE_COMMAND", "The command id has already been processed.");
    this.#processedCommandIds.add(commandId); return null;
  }
  #accept(commandId: string): R6DemoApplicationResult { return { accepted: true, commandId, snapshot: this.getSnapshot() }; }
  #reject(commandId: string, code: "DUPLICATE_COMMAND" | "INVALID_PHASE" | "BUSINESS_FAILURE", message: string): R6DemoApplicationResult {
    return { accepted: false, commandId, code, message, snapshot: this.getSnapshot() };
  }
}