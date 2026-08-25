import { describe, expect, it } from "vitest";
import {
  resolveDialogueBubbleLayout,
  type DialogueBubbleLayoutInput,
} from "../src/renderer/desktop/dialogue-bubble-renderer";

const BASE_INPUT: DialogueBubbleLayoutInput = {
  viewportWidth: 1_200,
  restaurantY: 500,
  restaurantHeight: 200,
  speakerXRatio: 0.5,
  speakerYRatio: 0.75,
  speakerInstanceId: "",
  timeMs: 0,
  motionScale: 1,
  speakerTextHeight: 16,
  lineTextHeight: 32,
};

describe("dialogue bubble layout", () => {
  it("centers a measured bubble above its speaker", () => {
    expect(resolveDialogueBubbleLayout(BASE_INPUT)).toEqual({
      bubbleWidth: 240,
      bubbleHeight: 71,
      textWidth: 216,
      left: 480,
      top: 522,
      bottom: 593,
      tailX: 600,
      speakerTextX: 492,
      speakerTextY: 530,
      lineTextX: 492,
      lineTextY: 548,
    });
  });

  it("maps a speaker ratio into the restaurant artwork bounds", () => {
    const layout = resolveDialogueBubbleLayout({
      ...BASE_INPUT,
      restaurantX: 80,
      restaurantWidth: 640,
      speakerXRatio: 0.5,
    });

    expect(layout).toMatchObject({
      left: 280,
      tailX: 400,
    });
  });

  it("uses the minimum width and keeps a left-edge tail inside", () => {
    const layout = resolveDialogueBubbleLayout({
      ...BASE_INPUT,
      viewportWidth: 800,
      speakerXRatio: 0,
    });

    expect(layout).toMatchObject({
      bubbleWidth: 200,
      textWidth: 176,
      left: 12,
      tailX: 30,
    });
  });

  it("uses the maximum width and clamps against the right edge", () => {
    const layout = resolveDialogueBubbleLayout({
      ...BASE_INPUT,
      viewportWidth: 2_000,
      speakerXRatio: 1,
    });

    expect(layout).toMatchObject({
      bubbleWidth: 270,
      textWidth: 246,
      left: 1_718,
      tailX: 1_970,
    });
  });
});
