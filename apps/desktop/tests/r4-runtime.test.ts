import { createM2ContentRegistry } from "@airship-restaurant/content";
import { instanceId } from "@airship-restaurant/core";
import { describe, expect, it } from "vitest";
import { createR4CharacterModule } from "../src/main/r4-runtime";

describe("R4 character composition", () => {
  it("boots core members and can instantiate story customers through the same model", () => {
    const characters = createR4CharacterModule(createM2ContentRegistry());
    expect(characters.createReadModel().characters).toMatchObject([
      { definitionId: "character.baiyecheng", coreMember: true },
      { definitionId: "character.otto", coreMember: true },
      { definitionId: "character.martha_bell", coreMember: false },
      { definitionId: "character.thomas_bell", coreMember: false },
    ]);
    expect(characters.createCharacter("visit:martha", {
      instanceId: instanceId("instance.character.martha_visit"),
      definitionId: "character.martha_bell",
      coreMember: false,
      occurredAtUtcMs: 1,
    })).toMatchObject({
      accepted: true,
      value: {
        definitionId: "character.martha_bell",
        skills: { charm: { level: 2 } },
        talentIds: ["talent.old_recipe_memory"],
      },
    });
  });

  it("restores fixed character identity and talents without re-running bootstrap", () => {
    const content = createM2ContentRegistry();
    const first = createR4CharacterModule(content);
    const restored = createR4CharacterModule(content, first.exportState());
    expect(restored.createReadModel().characters).toHaveLength(4);
  });
});
