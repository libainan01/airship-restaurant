import type { GameplayRestaurantSaleSnapshot } from "@airship-restaurant/contracts";
import type { DialogueBubblePresentation } from "./dialogue-bubble-presenter";
import type { RestaurantNpcFrame } from "./restaurant-npc-presentation";

export interface RestaurantMotionInput {
  readonly frame: RestaurantNpcFrame;
  readonly dialogue: DialogueBubblePresentation | null;
  readonly latestSale: GameplayRestaurantSaleSnapshot | undefined;
  readonly timeMs: number;
  readonly motionScale: number;
  readonly nowUtcMs: number;
  readonly viewportWidth: number;
  readonly restaurantX?: number;
  readonly restaurantWidth?: number;
  readonly restaurantY: number;
  readonly restaurantHeight: number;
}

export interface RestaurantTextPresentation {
  readonly text: string;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
}

export interface RestaurantMotionPresentation {
  readonly dialogueContext: RestaurantTextPresentation;
  readonly saleFeedback: RestaurantTextPresentation;
  readonly ottoStatus: RestaurantTextPresentation;
}

function resolveOttoStatus(frame: RestaurantNpcFrame): string {
  const otto = frame.actors.find(
    (actor) => actor.visible && actor.kind === "otto",
  );
  if (otto === undefined) return "";
  if (otto.trayVisible || otto.action === "serving") {
    return frame.delivery === null
      ? "奥托 · 送餐中"
      : "奥托 · 前往指定餐桌";
  }
  if (frame.orderConfirmation !== null) {
    return frame.orderConfirmation.phase === "confirming"
      ? "奥托 · 正在确认点单"
      : "奥托 · 前往响应点单";
  }
  if (frame.kitchenNotification?.phase === "sending") {
    return "奥托 · 正在通知空中厨房";
  }
  if (otto.conversationParticipant) {
    return otto.action === "listening"
      ? "奥托 · 在听"
      : "奥托 · 走向客人";
  }
  return "";
}

export function resolveRestaurantMotionPresentation(
  input: RestaurantMotionInput,
  ottoHomeYRatio: number,
): RestaurantMotionPresentation {
  const { frame, dialogue, latestSale } = input;
  const conversation = frame.conversation;
  let dialogueText = "";
  if (conversation !== null && dialogue !== null) {
    const participantNames = dialogue.participants
      .map((participant) => participant.speakerName)
      .join(" ↔ ");
    const relationship = dialogue.participants.length === 1
      ? `${participantNames} ↔ 奥托`
      : participantNames;
    dialogueText = `${relationship} · ${
      conversation.ready ? "交谈中" : "正在靠近桌边"
    }`;
  }

  const latestSaleActor = latestSale === undefined
    ? undefined
    : frame.actors.find(
        (actor) => actor.customerId === latestSale.customerId,
      );
  const customerHasOrdered =
    latestSaleActor !== undefined &&
    latestSaleActor.action !== "walking" &&
    latestSaleActor.action !== "idle";
  const saleAgeMs = latestSale === undefined
    ? Number.POSITIVE_INFINITY
    : input.nowUtcMs - latestSale.soldAtUtcMs;

  const otto = frame.actors.find(
    (actor) => actor.visible && actor.kind === "otto",
  );
  const restaurantX = input.restaurantX ?? 0;
  const restaurantWidth = input.restaurantWidth ?? input.viewportWidth;
  const ottoX = otto?.xRatio === undefined
    ? restaurantX
    : restaurantX + otto.xRatio * restaurantWidth;
  const ottoFeetY = input.restaurantY + input.restaurantHeight *
    (otto?.yRatio ?? ottoHomeYRatio);
  const ottoStatus = resolveOttoStatus(frame);

  return {
    dialogueContext: {
      text: dialogueText,
      visible: dialogueText.length > 0,
      x: restaurantX + restaurantWidth * 0.5,
      y: input.restaurantY + input.restaurantHeight * 0.9,
    },
    saleFeedback: {
      text: latestSale === undefined
        ? ""
        : `订单确认 · +${latestSale.copperEarned} 铜币`,
      visible:
        saleAgeMs >= 0 && saleAgeMs < 4_500 && customerHasOrdered,
      x: 0,
      y: 0,
    },
    ottoStatus: {
      text: ottoStatus,
      visible: ottoStatus.length > 0,
      x: ottoX,
      y: ottoFeetY - 58,
    },
  };
}
