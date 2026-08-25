import { createM2ContentRegistry } from "@airship-restaurant/content";
import {
  FinanceModule,
  NarrativeSystem,
  ProgressionModule,
  TechnologyModule,
} from "@airship-restaurant/core";
import { describe, expect, it } from "vitest";
import { DesktopProgressionFactAdapter } from "../src/main/progression-fact-adapter";
import { createDesktopStoryRosterRuntime } from "../src/main/story-roster-runtime";

describe("story roster progression facts", () => {
  it("unlocks declared progression rewards from completed roster nodes", () => {
    const content = createM2ContentRegistry();
    const roster = createDesktopStoryRosterRuntime(content);
    roster.discover("discover:martha", "character.martha_bell", 1);
    roster.makeNodeAvailable("available:martha", "story_node.martha_bell.first_service", 2);
    roster.completeNode("complete:martha", "story_node.martha_bell.first_service", 3);
    const finance = new FinanceModule(1_000);
    const technology = new TechnologyModule({ definitions: content.listTechnologies(), finance });
    const narrative = new NarrativeSystem(content.listStoryEvents());
    const facts = new DesktopProgressionFactAdapter({ narrative, technology, storyRoster: roster });

    expect(facts.getFactValue("story_node.martha_bell.first_service.completed")).toBe(true);
    const progression = new ProgressionModule({ definitions: content.listProgression(), facts });
    expect(progression.evaluate("progression:story-roster-test", 4)).toMatchObject({
      accepted: true,
      unlockedContentIds: expect.arrayContaining(["region.windroot", "recipe.windroot_soup"]),
    });
  });
});