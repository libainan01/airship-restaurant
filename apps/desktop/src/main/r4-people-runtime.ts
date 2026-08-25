import type { ContentRegistry } from "@airship-restaurant/content";
import {
  EmploymentModule,
  instanceId,
  type CharacterState,
  type EmploymentState,
} from "@airship-restaurant/core";
import { createR4CharacterModule } from "./r4-runtime";

export interface R4PeopleState {
  readonly characters: CharacterState;
  readonly employment: EmploymentState;
}

export function createR4PeopleModules(content: ContentRegistry, initialState?: R4PeopleState) {
  const characters = createR4CharacterModule(content, initialState?.characters);
  const employment = new EmploymentModule(characters, undefined, initialState?.employment);
  if (initialState === undefined) {
    const initialEmployees = [
      {
        characterId: instanceId("instance.character.baiyecheng_core"),
        learnedJobIds: ["job.chef"],
        primaryJobId: "job.chef",
      },
      {
        characterId: instanceId("instance.character.otto_core"),
        learnedJobIds: ["job.waiter", "job.local_procurer", "job.repairer"],
        primaryJobId: "job.waiter",
      },
    ] as const;
    for (const employee of initialEmployees) {
      const result = employment.addEmployee(`bootstrap:employment:${employee.characterId}`, {
        ...employee,
        kind: "core",
        dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
        occurredAtUtcMs: 0,
      });
      if (!result.accepted) throw new Error(result.message);
    }
  }
  return Object.freeze({ characters, employment });
}
