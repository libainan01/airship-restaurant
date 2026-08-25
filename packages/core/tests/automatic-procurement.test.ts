import { describe, expect, it } from "vitest";
import {
  AutomaticProcurementModule,
  LOCAL_PROCUREMENT_SCHEMA_VERSION,
  RestaurantApplicationRuntime,
  RestaurantProcurementProcess,
  type AutomaticProcurementOrderPort,
  type AutomaticProcurementStockPort,
  instanceId,
  isAutomaticProcurementState,
  type RestaurantManagerAvailabilityPort,
} from "../src";

function setup(options: { availableCopper?: number; manager?: "locked" | "off-duty" | "available" } = {}) {
  const incoming = new Map<string, number>();
  const available = new Map<string, number>([["item.carrot", 1], ["item.meat", 0]]);
  let copper = options.availableCopper ?? 1000;
  const managerMode = options.manager ?? "available";
  const managers: RestaurantManagerAvailabilityPort = {
    getAvailability: () => ({
      unlocked: managerMode !== "locked",
      available: managerMode === "available",
      characterId: managerMode === "available" ? instanceId("instance.character.manager") : null,
    }),
  };
  const stock: AutomaticProcurementStockPort = {
    getAvailableQuantity: (_regionId, itemId) => available.get(itemId) ?? 0,
    getIncomingQuantity: (_regionId, itemId) => incoming.get(itemId) ?? 0,
  };
  const placements: { itemId: string; quantity: number; operationId: string }[] = [];
  const orders: AutomaticProcurementOrderPort = {
    getAvailableCopper: () => copper,
    preview: ({ itemId, quantity }) => itemId === "item.unknown"
      ? { accepted: false, message: "No route" }
      : { accepted: true, totalPriceCopper: quantity * (itemId === "item.meat" ? 20 : 10) },
    place: (operationId, request) => {
      const price = request.quantity * (request.itemId === "item.meat" ? 20 : 10);
      if (price > copper) return { accepted: false };
      copper -= price;
      incoming.set(request.itemId, (incoming.get(request.itemId) ?? 0) + request.quantity);
      placements.push({ operationId, itemId: request.itemId, quantity: request.quantity });
      return { accepted: true, orderIds: ["order." + placements.length] };
    },
  };
  return { module: new AutomaticProcurementModule(managers, stock, orders), placements, incoming, getCopper: () => copper };
}
function configure(target: ReturnType<typeof setup>, reserveCopper = 0) {
  target.module.setReserveCopper("reserve", reserveCopper, 1);
  target.module.setRegionEnabled("enable", "region.home", true, 2);
  target.module.setTarget("target-carrot", "region.home", "item.carrot", 5, 3);
  target.module.setTarget("target-meat", "region.home", "item.meat", 4, 4);
}

