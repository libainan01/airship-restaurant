import type {
  CharacterPresentationAction,
  CharacterPresentationItem,
  CharacterPresentationReadModel,
  CharacterPresentationTarget,
  PersonnelElevatorPresentation,
  PersonnelElevatorPresentationRequest,
} from "@airship-restaurant/contracts";
import type {
  CharacterReadModel,
  EmploymentReadModel,
  MovementCharacterState,
  MovementReadModel,
  PersonnelElevatorRequestState,
  PersonnelElevatorSnapshot,
  TaskReadModel,
  TaskState,
} from "../modules";

export const CHARACTER_PRESENTATION_READ_MODEL_KEY = "characters";

export const EMPTY_CHARACTER_PRESENTATION_READ_MODEL: CharacterPresentationReadModel =
  Object.freeze({
    sourceRevision: 0,
    characters: Object.freeze([]),
    personnelElevator: null,
  });

export interface CharacterPresentationSources {
  readonly characters: { createReadModel(): CharacterReadModel };
  readonly employment: {
    createReadModel(minuteOfDay: number): EmploymentReadModel;
  };
  readonly movement: { createReadModel(): MovementReadModel };
  readonly tasks: { createReadModel(): TaskReadModel };
  readonly personnelElevator?: {
    getSnapshot(nowUtcMs: number): PersonnelElevatorSnapshot;
  };
  readonly nowUtcMs: () => number;
}

function projectRequest(
  request: PersonnelElevatorRequestState | null,
): PersonnelElevatorPresentationRequest | null {
  return request === null
    ? null
    : Object.freeze({
        id: request.id,
        characterId: request.characterId,
        fromStationId: request.fromStationId,
        toStationId: request.toStationId,
      });
}

function projectElevator(
  snapshot: PersonnelElevatorSnapshot | null,
): PersonnelElevatorPresentation | null {
  if (snapshot === null) return null;
  return Object.freeze({
    id: snapshot.elevatorId,
    phase: snapshot.phase,
    phaseProgress: snapshot.phaseProgress,
    phaseStartedAtUtcMs: snapshot.phaseStartedAtUtcMs,
    phaseEndsAtUtcMs: snapshot.phaseEndsAtUtcMs,
    cabinStationId: snapshot.cabinStationId,
    motionFromStationId: snapshot.motionFromStationId,
    motionToStationId: snapshot.motionToStationId,
    passengerCharacterId: snapshot.passengerCharacterId,
    activeRequest: projectRequest(snapshot.activeRequest),
    queue: Object.freeze(
      snapshot.queue.map((request) => projectRequest(request)!),
    ),
  });
}

function resolveElevatorRequestId(
  characterId: string,
  elevator: PersonnelElevatorSnapshot | null,
): string | null {
  if (elevator?.activeRequest?.characterId === characterId) {
    return elevator.activeRequest.id;
  }
  return elevator?.queue.find((request) => request.characterId === characterId)?.id ?? null;
}

function resolveAction(
  characterId: string,
  movement: MovementCharacterState | null,
  task: TaskState | null,
  elevator: PersonnelElevatorSnapshot | null,
): CharacterPresentationAction {
  if (elevator?.activeRequest?.characterId === characterId) {
    if (elevator.phase === "boarding") return "boarding-elevator";
    if (elevator.phase === "moving-passenger") return "riding-elevator";
    if (elevator.phase === "alighting") return "alighting-elevator";
    return "waiting-elevator";
  }
  if (elevator?.queue.some((request) => request.characterId === characterId)) {
    return "waiting-elevator";
  }
  if (movement?.status === "moving") return "moving";
  if (movement?.status === "blocked") return "blocked";
  if (movement?.status === "arrived" || task !== null) return "interacting";
  return "idle";
}

function projectTarget(
  movement: MovementCharacterState | null,
  task: TaskState | null,
): CharacterPresentationTarget | null {
  const target = movement?.plan?.target ?? task?.target ?? null;
  if (target === null) return null;
  return Object.freeze({
    type: target.type,
    id: target.id,
    interactionId: movement?.plan?.target.interactionId ?? null,
  });
}

export function projectCharacterPresentationReadModel(input: {
  readonly sourceRevision: number;
  readonly characters: CharacterReadModel;
  readonly employment: EmploymentReadModel;
  readonly movement: MovementReadModel;
  readonly tasks: TaskReadModel;
  readonly personnelElevator: PersonnelElevatorSnapshot | null;
}): CharacterPresentationReadModel {
  const employments = new Map(
    input.employment.employees.map((employee) => [employee.characterId, employee]),
  );
  const movements = new Map(
    input.movement.characters.map((movement) => [movement.characterId, movement]),
  );
  const tasks = new Map(
    input.tasks.inProgress
      .filter((task) => task.assignedCharacterId !== null)
      .map((task) => [task.assignedCharacterId!, task]),
  );
  const characters: CharacterPresentationItem[] = input.characters.characters.map(
    (character) => {
      const employment = employments.get(character.id) ?? null;
      const movement = movements.get(character.id) ?? null;
      const task = tasks.get(character.id) ?? null;
      return Object.freeze({
        id: character.id,
        definitionId: character.definitionId,
        name: character.name,
        coreMember: character.coreMember,
        navigationAreaId: movement?.navigationAreaId ?? null,
        x: movement?.position.x ?? null,
        y: movement?.position.y ?? null,
        action: resolveAction(character.id, movement, task, input.personnelElevator),
        target: projectTarget(movement, task),
        task: task === null
          ? null
          : Object.freeze({ id: task.taskId, type: task.taskType, status: "in-progress" as const }),
        tags: Object.freeze([...(employment?.tags ?? [])]),
        primaryJobId: employment?.primaryJobId ?? null,
        elevatorRequestId: resolveElevatorRequestId(character.id, input.personnelElevator),
      });
    },
  );
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    characters: Object.freeze(characters),
    personnelElevator: projectElevator(input.personnelElevator),
  });
}

export class CharacterPresentationReadModelSource {
  readonly #sources: CharacterPresentationSources;
  #sourceRevision = 0;
  #signature = "";
  #snapshot: CharacterPresentationReadModel = EMPTY_CHARACTER_PRESENTATION_READ_MODEL;

  constructor(sources: CharacterPresentationSources) {
    this.#sources = sources;
    this.#snapshot = this.#project();
  }

  getSnapshot(): CharacterPresentationReadModel {
    return this.#project();
  }

  #project(): CharacterPresentationReadModel {
    const nowUtcMs = this.#sources.nowUtcMs();
    const minuteOfDay = Math.floor(nowUtcMs / 60_000) % 1_440;
    const characters = this.#sources.characters.createReadModel();
    const employment = this.#sources.employment.createReadModel(minuteOfDay);
    const movement = this.#sources.movement.createReadModel();
    const tasks = this.#sources.tasks.createReadModel();
    const personnelElevator = this.#sources.personnelElevator?.getSnapshot(nowUtcMs) ?? null;
    const signature = [
      characters.revision,
      employment.revision,
      movement.revision,
      tasks.revision,
      personnelElevator?.revision ?? -1,
      minuteOfDay,
    ].join(":");
    if (signature === this.#signature) return this.#snapshot;
    this.#signature = signature;
    this.#sourceRevision += 1;
    this.#snapshot = projectCharacterPresentationReadModel({
      sourceRevision: this.#sourceRevision,
      characters,
      employment,
      movement,
      tasks,
      personnelElevator,
    });
    return this.#snapshot;
  }
}