import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  PersonnelElevatorModule,
  TransactionScope,
  instanceId,
  type PersonnelElevatorDefinition,
} from "../src";

const definition: PersonnelElevatorDefinition = {
  id: "elevator.restaurant",
  stations: [
    { id: "station.ground", navigationAreaId: "area.ground", waitingPoint: { x: 100, y: 500 }, exitPoint: { x: 95, y: 500 } },
    { id: "station.airship", navigationAreaId: "area.airship", waitingPoint: { x: 100, y: 100 }, exitPoint: { x: 95, y: 100 } },
  ],
  travelDurationMs: 100,
  boardingDurationMs: 10,
  alightingDurationMs: 10,
};

function request(id: string, characterToken: string, from = "station.ground", to = "station.airship", time = 0) {
  return {
    id,
    characterId: instanceId(`instance.character.${characterToken}`),
    fromStationId: from,
    toStationId: to,
    requestedAtUtcMs: time,
  };
}

describe("PersonnelElevatorModule", () => {
  it("builds the visible four-leg cross-area movement plan", () => {
    const elevator = new PersonnelElevatorModule(definition);
    expect(elevator.createCrossAreaPlan("area.ground", "area.airship")).toEqual({
      fromNavigationAreaId: "area.ground",
      toNavigationAreaId: "area.airship",
      steps: [
        { type: "walk-to-station", stationId: "station.ground", navigationAreaId: "area.ground", point: { x: 100, y: 500 } },
        { type: "wait-for-elevator", stationId: "station.ground" },
        { type: "ride-elevator", fromStationId: "station.ground", toStationId: "station.airship" },
        { type: "walk-from-station", stationId: "station.airship", navigationAreaId: "area.airship", point: { x: 95, y: 100 } },
      ],
    });
  });

  it("boards at the current station and completes one passenger journey", () => {
    const elevator = new PersonnelElevatorModule(definition);
    const ride = request("ride.one", "rider_one");
    elevator.requestTransfer("request", ride);
    expect(elevator.advanceTo("start", 0)).toMatchObject({ accepted: true, value: { phase: "boarding", activeRequest: { id: ride.id } } });
    const finished = elevator.advanceTo("finish", 120);
    expect(finished).toMatchObject({ accepted: true, value: { phase: "idle", cabinStationId: "station.airship", passengerCharacterId: null } });
    if (finished.accepted) {
      expect(finished.events.map((event) => event.type)).toEqual([
        "personnel-elevator.passenger-trip-started",
        "personnel-elevator.alighting-started",
        "personnel-elevator.transfer-completed",
      ]);
      expect(finished.events.at(-1)?.payload).toMatchObject({
        characterId: ride.characterId,
        navigationAreaId: "area.airship",
        exitPoint: { x: 95, y: 100 },
      });
    }
  });

  it("moves empty only to collect the first waiting passenger", () => {
    const elevator = new PersonnelElevatorModule(definition);
    elevator.requestTransfer("first-request", request("ride.first", "first"));
    elevator.advanceTo("first-start", 0);
    elevator.advanceTo("first-finish", 120);
    expect(elevator.advanceTo("idle-no-request", 200)).toMatchObject({
      accepted: true,
      value: { phase: "idle", cabinStationId: "station.airship" },
      events: [],
    });
    elevator.requestTransfer("second-request", request("ride.second", "second", "station.ground", "station.airship", 201));
    expect(elevator.advanceTo("collect", 201)).toMatchObject({
      accepted: true,
      value: {
        phase: "moving-empty",
        cabinStationId: null,
        motionFromStationId: "station.airship",
        motionToStationId: "station.ground",
        passengerCharacterId: null,
      },
      events: [{ type: "personnel-elevator.empty-trip-started" }],
    });
  });

  it("uses FIFO and never adds a second passenger during a trip", () => {
    const elevator = new PersonnelElevatorModule(definition);
    const first = request("ride.first", "fifo_first");
    const second = request("ride.second", "fifo_second", "station.airship", "station.ground", 10);
    elevator.requestTransfer("request-first", first);
    elevator.advanceTo("start-first", 0);
    elevator.advanceTo("depart-first", 10);
    elevator.requestTransfer("request-second", second);
    expect(elevator.getSnapshot(50)).toMatchObject({
      phase: "moving-passenger",
      passengerCharacterId: first.characterId,
      activeRequest: { id: first.id },
      queue: [{ id: second.id }],
    });
    const advanced = elevator.advanceTo("finish-and-start-next", 120);
    expect(advanced).toMatchObject({
      accepted: true,
      value: { phase: "boarding", passengerCharacterId: null, activeRequest: { id: second.id }, queue: [] },
    });
  });

  it("preserves an in-flight cabin and remaining progress across save restoration", () => {
    const elevator = new PersonnelElevatorModule(definition);
    const ride = request("ride.saved", "saved_rider");
    elevator.requestTransfer("request", ride);
    elevator.advanceTo("start", 0);
    elevator.advanceTo("depart", 10);
    elevator.advanceTo("mid-flight", 60);
    const restored = new PersonnelElevatorModule(definition, elevator.exportState());
    expect(restored.getSnapshot(60)).toMatchObject({ phase: "moving-passenger", phaseProgress: 0.5, passengerCharacterId: ride.characterId });
    expect(restored.advanceTo("resume", 120)).toMatchObject({ accepted: true, value: { phase: "idle", cabinStationId: "station.airship" } });
  });

  it("rejects duplicate character requests and active cancellation", () => {
    const elevator = new PersonnelElevatorModule(definition);
    const ride = request("ride.unique", "unique_rider");
    elevator.requestTransfer("request", ride);
    expect(elevator.requestTransfer("duplicate-character", { ...ride, id: "ride.other" })).toMatchObject({
      accepted: false,
      code: "CHARACTER_ALREADY_WAITING_OR_RIDING",
    });
    elevator.advanceTo("start", 0);
    expect(elevator.cancelQueuedRequest("cancel-active", ride.id, 1)).toMatchObject({ accepted: false, code: "REQUEST_ALREADY_ACTIVE" });
  });

  it("rolls queue and phase changes back transactionally", () => {
    const elevator = new PersonnelElevatorModule(definition);
    const scope = new TransactionScope(new DomainEventBus());
    expect(() => scope.run([elevator], () => {
      elevator.requestTransfer("request", request("ride.rollback", "rollback_rider"));
      elevator.advanceTo("start", 0);
      throw new Error("abort");
    })).toThrow("abort");
    expect(elevator.getSnapshot()).toMatchObject({ phase: "idle", queue: [], activeRequest: null });
  });
});
