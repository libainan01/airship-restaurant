import { describe, expect, it } from "vitest";
import { R6DemoApplication } from "../src/demo/r6-demo-application";
import { R6_DEMO_IDS } from "../src/demo/r6-demo-fixture";

describe("R6 Demo application boundary", () => {
  it("completes the fixed business day from only procurement and open-business commands", () => {
    const application = new R6DemoApplication();
    const eventTypes: string[] = [];
    application.fixture.eventBus.subscribe("*", (event) => eventTypes.push(event.type));

    expect(application.getSnapshot()).toMatchObject({ phase: "awaiting-procurement", balanceCopper: 200 });
    expect(application.submitRecipeProcurement("ui:procurement:1")).toMatchObject({
      accepted: true,
      snapshot: { phase: "ready-to-open", balanceCopper: 193 },
    });
    expect(application.fixture.finance.getSnapshot().availableCopper).toBe(193);

    expect(application.startBusiness("ui:open:1")).toMatchObject({
      accepted: true,
      snapshot: {
        phase: "completed",
        balanceCopper: 225,
        orderStatus: "settled",
        customerVisitPhase: "departed",
        completedKitchenStepCount: 6,
      },
    });

    const fixture = application.fixture;
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.egg)).toBe(0);
    expect(fixture.inventory.getStackQuantity(R6_DEMO_IDS.locations.airshipExchange, R6_DEMO_IDS.items.tomato)).toBe(0);
    expect(fixture.dishware.getSnapshot()).toMatchObject({ counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 } });
    expect(fixture.customers.createReadModel().tables[0]).toMatchObject({ cleanliness: "clean" });
    expect(fixture.inventory.getSnapshot().reservations).toHaveLength(0);
    expect(fixture.inventory.getSnapshot().capacityReservations).toHaveLength(0);
    expect(fixture.logistics.exportState().groups.every((group) => group.status === "completed")).toBe(true);
    expect(fixture.freightElevators.getSnapshot().elevators.every((elevator) => elevator.phase === "idle" && elevator.cargoInstanceId === null)).toBe(true);
    expect(eventTypes.filter((type) => type === "kitchen-step.completed")).toHaveLength(6);
    expect(eventTypes.filter((type) => type === "tray-delivery.meal-delivered")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "dishware-service.table-cleanup-completed")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "dishware.washing-completed")).toHaveLength(1);
  });


  it("rejects opening before procurement and duplicate command ids", () => {
    const application = new R6DemoApplication();
    expect(application.startBusiness("ui:open:early")).toMatchObject({ accepted: false, code: "INVALID_PHASE" });
    expect(application.submitRecipeProcurement("ui:procurement:1")).toMatchObject({ accepted: true });
    expect(application.submitRecipeProcurement("ui:procurement:1")).toMatchObject({ accepted: false, code: "DUPLICATE_COMMAND" });
  });
  it("snapshots the focus income bonus when the table order is submitted", () => {
    const application = new R6DemoApplication(undefined, () => 2_000);

    expect(application.submitRecipeProcurement("focus:procurement").accepted).toBe(true);
    expect(application.startBusiness("focus:open")).toMatchObject({
      accepted: true,
      snapshot: { phase: "completed", balanceCopper: 231 },
    });
    expect(application.fixture.orders.getOrder("order.r6_demo")).toMatchObject({
      focusBonusRateBasisPoints: 2_000,
    });
    expect(application.fixture.finance.getSnapshot().ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "focus-bonus", amountCopper: 6 }),
      ]),
    );
  });

});