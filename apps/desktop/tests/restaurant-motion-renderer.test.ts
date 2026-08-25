import type { GameplayRestaurantSaleSnapshot } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import type { DialogueBubblePresentation } from "../src/renderer/desktop/dialogue-bubble-presenter";
import {
  resolveRestaurantMotionPresentation,
  type RestaurantMotionInput,
} from "../src/renderer/desktop/restaurant-motion-renderer";
import type {
  RestaurantNpcFrame,
  RestaurantNpcPresentation,
} from "../src/renderer/desktop/restaurant-npc-projector";

function createActor(
  overrides: Partial<RestaurantNpcPresentation> = {},
): RestaurantNpcPresentation {
  return {
    instanceId: "otto",
    kind: "otto",
    xRatio: 0.8,
    yRatio: 0.75,
    facing: -1,
    action: "idle",
    visible: true,
    positionSlotId: null,
    speakerId: null,
    speakerName: null,
    conversationParticipant: false,
    activeSpeaker: false,
    trayVisible: false,
    customerId: null,
    mealStatus: "ambient",
    ...overrides,
  };
}

function createFrame(
  overrides: Partial<RestaurantNpcFrame> = {},
): RestaurantNpcFrame {
  return {
    actors: [createActor()],
    conversation: null,
    dialogueOpportunity: null,
    delivery: null,
    orderConfirmation: null,
    kitchenNotification: null,
    ...overrides,
  };
}

const DIALOGUE: DialogueBubblePresentation = {
  dialogueId: "dialogue-1",
  kind: "ambient",
  contexts: ["idle"],
  lineIndex: 0,
  speakerId: "speaker-linlan",
  speakerName: "林岚",
  text: "今天的汤闻起来不错。",
  participantIndex: 0,
  participants: [{
    speakerId: "speaker-linlan",
    speakerName: "林岚",
  }],
};

function resolve(options: {
  frame?: RestaurantNpcFrame;
  dialogue?: DialogueBubblePresentation | null;
  latestSale?: GameplayRestaurantSaleSnapshot;
  nowUtcMs?: number;
  restaurantX?: number;
  restaurantWidth?: number;
}) {
  const input: RestaurantMotionInput = {
    frame: options.frame ?? createFrame(),
    dialogue: options.dialogue ?? null,
    latestSale: options.latestSale,
    timeMs: 0,
    motionScale: 1,
    nowUtcMs: options.nowUtcMs ?? 10_000,
    viewportWidth: 1_000,
    restaurantX: options.restaurantX ?? 0,
    restaurantWidth: options.restaurantWidth ?? 1_000,
    restaurantY: 500,
    restaurantHeight: 200,
  };
  return resolveRestaurantMotionPresentation(input, 0.75);
}

describe("restaurant motion presentation", () => {
  it("describes a ready one-guest conversation with Otto", () => {
    const result = resolve({
      dialogue: DIALOGUE,
      frame: createFrame({
        conversation: {
          dialogueId: "dialogue-1",
          ready: true,
          activeSpeakerActorId: "guest-1",
          participantActorIds: ["guest-1", "otto"],
        },
      }),
    });

    expect(result.dialogueContext).toEqual({
      text: "林岚 ↔ 奥托 · 交谈中",
      visible: true,
      x: 500,
      y: 680,
    });
  });

  it("maps restaurant-local ratios into artwork coordinates", () => {
    const result = resolve({
      restaurantX: 100,
      restaurantWidth: 600,
      frame: createFrame({
        actors: [createActor({ xRatio: 0.8 })],
      }),
    });

    expect(result.dialogueContext.x).toBe(400);
    expect(result.ottoStatus.x).toBe(580);
  });

  it("keeps sale feedback within its display window after ordering", () => {
    const sale: GameplayRestaurantSaleSnapshot = {
      customerId: "customer-1",
      recipeId: "recipe-1",
      dishItemId: "dish-1",
      quantity: 1,
      copperEarned: 12,
      soldAtUtcMs: 8_000,
    };
    const frame = createFrame({
      actors: [
        createActor(),
        createActor({
          instanceId: "guest-1",
          kind: "guest",
          customerId: "customer-1",
          action: "eating",
        }),
      ],
    });

    expect(resolve({ frame, latestSale: sale }).saleFeedback).toMatchObject({
      text: "订单确认 · +12 铜币",
      visible: true,
    });
    expect(resolve({
      frame,
      latestSale: sale,
      nowUtcMs: 12_500,
    }).saleFeedback.visible).toBe(false);
  });

  it("does not show a sale before the matching guest has ordered", () => {
    const sale: GameplayRestaurantSaleSnapshot = {
      customerId: "customer-1",
      recipeId: "recipe-1",
      dishItemId: "dish-1",
      quantity: 1,
      copperEarned: 9,
      soldAtUtcMs: 9_000,
    };
    const frame = createFrame({
      actors: [
        createActor(),
        createActor({
          instanceId: "guest-1",
          kind: "guest",
          customerId: "customer-1",
          action: "walking",
        }),
      ],
    });

    expect(resolve({ frame, latestSale: sale }).saleFeedback.visible).toBe(false);
  });

  it("prioritizes delivery status over other Otto activities", () => {
    const frame = createFrame({
      actors: [createActor({
        action: "serving",
        trayVisible: true,
        conversationParticipant: true,
      })],
      delivery: {
        targetActorId: "guest-1",
        customerId: "customer-1",
      },
      orderConfirmation: {
        targetActorId: "guest-1",
        customerId: "customer-1",
        phase: "confirming",
      },
    });

    expect(resolve({ frame }).ottoStatus).toEqual({
      text: "奥托 · 前往指定餐桌",
      visible: true,
      x: 800,
      y: 592,
    });
  });

  it("falls back to the layout home when Otto is not visible", () => {
    const result = resolve({
      frame: createFrame({
        actors: [createActor({ visible: false })],
      }),
    });

    expect(result.ottoStatus).toEqual({
      text: "",
      visible: false,
      x: 0,
      y: 592,
    });
  });
});
