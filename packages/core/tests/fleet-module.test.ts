import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  FleetModule,
  instanceId,
  isFleetState,
  type FleetCaptainSnapshot,
  type ProcurementAirshipDefinition,
} from "../src";

const DEFINITION: ProcurementAirshipDefinition = {
  id: "airship.procurement.skylark",
  name: "云雀级采购艇",
  purchaseCostCopper: 300,
  defaultStyleId: "style.brass",
  styleIds: ["style.brass", "style.ivory"],
  levels: [
    {
      level: 1,
      upgradeCostCopper: 0,
      cargoCapacity: 5,
      speedUnitsPerSecond: 20,
      maxDurability: 100,
      cooldownEfficiency: 2,
    },
    {
      level: 2,
      upgradeCostCopper: 120,
      cargoCapacity: 8,
      speedUnitsPerSecond: 28,
      maxDurability: 130,
      cooldownEfficiency: 3,
    },
  ],
};

const CAPTAIN_A = instanceId("instance.character.captain_a");
const CAPTAIN_B = instanceId("instance.character.captain_b");

function fixture(options?: { readonly routeUnlocked?: boolean; readonly damaged?: boolean; readonly paymentAccepted?: boolean }) {
  const captains = new Map<string, FleetCaptainSnapshot>([
    [CAPTAIN_A, { eligible: true, pilotingLevel: 2 }],
    [CAPTAIN_B, { eligible: true, pilotingLevel: 1 }],
  ]);
  let routeUnlocked = options?.routeUnlocked ?? true;
  const eventBus = new DomainEventBus();
  const payments: { readonly operationId: string; readonly amountCopper: number }[] = [];
  const fleet = new FleetModule({
    definitions: [DEFINITION],
    initialShips: [
      {
        id: "airship.instance.skylark_1",
        definitionId: DEFINITION.id,
        ...(options?.damaged ? { durability: 0 } : {}),
      },
      {
        id: "airship.instance.skylark_2",
        definitionId: DEFINITION.id,
      },
    ],
    captains: {
      getCaptainSnapshot: (characterId) => captains.get(characterId) ?? null,
    },
    routes: { isRouteUnlocked: () => routeUnlocked },
    policy: {
      calculateVoyageDurationMs: ({
        roundTripDistanceUnits,
        shipSpeedUnitsPerSecond,
        captainPilotingLevel,
      }) => Math.ceil(
        roundTripDistanceUnits * 1_000 /
          (shipSpeedUnitsPerSecond * (1 + captainPilotingLevel * 0.1)),
      ),
      calculateDurabilityLoss: ({
        roundTripDistanceUnits,
        captainPilotingLevel,
      }) => Math.ceil(
        roundTripDistanceUnits / (10 + captainPilotingLevel * 2),
      ),
      calculateCooldownDurationMs: ({
        roundTripDistanceUnits,
        cooldownEfficiency,
      }) => Math.ceil(roundTripDistanceUnits * 1_000 / cooldownEfficiency),
    },
    eventBus,
    finance: {
      payExpense: (operationId, request) => {
        payments.push({ operationId, amountCopper: request.amountCopper });
        return options?.paymentAccepted === false
          ? { accepted: false as const, code: "INSUFFICIENT_FUNDS", message: "Not enough copper." }
          : { accepted: true as const };
      },
    },
  });
  return {
    captains,
    eventBus,
    fleet,
    payments,
    setRouteUnlocked(value: boolean) { routeUnlocked = value; },
  };
}

function startRequest(overrides: Partial<Parameters<FleetModule["startVoyage"]>[1]> = {}) {
  return {
    voyageId: "voyage.remote.1",
    batchId: "procurement.batch.remote.1",
    routeId: "route.greyfeather_windroot",
    shipId: "airship.instance.skylark_1",
    captainId: CAPTAIN_A,
    cargoQuantity: 4,
    roundTripDistanceUnits: 100,
    occurredAtUtcMs: 1_000,
    ...overrides,
  };
}

