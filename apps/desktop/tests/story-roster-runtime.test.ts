import { createM2ContentRegistry } from "@airship-restaurant/content";
import { DomainEventBus } from "@airship-restaurant/core";
import { describe, expect, it } from "vitest";
import { createPrimaryStorySequence } from "../src/main/story-runtime";
import {
  createDesktopStoryRosterRuntime,
  DesktopStoryRosterSequenceRuntime,
} from "../src/main/story-roster-runtime";
describe("desktop story roster runtime", () => {
  it("resolves localized content into the core roster module", () => {
    const roster = createDesktopStoryRosterRuntime(createM2ContentRegistry());
    expect(roster.createReadModel().characters).toEqual([]);

    expect(roster.discover("discover:martha", "character.martha_bell", 10).accepted).toBe(true);
    expect(roster.makeNodeAvailable("available:martha", "story_node.martha_bell.first_service", 11).accepted).toBe(true);
    expect(roster.recordMealEaten("meal:martha", "character.martha_bell", 2, 12).accepted).toBe(true);

    expect(roster.createReadModel().characters[0]).toMatchObject({
      characterId: "character.martha_bell",
      affinity: 2,
      relationshipTierId: "relationship.new",
      identity: expect.stringContaining("贝尔家"),
      nodes: [{
        id: "story_node.martha_bell.first_service",
        status: "available",
        hint: expect.stringContaining("炖菜"),
        summary: null,
        rewardContentIds: [],
      }],
    });
  });

  it("reconciles content-owned stage conditions and publishes declared rewards", () => {
    const content = createM2ContentRegistry();
    const roster = createDesktopStoryRosterRuntime(content);
    const story = createPrimaryStorySequence(content, {
      version: 1,
      revision: 2,
      completedStages: [
        { stageId: "stage.greyfeather.bell_reunion", completedAtUtcMs: 100 },
        { stageId: "stage.greyfeather.first_service", completedAtUtcMs: 200 },
      ],
      active: null,
      onlineSales: 1,
      storyOrderFulfilled: 2,
    });
    const eventBus = new DomainEventBus();
    const rewards: unknown[] = [];
    eventBus.subscribe("story-roster.rewards-declared", (event) => rewards.push(event.payload));
    const runtime = new DesktopStoryRosterSequenceRuntime({ content, eventBus, roster, story });

    expect(runtime.reconcile()).toBe(true);
    expect(runtime.reconcile()).toBe(false);
    expect(roster.createReadModel().characters).toEqual([
      expect.objectContaining({ characterId: "character.martha_bell", completedNodeCount: 1 }),
      expect.objectContaining({ characterId: "character.thomas_bell", completedNodeCount: 1 }),
    ]);
    expect(rewards).toContainEqual({
      characterId: "character.martha_bell",
      nodeId: "story_node.martha_bell.first_service",
      contentIds: ["region.windroot"],
    });
  });
  it("restores an exported roster state", () => {
    const content = createM2ContentRegistry();
    const first = createDesktopStoryRosterRuntime(content);
    first.discover("discover:thomas", "character.thomas_bell", 20);
    first.recordMealEaten("meal:thomas", "character.thomas_bell", 3, 21);

    const restored = createDesktopStoryRosterRuntime(content, first.exportState());
    expect(restored.createReadModel().characters[0]).toMatchObject({
      characterId: "character.thomas_bell",
      affinity: 4,
    });
  });
});