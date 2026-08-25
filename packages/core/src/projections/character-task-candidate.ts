import type {
  CharacterReadModelItem,
  CharacterSkillKey,
  CharacterWorkContext,
  TaskCandidate,
} from "../modules";

export function projectCharacterTaskCandidate(
  character: CharacterReadModelItem,
  work: CharacterWorkContext,
): TaskCandidate {
  if (character.id !== work.characterId) {
    throw new Error("Character and employment context refer to different instances.");
  }
  const skills = Object.freeze(Object.fromEntries(
    (Object.keys(character.skills) as CharacterSkillKey[]).map((key) => [key, character.skills[key].level]),
  ) as Record<CharacterSkillKey, number>);
  return Object.freeze({
    characterId: character.id,
    available: work.acceptingNewWork,
    tags: Object.freeze([...work.tags]),
    learnedJobIds: Object.freeze([...work.learnedJobIds]),
    primaryJobId: work.primaryJobId,
    skills,
  });
}