describe("FleetModule", () => {
  it("freezes ship and captain attributes for an uninterrupted round trip", () => {
    const target = fixture();
    const started = target.fleet.startVoyage("fleet:start:1", startRequest());
    expect(started).toMatchObject({
      accepted: true,
      value: {
        cargoCapacitySnapshot: 5,
        shipLevelSnapshot: 1,
        shipSpeedSnapshot: 20,
        captainPilotingLevelSnapshot: 2,
        durabilityLossSnapshot: 8,
        cooldownDurationMsSnapshot: 50_000,
        returnsAtUtcMs: 5_167,
        status: "in-transit",
      },
    });
    expect(target.fleet.isCaptainVoyageActive(CAPTAIN_A)).toBe(true);

    target.captains.set(CAPTAIN_A, { eligible: true, pilotingLevel: 5 });
    expect(target.fleet.advanceTo("fleet:advance:early", 5_000)).toMatchObject({
      accepted: true,
      changed: false,
      value: [],
    });
    const returned = target.fleet.advanceTo("fleet:advance:return", 6_000);
    expect(returned).toMatchObject({
      accepted: true,
      value: [{ status: "awaiting-handoff", returnedAtUtcMs: 5_167 }],
    });
    expect(target.fleet.isCaptainVoyageActive(CAPTAIN_A)).toBe(true);

    expect(target.fleet.completeHandoff(
      "fleet:handoff:1",
      "voyage.remote.1",
      6_001,
    )).toMatchObject({ accepted: true, value: { status: "completed" } });
    expect(target.fleet.isCaptainVoyageActive(CAPTAIN_A)).toBe(false);
    expect(target.fleet.createReadModel(6_001).ships[0]).toMatchObject({
      durability: 92,
      cooldownEndsAtUtcMs: 55_167,
      available: false,
      unavailableReason: "COOLDOWN",
    });
  });

  it("releases the captain after handoff so another available ship can depart immediately", () => {
    const target = fixture();
    const first = target.fleet.startVoyage("fleet:start:first", startRequest());
    if (!first.accepted) throw new Error(first.message);
    target.fleet.advanceTo("fleet:return:first", first.value.returnsAtUtcMs);
    target.fleet.completeHandoff("fleet:handoff:first", first.value.id, first.value.returnsAtUtcMs);

    expect(target.fleet.startVoyage("fleet:start:cooling", startRequest({
      voyageId: "voyage.remote.cooling",
      batchId: "procurement.batch.remote.cooling",
      occurredAtUtcMs: first.value.returnsAtUtcMs + 1,
    }))).toMatchObject({ accepted: false, code: "SHIP_COOLDOWN" });
    expect(target.fleet.startVoyage("fleet:start:second-ship", startRequest({
      voyageId: "voyage.remote.2",
      batchId: "procurement.batch.remote.2",
      shipId: "airship.instance.skylark_2",
      occurredAtUtcMs: first.value.returnsAtUtcMs + 1,
    }))).toMatchObject({ accepted: true });
  });

  it("rejects locked routes, damaged ships, busy captains and oversized cargo", () => {
    const locked = fixture({ routeUnlocked: false });
    expect(locked.fleet.startVoyage("fleet:locked", startRequest())).toMatchObject({
      accepted: false,
      code: "ROUTE_LOCKED",
    });

    const damaged = fixture({ damaged: true });
    expect(damaged.fleet.startVoyage("fleet:damaged", startRequest())).toMatchObject({
      accepted: false,
      code: "SHIP_DAMAGED",
    });

    const active = fixture();
    expect(active.fleet.startVoyage("fleet:active:first", startRequest())).toMatchObject({ accepted: true });
    expect(active.fleet.startVoyage("fleet:active:captain", startRequest({
      voyageId: "voyage.remote.busy-captain",
      batchId: "procurement.batch.remote.busy-captain",
      shipId: "airship.instance.skylark_2",
      occurredAtUtcMs: 1_001,
    }))).toMatchObject({ accepted: false, code: "CAPTAIN_BUSY" });

    const capacity = fixture();
    expect(capacity.fleet.startVoyage("fleet:capacity", startRequest({
      cargoQuantity: 6,
    }))).toMatchObject({ accepted: false, code: "CARGO_OVER_CAPACITY" });
  });

  it("purchases and upgrades each procurement airship as an independent financed instance", () => {
    const target = fixture();
    expect(target.fleet.purchaseShip(
      "fleet:purchase:third",
      "airship.instance.skylark_3",
      DEFINITION.id,
      2_000,
    )).toMatchObject({ accepted: true, value: { level: 1, durability: 100 } });
    expect(target.fleet.upgradeShip(
      "fleet:upgrade:third",
      "airship.instance.skylark_3",
      2_001,
    )).toMatchObject({ accepted: true, value: { level: 2, durability: 100 } });
    expect(target.fleet.createReadModel(2_001).ships).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "airship.instance.skylark_1", level: 1 }),
      expect.objectContaining({ id: "airship.instance.skylark_3", level: 2, cargoCapacity: 8 }),
    ]));
    expect(target.payments).toEqual([
      { operationId: "fleet:purchase:third:finance", amountCopper: 300 },
      { operationId: "fleet:upgrade:third:finance", amountCopper: 120 },
    ]);

    const poor = fixture({ paymentAccepted: false });
    expect(poor.fleet.purchaseShip(
      "fleet:purchase:denied",
      "airship.instance.skylark_denied",
      DEFINITION.id,
      2_000,
    )).toMatchObject({ accepted: false, code: "INSUFFICIENT_FUNDS" });
    expect(poor.fleet.exportState().ships).toHaveLength(2);
  });

  it("allows repair during cooldown and presentation-only style changes during a voyage", () => {
    const target = fixture();
    const started = target.fleet.startVoyage("fleet:maintenance:start", startRequest());
    if (!started.accepted) throw new Error(started.message);
    expect(target.fleet.changeShipStyle(
      "fleet:style:active",
      started.value.shipId,
      "style.ivory",
      1_001,
    )).toMatchObject({ accepted: true, value: { styleId: "style.ivory" } });
    expect(target.fleet.upgradeShip(
      "fleet:upgrade:active",
      started.value.shipId,
      1_002,
    )).toMatchObject({ accepted: false, code: "SHIP_BUSY" });

    target.fleet.advanceTo("fleet:maintenance:return", started.value.returnsAtUtcMs);
    target.fleet.completeHandoff("fleet:maintenance:handoff", started.value.id, started.value.returnsAtUtcMs);
    expect(target.fleet.repairShip(
      "fleet:repair:cooldown",
      started.value.shipId,
      5,
      started.value.returnsAtUtcMs + 1,
    )).toMatchObject({ accepted: true, value: { durability: 97 } });
    expect(target.fleet.createReadModel(started.value.returnsAtUtcMs + 1).ships[0]).toMatchObject({
      unavailableReason: "COOLDOWN",
      durability: 97,
      styleId: "style.ivory",
    });
  });
  it("restores active assignments silently and validates its save boundary", () => {
    const target = fixture();
    const started = target.fleet.startVoyage("fleet:start:save", startRequest());
    if (!started.accepted) throw new Error(started.message);
    const saved = target.fleet.exportState();
    expect(isFleetState(saved)).toBe(true);

    const eventBus = new DomainEventBus();
    const restoredEvents: string[] = [];
    eventBus.subscribe("*", (event) => restoredEvents.push(event.type));
    const restored = new FleetModule({
      definitions: [DEFINITION],
      initialShips: [],
      captains: { getCaptainSnapshot: () => ({ eligible: true, pilotingLevel: 9 }) },
      routes: { isRouteUnlocked: () => true },
      policy: {
        calculateVoyageDurationMs: () => 1,
        calculateDurabilityLoss: () => 0,
        calculateCooldownDurationMs: () => 0,
      },
      eventBus,
      initialState: saved,
    });

    expect(restored.exportState()).toEqual(saved);
    expect(restored.isCaptainVoyageActive(CAPTAIN_A)).toBe(true);
    expect(restoredEvents).toEqual([]);
  });
});