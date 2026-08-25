import type {
  CharacterReadModel,
  EmploymentReadModel,
  MovementReadModel,
  PersonnelElevatorSnapshot,
  TaskReadModel,
  TaskState,
} from "../src";
import { describe, expect, it } from "vitest";
import { instanceId, projectCharacterPresentationReadModel } from "../src";

const characterId = instanceId("instance.character.otto_test");

function task(): TaskState {
  return {
    taskId: "task.order.1",
    taskType: "restaurant.take-order",
    source: { type: "table", id: "table.1" },
    target: { type: "table", id: "table.1" },
    basePriority: 10,
    requiredTags: ["employee"],
    eligibleJobIds: ["job.waiter"],
    requiredSkills: [],
    urgency: 0,
    urgent: false,
    interruptible: true,
    createdAtUtcMs: 0,
    status: "in-progress",
    assignedCharacterId: characterId,
    claimedAtUtcMs: 10,
    finishedAtUtcMs: null,
    result: {},
  };
}

function elevator(phase: PersonnelElevatorSnapshot["phase"]): PersonnelElevatorSnapshot {
  const request = {
    id: "request.elevator.1",
    characterId,
    fromStationId: "station.ground",
    toStationId: "station.airship",
    requestedAtUtcMs: 100,
  };
  return {
    schemaVersion: 1,
    revision: 4,
    elevatorId: "elevator.people.1",
    phase,
    cabinStationId: phase === "moving-passenger" ? null : "station.ground",
    motionFromStationId: phase === "moving-passenger" ? "station.ground" : null,
    motionToStationId: phase === "moving-passenger" ? "station.airship" : null,
    phaseStartedAtUtcMs: 100,
    phaseEndsAtUtcMs: 500,
    passengerCharacterId: phase === "moving-passenger" ? characterId : null,
    activeRequest: request,
    queue: [],
    lastAdvancedAtUtcMs: 200,
    processedOperationIds: [],
    phaseProgress: 0.25,
  };
}

function project(personnelElevator: PersonnelElevatorSnapshot | null) {
  const activeTask = task();
  return projectCharacterPresentationReadModel({
    sourceRevision: 9,
    characters: {
      revision: 1,
      characters: [{
        id: characterId,
        definitionId: "character.otto",
        name: "奥托",
        coreMember: true,
        skills: {} as never,
        talents: [],
      }],
    } satisfies CharacterReadModel,
    employment: {
      revision: 2,
      employees: [{
        characterId,
        name: "奥托",
        kind: "core",
        employed: true,
        onShift: true,
        acceptingNewWork: true,
        voyageActive: false,
        learnedJobIds: ["job.waiter"],
        primaryJobId: "job.waiter",
        tags: ["employee"],
        dailyShift: { startMinuteInclusive: 0, endMinuteExclusive: 1_000 },
        dismissalPending: false,
      }],
    } satisfies EmploymentReadModel,
    movement: {
      revision: 3,
      characters: [{
        characterId,
        navigationAreaId: "area.restaurant.ground",
        position: { x: 0.4, y: 0.7 },
        status: "arrived",
        plan: {
          taskId: activeTask.taskId,
          target: { type: "table", id: "table.1", interactionId: "front" },
          targetRevision: 1,
          interactionCandidateId: "front",
          destination: { x: 0.4, y: 0.7 },
          speedUnitsPerSecond: 0.2,
          startedAtUtcMs: 0,
          lastAdvancedAtUtcMs: 10,
          reservationExpiresAtUtcMs: 1_000,
          replanAttempts: 0,
        },
        blockedReason: null,
      }],
    } satisfies MovementReadModel,
    tasks: {
      revision: 4,
      waiting: [],
      inProgress: [activeTask],
      recentTerminal: [],
    } satisfies TaskReadModel,
    personnelElevator,
  });
}

describe("character presentation read model", () => {
  it("combines identity, work tags, movement target and task summary", () => {
    const model = project(null);
    expect(model.sourceRevision).toBe(9);
    expect(model.characters[0]).toMatchObject({
      id: characterId,
      name: "奥托",
      action: "interacting",
      navigationAreaId: "area.restaurant.ground",
      x: 0.4,
      y: 0.7,
      tags: ["employee"],
      primaryJobId: "job.waiter",
      target: { type: "table", id: "table.1", interactionId: "front" },
      task: { id: "task.order.1", type: "restaurant.take-order", status: "in-progress" },
    });
  });

  it("lets elevator state override ordinary movement presentation", () => {
    const model = project(elevator("moving-passenger"));
    expect(model.characters[0]).toMatchObject({
      action: "riding-elevator",
      elevatorRequestId: "request.elevator.1",
    });
    expect(model.personnelElevator).toMatchObject({
      id: "elevator.people.1",
      phase: "moving-passenger",
      phaseProgress: 0.25,
      passengerCharacterId: characterId,
    });
  });
});