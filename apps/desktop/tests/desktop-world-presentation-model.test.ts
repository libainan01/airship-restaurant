import type {
  DesktopWorldReadModel,
  GameplayProcurementSnapshot,
  GameplaySnapshot,
} from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import type { DialogueBubbleContentLookup } from "../src/renderer/desktop/dialogue-bubble-presenter";
import { DesktopWorldPresentationModel } from "../src/renderer/desktop/desktop-world-presentation-model";

const EMPTY_CONTENT: DialogueBubbleContentLookup = {
  getDialogue: () => undefined,
  getDialogueSpeaker: () => undefined,
  getLocalizedText: () => undefined,
};

function createProcurement(
  arrivalRevision = 0,
): GameplayProcurementSnapshot {
  return {
    revision: arrivalRevision,
    arrivalRevision,
    nextTransitionUtcMs: null,
    regions: [],
    orders: [],
    recentArrivals: arrivalRevision === 0
      ? []
      : [{
          orderId: "order.1",
          regionId: "region.local",
          items: [{ itemId: "ingredient.1", quantity: 3 }],
          arrivedAtUtcMs: 1_000,
        }],
    incomingItems: [],
    automation: {
      unlocked: false,
      reserveCopper: 0,
      policies: [],
    },
  };
}

function createGameplay(
  revision: number,
  seatCapacity: number,
  procurement = createProcurement(),
): GameplaySnapshot {
  return {
    revision,
    restaurant: { seatCapacity },
    procurement,
  } as GameplaySnapshot;
}

function createReadModel(options?: {
  readonly revision?: number;
  readonly gameplay?: GameplaySnapshot | null;
  readonly activityRevision?: number;
  readonly quietMode?: boolean;
  readonly arrivalDemo?: boolean;
}): DesktopWorldReadModel {
  const gameplay = options?.gameplay ?? null;
  return {
    sourceRevision: options?.revision ?? 1,
    phase: "ready",
    gameplayRevision: gameplay?.revision ?? null,
    gameplay,
    quietMode: options?.quietMode ?? false,
    procurement: gameplay?.procurement ?? null,
    seatCapacity: gameplay?.restaurant.seatCapacity ?? null,
    restaurantActivity: {
      revision: options?.activityRevision ?? 0,
      events: [{
        id: "customer.left:1",
        type: "customer.left",
        customerId: "customer.1",
        recipeId: "recipe.1",
        leftAtUtcMs: 1_000,
        reason: "wait-timeout",
      }],
    },
    foregroundDialogue: null,
    deliveryRevision: options?.arrivalDemo === true ? 4 : 0,
    guestFlowRevision: options?.arrivalDemo === true ? 6 : 0,
    showLayoutAnchors: options?.arrivalDemo === true,
  };
}

describe("DesktopWorldPresentationModel", () => {
  it("projects runtime, restaurant activity and demo presentation state", () => {
    const state = new DesktopWorldPresentationModel(EMPTY_CONTENT);
    const gameplay = createGameplay(8, 5);

    const update = state.applyReadModel(createReadModel({
      revision: 3,
      gameplay,
      activityRevision: 7,
      quietMode: true,
      arrivalDemo: true,
    }));

    expect(update).toMatchObject({
      runtimePhaseLabel: "世界在线 · 经营修订 8",
      seatCapacity: 5,
      seatCapacityChanged: true,
    });
    expect(state.gameplay).toBe(gameplay);
    expect(state.restaurantActivityRevision).toBe(7);
    expect(state.restaurantEvents).toHaveLength(1);
    expect(state.deliveryRevision).toBe(4);
    expect(state.guestFlowRevision).toBe(6);
    expect(state.showLayoutAnchors).toBe(true);
    expect(state.runtimeQuietMode).toBe(true);
  });

  it("retains the last seat capacity while gameplay is temporarily absent", () => {
    const state = new DesktopWorldPresentationModel(EMPTY_CONTENT);
    state.applyReadModel(createReadModel({
      gameplay: createGameplay(1, 5),
    }));

    const update = state.applyReadModel(createReadModel({
      revision: 2,
      gameplay: null,
    }));

    expect(update.seatCapacity).toBe(5);
    expect(update.seatCapacityChanged).toBe(false);
    expect(state.gameplay).toBeNull();
  });

  it("does not replay restored procurement arrivals during hydration", () => {
    const state = new DesktopWorldPresentationModel(EMPTY_CONTENT);

    const hydrated = state.applyReadModel(createReadModel({
      gameplay: createGameplay(1, 3, createProcurement(1)),
    }));
    const advanced = state.applyReadModel(createReadModel({
      revision: 2,
      gameplay: createGameplay(2, 3, createProcurement(2)),
    }));

    expect(hydrated.procurementArrivalMessage).toBeNull();
    expect(advanced.procurementArrivalMessage).toContain("3 格食材已入库");
  });
  it("retains the projected focus session for the desktop edge timer", () => {
    const state = new DesktopWorldPresentationModel(EMPTY_CONTENT);
    state.applyReadModel({
      ...createReadModel(),
      focusSession: {
        revision: 1,
        phase: "focusing",
        requestedAtUtcMs: 1_000,
        phaseStartedAtUtcMs: 1_000,
        phaseEndsAtUtcMs: 101_000,
        remainingMs: 100_000,
        completedFocusCount: 0,
        focusDurationMs: 100_000,
        breakDurationMs: 20_000,
        effects: {
          active: true,
          customerArrivalIntervalRateBasisPoints: 7_500,
          incomeBonusRateBasisPoints: 2_000,
        },
      },
    });

    expect(state.focusSession).toMatchObject({
      phase: "focusing",
      phaseEndsAtUtcMs: 101_000,
      effects: { active: true },
    });
  });

});