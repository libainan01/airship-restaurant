import type Phaser from "phaser";
import type { DialogueBubblePresentation } from "./dialogue-bubble-presenter";
import type { RestaurantNpcFrame } from "./restaurant-npc-presentation";

export interface DialogueBubbleColors {
  readonly ink: number;
  readonly creamLight: number;
  readonly copper: number;
}

export interface DialogueBubbleLayoutInput {
  readonly viewportWidth: number;
  readonly restaurantX?: number | undefined;
  readonly restaurantWidth?: number | undefined;
  readonly restaurantY: number;
  readonly restaurantHeight: number;
  readonly speakerXRatio: number;
  readonly speakerYRatio: number;
  readonly speakerInstanceId: string;
  readonly timeMs: number;
  readonly motionScale: number;
  readonly speakerTextHeight: number;
  readonly lineTextHeight: number;
}

export interface DialogueBubbleLayout {
  readonly bubbleWidth: number;
  readonly bubbleHeight: number;
  readonly textWidth: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly tailX: number;
  readonly speakerTextX: number;
  readonly speakerTextY: number;
  readonly lineTextX: number;
  readonly lineTextY: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveDialogueBubbleLayout(
  input: DialogueBubbleLayoutInput,
): DialogueBubbleLayout {
  const bubbleWidth = clamp(
    Math.round(input.viewportWidth * 0.2),
    200,
    270,
  );
  const textWidth = bubbleWidth - 24;
  const bubbleHeight = Math.ceil(
    10 + input.speakerTextHeight + 2 + input.lineTextHeight + 11,
  );
  const seatX =
    (input.restaurantX ?? 0) +
    input.speakerXRatio * (input.restaurantWidth ?? input.viewportWidth);
  const actorTime =
    input.timeMs * Math.max(0.35, input.motionScale) +
    input.speakerInstanceId.length * 137;
  const bounce = Math.sin(actorTime * 0.005) * 1.2;
  const speakerHeadY =
    input.restaurantY +
    input.restaurantHeight * input.speakerYRatio -
    bounce -
    38;
  const left = clamp(
    seatX - bubbleWidth / 2,
    12,
    input.viewportWidth - bubbleWidth - 12,
  );
  const top = speakerHeadY - bubbleHeight - 19;
  const bottom = top + bubbleHeight;
  const tailX = clamp(seatX, left + 18, left + bubbleWidth - 18);

  return {
    bubbleWidth,
    bubbleHeight,
    textWidth,
    left,
    top,
    bottom,
    tailX,
    speakerTextX: left + 12,
    speakerTextY: top + 8,
    lineTextX: left + 12,
    lineTextY: top + 10 + input.speakerTextHeight,
  };
}

export class DialogueBubbleRenderer {
  readonly #colors: DialogueBubbleColors;

  constructor(colors: DialogueBubbleColors) {
    this.#colors = colors;
  }

  draw(options: {
    readonly graphics: Phaser.GameObjects.Graphics;
    readonly speakerText: Phaser.GameObjects.Text;
    readonly lineText: Phaser.GameObjects.Text;
    readonly bubble: DialogueBubblePresentation | null;
    readonly frame: RestaurantNpcFrame;
    readonly viewportWidth: number;
    readonly restaurantX?: number | undefined;
    readonly restaurantWidth?: number | undefined;
    readonly restaurantY: number;
    readonly restaurantHeight: number;
    readonly timeMs: number;
    readonly motionScale: number;
  }): DialogueBubbleLayout | null {
    const { graphics, speakerText, lineText, bubble, frame } = options;
    graphics.clear();
    const conversation = frame.conversation;
    const speakerActor = frame.actors.find(
      (actor) =>
        actor.instanceId === conversation?.activeSpeakerActorId,
    );
    if (
      bubble === null ||
      conversation === null ||
      !conversation.ready ||
      speakerActor === undefined
    ) {
      speakerText.setVisible(false);
      lineText.setVisible(false);
      return null;
    }

    const bubbleWidth = clamp(
      Math.round(options.viewportWidth * 0.2),
      200,
      270,
    );
    speakerText.setText(bubble.speakerName).setVisible(true);
    lineText
      .setWordWrapWidth(bubbleWidth - 24, true)
      .setText(bubble.text)
      .setVisible(true);

    const layout = resolveDialogueBubbleLayout({
      viewportWidth: options.viewportWidth,
      restaurantX: options.restaurantX,
      restaurantWidth: options.restaurantWidth,
      restaurantY: options.restaurantY,
      restaurantHeight: options.restaurantHeight,
      speakerXRatio: speakerActor.xRatio,
      speakerYRatio: speakerActor.yRatio,
      speakerInstanceId: speakerActor.instanceId,
      timeMs: options.timeMs,
      motionScale: options.motionScale,
      speakerTextHeight: speakerText.height,
      lineTextHeight: lineText.height,
    });
    const colors = this.#colors;
    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillRoundedRect(
      layout.left + 3,
      layout.top + 4,
      layout.bubbleWidth,
      layout.bubbleHeight,
      10,
    );
    graphics.fillStyle(colors.creamLight, 0.98);
    graphics.fillRoundedRect(
      layout.left,
      layout.top,
      layout.bubbleWidth,
      layout.bubbleHeight,
      10,
    );
    graphics.fillTriangle(
      layout.tailX - 8,
      layout.bottom - 1,
      layout.tailX + 8,
      layout.bottom - 1,
      layout.tailX,
      layout.bottom + 9,
    );
    graphics.lineStyle(2, colors.copper, 0.92);
    graphics.strokeRoundedRect(
      layout.left,
      layout.top,
      layout.bubbleWidth,
      layout.bubbleHeight,
      10,
    );
    speakerText.setPosition(layout.speakerTextX, layout.speakerTextY);
    lineText.setPosition(layout.lineTextX, layout.lineTextY);
    return layout;
  }
}
