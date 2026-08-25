import { describe, expect, it, vi } from "vitest";
import {
  AmbientDialogueSystem,
  GameRuntime,
  FocusSessionModule,
  GameplayRuntime,
  NarrativeSystem,
  SeededRandom,
  createInitialRuntimeState,
} from "../src";

function createSimulation(): GameplayRuntime {
  return new GameplayRuntime({
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

  it("broadcasts an external domain change for compatibility projections and saves", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const listener = vi.fn();
    runtime.markReady();
    runtime.subscribe(listener);

    expect(runtime.notifyExternalChange()).toMatchObject({
      revision: 2,
      phase: "ready",
    });
    expect(listener).toHaveBeenCalledOnce();
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
    });
    expect(runtime.getSnapshot()).toMatchObject({
      revision: 2,
      settings: { quietMode: true },
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("dispatches technology upgrades through the optional module port", () => {
    const upgrade = vi.fn(() => ({ accepted: true as const }));
    const technology = {
      createReadModel: () => Object.freeze({
        revision: 0,
        nodes: Object.freeze([]),
        effects: Object.freeze({}),
      }),
      upgrade,
    };
    const runtime = new GameRuntime(
      { nowUtcMs: () => 5_000 },
      null,
      null,
      null,
      null,
      null,
      technology,
    );
    runtime.markReady();

    expect(runtime.dispatch({
      id: "technology-speed-1",
      type: "technology.upgrade-node",
      payload: { nodeId: "technology.cargo_lift_speed" },
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot()).toMatchObject({
      revision: 2,
      technology: { revision: 0 },
    });
    expect(upgrade).toHaveBeenCalledWith(
      "technology-speed-1",
      "technology.cargo_lift_speed",
      5_000,
    );
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
    });
    expect(runtime.getSnapshot().revision).toBe(2);
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

    expect(runtime.dispatch({
      id: "view-first-sale",
      type: "narrative.mark-viewed",
      payload: { eventId: "story.first_online_sale" },
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().narrative).toMatchObject({
      unreadEventIds: [],
    });
    expect(runtime.dispatch({
      id: "complete-first-sale",
      type: "narrative.complete",
      payload: { eventId: "story.first_online_sale" },
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().narrative).toMatchObject({
      events: [expect.objectContaining({ status: "completed" })],
    });
  });

  it("starts ambient dialogue from Core restaurant customer facts", () => {
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
          participantCount: 1,
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
    const started = runtime.tick();
    expect(started.dialogue).toMatchObject({
      active: {
        dialogueId: "dialogue.test.arrival",
        lineIndex: 0,
        startedAtUtcMs: 60_000,
        endsAtUtcMs: 65_000,
      },
    });
    expect(started.dialogue?.lastStartedOpportunityId).toMatch(
      /^restaurant:(arrival|waiting|eating):/,
    );

    const compatibilityCommand = runtime.dispatch({
      id: "npc-dialogue-opportunity-legacy",
      type: "dialogue.request-ambient",
      payload: {
        opportunityId: "legacy-renderer-opportunity",
        context: "arrival",
        availableSpeakerCount: 1,
      },
    });
    expect(compatibilityCommand).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().dialogue).toMatchObject({
      active: { dialogueId: "dialogue.test.arrival" },
      lastStartedOpportunityId: started.dialogue?.lastStartedOpportunityId,
    });
    nowUtcMs = 65_000;
    expect(runtime.tick().dialogue).toMatchObject({
      active: null,
      lastCompletedDialogueId: "dialogue.test.arrival",
    });
  });

  it("delays focus until foreground dialogue ends, then suppresses ambient dialogue", () => {
    const simulation = createSimulation();
    let nowUtcMs = 0;
    const dialogue = new AmbientDialogueSystem({
      dialogues: [{
        id: "dialogue.test.focus-delay",
        locationId: "location.test",
        contexts: ["arrival", "waiting", "eating"],
        minimumFamiliarity: "new",
        weight: 1,
        cooldownMs: 0,
        maxPlaysPerSession: 3,
        prerequisiteEventIds: [],
        participantCount: 1,
        lineDurationsMs: [5_000],
      }],
      random: new SeededRandom(123),
      locationId: "location.test",
      minimumGapMs: 0,
      quietModeGapMultiplier: 3,
      returningAfterSales: 2,
      regularAfterSales: 4,
    });
    const focus = new FocusSessionModule({
      focusDurationMs: 10_000,
      breakDurationMs: 2_000,
      customerArrivalIntervalRateBasisPoints: 7_500,
      incomeBonusRateBasisPoints: 2_000,
    });
    const runtime = new GameRuntime(
      { nowUtcMs: () => nowUtcMs },
      simulation,
      null,
      null,
      dialogue,
      null,
      null,
      focus,
    );
    runtime.markReady();
    nowUtcMs = 60_000;
    runtime.tick();
    expect(runtime.getSnapshot().dialogue?.active).not.toBeNull();

    expect(runtime.dispatch({
      id: "focus:start-after-dialogue",
      type: "focus-session.start",
      payload: {},
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().focusSession).toMatchObject({
      phase: "waiting-for-dialogue",
      remainingMs: null,
    });

    nowUtcMs = 65_000;
    runtime.tick();
    expect(runtime.getSnapshot()).toMatchObject({
      dialogue: { active: null },
      focusSession: { phase: "waiting-for-dialogue" },
    });
    nowUtcMs = 65_001;
    runtime.tick();
    expect(runtime.getSnapshot().focusSession).toMatchObject({
      phase: "focusing",
      phaseStartedAtUtcMs: 65_001,
      phaseEndsAtUtcMs: 75_001,
      effects: { active: true, incomeBonusRateBasisPoints: 2_000 },
    });

    expect(runtime.dispatch({
      id: "ambient:during-focus",
      type: "dialogue.request-ambient",
      payload: {
        opportunityId: "focus-suppressed",
        context: "idle",
        availableSpeakerCount: 1,
      },
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().dialogue).toMatchObject({ active: null });
    expect(runtime.dispatch({
      id: "focus:cancel",
      type: "focus-session.cancel",
      payload: {},
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot().focusSession).toMatchObject({ phase: "idle" });
  });
});
