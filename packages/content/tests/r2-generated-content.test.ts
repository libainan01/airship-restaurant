import { describe, expect, it } from "vitest";
import {
  M2_BUILDING_DEFINITIONS,
  M2_CONTENT_DEFINITIONS,
  M2_LOCAL_PROCUREMENT_CARTS,
  M2_LOCAL_PROCUREMENT_SUPPLIERS,
  M2_RECRUITMENT_DEFINITION,
  M2_PROGRESSION_DEFINITIONS,
  M2_STORY_SEQUENCES,
  M2_TECHNOLOGY_DEFINITIONS,
  createM2ContentRegistry,
} from "../src";

describe("R2 generated content", () => {
  it("provides both a game production DAG and a practical real-world recipe", () => {
    for (const recipe of M2_CONTENT_DEFINITIONS.recipes) {
      expect(recipe.productionSteps?.length).toBeGreaterThan(0);
      expect(recipe.detailedRecipe?.ingredients.length).toBeGreaterThan(0);
      expect(recipe.detailedRecipe?.steps.map((step) => step.order)).toEqual(
        recipe.detailedRecipe?.steps.map((_, index) => index + 1),
      );
    }
    const stew = M2_CONTENT_DEFINITIONS.recipes.find(
      (recipe) => recipe.id === "recipe.homecoming_stew",
    );
    expect(stew?.productionSteps?.filter(
      (step) => step.prerequisiteStepIds.length === 0,
    )).toHaveLength(2);
  });

  it("registers building footprints and technology nodes from generated data", () => {
    const registry = createM2ContentRegistry();
    expect(registry.listBuildings()).toHaveLength(M2_BUILDING_DEFINITIONS.length);
    expect(registry.getBuilding("building.cargo_lift")?.footprint).toEqual({
      width: 1,
      height: 1,
    });
    expect(registry.getBuilding("building.ground_exchange_station")?.levels).toHaveLength(1);
    expect(registry.getBuilding("building.airship_exchange_station")?.levels[1]).toMatchObject({
      level: 2,
      upgradeCostCopper: 120,
      capabilityValues: {
        "storage.ingredient-capacity": 18,
        "storage.dishware-capacity": 12,
        "storage.meal-capacity": 10,
      },
    });
    expect(registry.getBuilding("building.waiting_area")?.levels.map((level) =>
      level.capabilityValues["waiting-area.slot-count"])).toEqual([4, 6]);
    expect(registry.listTechnologies()).toHaveLength(M2_TECHNOLOGY_DEFINITIONS.length);
    expect(registry.listTechnologies().map((technology) => technology.id)).toEqual([
      "technology.cargo_lift_speed",
      "technology.cargo_lift_count",
      "technology.organization_management",
      "technology.tray_improvement",
      "technology.recruitment_center",
    ]);
    expect(registry.getTechnology("technology.cargo_lift_count")?.baseEffects).toEqual({
      "freight-elevator.available-count": 4,
    });
    expect(registry.getTechnology("technology.recruitment_center")?.prerequisites).toEqual([
      { nodeId: "technology.organization_management", requiredLevel: 1 },
    ]);
    expect(registry.listProgression()).toHaveLength(M2_PROGRESSION_DEFINITIONS.length);
    expect(registry.getProgression("region.greyfeather")).toMatchObject({
      kind: "region",
      initiallyRevealed: true,
      initiallyUnlocked: true,
    });
    expect(registry.getProgression("region.windroot")?.unlockSources).toEqual([
      {
        id: "source.story_bell_first_service",
        requirements: [{ kind: "fact", factId: "story_node.martha_bell.first_service.completed" }],
      },
    ]);
    expect(registry.getProgression("recipe.windroot_soup")?.unlockSources[0]?.requirements).toEqual([
      { kind: "content-unlocked", contentId: "region.windroot" },
    ]);
    expect(registry.getProgression("region.brasslands")?.spoilerSensitive).toBe(true);    expect(registry.listTalents().length).toBeGreaterThan(0);
    expect(registry.getCharacter("character.baiyecheng")?.baseSkills?.cooking).toBe(3);
    expect(registry.getBuilding("building.cargo_lift")?.componentSlots).toEqual([
      { slotId: "slot.single_item_transport", capabilityId: "capability.single_item_transport" },
    ]);
    expect(M2_STORY_SEQUENCES[0]).toMatchObject({ isPrimary: true });
    expect(M2_STORY_SEQUENCES[0]?.stages).toHaveLength(7);
    expect(M2_LOCAL_PROCUREMENT_SUPPLIERS).toMatchObject([
      { id: "supplier.greyfeather_market", sourceRegionId: "region.greyfeather" },
    ]);
    expect(M2_LOCAL_PROCUREMENT_CARTS[0]?.levels.map((level) => level.capacity)).toEqual([3, 5, 8]);
expect(M2_RECRUITMENT_DEFINITION).toMatchObject({
      templateCharacterId: "character.recruit_template",
      candidateCount: 3,
      qualityTiers: [
        { tier: 0, minimumSkill: 1, maximumSkill: 2, maximumTalentQuality: 1 },
        { tier: 1, maximumTalentQuality: 2 },
        { tier: 2, maximumTalentQuality: 3 },
        { tier: 3, maximumSkill: 5, maximumTalentQuality: 3 },
      ],
    });
    expect(new Set(M2_RECRUITMENT_DEFINITION.candidateNames).size).toBe(M2_RECRUITMENT_DEFINITION.candidateNames.length);
    expect(registry.getCharacter("character.recruit_template")?.talentIds).toEqual([]);
    expect(registry.listTalents().filter((talent) => talent.exclusiveCharacterId === null).map((talent) => talent.qualityTier)).toEqual([1, 2, 3]);
  });
});