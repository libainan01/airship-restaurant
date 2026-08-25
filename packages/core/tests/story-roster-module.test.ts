import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  StoryRosterCustomerEventAdapter,
  StoryRosterModule,
  instanceId,
  isStoryRosterState,
} from "../src";

function setup() {
  return new StoryRosterModule({
    characters: [{
      characterId: "character.bell",
      identity: "远方来的旧友",
      relationshipTiers: [
        { id: "relationship.new", minimumAffinity: 0 },
        { id: "relationship.familiar", minimumAffinity: 5 },
      ],
    }],
    nodes: [
      { id: "story.bell.meeting", characterId: "character.bell", sequence: 1, hint: "也许该再见一面。", summary: "在灰羽港与铃重逢。", prerequisiteNodeIds: [], rewardContentIds: ["recipe.tomato_egg"] },
      { id: "story.bell.promise", characterId: "character.bell", sequence: 2, hint: "她似乎还有话想说。", summary: "铃说起了旧日约定。", prerequisiteNodeIds: ["story.bell.meeting"], rewardContentIds: ["region.windroot"] },
    ],
    affinityByQuality: { 1: 1, 2: 3, 3: 5 },
  });
}

describe("StoryRosterModule", () => {
  it("only exposes encountered characters and hides unfinished summaries and rewards", () => {
    const module = setup();
    expect(module.createReadModel().characters).toEqual([]);
    module.discover("discover", "character.bell", 1);
    module.makeNodeAvailable("available", "story.bell.meeting", 2);
    expect(module.createReadModel().characters[0]).toMatchObject({
      affinity: 0,
      completedNodeCount: 0,
      totalNodeCount: 2,
      nodes: [
        { id: "story.bell.meeting", status: "available", hint: "也许该再见一面。", summary: null, rewardContentIds: [] },
        { id: "story.bell.promise", status: "locked", hint: "她似乎还有话想说。", summary: null, rewardContentIds: [] },
      ],
    });
  });

  it("increases affinity only through explicit completed-meal quality and derives relationship tier", () => {
    const module = setup();
    module.discover("discover", "character.bell", 1);
    expect(module.recordMealEaten("meal-1", "character.bell", 2, 2)).toMatchObject({ accepted: true, value: 3 });
    expect(module.recordMealEaten("meal-2", "character.bell", 1, 3)).toMatchObject({ accepted: true, value: 4 });
    expect(module.recordMealEaten("meal-3", "character.bell", 1, 4)).toMatchObject({ accepted: true, value: 5 });
    expect(module.createReadModel().characters[0]).toMatchObject({ affinity: 5, relationshipTierId: "relationship.familiar" });
  });

  it("discovers story visitors and increases affinity only after their bound meal is consumed", () => {
    const roster = setup();
    const eventBus = new DomainEventBus();
    const storyVisitor = instanceId("instance.character.story_bell");
    const ordinaryVisitor = instanceId("instance.character.ordinary_guest");
    const characters = new Map([
      [storyVisitor, { definitionId: "character.bell" }],
      [ordinaryVisitor, { definitionId: "character.ordinary" }],
    ]);
    const mealQuality = new Map([["meal.story", 3.2], ["meal.ordinary", 5]]);
    const broadcasts: string[] = [];
    eventBus.subscribe("*", (event) => broadcasts.push(event.type));
    let changedCount = 0;
    const adapter = new StoryRosterCustomerEventAdapter({
      eventBus,
      roster,
      characters: { getCharacter: (id) => characters.get(id) ?? null },
      finishedMeals: { getFinishedMealByMealId: (id) => {
        const quality = mealQuality.get(id);
        return quality === undefined ? null : { quality };
      } },
      storyCharacterIds: ["character.bell"],
      qualityTiers: [
        { qualityTier: 1, minimumQuality: 1 },
        { qualityTier: 2, minimumQuality: 3 },
        { qualityTier: 3, minimumQuality: 5 },
      ],
      onChanged: () => { changedCount += 1; },
    });

    eventBus.publish({
      id: "customer.group-arrived:story",
      type: "customer.group-arrived",
      occurredAtUtcMs: 10,
      payload: { memberCharacterIds: [storyVisitor, ordinaryVisitor] },
    });
    expect(roster.createReadModel().characters).toHaveLength(1);

    eventBus.publish({
      id: "customer.meal-consumed:ordinary",
      type: "customer.meal-consumed",
      occurredAtUtcMs: 20,
      payload: { dinerCharacterId: ordinaryVisitor, mealId: "meal.ordinary" },
    });
    eventBus.publish({
      id: "customer.meal-consumed:story",
      type: "customer.meal-consumed",
      occurredAtUtcMs: 21,
      payload: { dinerCharacterId: storyVisitor, mealId: "meal.story" },
    });
    expect(roster.createReadModel().characters[0]).toMatchObject({ affinity: 3 });
    expect(broadcasts).toContain("story-roster.character-discovered");
    expect(broadcasts).toContain("story-roster.affinity-increased");
    expect(changedCount).toBe(2);

    eventBus.publish({
      id: "customer.meal-consumed:story",
      type: "customer.meal-consumed",
      occurredAtUtcMs: 21,
      payload: { dinerCharacterId: storyVisitor, mealId: "meal.story" },
    });
    expect(roster.createReadModel().characters[0]?.affinity).toBe(3);
    adapter.dispose();
  });
  it("keeps available nodes permanent, enforces prerequisites, completes idempotently and declares rewards", () => {
    const module = setup();
    module.discover("discover", "character.bell", 1);
    module.makeNodeAvailable("available-2", "story.bell.promise", 2);
    expect(module.completeNode("too-early", "story.bell.promise", 3)).toMatchObject({ accepted: false, code: "NODE_NOT_AVAILABLE" });
    module.makeNodeAvailable("available-1", "story.bell.meeting", 4);
    const first = module.completeNode("complete-1", "story.bell.meeting", 5);
    expect(first).toMatchObject({ accepted: true, value: ["recipe.tomato_egg"] });
    expect(first.accepted && first.events.map((event) => event.type)).toEqual([
      "story-roster.node-completed",
      "story-roster.rewards-declared",
    ]);
    expect(module.completeNode("complete-again", "story.bell.meeting", 6)).toMatchObject({ accepted: true, changed: false });
    expect(module.completeNode("complete-2", "story.bell.promise", 7)).toMatchObject({ accepted: true, value: ["region.windroot"] });
    expect(module.createReadModel().characters[0]?.nodes[0]).toMatchObject({ status: "completed", summary: "在灰羽港与铃重逢。" });
    expect(isStoryRosterState(module.exportState())).toBe(true);
  });
});