function createProcessRuntime(target: ReturnType<typeof setup>) {
  let procurementUtcMs = 0;
  const procurementState = () => ({
    schemaVersion: LOCAL_PROCUREMENT_SCHEMA_VERSION,
    revision: procurementUtcMs,
    orders: [],
    batches: [],
    carts: [],
    nextOrderSequence: 1,
    nextSubmissionSequence: 1,
    lastAdvancedAtUtcMs: procurementUtcMs,
    processedOperationIds: [],
  });
  return new RestaurantApplicationRuntime({
    startUtcMs: 0,
    processes: [new RestaurantProcurementProcess({
      procurement: {
        exportState: procurementState,
        advanceTo: (_operationId, nowUtcMs) => {
          const changed = procurementUtcMs !== nowUtcMs;
          procurementUtcMs = nowUtcMs;
          return { accepted: true as const, changed, value: procurementState(), committedEventIds: [] };
        },
        startBatch: () => { throw new Error("No local batch is expected."); },
        startRemoteBatch: () => { throw new Error("No remote batch is expected."); },
      },
      automatic: target.module,
      fleet: {
        createReadModel: (currentUtcMs) => ({ revision: 0, currentUtcMs, ships: [], voyages: [] }),
        getVoyage: () => null,
        advanceTo: (operationId) => ({ accepted: true as const, changed: false as const, operationId, value: [], events: [] as const }),
      },
      candidates: { listCandidates: () => [] },
      activeRegionId: "region.home",
      minuteOfDayAt: () => 600,
      automaticIntervalMs: 30_000,
    })],
  });
}
describe("AutomaticProcurementModule", () => {
  it("orders lowest coverage first and counts inbound stock to prevent duplicates", () => {
    const target = setup();
    configure(target);
    expect(target.module.reconcile("reconcile-1", {
      activeRegionId: "region.home", minuteOfDay: 600, occurredAtUtcMs: 10,
    })).toMatchObject({ accepted: true });
    expect(target.placements.map(({ itemId, quantity }) => ({ itemId, quantity }))).toEqual([
      { itemId: "item.meat", quantity: 4 },
      { itemId: "item.carrot", quantity: 4 },
    ]);
    expect(target.module.reconcile("reconcile-2", {
      activeRegionId: "region.home", minuteOfDay: 601, occurredAtUtcMs: 11,
    })).toMatchObject({ accepted: true, value: [] });
    expect(target.placements).toHaveLength(2);
    expect(isAutomaticProcurementState(target.module.exportState())).toBe(true);
  });

  it("protects reserve funds, buys integer quantities, and continues with other items", () => {
    const target = setup({ availableCopper: 100 });
    configure(target, 45);
    target.module.reconcile("reconcile", {
      activeRegionId: "region.home", minuteOfDay: 600, occurredAtUtcMs: 10,
    });
    expect(target.placements).toEqual([
      { operationId: "reconcile:item.meat", itemId: "item.meat", quantity: 2 },
      { operationId: "reconcile:item.carrot", itemId: "item.carrot", quantity: 1 },
    ]);
    expect(target.getCopper()).toBe(50);
  });

  it("retains deficits with manager and source blocking reasons", () => {
    const offDuty = setup({ manager: "off-duty" });
    configure(offDuty);
    offDuty.module.setTarget("target-unknown", "region.home", "item.unknown", 2, 5);
    offDuty.module.reconcile("off-duty", {
      activeRegionId: "region.home", minuteOfDay: 100, occurredAtUtcMs: 10,
    });
    expect(offDuty.placements).toEqual([]);
    expect(offDuty.module.getRegion("region.home")?.targets
      .every((entry) => entry.blockingReason === "MANAGER_UNAVAILABLE")).toBe(true);

    const noSource = setup();
    configure(noSource);
    noSource.module.setTarget("target-unknown", "region.home", "item.unknown", 2, 5);
    noSource.module.reconcile("no-source", {
      activeRegionId: "region.home", minuteOfDay: 600, occurredAtUtcMs: 10,
    });
    expect(noSource.module.getRegion("region.home")?.targets
      .find((entry) => entry.itemId === "item.unknown"))
      .toMatchObject({ waitingSinceUtcMs: 10, blockingReason: "SOURCE_UNAVAILABLE" });
  });

  it("runs manager restocking on the application clock without duplicating inbound stock", () => {
    const target = setup({ availableCopper: 100 });
    configure(target, 45);
    const runtime = createProcessRuntime(target);

    runtime.advanceTo(29_999);
    expect(target.placements).toEqual([]);
    runtime.advanceTo(30_000);
    expect(target.placements.map(({ itemId, quantity }) => ({ itemId, quantity }))).toEqual([
      { itemId: "item.meat", quantity: 2 },
      { itemId: "item.carrot", quantity: 1 },
    ]);
    expect(target.getCopper()).toBe(50);
    expect(runtime.getSnapshot().nextTransitionUtcMs).toBe(60_000);

    runtime.advanceTo(60_000);
    expect(target.placements).toHaveLength(2);
  });

  it("keeps automatic deficits blocked while the restaurant manager is off duty", () => {
    const target = setup({ manager: "off-duty" });
    configure(target);
    const runtime = createProcessRuntime(target);

    runtime.advanceTo(30_000);

    expect(target.placements).toEqual([]);
    expect(target.module.getRegion("region.home")?.targets.every(
      (entry) => entry.blockingReason === "MANAGER_UNAVAILABLE",
    )).toBe(true);
  });
  it("does not cancel paid orders when disabled or when a target is lowered", () => {
    const target = setup();
    configure(target);
    target.module.reconcile("reconcile", {
      activeRegionId: "region.home", minuteOfDay: 600, occurredAtUtcMs: 10,
    });
    target.module.setTarget("lower", "region.home", "item.meat", 1, 11);
    target.module.setRegionEnabled("disable", "region.home", false, 12);
    expect(target.incoming.get("item.meat")).toBe(4);
    expect(target.placements).toHaveLength(2);
  });
});
