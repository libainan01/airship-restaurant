import { describe, expect, it } from "vitest";
import {
  MovementModule,
  PersonnelElevatorModule,
  instanceId,
  type InteractionTargetResolver,
  type PersonnelElevatorDefinition,
} from "../src";

const elevatorDefinition: PersonnelElevatorDefinition = {
  id: "elevator.restaurant",
  stations: [
    { id: "station.ground", navigationAreaId: "area.ground", waitingPoint: { x: 100, y: 500 }, exitPoint: { x: 95, y: 500 } },
    { id: "station.airship", navigationAreaId: "area.airship", waitingPoint: { x: 100, y: 100 }, exitPoint: { x: 95, y: 100 } },
  ],
  travelDurationMs: 100,
  boardingDurationMs: 10,
  alightingDurationMs: 10,
};

describe("personnel elevator movement handoff", () => {
  it("updates the navigation area on elevator completion and then resumes the original target", () => {
    const targets: InteractionTargetResolver = {
      resolve: () => ({
        revision: 1,
        candidates: [{
          id: "work",
          navigationAreaId: "area.airship",
          bounds: { x: 110, y: 100, width: 2, height: 2 },
          capacity: 1,
        }],
      }),
    };
    const movement = new MovementModule({ targetResolver: targets });
    const characterId = instanceId("instance.character.elevator_handoff");
    movement.registerCharacter("register", characterId, "area.ground", { x: 100, y: 500 });
    const target = { type: "building", id: "building.airship_kitchen", interactionId: "work" } as const;
    expect(movement.beginMovement("cross-area", {
      characterId,
      taskId: "task.airship-work",
      target,
      speedUnitsPerSecond: 5,
      occurredAtUtcMs: 0,
    })).toMatchObject({ accepted: false, code: "REGION_CONNECTION_REQUIRED" });

    const elevator = new PersonnelElevatorModule(elevatorDefinition);
    elevator.requestTransfer("request", {
      id: "ride.airship-work",
      characterId,
      fromStationId: "station.ground",
      toStationId: "station.airship",
      requestedAtUtcMs: 0,
    });
    elevator.advanceTo("start", 0);
    const finished = elevator.advanceTo("finish", 120);
    if (!finished.accepted) throw new Error(finished.message);
    const completed = finished.events.find((event) => event.type === "personnel-elevator.transfer-completed");
    const payload = completed?.payload as {
      navigationAreaId: string;
      exitPoint: { x: number; y: number };
    };
    expect(movement.completeAreaTransfer("handoff", characterId, payload.navigationAreaId, payload.exitPoint, 120)).toMatchObject({
      accepted: true,
      value: { navigationAreaId: "area.airship", position: { x: 95, y: 100 } },
    });
    expect(movement.beginMovement("resume", {
      characterId,
      taskId: "task.airship-work",
      target,
      speedUnitsPerSecond: 5,
      occurredAtUtcMs: 121,
    })).toMatchObject({
      accepted: true,
      value: { status: "moving", plan: { destination: { x: 110, y: 100 } } },
    });
  });
});
