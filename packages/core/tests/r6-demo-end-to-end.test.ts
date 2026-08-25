import { createM2ContentRegistry } from "../../content/src";
import { describe, expect, it } from "vitest";
import {
  createRecipeExecutionStepId,
  projectCharacterTaskCandidate,
  projectRecipeBookReadModel,
  selectRecipeBookPage,
} from "../src";import {
  R6_DEMO_CURRENT_MINUTE,
  R6_DEMO_IDS,
  createR6DemoFixture,
} from "../src/demo/r6-demo-fixture";

describe("R6 Demo end-to-end", () => {
  it("verifies every business-module transition in the complete fixed Demo path", () => {
    const fixture = createR6DemoFixture();
    const eventTypes: string[] = [];
    fixture.eventBus.subscribe("*", (event) => eventTypes.push(event.type));

    const placed = fixture.localProcurement.placeOrder("r6-e2e:procurement:place", {
      recipeSelections: [{ recipeId: R6_DEMO_IDS.recipe, quantity: 1 }],
      freeItems: [],
      minuteOfDay: R6_DEMO_CURRENT_MINUTE,
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs: 0,
    });
    expect(placed).toMatchObject({ accepted: true, value: [{ totalQuantity: 5, status: "pending" }] });
    expect(fixture.finance.getSnapshot().availableCopper).toBe(193);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.egg)).toBe(0);

    expect(fixture.localProcurement.advanceTo("r6-e2e:procurement:prepared", 500)).toMatchObject({ accepted: true });
    expect(fixture.tasks.createReadModel().waiting).toHaveLength(1);
    const batch = fixture.localProcurement.exportState().batches[0]!;
    const otto = fixture.characters.createReadModel().characters.find((character) => character.id === R6_DEMO_IDS.characters.otto)!;
    const work = fixture.employment.getWorkContext(R6_DEMO_IDS.characters.otto, {
      minuteOfDay: R6_DEMO_CURRENT_MINUTE,
      customerVisitActive: false,
      voyageActive: false,
    });
    const candidate = projectCharacterTaskCandidate(otto, work);
    expect(candidate).toMatchObject({ available: true, primaryJobId: "job.waiter", learnedJobIds: ["job.waiter", "job.local_procurer"] });

    expect(fixture.localProcurement.startBatch("r6-e2e:procurement:start", {
      batchId: batch.id,
      cartId: "cart.otto",
      candidate,
      occurredAtUtcMs: 500,
    })).toMatchObject({ accepted: true, value: { status: "in-transit", totalQuantity: 5, arrivesAtUtcMs: 5_500 } });
    expect(fixture.localProcurement.advanceTo("r6-e2e:procurement:arrive", 5_500)).toMatchObject({ accepted: true });

    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.egg)).toBe(2);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.tomato)).toBe(3);
    expect(fixture.localProcurement.exportState().orders[0]).toMatchObject({ status: "completed", deliveredQuantity: 5 });
    expect(fixture.tasks.createReadModel().recentTerminal).toMatchObject([{ status: "completed" }]);
    expect(eventTypes.filter((type) => type === "local-procurement.batch-arrived")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "local-procurement.order-completed")).toHaveLength(1);

    const synchronized = fixture.stackSupply.synchronize("r6-e2e:supply:sync", 5_500);
    expect(synchronized.createdDemandIds).toHaveLength(2);
    expect(synchronized.snapshots.map((target) => [target.itemId, target.incomingQuantity])).toEqual([
      [R6_DEMO_IDS.items.egg, 2],
      [R6_DEMO_IDS.items.tomato, 3],
    ]);
    expect(fixture.freightElevators.advanceTo("r6-e2e:freight:dispatch", 5_500)).toMatchObject({ accepted: true });
    expect(fixture.freightElevators.getSnapshot().elevators.filter((elevator) => elevator.phase === "moving-loaded")).toHaveLength(4);

    for (const time of [9_500, 13_500, 17_500]) {
      expect(fixture.freightElevators.advanceTo(`r6-e2e:freight:${time}`, time)).toMatchObject({ accepted: true });
    }
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.egg)).toBe(0);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.tomato)).toBe(0);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.egg)).toBe(2);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.tomato)).toBe(3);
    expect(fixture.logistics.exportState().groups.every((group) => group.status === "completed" && group.remainingQuantity === 0)).toBe(true);
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(fixture.inventory.getSnapshot().capacityReservations).toHaveLength(0);
    expect(fixture.freightElevators.getSnapshot().elevators.every((elevator) => elevator.phase === "idle" && elevator.cargoInstanceId === null)).toBe(true);
    expect(eventTypes.filter((type) => type === "logistics.unit-delivered")).toHaveLength(5);
    expect(eventTypes.filter((type) => type === "freight-elevator.cargo-delivered")).toHaveLength(5);

    expect(fixture.dishwareService.refreshSupplyJobs("r6-e2e:plates:refresh", 17_500)).toMatchObject({ accepted: true, value: [{ status: "waiting-service" }, { status: "waiting-service" }] });
    expect(fixture.service.synchronizeTasks("r6-e2e:plates:service-sync", 17_500)).toMatchObject({ accepted: true });
    for (let index = 0; index < 2; index += 1) {
      const supplyTask = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.supply-plate");
      if (supplyTask === undefined) throw new Error("Missing Demo plate supply task.");
      const startedAt = 17_501 + index * 2;
      expect(fixture.service.startTask(`r6-e2e:plates:start:${index}`, supplyTask.taskId, candidate, startedAt)).toMatchObject({ accepted: true });
      expect(fixture.dishwareService.handoffSupplyPlate(`r6-e2e:plates:handoff:${index}`, supplyTask.taskId, startedAt + 1)).toMatchObject({ accepted: true, value: { status: "handed-to-logistics" } });
    }
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)?.instances.filter((entry) => entry.itemId === R6_DEMO_IDS.items.cleanPlate)).toHaveLength(2);
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.cabinetClean)?.instances).toHaveLength(2);

    expect(fixture.freightElevators.advanceTo("r6-e2e:plates:empty-dispatch", 17_505)).toMatchObject({ accepted: true });
    expect(fixture.freightElevators.getSnapshot().elevators.filter((elevator) => elevator.phase === "moving-empty")).toHaveLength(2);
    expect(fixture.freightElevators.advanceTo("r6-e2e:plates:load", 21_505)).toMatchObject({ accepted: true });
    expect(fixture.freightElevators.advanceTo("r6-e2e:plates:deliver", 25_505)).toMatchObject({ accepted: true });
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.airshipExchange)?.instances.filter((entry) => entry.itemId === R6_DEMO_IDS.items.cleanPlate)).toHaveLength(2);
    expect(fixture.dishware.getSnapshot()).toMatchObject({ totalPlateCount: 4, counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 } });
    expect(fixture.inventory.getSnapshot().locations.flatMap((location) => location.instances).filter((entry) => entry.itemId === R6_DEMO_IDS.items.cleanPlate)).toHaveLength(4);
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(fixture.inventory.getSnapshot().capacityReservations).toHaveLength(0);
    expect(eventTypes.filter((type) => type === "dishware-service.supply-handed-to-logistics")).toHaveLength(2);
    expect(eventTypes.filter((type) => type === "freight-elevator.cargo-delivered")).toHaveLength(7);

    expect(fixture.customers.arriveGroup("r6-e2e:customer:arrive", {
      visitId: "visit.r6_demo",
      sceneId: R6_DEMO_IDS.scenes.ground,
      memberCharacterIds: [R6_DEMO_IDS.characters.customer],
      minuteOfDay: R6_DEMO_CURRENT_MINUTE,
      arrivedAtUtcMs: 25_506,
    })).toMatchObject({ accepted: true, value: { phase: "moving-to-table", tableId: "table.demo" } });
    expect(fixture.service.synchronizeTasks("r6-e2e:service:reception-sync", 25_506)).toMatchObject({ accepted: true });
    const reception = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.reception");
    if (reception === undefined) throw new Error("Missing Demo reception task.");
    expect(fixture.service.startTask("r6-e2e:service:reception-start", reception.taskId, candidate, 25_507)).toMatchObject({ accepted: true });
    expect(fixture.service.completeReception("r6-e2e:service:reception-complete", reception.taskId, 25_508)).toMatchObject({ accepted: true });
    expect(fixture.customers.getVisit("visit.r6_demo")).toMatchObject({ phase: "awaiting-order", tableId: "table.demo" });

    expect(fixture.service.synchronizeTasks("r6-e2e:service:order-sync", 25_508)).toMatchObject({ accepted: true });
    const ordering = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.take-order");
    if (ordering === undefined) throw new Error("Missing Demo take-order task.");
    expect(fixture.service.startTask("r6-e2e:service:order-start", ordering.taskId, candidate, 25_509)).toMatchObject({ accepted: true });
    expect(fixture.service.recordOrderAtTable("r6-e2e:service:order-record", ordering.taskId, {
      pendingOrderId: "pending.r6_demo",
      ingredientReservationId: "reservation.r6_demo.ingredients",
      lines: [{ id: "line.r6_demo", recipeId: R6_DEMO_IDS.recipe, quantity: 1, dinerCharacterIds: [R6_DEMO_IDS.characters.customer] }],
      occurredAtUtcMs: 25_510,
    })).toMatchObject({ accepted: true, value: { stage: "transmitting-order", pendingOrderId: "pending.r6_demo" } });
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(1);
    expect(fixture.service.submitRecordedOrder("r6-e2e:service:order-submit", ordering.taskId, {
      orderId: "order.r6_demo",
      linePrices: [{ lineId: "line.r6_demo", baseUnitPriceCopper: 30, businessAdjustmentCopper: 0, transactionUnitPriceCopper: 30 }],
      occurredAtUtcMs: 25_511,
    })).toMatchObject({ accepted: true, value: { status: "submitted" } });
    expect(fixture.customers.advanceTo("r6-e2e:customer:observe-order", 25_511)).toMatchObject({ accepted: true });
    expect(fixture.orders.getOrder("order.r6_demo")).toMatchObject({ status: "submitted", lines: [{ recipeId: R6_DEMO_IDS.recipe, quantity: 1 }] });
    expect(fixture.customers.getVisit("visit.r6_demo")).toMatchObject({ phase: "dining" });
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.egg)).toBe(2);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.tomato)).toBe(3);
    expect(fixture.inventory.getSnapshot().reservations[0]).toMatchObject({ id: "reservation.r6_demo.ingredients", ownerType: "pending-order" });

    const order = fixture.orders.getOrder("order.r6_demo")!;
    const mealId = order.meals[0]!.id;
    expect(fixture.recipeExecutions.createExecutionsForOrder("r6:kitchen:create", order, 25_512)).toMatchObject({ accepted: true, value: [{ mealId, status: "active" }] });
    expect(fixture.kitchenSteps.synchronizeWaitingTasks("r6:kitchen:sync-roots", 25_512)).toMatchObject({ accepted: true, value: expect.any(Array) });
    const chef = fixture.characters.createReadModel().characters.find((character) => character.id === R6_DEMO_IDS.characters.baiyecheng)!;
    const chefWork = fixture.employment.getWorkContext(R6_DEMO_IDS.characters.baiyecheng, {
      minuteOfDay: R6_DEMO_CURRENT_MINUTE,
      customerVisitActive: false,
      voyageActive: false,
    });
    const chefCandidate = projectCharacterTaskCandidate(chef, chefWork);
    const completedDefinitionStepIds: string[] = [];
    let kitchenTime = 25_513;
    for (const definitionStepId of [
      "step.process_tomato",
      "step.whisk_egg",
      "step.fry_tomato",
      "step.fry_egg",
      "step.combine",
      "step.plate",
    ]) {
      const stepInstanceId = createRecipeExecutionStepId(mealId, definitionStepId);
      expect(fixture.kitchenSteps.synchronizeWaitingTasks(`r6:kitchen:sync:${definitionStepId}`, kitchenTime)).toMatchObject({ accepted: true });
      expect(fixture.kitchenSteps.claimStep(`r6:kitchen:claim:${definitionStepId}`, {
        stepInstanceId,
        candidate: chefCandidate,
        speedUnitsPerSecond: 30,
        reservationExpiresAtUtcMs: kitchenTime + 120_000,
        occurredAtUtcMs: kitchenTime,
      })).toMatchObject({ accepted: true, value: { status: "claimed", characterId: R6_DEMO_IDS.characters.baiyecheng } });
      const movement = fixture.movement.getCharacter(R6_DEMO_IDS.characters.baiyecheng)!;
      if (movement.status === "moving") {
        kitchenTime += 5_000;
        expect(fixture.movement.advanceCharacter(`r6:kitchen:move:${definitionStepId}`, R6_DEMO_IDS.characters.baiyecheng, kitchenTime)).toMatchObject({ accepted: true, value: { status: "arrived" } });
      }
      const started = fixture.kitchenSteps.startStep(`r6:kitchen:start:${definitionStepId}`, stepInstanceId, kitchenTime);
      expect(started).toMatchObject({ accepted: true, value: { status: "running", performance: { cookingLevel: 8 } } });
      if (!started.accepted) throw new Error(started.message);
      kitchenTime += started.value.performance!.effectiveDurationMs;
      expect(fixture.kitchenSteps.advance(`r6:kitchen:complete:${definitionStepId}`, kitchenTime)).toMatchObject({ accepted: true, value: [expect.objectContaining({ stepInstanceId, status: "completed" })] });
      completedDefinitionStepIds.push(definitionStepId);
      kitchenTime += 1;
    }

    expect(completedDefinitionStepIds).toHaveLength(6);
    expect(fixture.recipeExecutions.getExecution(mealId)).toMatchObject({ status: "completed", steps: expect.arrayContaining(completedDefinitionStepIds.map((definitionStepId) => expect.objectContaining({ definitionStepId, status: "completed" }))) });
    expect(fixture.orders.getMeal(mealId)).toMatchObject({ status: "awaiting-pickup" });
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.egg)).toBe(0);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.tomato)).toBe(0);
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(fixture.kitchenProducts.createReadModel().availableIntermediates).toHaveLength(0);
    expect(fixture.kitchenProducts.createReadModel().finishedMeals).toHaveLength(1);
    expect(fixture.kitchenFacilities.createReadModel()).toMatchObject({ bindings: [], cacheClaims: [] });
    expect(fixture.dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 1, dirty: 0, washing: 0 });
    expect(eventTypes.filter((type) => type === "kitchen-step.completed")).toHaveLength(6);

    expect(fixture.mealDispatch.synchronize("r6:meal-dispatch", kitchenTime)).toHaveLength(1);
    expect(fixture.freightElevators.advanceTo("r6:meal-freight:start", kitchenTime)).toMatchObject({ accepted: true });
    expect(fixture.freightElevators.getSnapshot().elevators.filter((elevator) => elevator.phase === "moving-loaded")).toHaveLength(1);
    const mealGroundAt = kitchenTime + 4_000;
    expect(fixture.freightElevators.advanceTo("r6:meal-freight:arrive", mealGroundAt)).toMatchObject({ accepted: true });
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)?.instances.filter((entry) => entry.attributes.mealId === mealId)).toHaveLength(1);
    expect(fixture.logistics.exportState().groups.find((group) => group.ownerType === "demo-finished-meal")).toMatchObject({ status: "completed", deliveredQuantity: 1 });

    expect(fixture.service.synchronizeTasks("r6:delivery:sync", mealGroundAt)).toMatchObject({ accepted: true });
    const deliveryTask = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.deliver-meal");
    if (deliveryTask === undefined) throw new Error("Missing Demo meal delivery task.");
    expect(fixture.service.startTask("r6:delivery:start", deliveryTask.taskId, candidate, mealGroundAt + 1)).toMatchObject({ accepted: true, value: { stage: "external-handoff" } });
    expect(fixture.trayDelivery.pickupBatch("r6:delivery:pickup", "tray.r6_demo", deliveryTask.taskId, mealGroundAt + 2)).toMatchObject({ accepted: true, value: { status: "delivering", capacitySnapshot: 1 } });
    expect(fixture.trayDelivery.deliverNextTable("r6:delivery:serve", "tray.r6_demo", mealGroundAt + 3)).toMatchObject({ accepted: true, value: { status: "completed", currentLocationId: "table.demo" } });
    expect(fixture.orders.getMeal(mealId)).toMatchObject({ status: "served", tipCopper: 2 });
    expect(fixture.customers.advanceTo("r6:customer:begin-eating", mealGroundAt + 3)).toMatchObject({ accepted: true });
    expect(fixture.customers.advanceTo("r6:customer:finish-eating", mealGroundAt + 1_003)).toMatchObject({ accepted: true });
    expect(fixture.orders.getMeal(mealId)).toMatchObject({ status: "consumed", tipCopper: 2 });
    expect(fixture.customers.getVisit("visit.r6_demo")).toMatchObject({ phase: "awaiting-payment" });
    expect(eventTypes.filter((type) => type === "tray-delivery.meal-delivered")).toHaveLength(1);

    const consumedAt = mealGroundAt + 1_004;
    expect(fixture.dishwareService.synchronizeConsumedMeals("r6:cleanup:consumed", consumedAt)).toMatchObject({ accepted: true, value: [mealId] });
    expect(fixture.dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 0, dirty: 1, washing: 0 });
    expect(fixture.service.synchronizeTasks("r6:checkout:sync", consumedAt)).toMatchObject({ accepted: true });
    const checkoutTask = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.checkout");
    if (checkoutTask === undefined) throw new Error("Missing Demo checkout task.");
    expect(fixture.service.startTask("r6:checkout:start", checkoutTask.taskId, candidate, consumedAt + 1)).toMatchObject({ accepted: true });
    expect(fixture.service.completeCheckout("r6:checkout:complete", checkoutTask.taskId, { settlementBatchId: "settlement.r6_demo", regionId: "region.greyfeather", occurredAtUtcMs: consumedAt + 2 })).toMatchObject({ accepted: true, value: { status: "settled" } });
    expect(fixture.customers.advanceTo("r6:customer:observe-payment", consumedAt + 2)).toMatchObject({ accepted: true });
    expect(fixture.customers.confirmDeparted("r6:customer:depart", "visit.r6_demo", consumedAt + 3)).toMatchObject({ accepted: true });
    expect(fixture.orders.getOrder("order.r6_demo")).toMatchObject({ status: "settled", settlementBatchId: "settlement.r6_demo" });
    expect(fixture.finance.getSnapshot()).toMatchObject({ balanceCopper: 225, availableCopper: 225 });

    expect(fixture.dishwareService.refreshSupplyJobs("r6:cleanup:refresh-supply", consumedAt + 4)).toMatchObject({ accepted: true, value: [{ status: "waiting-service" }] });
    expect(fixture.service.synchronizeTasks("r6:cleanup:sync", consumedAt + 4)).toMatchObject({ accepted: true });
    const cleanupTask = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.clean-table");
    if (cleanupTask === undefined) throw new Error("Missing Demo table cleanup task.");
    expect(fixture.service.startTask("r6:cleanup:start", cleanupTask.taskId, candidate, consumedAt + 5)).toMatchObject({ accepted: true });
    expect(fixture.dishwareService.pickupDirtyTable("r6:cleanup:pickup", cleanupTask.taskId, consumedAt + 6)).toMatchObject({ accepted: true, value: { plateIds: expect.any(Array) } });
    expect(fixture.dishwareService.deliverDirtyToCabinet("r6:cleanup:cabinet", cleanupTask.taskId, consumedAt + 7)).toMatchObject({ accepted: true });
    expect(fixture.customers.createReadModel().tables[0]).toMatchObject({ cleanliness: "clean" });
    expect(fixture.dishware.getSnapshot().counts).toEqual({ clean: 3, in_use: 0, dirty: 0, washing: 1 });

    const plateSupplyTask = fixture.service.createTaskSourceSnapshot().waitingTasks.find((task) => task.taskType === "service.supply-plate");
    if (plateSupplyTask === undefined) throw new Error("Missing Demo replacement plate supply task.");
    expect(fixture.service.startTask("r6:cleanup:supply-start", plateSupplyTask.taskId, candidate, consumedAt + 8)).toMatchObject({ accepted: true });
    expect(fixture.dishwareService.handoffSupplyPlate("r6:cleanup:supply-handoff", plateSupplyTask.taskId, consumedAt + 9)).toMatchObject({ accepted: true, value: { status: "handed-to-logistics" } });
    expect(fixture.freightElevators.advanceTo("r6:cleanup:supply-freight", consumedAt + 9)).toMatchObject({ accepted: true });
    expect(fixture.freightElevators.advanceTo("r6:cleanup:supply-arrive", consumedAt + 4_009)).toMatchObject({ accepted: true });
    expect(fixture.dishwareService.advanceWashing("r6:cleanup:washing-complete", consumedAt + 10_007)).toMatchObject({ accepted: true });

    expect(fixture.dishware.getSnapshot()).toMatchObject({ totalPlateCount: 4, counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 } });
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.airshipExchange)?.instances.filter((entry) => entry.itemId === R6_DEMO_IDS.items.cleanPlate)).toHaveLength(2);
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.cabinetClean)?.instances).toHaveLength(2);
    expect(fixture.inventory.getSnapshot().locations.flatMap((location) => location.instances).filter((entry) => entry.itemId === R6_DEMO_IDS.items.cleanPlate)).toHaveLength(4);
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(fixture.inventory.getSnapshot().capacityReservations).toHaveLength(0);
    expect(fixture.logistics.exportState().groups.every((group) => group.status === "completed")).toBe(true);
    expect(fixture.freightElevators.getSnapshot().elevators.every((elevator) => elevator.phase === "idle" && elevator.cargoInstanceId === null)).toBe(true);
    expect(fixture.tasks.createReadModel().inProgress).toHaveLength(0);
    expect(eventTypes.filter((type) => type === "dishware-service.table-cleanup-completed")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "dishware.washing-completed")).toHaveLength(1);

    const beforeRecipeReading = {
      inventory: fixture.inventory.exportState(),
      orders: fixture.orders.exportState(),
      recipes: fixture.recipeExecutions.exportState(),
      kitchen: fixture.kitchenSteps.exportState(),
    };
    const recipeBook = projectRecipeBookReadModel(createM2ContentRegistry());
    const realRecipe = selectRecipeBookPage(recipeBook, R6_DEMO_IDS.recipe, "real-world");
    expect(realRecipe).toMatchObject({
      layer: "real-world",
      displayName: "番茄炒蛋",
      content: {
        name: "家常番茄炒鸡蛋",
        servings: 2,
        ingredients: expect.arrayContaining([{ name: "盐", amount: "2 克" }]),
        steps: [{ order: 1 }, { order: 2 }, { order: 3 }, { order: 4 }, { order: 5 }],
      },
    });
    for (let index = 0; index < 10; index += 1) {
      expect(selectRecipeBookPage(recipeBook, R6_DEMO_IDS.recipe, index % 2 === 0 ? "gameplay" : "real-world")).not.toBeNull();
    }
    expect(fixture.inventory.exportState()).toEqual(beforeRecipeReading.inventory);
    expect(fixture.orders.exportState()).toEqual(beforeRecipeReading.orders);
    expect(fixture.recipeExecutions.exportState()).toEqual(beforeRecipeReading.recipes);
    expect(fixture.kitchenSteps.exportState()).toEqual(beforeRecipeReading.kitchen);
  });
});