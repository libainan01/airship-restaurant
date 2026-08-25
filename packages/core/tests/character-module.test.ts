import { describe, expect, it } from "vitest";
import {
  CharacterModule,
  TransactionScope,
  DomainEventBus,
  instanceId,
  isCharacterState,
  type CharacterDefinition,
  type CharacterTalentDefinition,
} from "../src";

const definitions: readonly CharacterDefinition[] = [
  {
    id: "character.baiyecheng",
    name: "白夜城",
    baseSkills: { cooking: 3, charm: 1, movement: 1, repair: 1, piloting: 1 },
    defaultTalentIds: ["talent.steady_hands"],
  },
  {
    id: "character.otto",
    name: "奥托",
    baseSkills: { cooking: 1, charm: 3, movement: 2, repair: 1, piloting: 1 },
    defaultTalentIds: ["talent.warm_welcome"],
  },
];

const talents: readonly CharacterTalentDefinition[] = [
  {
    id: "talent.steady_hands",
    name: "沉稳手法",
    exclusiveCharacterId: "character.baiyecheng",
    effectKeys: ["cooking.qualityStability"],
  },
  {
    id: "talent.warm_welcome",
    name: "亲切招呼",
    exclusiveCharacterId: "character.otto",
    effectKeys: ["service.tipChance"],
  },
  { id: "talent.patient", name: "耐心", exclusiveCharacterId: null, effectKeys: ["task.patience"] },
  { id: "talent.swift", name: "利落", exclusiveCharacterId: null, effectKeys: ["movement.speed"] },
  { id: "talent.careful", name: "细心", exclusiveCharacterId: null, effectKeys: ["repair.stability"] },
];

function setup() {
  return new CharacterModule(definitions, talents);
}

