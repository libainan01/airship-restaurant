import { describe, expect, it, vi } from "vitest";
import {
  AmbientDialogueSystem,
  GameRuntime,
  M2Simulation,
  NarrativeSystem,
  SeededRandom,
  createInitialRuntimeState,
} from "../src";

function createSimulation(): M2Simulation {
  return new M2Simulation({
    startUtcMs: 0,
    randomSeed: 123,
    ingredients: [{ id: "ingredient.test", capacity: 100 }],
    recipes: [
      {
        id: "recipe.test",
        durationMs: 1_000,
        outputItemId: "dish.test",
        outputQuantity: 2,
        unitPriceCopper: 1,
        ingredients: [
          { itemId: "ingredient.test", quantity: 1 },
        ],
      },
    ],
    initialIngredients: [{ itemId: "ingredient.test", quantity: 50 }],
    supply: {
      intervalMs: 60_000,
      items: [{ itemId: "ingredient.test", quantity: 1 }],
    },
    defaultRecipeId: "recipe.test",
  });
}

describe("createInitialRuntimeState", () => {
  it("creates a deterministic boot state", () => {
    expect(createInitialRuntimeState(1_234)).toEqual({
      revision: 0,
      phase: "booting",
      runtimeStartedAtUtcMs: 1_234,
      quietMode: false,
    });
  });
});

describe("GameRuntime", () => {
  it("publishes a ready snapshot once", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const listener = vi.fn();
    runtime.subscribe(listener);

    expect(runtime.markReady()).toMatchObject({
      revision: 1,
      phase: "ready",
      runtimeStartedAtUtcMs: 5_000,
    });
    expect(runtime.markReady().revision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies a typed command and broadcasts the new snapshot", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const listener = vi.fn();
    runtime.markReady();
    runtime.subscribe(listener);

    const result = runtime.dispatch({
      id: "quiet-on",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    });

    expect(result).toMatchObject({
      accepted: true,
      commandId: "quiet-on",
      snapshot: {
        revision: 2,
        settings: { quietMode: true },
      },
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects duplicate command ids without changing state", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    runtime.markReady();

    const command = {
      id: "quiet-on",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    } as const;

    runtime.dispatch(command);
    const duplicate = runtime.dispatch(command);

    expect(duplicate).toMatchObject({
      accepted: false,
      commandId: "quiet-on",
      code: "DUPLICATE_COMMAND",
      snapshot: { revision: 2 },
    });
  });

  it("observes only sales that occur after the online runtime starts", () => {
    const simulation = createSimulation();
    simulation.advanceTo(180_000);
    const offlineSold =
      simulation.getSnapshot().restaurant.totalSoldQuantity;
    expect(offlineSold).toBeGreaterThan(0);

    let nowUtcMs = 180_000;
    const narrative = new NarrativeSystem([
      {
        id: "story.first_online_sale",
        priority: 1,
        prerequisiteEventIds: [],
        conditions: [
          {
            type: "online-dish-sales",
            dishItemId: "dish.test",
            quantity: 1,
          },
        ],
      },
    ]);
    const runtime = new GameRuntime(
      { nowUtcMs: () => nowUtcMs },
      simulation,
      null,
      narrative,
    );
    runtime.markReady();

    runtime.tick();
    expect(runtime.getSnapshot().narrative).toMatchObject({
      availableEventIds: [],
      unreadEventIds: [],
    });

    nowUtcMs = 300_000;
    runtime.tick();
    expect(runtime.getSnapshot().narrative).toMatchObject({
      availableEventIds: ["story.first_online_sale"],
      unreadEventIds: ["story.first_online_sale"],
    });
  });

  it("dispatches narrative viewed and completion commands", () => {
    const simulation = createSimulation();
    let nowUtcMs = 0;
    const narrative = new NarrativeSystem([
      {
        id: "story.first_online_sale",
        priority: 1,
        prerequisiteEventIds: [],
        conditions: [
          {
            type: "online-dish-sales",
            dishItemId: "dish.test",
            quantity: 1,
          },
        ],
      },
    ]);
    const runtime = new GameRuntime(
      { nowUtcMs: () => nowUtcMs },
      simulation,
      null,
      narrative,
    );
    runtime.markReady();
    nowUtcMs = 120_000;
    runtime.tick();

    expect(
      runtime.dispatch({
        id: "view-first-sale",
        type: "narrative.mark-viewed",
        payload: { eventId: "story.first_online_sale" },
      }),
    ).toMatchObject({
      accepted: true,
      snapshot: { narrative: { unreadEventIds: [] } },
    });
    expect(
      runtime.dispatch({
        id: "complete-first-sale",
        type: "narrative.complete",
        payload: { eventId: "story.first_online_sale" },
      }),
    ).toMatchObject({
      accepted: true,
      snapshot: {
        narrative: {
          events: [
            expect.objectContaining({ status: "completed" }),
          ],
        },
      },
    });
  });

  it("publishes ambient dialogue selected from online customer state", () => {
    const simulation = createSimulation();
    let nowUtcMs = 0;
    const dialogue = new AmbientDialogueSystem({
      dialogues: [
        {
          id: "dialogue.test.arrival",
          locationId: "location.test",
          contexts: ["arrival", "waiting", "eating"],
          minimumFamiliarity: "new",
          weight: 1,
          cooldownMs: 0,
          maxPlaysPerSession: 1,
          prerequisiteEventIds: [],
          lineDurationsMs: [5_000],
        },
      ],
      random: new SeededRandom(123),
      locationId: "location.test",
      minimumGapMs: 0,
      quietModeGapMultiplier: 3,
      returningAfterSales: 2,
      regularAfterSales: 4,
    });
    const runtime = new GameRuntime(
      { nowUtcMs: () => nowUtcMs },
      simulation,
      null,
      null,
      dialogue,
    );
    runtime.markReady();

    nowUtcMs = 60_000;
    expect(runtime.tick()).toMatchObject({
      dialogue: {
        active: {
          dialogueId: "dialogue.test.arrival",
          lineIndex: 0,
          startedAtUtcMs: 60_000,
          endsAtUtcMs: 65_000,
        },
      },
    });

    nowUtcMs = 65_000;
    expect(runtime.tick().dialogue).toMatchObject({
      active: null,
      lastCompletedDialogueId: "dialogue.test.arrival",
    });
  });
});
