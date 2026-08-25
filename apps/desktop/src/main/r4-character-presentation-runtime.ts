import type { ContentRegistry } from "@airship-restaurant/content";
import {
  CharacterPresentationReadModelSource,
  MovementModule,
  PersonnelElevatorModule,
  TaskModule,
  instanceId,
  type CharacterModule,
  type EmploymentModule,
} from "@airship-restaurant/core";
import { createR4PeopleModules, type R4PeopleState } from "./r4-people-runtime";

export interface R4CharacterPresentationModules {
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly tasks: TaskModule;
  readonly movement: MovementModule;
  readonly personnelElevator: PersonnelElevatorModule;
}

export function createR4CharacterPresentationRuntimeFromModules(
  modules: R4CharacterPresentationModules,
  nowUtcMs: () => number,
) {
  const fixedPositions = new Map([
    [instanceId("instance.character.baiyecheng_core"), { x: 0.21, y: 0.765 }],
    [instanceId("instance.character.otto_core"), { x: 0.82, y: 0.765 }],
  ]);
  const registerCharacterPresentation = (characterId: ReturnType<typeof instanceId>): void => {
    if (modules.movement.getCharacter(characterId) !== null) return;
    const recruitedIndex = modules.movement.createReadModel().characters.filter(
      (character) => !fixedPositions.has(character.characterId),
    ).length;
    const position = fixedPositions.get(characterId) ?? {
      x: 0.68 + (recruitedIndex % 5) * 0.035,
      y: 0.765 - Math.floor(recruitedIndex / 5) * 0.025,
    };
    const result = modules.movement.registerCharacter(
      `bootstrap:movement:${characterId}`,
      characterId,
      "area.restaurant.ground",
      position,
    );
    if (!result.accepted) throw new Error(result.message);
  };
  for (const character of modules.characters.createReadModel().characters) {
    registerCharacterPresentation(character.id);
  }
  const presentation = new CharacterPresentationReadModelSource({
    characters: modules.characters,
    employment: modules.employment,
    movement: modules.movement,
    tasks: modules.tasks,
    personnelElevator: modules.personnelElevator,
    nowUtcMs,
  });
  return Object.freeze({
    ...modules,
    presentation,
    registerCharacterPresentation,
  });
}

export function createR4CharacterPresentationRuntime(
  content: ContentRegistry,
  nowUtcMs: () => number,
  initialPeopleState?: R4PeopleState,
) {
  const people = createR4PeopleModules(content, initialPeopleState);
  const tasks = new TaskModule();
  const movement = new MovementModule({ targetResolver: { resolve: () => null } });
  const personnelElevator = new PersonnelElevatorModule({
    id: "personnel-elevator.restaurant-airship",
    stations: [
      {
        id: "personnel-station.ground",
        navigationAreaId: "area.restaurant.ground",
        waitingPoint: { x: 0.94, y: 0.765 },
        exitPoint: { x: 0.91, y: 0.765 },
      },
      {
        id: "personnel-station.airship",
        navigationAreaId: "area.airship.kitchen",
        waitingPoint: { x: 0.08, y: 0.78 },
        exitPoint: { x: 0.12, y: 0.78 },
      },
    ],
    travelDurationMs: 4_000,
    boardingDurationMs: 600,
    alightingDurationMs: 600,
  });
  return createR4CharacterPresentationRuntimeFromModules({
    ...people,
    tasks,
    movement,
    personnelElevator,
  }, nowUtcMs);
}