describe("CharacterModule", () => {
  it("represents the protagonist and Otto through the same character model", () => {
    const characters = setup();
    characters.createCharacter("create-baiye", {
      instanceId: instanceId("instance.character.baiye_1"),
      definitionId: "character.baiyecheng",
      coreMember: true,
      occurredAtUtcMs: 1,
    });
    characters.createCharacter("create-otto", {
      instanceId: instanceId("instance.character.otto_1"),
      definitionId: "character.otto",
      coreMember: true,
      occurredAtUtcMs: 2,
    });

    expect(characters.createReadModel().characters).toMatchObject([
      {
        definitionId: "character.baiyecheng",
        name: "白夜城",
        coreMember: true,
        skills: { cooking: { level: 3, experience: 0 } },
        talents: [{ id: "talent.steady_hands" }],
      },
      {
        definitionId: "character.otto",
        name: "奥托",
        coreMember: true,
        skills: { charm: { level: 3, experience: 0 } },
        talents: [{ id: "talent.warm_welcome" }],
      },
    ]);
  });

  it("persists a recruited character instance name and rolled skill snapshot", () => {
    const characters = setup();
    const characterId = instanceId("instance.character.recruit_1");
    const created = characters.createCharacter("create-recruit", {
      instanceId: characterId,
      definitionId: "character.otto",
      name: "林檎",
      skillLevels: { cooking: 2, charm: 4, movement: 3, repair: 2, piloting: 1 },
      coreMember: false,
      talentIds: ["talent.patient"],
      occurredAtUtcMs: 5,
    });
    expect(created).toMatchObject({
      accepted: true,
      value: { name: "林檎", skills: { charm: { level: 4, experience: 0 } } },
    });
    const restored = new CharacterModule(definitions, talents, characters.exportState());
    expect(restored.createReadModel().characters[0]).toMatchObject({
      name: "林檎",
      skills: { cooking: { level: 2 }, charm: { level: 4 }, movement: { level: 3 } },
    });
  });

  it("migrates v1 characters by snapshotting the definition name", () => {
    const characters = setup();
    characters.createCharacter("create-v1", {
      instanceId: instanceId("instance.character.legacy"),
      definitionId: "character.otto",
      coreMember: false,
      occurredAtUtcMs: 1,
    });
    const current = characters.exportState();
    const legacy = {
      ...current,
      schemaVersion: 1,
      characters: current.characters.map(({ name: _name, ...character }) => character),
    };
    const restored = new CharacterModule(definitions, talents, legacy as never);
    expect(restored.exportState()).toMatchObject({
      schemaVersion: 2,
      characters: [{ name: "奥托" }],
    });
  });
  it("rejects another character's exclusive talent and assignments over three talents", () => {
    const characters = setup();
    expect(characters.createCharacter("wrong-exclusive", {
      instanceId: instanceId("instance.character.otto_wrong"),
      definitionId: "character.otto",
      coreMember: false,
      talentIds: ["talent.steady_hands"],
      occurredAtUtcMs: 1,
    })).toMatchObject({ accepted: false, code: "INVALID_TALENTS" });
    expect(characters.createCharacter("too-many", {
      instanceId: instanceId("instance.character.otto_many"),
      definitionId: "character.otto",
      coreMember: false,
      talentIds: ["talent.patient", "talent.swift", "talent.careful", "talent.warm_welcome"],
      occurredAtUtcMs: 2,
    })).toMatchObject({ accepted: false, code: "INVALID_TALENTS" });
  });

  it("rolls unique general talents only and enforces the maximum", () => {
    const library = setup().talentLibrary;
    const rolled = library.rollGeneralTalents(() => 0, 3);
    expect(rolled).toHaveLength(3);
    expect(new Set(rolled).size).toBe(3);
    expect(rolled.every((id) => library.get(id)?.exclusiveCharacterId === null)).toBe(true);
    expect(() => library.rollGeneralTalents(() => 0.5, 4)).toThrow(RangeError);
  });

  it("grows only the selected skill through work or training and broadcasts completion facts", () => {
    const characters = setup();
    const characterId = instanceId("instance.character.baiye_skill");
    characters.createCharacter("create", {
      instanceId: characterId,
      definitionId: "character.baiyecheng",
      coreMember: true,
      occurredAtUtcMs: 1,
    });
    const result = characters.addSkillExperience("cooking-work", {
      characterId,
      skill: "cooking",
      amount: 230,
      source: "work",
      occurredAtUtcMs: 2,
    });
    expect(result).toMatchObject({ accepted: true, value: { level: 5, experience: 30 } });
    if (result.accepted) {
      expect(result.events[0]).toMatchObject({
        type: "character.skill-experience-added",
        payload: { skill: "cooking", source: "work", levelsGained: 2 },
      });
    }
    expect(characters.getCharacter(characterId)?.skills.charm).toEqual({ level: 1, experience: 0 });
  });

  it("is idempotent and restores character progress when a surrounding transaction rolls back", () => {
    const characters = setup();
    const characterId = instanceId("instance.character.baiye_tx");
    const creation = characters.createCharacter("create", {
      instanceId: characterId,
      definitionId: "character.baiyecheng",
      coreMember: true,
      occurredAtUtcMs: 1,
    });
    expect(creation.accepted).toBe(true);
    expect(characters.createCharacter("create", {
      instanceId: characterId,
      definitionId: "character.baiyecheng",
      coreMember: true,
      occurredAtUtcMs: 1,
    })).toMatchObject({ accepted: false, code: "DUPLICATE_OPERATION" });

    const transaction = new TransactionScope(new DomainEventBus());
    expect(() => transaction.run([characters], () => {
      characters.addSkillExperience("training", {
        characterId,
        skill: "repair",
        amount: 100,
        source: "training",
        occurredAtUtcMs: 2,
      });
      throw new Error("abort");
    })).toThrow("abort");
    expect(characters.getCharacter(characterId)?.skills.repair).toEqual({ level: 1, experience: 0 });
  });

  it("restores a persisted talent assignment without rerolling it", () => {
    const characters = setup();
    const characterId = instanceId("instance.character.otto_saved");
    characters.createCharacter("create", {
      instanceId: characterId,
      definitionId: "character.otto",
      coreMember: false,
      talentIds: ["talent.patient", "talent.swift"],
      occurredAtUtcMs: 1,
    });
    const restored = new CharacterModule(definitions, talents, characters.exportState());
    expect(restored.getCharacter(characterId)?.talentIds).toEqual(["talent.patient", "talent.swift"]);
  });
  it("structurally validates current character save states", () => {
    const characters = setup();
    characters.createCharacter("validate-save", {
      instanceId: instanceId("instance.character.validated"),
      definitionId: "character.otto",
      coreMember: false,
      occurredAtUtcMs: 1,
    });
    const state = characters.exportState();
    expect(isCharacterState(state)).toBe(true);
    expect(isCharacterState({ ...state, characters: [{ ...state.characters[0], name: "" }] })).toBe(false);
  });
});
