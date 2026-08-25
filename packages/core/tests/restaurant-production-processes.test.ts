import { describe, expect, it } from "vitest";
import {
  EmploymentRestaurantTaskCandidateProvider,
  MovementModule,
  PersonnelElevatorModule,
  RestaurantApplicationRuntime,
  RestaurantDishwareWorkProcess,
  RestaurantKitchenWorkProcess,
  RestaurantMealLogisticsProcess,
  RestaurantOrderRecipeProcess,
  RestaurantServiceWorkProcess,
  RestaurantServiceMovementGate,
  RestaurantPersonnelElevatorProcess,
  RestaurantProcurementProcess,
  instanceId,
} from "../src";
import {
  R6_DEMO_CURRENT_MINUTE,
  R6_DEMO_IDS,
  R6_DEMO_RECIPE,
  createR6DemoFixture,
} from "../src/demo/r6-demo-fixture";

function requireAccepted(
  result: { readonly accepted: boolean; readonly message?: string },
): void {
  if (!result.accepted) throw new Error(result.message ?? "Operation rejected.");
}

describe("restaurant production processes", () => {
  it("drives arbitrary submitted orders through recipe DAGs to plated meals", () => {
    const fixture = createR6DemoFixture();
    requireAccepted(
      fixture.inventory.depositStack(
        "production-test:ingredients",
        R6_DEMO_IDS.locations.airshipExchange,
        [
          { itemId: R6_DEMO_IDS.items.egg, quantity: 4 },
          { itemId: R6_DEMO_IDS.items.tomato, quantity: 6 },
        ],
        1,
      ),
    );

    const plates = fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.cabinetClean)!
      .instances.slice(0, 2);
    for (const [index, plate] of plates.entries()) {
      requireAccepted(
        fixture.inventory.transferInstance(
          `production-test:plate:${index}`,
          plate.id,
          R6_DEMO_IDS.locations.airshipExchange,
          1,
        ),
      );
    }

    const orderIds = ["order.dynamic.alpha", "order.dynamic.beta"];
    for (const [index, orderId] of orderIds.entries()) {
      const pendingOrderId = `pending.dynamic.${index}`;
      const lineId = `line.dynamic.${index}`;
      requireAccepted(
        fixture.orders.createPendingOrder({
          operationId: `production-test:pending:${index}`,
          pendingOrderId,
          tableId: `table.dynamic.${index}`,
          customerGroupId: `group.dynamic.${index}`,
          lines: [
            {
              id: lineId,
              recipeId: R6_DEMO_IDS.recipe,
              quantity: 1,
              dinerCharacterIds: [R6_DEMO_IDS.characters.customer],
            },
          ],
          ingredientReservationId: `reservation.dynamic.${index}`,
          createdAtUtcMs: 2,
        }),
      );
      requireAccepted(
        fixture.orders.submitPendingOrder({
          operationId: `production-test:submit:${index}`,
          pendingOrderId,
          orderId,
          linePrices: [
            {
              lineId,
              baseUnitPriceCopper: 30,
              businessAdjustmentCopper: 0,
              transactionUnitPriceCopper: 30,
            },
          ],
          submittedAtUtcMs: 3,
        }),
      );
    }

    const candidates = new EmploymentRestaurantTaskCandidateProvider({
      characters: fixture.characters,
      employment: fixture.employment,
      customers: fixture.customers,
      minuteOfDayAt: () => R6_DEMO_CURRENT_MINUTE,
    });
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 3,
      processes: [
        new RestaurantOrderRecipeProcess({
          orders: fixture.orders,
          recipes: fixture.recipeExecutions,
          kitchenSteps: fixture.kitchenSteps,
        }),
        new RestaurantKitchenWorkProcess({
          kitchenSteps: fixture.kitchenSteps,
          tasks: fixture.tasks,
          movement: fixture.movement,
          candidates,
        }),
        new RestaurantMealLogisticsProcess({
          products: fixture.kitchenProducts,
          logistics: fixture.logistics,
          freightElevators: fixture.freightElevators,
          groundMealLocationId: R6_DEMO_IDS.locations.groundExchange,
        }),
      ],
    });

    let nowUtcMs = 3;
    for (let guard = 0; guard < 100; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      const meals = orderIds.flatMap(
        (orderId) => fixture.orders.getOrder(orderId)!.meals,
      );
      const finishedMeals =
        fixture.kitchenProducts.createReadModel().finishedMeals;
      if (
        meals.every((meal) => meal.status === "awaiting-pickup") &&
        finishedMeals.length === orderIds.length &&
        finishedMeals.every(
          (meal) =>
            meal.locationId === R6_DEMO_IDS.locations.groundExchange,
        )
      ) {
        break;
      }
      const nextTransitionUtcMs = runtime.getSnapshot().nextTransitionUtcMs;
      if (nextTransitionUtcMs === null) {
        throw new Error("Production runtime stalled before plating every meal.");
      }
      nowUtcMs = Math.max(nowUtcMs + 1, nextTransitionUtcMs);
    }

    for (const orderId of orderIds) {
      const order = fixture.orders.getOrder(orderId)!;
      expect(order.meals).toHaveLength(1);
      expect(order.meals[0]).toMatchObject({ status: "awaiting-pickup" });
      const execution = fixture.recipeExecutions.getExecutionForMeal(
        order.meals[0]!.id,
      );
      expect(execution).toMatchObject({
        orderId,
        status: "completed",
      });
      expect(execution!.steps).toHaveLength(R6_DEMO_RECIPE.steps.length);
      expect(
        execution!.steps.every((step) => step.status === "completed"),
      ).toBe(true);
    }

    expect(
      fixture.kitchenProducts.createReadModel().finishedMeals.map(
        (meal) => meal.mealId,
      ),
    ).toEqual(
      expect.arrayContaining(
        orderIds.map((orderId) => fixture.orders.getOrder(orderId)!.meals[0]!.id),
      ),
    );
    expect(
      fixture.kitchenSteps.createReadModel().completed,
    ).toHaveLength(R6_DEMO_RECIPE.steps.length * orderIds.length);
    expect(
      fixture.kitchenProducts
        .createReadModel()
        .finishedMeals.every(
          (meal) =>
            meal.locationId === R6_DEMO_IDS.locations.groundExchange,
        ),
    ).toBe(true);
    expect(
      fixture.logistics
        .exportState()
        .groups.filter((group) => group.ownerType === "finished-meal"),
    ).toHaveLength(orderIds.length);
  });

  it("advances a paid local procurement order into the authoritative inventory", () => {
    const fixture = createR6DemoFixture();
    const beforeCopper = fixture.finance.getSnapshot().availableCopper;
    const beforeEggs = fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)!
      .stacks.find((entry) => entry.itemId === R6_DEMO_IDS.items.egg)?.quantity ?? 0;
    const placed = fixture.localProcurement.placeOrder("procurement-process:place", {
      recipeSelections: [],
      freeItems: [{ itemId: R6_DEMO_IDS.items.egg, quantity: 2 }],
      minuteOfDay: R6_DEMO_CURRENT_MINUTE,
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs: 10,
    });
    requireAccepted(placed);
    const candidates = new EmploymentRestaurantTaskCandidateProvider({
      characters: fixture.characters,
      employment: fixture.employment,
      customers: fixture.customers,
      minuteOfDayAt: () => R6_DEMO_CURRENT_MINUTE,
    });
    const automaticState = {
      schemaVersion: 1 as const,
      revision: 0,
      reserveCopper: 0,
      regions: [],
      lastReconciledAtUtcMs: 0,
      processedOperationIds: [],
    };
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 10,
      processes: [new RestaurantProcurementProcess({
        procurement: fixture.localProcurement,
        automatic: {
          exportState: () => automaticState,
          reconcile: () => { throw new Error("Disabled automation must not reconcile."); },
        },
        fleet: {
          createReadModel: (currentUtcMs) => ({ revision: 0, currentUtcMs, ships: [], voyages: [] }),
          getVoyage: () => null,
          advanceTo: (operationId) => ({ accepted: true, changed: false, operationId, value: [], events: [] }),
        },
        candidates,
        activeRegionId: "region.greyfeather",
        minuteOfDayAt: () => R6_DEMO_CURRENT_MINUTE,
      })],
    });

    let nowUtcMs = 10;
    for (let guard = 0; guard < 10; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      if (fixture.localProcurement.exportState().orders.every((order) => order.status === "completed")) break;
      const next = runtime.getSnapshot().nextTransitionUtcMs;
      nowUtcMs = next === null ? nowUtcMs + 1 : Math.max(nowUtcMs + 1, next);
    }

    expect(fixture.localProcurement.exportState().orders).toEqual([
      expect.objectContaining({ status: "completed", deliveredQuantity: 2 }),
    ]);
    expect(fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.groundExchange)!
      .stacks.find((entry) => entry.itemId === R6_DEMO_IDS.items.egg)?.quantity).toBe(beforeEggs + 2);
    expect(fixture.finance.getSnapshot().availableCopper).toBeLessThan(beforeCopper);
  });
  it("runs a real customer from arrival through payment and departure", () => {
    const fixture = createR6DemoFixture();
    requireAccepted(
      fixture.inventory.depositStack(
        "customer-flow:ingredients",
        R6_DEMO_IDS.locations.airshipExchange,
        [
          { itemId: R6_DEMO_IDS.items.egg, quantity: 2 },
          { itemId: R6_DEMO_IDS.items.tomato, quantity: 3 },
        ],
        1,
      ),
    );
    const plate = fixture.inventory
      .getLocationSnapshot(R6_DEMO_IDS.locations.cabinetClean)!
      .instances[0]!;
    requireAccepted(
      fixture.inventory.transferInstance(
        "customer-flow:plate",
        plate.id,
        R6_DEMO_IDS.locations.airshipExchange,
        1,
      ),
    );
    requireAccepted(
      fixture.customers.arriveGroup("customer-flow:arrive", {
        visitId: "visit.dynamic.customer",
        sceneId: R6_DEMO_IDS.scenes.ground,
        memberCharacterIds: [R6_DEMO_IDS.characters.customer],
        minuteOfDay: R6_DEMO_CURRENT_MINUTE,
        arrivedAtUtcMs: 10,
      }),
    );

    const candidates = new EmploymentRestaurantTaskCandidateProvider({
      characters: fixture.characters,
      employment: fixture.employment,
      customers: fixture.customers,
      minuteOfDayAt: () => R6_DEMO_CURRENT_MINUTE,
    });
    const serviceMovement = {
      movement: fixture.movement,
      defaultSpeedUnitsPerSecond: 20,
      targets: {
        resolveTarget: (_workflow: unknown, phase: string, logicalTarget: { type: string; id: string }) => {
          const definitionId = phase === "order-transfer"
            ? "building.order_transfer"
            : phase === "meal-pickup" || phase === "dishware-handoff"
              ? "building.ground_exchange"
              : phase === "dishware-source"
                ? "building.cabinet"
                : logicalTarget.type === "table"
                  ? "building.table_two_seat"
                  : null;
          return definitionId === null
            ? null
            : { type: "building", id: instanceId(`instance.${definitionId}`) };
        },
      },
    };    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 10,
      processes: [
        new RestaurantOrderRecipeProcess({
          orders: fixture.orders,
          recipes: fixture.recipeExecutions,
          kitchenSteps: fixture.kitchenSteps,
        }),
        new RestaurantKitchenWorkProcess({
          kitchenSteps: fixture.kitchenSteps,
          tasks: fixture.tasks,
          movement: fixture.movement,
          candidates,
        }),
        new RestaurantMealLogisticsProcess({
          products: fixture.kitchenProducts,
          logistics: fixture.logistics,
          freightElevators: fixture.freightElevators,
          groundMealLocationId: R6_DEMO_IDS.locations.groundExchange,
        }),
        new RestaurantServiceWorkProcess({
          customers: fixture.customers,
          orders: fixture.orders,
          service: fixture.service,
          trayDelivery: fixture.trayDelivery,
          tasks: fixture.tasks,
          candidates,
          settlementRegionId: "region.greyfeather",
          movement: serviceMovement,

        }),
        new RestaurantDishwareWorkProcess({
          dishwareService: fixture.dishwareService,
          dishware: fixture.dishware,
          service: fixture.service,
          movement: serviceMovement,
        }),
      ],
    });

    runtime.advanceTo(10);
    expect(fixture.customers.getVisit("visit.dynamic.customer")?.orderId).toBeNull();
    expect(fixture.movement.getCharacter(R6_DEMO_IDS.characters.otto)).toMatchObject({
      status: "moving",
      plan: { target: { id: instanceId("instance.building.table_two_seat") } },
    });
    const firstArrivalUtcMs = runtime.getSnapshot().nextTransitionUtcMs!;
    runtime.advanceTo(firstArrivalUtcMs);
    expect(fixture.customers.getVisit("visit.dynamic.customer")?.orderId).toBeNull();
    expect(fixture.movement.getCharacter(R6_DEMO_IDS.characters.otto)).toMatchObject({
      status: "moving",
      plan: { target: { id: instanceId("instance.building.order_transfer") } },
    });

    let nowUtcMs = firstArrivalUtcMs;
    for (let guard = 0; guard < 200; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      if (
        fixture.customers.getVisit("visit.dynamic.customer")?.phase ===
          "departed" &&
        fixture.customers.getTable("table.demo")?.cleanliness === "clean" &&
        fixture.dishware.getSnapshot().washJobs.length === 0 &&
        fixture.dishware
          .getSnapshot()
          .plates.find((entry) => entry.id === plate.id)?.status === "clean"
      ) {
        break;
      }
      const nextTransitionUtcMs = runtime.getSnapshot().nextTransitionUtcMs;
      nowUtcMs =
        nextTransitionUtcMs === null
          ? nowUtcMs + 1
          : Math.max(nowUtcMs + 1, nextTransitionUtcMs);
    }

    const visit = fixture.customers.getVisit("visit.dynamic.customer")!;
    expect(visit).toMatchObject({
      phase: "departed",
      tableId: "table.demo",
    });
    expect(visit.orderId).not.toBeNull();
    const order = fixture.orders.getOrder(visit.orderId!)!;
    expect(order).toMatchObject({
      status: "settled",
      tableId: "table.demo",
      meals: [{ status: "consumed" }],
    });
    expect(
      fixture.trayDelivery.createReadModel().completedBatches,
    ).toHaveLength(1);
    expect(fixture.finance.getSnapshot().availableCopper).toBeGreaterThan(200);
    expect(
      fixture.customers.getTable("table.demo"),
    ).toMatchObject({
      cleanliness: "clean",
      assignedVisitId: null,
    });
    expect(
      fixture.dishware
        .getSnapshot()
        .plates.find((entry) => entry.id === plate.id),
    ).toMatchObject({ status: "clean" });
    expect(
      fixture.dishwareService.exportState().cleanupWorkflows,
    ).toEqual([
      expect.objectContaining({
        tableId: "table.demo",
        completedAtUtcMs: expect.any(Number),
      }),
    ]);
  });

  it("hands a completed personnel-elevator ride back to Movement", () => {
    const characterId = instanceId("instance.character.runtime_elevator");
    const movement = new MovementModule({
      targetResolver: { resolve: () => null },
    });
    requireAccepted(
      movement.registerCharacter(
        "personnel-runtime:register",
        characterId,
        "area.ground",
        { x: 10, y: 100 },
      ),
    );
    const elevator = new PersonnelElevatorModule({
      id: "elevator.runtime",
      stations: [
        {
          id: "station.ground",
          navigationAreaId: "area.ground",
          waitingPoint: { x: 10, y: 100 },
          exitPoint: { x: 10, y: 100 },
        },
        {
          id: "station.airship",
          navigationAreaId: "area.airship",
          waitingPoint: { x: 10, y: 10 },
          exitPoint: { x: 10, y: 10 },
        },
      ],
      travelDurationMs: 100,
      boardingDurationMs: 10,
      alightingDurationMs: 10,
    });
    requireAccepted(
      elevator.requestTransfer("personnel-runtime:request", {
        id: "ride.runtime",
        characterId,
        fromStationId: "station.ground",
        toStationId: "station.airship",
        requestedAtUtcMs: 0,
      }),
    );
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      processes: [
        new RestaurantPersonnelElevatorProcess({ elevator, movement }),
      ],
    });

    for (let guard = 0; guard < 10; guard += 1) {
      const next = runtime.getSnapshot().nextTransitionUtcMs ?? 0;
      runtime.advanceTo(next);
      if (movement.getCharacter(characterId)?.navigationAreaId === "area.airship") {
        break;
      }
    }

    expect(movement.getCharacter(characterId)).toMatchObject({
      navigationAreaId: "area.airship",
      position: { x: 10, y: 10 },
      status: "idle",
    });
    expect(elevator.exportState()).toMatchObject({
      phase: "idle",
      cabinStationId: "station.airship",
      queue: [],
    });
  });

  it("resumes a service route after a personnel-elevator area transfer", () => {
    const characterId = instanceId("instance.character.cross_area_waiter");
    const movement = new MovementModule({
      targetResolver: {
        resolve: (target) => {
          const entries = {
            "building.airship-target": { area: "area.airship", x: 10, y: 0 },
            "station.ground": { area: "area.ground", x: 20, y: 0 },
            "station.airship": { area: "area.airship", x: 0, y: 0 },
          } as const;
          const entry = entries[target.id as keyof typeof entries];
          return entry === undefined ? null : {
            revision: 1,
            candidates: [{
              id: "interaction.main",
              navigationAreaId: entry.area,
              bounds: { x: entry.x, y: entry.y, width: 0, height: 0 },
              capacity: 1,
            }],
          };
        },
      },
    });
    requireAccepted(movement.registerCharacter(
      "cross-area:register",
      characterId,
      "area.ground",
      { x: 0, y: 0 },
    ));
    const elevator = new PersonnelElevatorModule({
      id: "elevator.cross-area",
      stations: [
        { id: "station.ground", navigationAreaId: "area.ground", waitingPoint: { x: 20, y: 0 }, exitPoint: { x: 20, y: 0 } },
        { id: "station.airship", navigationAreaId: "area.airship", waitingPoint: { x: 0, y: 0 }, exitPoint: { x: 0, y: 0 } },
      ],
      travelDurationMs: 100,
      boardingDurationMs: 10,
      alightingDurationMs: 10,
    });
    const gate = new RestaurantServiceMovementGate({
      movement,
      defaultSpeedUnitsPerSecond: 10,
      targets: {
        resolveTarget: () => ({ type: "building", id: "building.airship-target" }),
      },
      areaTransfer: {
        elevator,
        stationTarget: (stationId) => ({ type: "personnel-elevator-station", id: stationId }),
      },
    });
    const workflow = {
      taskId: "task.cross-area-service",
      kind: "deliver-meal" as const,
      sourceId: "meal.cross-area",
      request: {
        taskId: "task.cross-area-service",
        taskType: "service.deliver-meal",
        source: { type: "order-meal", id: "meal.cross-area" },
        target: { type: "table", id: "table.airship" },
        basePriority: 100,
        requiredTags: ["employee"],
        eligibleJobIds: ["job.waiter"],
        requiredSkills: [],
        urgency: 0,
        urgent: false,
        interruptible: false,
        createdAtUtcMs: 0,
      },
      assignedCharacterId: characterId,
      claimedAtUtcMs: 0,
      stage: "external-handoff" as const,
      pendingOrderId: null,
      recordedSubmission: null,
    };
    let reached = false;
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      processes: [
        {
          id: "40-cross-area-route",
          advance: (context) => {
            gate.startCycle();
            const result = gate.reach(workflow, "work-target", context);
            reached ||= result.ready;
            return {
              changed: result.changed,
              nextTransitionUtcMs: gate.getNextTransitionUtcMs(),
            };
          },
        },
        new RestaurantPersonnelElevatorProcess({ elevator, movement }),
      ],
    });

    let nowUtcMs = 0;
    for (let guard = 0; guard < 20 && !reached; guard += 1) {
      runtime.advanceTo(nowUtcMs);
      const next = runtime.getSnapshot().nextTransitionUtcMs;
      nowUtcMs = next === null ? nowUtcMs + 1 : Math.max(nowUtcMs + 1, next);
    }

    expect(reached).toBe(true);
    expect(movement.getCharacter(characterId)).toMatchObject({
      navigationAreaId: "area.airship",
      status: "arrived",
      plan: { target: { id: "building.airship-target" } },
    });
    expect(elevator.exportState()).toMatchObject({
      phase: "idle",
      cabinStationId: "station.airship",
      queue: [],
    });
  });
  it("keeps active customers out of the employee candidate pool", () => {
    const fixture = createR6DemoFixture();
    const provider = new EmploymentRestaurantTaskCandidateProvider({
      characters: fixture.characters,
      employment: fixture.employment,
      customers: {
        isCustomerVisitActive: (characterId) =>
          characterId === R6_DEMO_IDS.characters.baiyecheng,
      },
      minuteOfDayAt: () => R6_DEMO_CURRENT_MINUTE,
    });

    const chef = provider
      .listCandidates(100)
      .find(
        (candidate) =>
          candidate.characterId === R6_DEMO_IDS.characters.baiyecheng,
      );

    expect(chef).toMatchObject({
      available: true,
      tags: ["customer"],
      primaryJobId: "job.chef",
    });
    expect(chef!.tags).not.toContain("employee");
  });
});