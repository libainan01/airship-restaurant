import { createM2ContentRegistry } from "@airship-restaurant/content";
import { describe, expect, it } from "vitest";
import { instanceId } from "@airship-restaurant/core";
import { createR4CharacterPresentationRuntime } from "../src/main/r4-character-presentation-runtime";
import { createR4PeopleModules } from "../src/main/r4-people-runtime";

describe("recruited character presentation composition", () => {
  it("restores recruited employees with a valid ground position", () => {
    const content = createM2ContentRegistry();
    const people = createR4PeopleModules(content);
    const characterId = instanceId("instance.character.recruit_saved_employee");
    expect(people.characters.createCharacter("test-create-recruit", {
      instanceId: characterId,
      definitionId: "character.recruit_template",
      name: "艾达",
      skillLevels: { cooking: 2, charm: 2, movement: 1, repair: 1, piloting: 1 },
      coreMember: false,
      talentIds: [],
      occurredAtUtcMs: 1,
    })).toMatchObject({ accepted: true });
    expect(people.employment.addEmployee("test-employ-recruit", {
      characterId,
      kind: "recruited",
      learnedJobIds: ["job.chef"],
      primaryJobId: "job.chef",
      dailyShift: { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      occurredAtUtcMs: 1,
    })).toMatchObject({ accepted: true });

    const restored = createR4CharacterPresentationRuntime(
      content,
      () => 600 * 60_000,
      {
        characters: people.characters.exportState(),
        employment: people.employment.exportState(),
      },
    );
    expect(restored.presentation.getSnapshot().characters.find((entry) => entry.id === characterId)).toMatchObject({
      name: "艾达",
      navigationAreaId: "area.restaurant.ground",
      x: expect.any(Number),
      y: expect.any(Number),
      primaryJobId: "job.chef",
      tags: ["employee"],
    });
  });

  it("registers a newly hired character once without disturbing existing positions", () => {
    const runtime = createR4CharacterPresentationRuntime(createM2ContentRegistry(), () => 0);
    const existing = runtime.movement.createReadModel().characters;
    const positions = new Map(existing.map((character) => [character.characterId, character.position]));
    const characterId = instanceId("instance.character.recruit_live_employee");
    runtime.registerCharacterPresentation(characterId);
    runtime.registerCharacterPresentation(characterId);
    expect(runtime.movement.createReadModel().characters).toHaveLength(existing.length + 1);
    for (const [existingCharacterId, position] of positions) {
      expect(runtime.movement.getCharacter(existingCharacterId)?.position).toEqual(position);
    }
    expect(runtime.movement.getCharacter(characterId)).toMatchObject({ navigationAreaId: "area.restaurant.ground" });
  });
});