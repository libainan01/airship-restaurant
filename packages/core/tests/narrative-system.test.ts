import { describe, expect, it } from "vitest";
import {
  NarrativeSystem,
  isNarrativeSystemState,
  type NarrativeEventConfig,
  type NarrativeGameplayFacts,
} from "../src";

const EVENTS: readonly NarrativeEventConfig[] = [
  {
    id: "story.first_meal",
    priority: 20,
    prerequisiteEventIds: [],
    conditions: [
      {
        type: "online-dish-sales",
        dishItemId: "dish.homecoming_stew",
        quantity: 1,
      },
    ],
  },
  {
    id: "story.second_memory",
    priority: 10,
    prerequisiteEventIds: ["story.first_meal"],
    conditions: [
      {
        type: "online-dish-sales",
        dishItemId: "dish.homecoming_stew",
        quantity: 2,
      },
    ],
  },
];

function facts(homecomingStew: number): NarrativeGameplayFacts {
  return {
    soldByDish: [
      {
        dishItemId: "dish.homecoming_stew",
        quantity: homecomingStew,
      },
    ],
  };
}

describe("NarrativeSystem", () => {
  it("unlocks only from an explicitly observed online delta", () => {
    const narrative = new NarrativeSystem(EVENTS);

    expect(
      narrative.observeOnline(facts(50), facts(50), 1_000),
    ).toMatchObject({
      changed: false,
      unlockedEventIds: [],
    });
    expect(
      narrative.observeOnline(facts(50), facts(51), 2_000),
    ).toMatchObject({
      changed: true,
      unlockedEventIds: ["story.first_meal"],
      snapshot: {
        availableEventIds: ["story.first_meal"],
        unreadEventIds: ["story.first_meal"],
      },
    });
  });

  it("sorts unlocks by priority and respects completed prerequisites", () => {
    const narrative = new NarrativeSystem(EVENTS);

    narrative.observeOnline(facts(0), facts(2), 1_000);
    expect(narrative.getSnapshot().availableEventIds).toEqual([
      "story.first_meal",
    ]);

    expect(narrative.complete("story.first_meal", 2_000)).toMatchObject({
      accepted: true,
      changed: true,
      snapshot: {
        availableEventIds: ["story.second_memory"],
        unreadEventIds: ["story.second_memory"],
      },
    });
  });

  it("marks events viewed and completed without repeating changes", () => {
    const narrative = new NarrativeSystem(EVENTS);
    narrative.observeOnline(facts(0), facts(1), 1_000);

    expect(narrative.markViewed("story.first_meal", 1_100)).toMatchObject({
      accepted: true,
      changed: true,
      snapshot: { unreadEventIds: [] },
    });
    expect(narrative.markViewed("story.first_meal", 1_200)).toMatchObject({
      accepted: true,
      changed: false,
    });
    expect(narrative.complete("story.first_meal", 1_300)).toMatchObject({
      accepted: true,
      changed: true,
    });
    expect(narrative.complete("story.first_meal", 1_400)).toMatchObject({
      accepted: true,
      changed: false,
    });
  });

  it("round-trips a validated state", () => {
    const narrative = new NarrativeSystem(EVENTS);
    narrative.observeOnline(facts(0), facts(2), 1_000);
    narrative.complete("story.first_meal", 2_000);
    const state = narrative.exportState();

    expect(isNarrativeSystemState(state)).toBe(true);
    expect(
      new NarrativeSystem(EVENTS, JSON.parse(JSON.stringify(state)))
        .getSnapshot(),
    ).toEqual(narrative.getSnapshot());
  });

  it("keeps old progress while content adds or removes events", () => {
    const original = new NarrativeSystem(EVENTS);
    original.observeOnline(facts(0), facts(1), 1_000);
    const restored = new NarrativeSystem(
      [
        EVENTS[0]!,
        {
          id: "story.new_event",
          priority: 30,
          prerequisiteEventIds: [],
          conditions: [
            {
              type: "online-dish-sales",
              dishItemId: "dish.homecoming_stew",
              quantity: 3,
            },
          ],
        },
      ],
      original.exportState(),
    );

    expect(restored.getSnapshot()).toMatchObject({
      availableEventIds: ["story.first_meal"],
      events: [
        { eventId: "story.first_meal", status: "available" },
        { eventId: "story.new_event", status: "locked" },
      ],
    });
  });

  it("rejects facts that move backwards", () => {
    const narrative = new NarrativeSystem(EVENTS);
    expect(() =>
      narrative.observeOnline(facts(2), facts(1), 1_000),
    ).toThrow(/moved backwards/);
  });
});
