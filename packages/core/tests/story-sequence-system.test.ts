import type { GameplaySnapshot } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import { PresentationDemoSystem } from "../src/presentation-demo-system";
import {
  StorySequenceSystem,
  isStorySequenceState,
  type StorySequenceState,
} from "../src";

function gameplay(
  totalSoldQuantity: number,
  storyDishQuantity: number,
  selectedRecipeId: string | null = "recipe.flatbread",
): GameplaySnapshot {
  return {
    cooking: { selectedRecipeId },
    restaurant: {
      totalSoldQuantity,
      soldByDish: storyDishQuantity === 0
        ? []
        : [{ dishItemId: "dish.stew", quantity: storyDishQuantity }],
    },
  } as unknown as GameplaySnapshot;
}

function createStory(initialState?: StorySequenceState): StorySequenceSystem {
  return new StorySequenceSystem({
    id: "sequence.test",
    stages: [
      {
        id: "stage.arrival",
        dialogueId: "dialogue.arrival",
        lineDurationsMs: [1_000],
        trigger: { type: "session-start" },
      },
      {
        id: "stage.wish",
        dialogueId: "dialogue.wish",
        lineDurationsMs: [1_000],
        trigger: { type: "online-sales", quantity: 1 },
      },
      {
        id: "stage.service",
        dialogueId: "dialogue.service",
        lineDurationsMs: [1_000],
        trigger: { type: "story-order-fulfilled" },
      },
    ],
    order: {
      id: "order.test",
      recipeId: "recipe.stew",
      dishItemId: "dish.stew",
      quantity: 2,
      activatesAfterStageId: "stage.wish",
    },
    journalId: "journal.test",
    journalDiscoveredAfterStageId: "stage.wish",
    journalCompletedAfterStageId: "stage.service",
    narrativeEventId: "story.test",
    narrativeEventAfterStageId: "stage.service",
    residentSpeakerIds: ["speaker.one", "speaker.two"],
    residentsArriveAtStageId: "stage.wish",
    residentsDepartAfterStageId: "stage.service",
  }, initialState);
}

describe("StorySequenceSystem", () => {
  it("turns one online sale into a two-serving story order and completes the journal", () => {
    const story = createStory();
    expect(story.observeOnline(gameplay(0, 0), gameplay(0, 0), 0).snapshot.active)
      .toMatchObject({ dialogueId: "dialogue.arrival", lineIndex: 0 });
    story.observeOnline(gameplay(0, 0), gameplay(0, 0), 1_000);

    expect(story.observeOnline(gameplay(0, 0), gameplay(1, 0), 1_001).snapshot.active)
      .toMatchObject({ dialogueId: "dialogue.wish" });
    const orderOpened = story.observeOnline(gameplay(1, 0), gameplay(1, 0), 2_001).snapshot;
    expect(orderOpened.storyOrder).toMatchObject({ status: "active", fulfilledQuantity: 0 });
    expect(orderOpened.recipeJournal.phase).toBe("discovered");
    expect(orderOpened.residentSpeakerIds).toEqual(["speaker.one", "speaker.two"]);

    expect(story.observeOnline(gameplay(1, 0), gameplay(2, 1), 2_002).snapshot.storyOrder)
      .toMatchObject({ status: "active", fulfilledQuantity: 1 });
    expect(story.observeOnline(gameplay(2, 1), gameplay(3, 2), 2_003).snapshot)
      .toMatchObject({
        active: { dialogueId: "dialogue.service" },
        storyOrder: { status: "fulfilled", fulfilledQuantity: 2 },
      });
    const completed = story.observeOnline(gameplay(3, 2), gameplay(3, 2), 3_003);
    expect(completed.completedNarrativeEventIds).toEqual(["story.test"]);
    expect(completed.snapshot.recipeJournal.phase).toBe("completed");
  });

  it("does not persist an interrupted dialogue line and restarts its stage from line zero", () => {
    const story = createStory();
    story.observeOnline(gameplay(0, 0), gameplay(0, 0), 0);
    expect(story.exportState().active).toBeNull();


    const saved = {
      ...story.exportState(),
      active: { stageId: "stage.arrival", lineIndex: 4, replay: false },
    } as const;
    expect(isStorySequenceState(saved)).toBe(true);
    const restored = createStory(saved);
    expect(restored.observeOnline(gameplay(0, 0), gameplay(0, 0), 50_000).snapshot.active)
      .toMatchObject({ dialogueId: "dialogue.arrival", lineIndex: 0 });
  });

  it("persists progress without treating offline totals as online story sales", () => {
    const story = createStory();
    story.observeOnline(gameplay(0, 0), gameplay(0, 0), 0);
    story.observeOnline(gameplay(0, 0), gameplay(0, 0), 1_000);
    story.observeOnline(gameplay(0, 0), gameplay(1, 0), 1_001);
    story.observeOnline(gameplay(1, 0), gameplay(1, 0), 2_001);
    const state = story.exportState();
    expect(isStorySequenceState(state)).toBe(true);

    const restored = new StorySequenceSystem({
      id: "sequence.test",
      stages: [
        { id: "stage.arrival", dialogueId: "dialogue.arrival", lineDurationsMs: [1_000], trigger: { type: "session-start" } },
        { id: "stage.wish", dialogueId: "dialogue.wish", lineDurationsMs: [1_000], trigger: { type: "online-sales", quantity: 1 } },
        { id: "stage.service", dialogueId: "dialogue.service", lineDurationsMs: [1_000], trigger: { type: "story-order-fulfilled" } },
      ],
      order: { id: "order.test", recipeId: "recipe.stew", dishItemId: "dish.stew", quantity: 2, activatesAfterStageId: "stage.wish" },
      journalId: "journal.test",
      journalDiscoveredAfterStageId: "stage.wish",
      journalCompletedAfterStageId: "stage.service",
      narrativeEventId: "story.test",
      narrativeEventAfterStageId: "stage.service",
      residentSpeakerIds: [],
      residentsArriveAtStageId: "stage.wish",
      residentsDepartAfterStageId: "stage.service",
    }, state);
    const afterOffline = gameplay(9, 7);
    expect(restored.observeOnline(afterOffline, afterOffline, 50_000).snapshot.storyOrder)
      .toMatchObject({ status: "active", fulfilledQuantity: 0 });
  });
});

describe("PresentationDemoSystem", () => {
  it("increments visual triggers without owning gameplay state", () => {
    const demo = new PresentationDemoSystem({
      dialogues: {
        "otto-listening": { dialogueId: "dialogue.demo", lineDurationsMs: [500, 500] },
      },
    });
    expect(demo.start("delivery", 0).snapshot.deliveryRevision).toBe(1);
    expect(demo.start("guest-flow", 1).snapshot.guestFlowRevision).toBe(1);
    expect(demo.start("layout", 2).snapshot.showLayoutAnchors).toBe(true);
    expect(demo.start("otto-listening", 3).snapshot.active)
      .toMatchObject({ dialogueId: "dialogue.demo", lineIndex: 0 });
    expect(demo.advanceTo(503).snapshot.active)
      .toMatchObject({ lineIndex: 1 });
    expect(demo.advanceTo(1_003).snapshot.active).toBeNull();
    expect(demo.stop().snapshot.scenario).toBeNull();
  });
});