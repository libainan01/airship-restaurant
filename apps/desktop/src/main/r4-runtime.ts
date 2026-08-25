import type { ContentRegistry } from "@airship-restaurant/content";
import {
  CharacterModule,
  instanceId,
  type CharacterState,
  type InstanceId,
} from "@airship-restaurant/core";

const CORE_CHARACTER_IDS = ["character.baiyecheng", "character.otto"] as const;
const RESIDENT_CHARACTER_IDS = ["character.martha_bell", "character.thomas_bell"] as const;

export const R4_RESIDENT_CHARACTER_INSTANCE_IDS: readonly InstanceId[] = Object.freeze(
  RESIDENT_CHARACTER_IDS.map((definitionId) =>
    instanceId(`instance.character.${definitionId.slice("character.".length)}_resident`),
  ),
);

export function createR4CharacterModule(
  content: ContentRegistry,
  initialState?: CharacterState,
): CharacterModule {
  const module = new CharacterModule(
    content.listCharacters().map((character) => ({
      id: character.id,
      name: character.name,
      baseSkills: character.baseSkills ?? {
        cooking: 1,
        charm: 1,
        movement: 1,
        repair: 1,
        piloting: 1,
      },
      defaultTalentIds: character.talentIds ?? [],
    })),
    content.listTalents(),
    initialState,
  );

  const ensureCharacter = (
    definitionId: string,
    characterId: InstanceId,
    coreMember: boolean,
  ): void => {
    if (module.getCharacter(characterId) !== null) return;
    const result = module.createCharacter(`bootstrap:${characterId}`, {
      instanceId: characterId,
      definitionId,
      coreMember,
      occurredAtUtcMs: 0,
    });
    if (!result.accepted) throw new Error(result.message);
  };

  for (const definitionId of CORE_CHARACTER_IDS) {
    ensureCharacter(
      definitionId,
      instanceId(`instance.character.${definitionId.slice("character.".length)}_core`),
      true,
    );
  }
  for (const [index, definitionId] of RESIDENT_CHARACTER_IDS.entries()) {
    ensureCharacter(definitionId, R4_RESIDENT_CHARACTER_INSTANCE_IDS[index]!, false);
  }
  return module;
}