import type Phaser from "phaser";
import type { RestaurantLayoutRuntime } from "./restaurant-layout";
import type { RestaurantNpcAction } from "./restaurant-npc-presentation";
import {
  resolveRestaurantMotionPresentation,
  type RestaurantMotionInput,
  type RestaurantMotionPresentation,
} from "./restaurant-motion-presentation";

export { resolveRestaurantMotionPresentation } from "./restaurant-motion-presentation";
export type {
  RestaurantMotionInput,
  RestaurantMotionPresentation,
  RestaurantTextPresentation,
} from "./restaurant-motion-presentation";

export interface RestaurantMotionColors {
  readonly ink: number;
  readonly woodDark: number;
  readonly teal: number;
  readonly tealLight: number;
  readonly copper: number;
  readonly copperLight: number;
  readonly brass: number;
  readonly brassLight: number;
  readonly creamLight: number;
  readonly smoke: number;
  readonly glow: number;
}

type GuestDrawAction =
  | "walking"
  | "browsing-menu"
  | "daydreaming"
  | "calling-otto"
  | "ordering"
  | "waiting"
  | "eating"
  | "talking";

export class RestaurantMotionRenderer {
  readonly #colors: RestaurantMotionColors;
  readonly #layout: RestaurantLayoutRuntime;

  constructor(
    colors: RestaurantMotionColors,
    layout: RestaurantLayoutRuntime,
  ) {
    this.#colors = colors;
    this.#layout = layout;
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    input: RestaurantMotionInput,
  ): RestaurantMotionPresentation {
    const colors = this.#colors;
    const y = input.restaurantY;
    const height = input.restaurantHeight;
    const restaurantX = input.restaurantX ?? 0;
    const restaurantWidth = input.restaurantWidth ?? input.viewportWidth;
    const frame = input.frame;
    const conversation = frame.conversation;

    const lampAlpha = 0.66 + Math.sin(input.timeMs * 0.002) * 0.08;
    for (const lamp of this.#layout.getProps("lamp")) {
      const width =
        (lamp.dimensions.widthRatio ?? 0) * restaurantWidth +
        (lamp.dimensions.widthPx ?? 0) +
        (lamp.dimensions.widthOffsetPx ?? 0);
      const lampX =
        restaurantX + lamp.transform.xRatio * restaurantWidth +
        (lamp.transform.offsetXPx ?? 0);
      const lampY =
        y + lamp.transform.yRatio * height +
        (lamp.transform.offsetYPx ?? 0);
      graphics.lineStyle(2, colors.woodDark, 1);
      graphics.lineBetween(lampX, y + 28, lampX, lampY - 7);
      graphics.fillStyle(colors.glow, lampAlpha);
      graphics.fillCircle(lampX, lampY, Math.max(6, width / 2));
    }

    if (conversation !== null && input.dialogue !== null) {
      const participantPoints = conversation.participantActorIds
        .map((actorId) => {
          const actor = frame.actors.find(
            (candidate) => candidate.instanceId === actorId,
          );
          return actor === undefined
            ? null
            : {
                x: restaurantX + actor.xRatio * restaurantWidth,
                y: y + actor.yRatio * height - 38,
              };
        })
        .filter(
          (point): point is { readonly x: number; readonly y: number } =>
            point !== null,
        );
      if (participantPoints.length >= 2) {
        this.#drawConversationLink(
          graphics,
          participantPoints,
          input.timeMs,
        );
      }
    }

    const bodyColors = [colors.teal, colors.copper, colors.brass] as const;
    for (const actor of frame.actors) {
      if (!actor.visible) continue;
      const x = restaurantX + actor.xRatio * restaurantWidth;
      const feetY = y + actor.yRatio * height;
      const actorTime =
        input.timeMs * Math.max(0.35, input.motionScale) +
        actor.instanceId.length * 137;

      if (actor.kind === "guest") {
        if (frame.delivery?.targetActorId === actor.instanceId) {
          const pulse = 0.52 + Math.sin(input.timeMs * 0.008) * 0.14;
          graphics.fillStyle(colors.glow, 0.12 + pulse * 0.08);
          graphics.fillEllipse(x, feetY + 5, 58, 16);
          graphics.lineStyle(2, colors.brassLight, pulse);
          graphics.strokeEllipse(x, feetY + 5, 58, 16);
        }
        if (actor.positionSlotId?.startsWith("position.seat") === true) {
          this.#drawTableService(graphics, x, feetY, actor.action, actorTime);
        }
        const guestIndex = Number(actor.instanceId.split(".").at(-1)) || 0;
        const guestAction = this.#resolveGuestAction(actor.action);
        this.#drawGuestActionCue(graphics, x, feetY, actor.facing, actor.action);
        const seated =
          actor.positionSlotId?.startsWith("position.seat") === true &&
          actor.action !== "walking";
        graphics.save();
        graphics.translateCanvas(x, feetY);
        graphics.scaleCanvas(1.18, 1.18);
        this.#drawRestaurantGuest(
          graphics,
          actor.facing,
          bodyColors[guestIndex % bodyColors.length] ?? colors.teal,
          guestAction,
          actorTime,
          actor.activeSpeaker,
          seated,
        );
        graphics.restore();
      } else if (actor.kind === "otto") {
        graphics.save();
        graphics.translateCanvas(x, feetY);
        graphics.scaleCanvas(1.2, 1.2);
        this.#drawOttoActor(
          graphics,
          actor.facing,
          actor.action,
          actor.trayVisible,
          actorTime,
        );
        graphics.restore();
      } else {
        graphics.save();
        graphics.translateCanvas(x, feetY);
        graphics.scaleCanvas(1.22, 1.22);
        this.#drawBaiyechengActor(
          graphics,
          actor.facing,
          actor.action,
          actorTime,
          actor.activeSpeaker,
        );
        graphics.restore();
      }
    }

    return resolveRestaurantMotionPresentation(
      input,
      this.#layout.requireAnchor("otto-home").yRatio,
    );
  }

  #resolveGuestAction(action: RestaurantNpcAction): GuestDrawAction {
    switch (action) {
      case "walking":
      case "browsing-menu":
      case "daydreaming":
      case "calling-otto":
      case "ordering":
      case "waiting":
      case "talking":
        return action;
      default:
        return "eating";
    }
  }

  #drawGuestActionCue(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feetY: number,
    facing: -1 | 1,
    action: RestaurantNpcAction,
  ): void {
    const colors = this.#colors;
    if (action === "ordering") {
      const bubbleY = feetY - 67;
      graphics.fillStyle(colors.creamLight, 0.97);
      graphics.fillRoundedRect(x - 15, bubbleY - 9, 30, 18, 8);
      graphics.fillTriangle(
        x - 5,
        bubbleY + 8,
        x + 1,
        bubbleY + 8,
        x - 2,
        bubbleY + 14,
      );
      graphics.lineStyle(2, colors.copper, 0.9);
      graphics.strokeRoundedRect(x - 15, bubbleY - 9, 30, 18, 8);
      graphics.fillStyle(colors.copper, 1);
      graphics.fillCircle(x - 7, bubbleY, 2);
      graphics.fillCircle(x, bubbleY, 2);
      graphics.fillCircle(x + 7, bubbleY, 2);
    } else if (action === "calling-otto") {
      const callY = feetY - 69;
      graphics.fillStyle(colors.creamLight, 0.97);
      graphics.fillCircle(x + facing * 12, callY, 9);
      graphics.fillStyle(colors.copper, 1);
      graphics.fillCircle(x + facing * 12, callY - 3, 1.8);
      graphics.fillRoundedRect(x + facing * 11, callY + 1, 2, 4, 1);
    } else if (action === "daydreaming") {
      graphics.fillStyle(colors.smoke, 0.75);
      graphics.fillCircle(x + 8, feetY - 60, 2.5);
      graphics.fillCircle(x + 13, feetY - 67, 3.5);
      graphics.fillCircle(x + 20, feetY - 75, 5);
    } else if (action === "browsing-menu") {
      graphics.fillStyle(colors.creamLight, 1);
      graphics.fillRoundedRect(x - 13, feetY - 29, 26, 16, 3);
      graphics.lineStyle(1, colors.copper, 0.9);
      graphics.strokeRoundedRect(x - 13, feetY - 29, 26, 16, 3);
      graphics.lineBetween(x, feetY - 28, x, feetY - 14);
    }
  }

  #drawConversationLink(
    graphics: Phaser.GameObjects.Graphics,
    actorPoints: readonly { readonly x: number; readonly y: number }[],
    timeMs: number,
  ): void {
    const sorted = [...actorPoints].sort((left, right) => left.x - right.x);
    const first = sorted[0];
    const last = sorted.at(-1);
    if (first === undefined || last === undefined) return;
    const linkY =
      sorted.reduce((sum, point) => sum + point.y, 0) / sorted.length;
    const colors = this.#colors;
    graphics.lineStyle(2, colors.copper, 0.48);
    graphics.lineBetween(first.x + 11, linkY, last.x - 11, linkY);
    const pulse = 0.68 + Math.sin(timeMs * 0.008) * 0.2;
    for (let index = 1; index <= 3; index += 1) {
      const progress = index / 4;
      graphics.fillStyle(colors.copperLight, pulse);
      graphics.fillCircle(
        first.x + (last.x - first.x) * progress,
        linkY,
        2.5,
      );
    }
  }

  #drawTableService(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feetY: number,
    action: RestaurantNpcAction,
    timeMs: number,
  ): void {
    if (action !== "eating") return;
    const colors = this.#colors;
    graphics.fillStyle(colors.creamLight, 1);
    graphics.fillEllipse(x, feetY - 18, 24, 7);
    graphics.lineStyle(2, colors.brass, 1);
    graphics.strokeEllipse(x, feetY - 18, 24, 7);
    graphics.fillStyle(colors.copperLight, 1);
    graphics.fillEllipse(x, feetY - 21, 13, 5);
    for (let index = 0; index < 2; index += 1) {
      const rise = (timeMs * 0.025 + index * 13) % 24;
      graphics.fillStyle(
        colors.smoke,
        Math.max(0, 0.55 * (1 - rise / 24)),
      );
      graphics.fillCircle(
        x - 4 + index * 8,
        feetY - 25 - rise,
        2.5 + rise * 0.04,
      );
    }
  }

  #drawBaiyechengActor(
    graphics: Phaser.GameObjects.Graphics,
    facing: -1 | 1,
    action: RestaurantNpcAction,
    timeMs: number,
    activeSpeaker: boolean,
  ): void {
    const colors = this.#colors;
    const walking = action === "walking";
    const step = walking ? Math.sin(timeMs * 0.0095) * 4 : 0;
    const bob = walking
      ? Math.abs(Math.sin(timeMs * 0.0095)) * 2
      : Math.sin(timeMs * 0.003) * 0.8;
    const feetY = -bob;
    const headY = feetY - 39;
    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillEllipse(0, 2, 27, 7);
    if (activeSpeaker) {
      graphics.lineStyle(3, colors.glow, 0.65 + Math.sin(timeMs * 0.01) * 0.18);
      graphics.strokeCircle(0, headY, 14);
    }
    graphics.lineStyle(4, colors.woodDark, 1);
    graphics.lineBetween(-4, feetY - 8, -5 + step, feetY);
    graphics.lineBetween(4, feetY - 8, 5 - step, feetY);
    graphics.fillStyle(colors.teal, 1);
    graphics.fillRoundedRect(-10, feetY - 32, 20, 25, 6);
    graphics.fillStyle(colors.creamLight, 1);
    graphics.fillRoundedRect(-7, feetY - 29, 14, 19, 4);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillCircle(0, headY - 2, 9);
    graphics.fillStyle(0xf2d2ae, 1);
    graphics.fillCircle(0, headY, 7.5);
    graphics.fillStyle(colors.creamLight, 1);
    graphics.fillTriangle(-7, headY + 4, 7, headY + 4, 0, headY + 15);
    graphics.fillRoundedRect(-10, headY - 14, 20, 7, 4);
    graphics.fillCircle(-6, headY - 13, 4);
    graphics.fillCircle(0, headY - 16, 5);
    graphics.fillCircle(6, headY - 13, 4);
    graphics.fillStyle(colors.ink, 1);
    graphics.fillCircle(facing * 3, headY - 1, 1.2);
    graphics.lineStyle(3, colors.creamLight, 1);
    const gesture = action === "talking" && activeSpeaker
      ? Math.sin(timeMs * 0.012) * 4
      : 0;
    graphics.lineBetween(
      facing * 6,
      feetY - 24,
      facing * (13 + gesture),
      feetY - 18,
    );
  }

  #drawRestaurantGuest(
    graphics: Phaser.GameObjects.Graphics,
    facing: -1 | 1,
    bodyColor: number,
    action: GuestDrawAction,
    timeMs: number,
    activeSpeaker: boolean,
    seated: boolean,
  ): void {
    const colors = this.#colors;
    const walking = action === "walking";
    const step = walking ? Math.sin(timeMs * 0.01) * 4 : 0;
    const bob = walking
      ? Math.abs(Math.sin(timeMs * 0.01)) * 2
      : Math.sin(timeMs * 0.005) * 1.2;
    const feetY = (seated ? 4 : 0) - bob;
    const headY = feetY - 38;
    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillEllipse(0, 2, 24, 7);
    if (activeSpeaker) {
      graphics.lineStyle(3, colors.glow, 0.48 + Math.sin(timeMs * 0.01) * 0.18);
      graphics.strokeCircle(0, headY, 13);
    }
    graphics.lineStyle(4, colors.woodDark, 1);
    if (seated) {
      graphics.lineBetween(-4, feetY - 8, -10, feetY - 2);
      graphics.lineBetween(4, feetY - 8, 10, feetY - 2);
    } else {
      graphics.lineBetween(-4, feetY - 8, -5 + step, feetY);
      graphics.lineBetween(4, feetY - 8, 5 - step, feetY);
    }
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRoundedRect(-9, feetY - 31, 18, 24, 6);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillCircle(0, headY - 2, 8.5);
    graphics.fillStyle(colors.creamLight, 1);
    graphics.fillCircle(0, headY, 7);
    graphics.fillStyle(colors.ink, 1);
    graphics.fillCircle(facing * 3, headY - 1, 1.2);
    graphics.lineStyle(3, colors.creamLight, 1);
    if (action === "talking" && activeSpeaker) {
      const gesture = 3 + Math.sin(timeMs * 0.012) * 3;
      graphics.lineBetween(
        facing * 5,
        feetY - 25,
        facing * (13 + gesture),
        feetY - 29,
      );
    } else if (action === "eating") {
      graphics.lineBetween(-5, feetY - 23, -1, feetY - 17);
      graphics.lineBetween(5, feetY - 23, 1, feetY - 17);
      graphics.fillStyle(colors.creamLight, 1);
      graphics.fillEllipse(0, feetY - 15, 14, 5);
      graphics.lineStyle(2, colors.brass, 1);
      graphics.lineBetween(
        3,
        feetY - 17,
        8,
        feetY - 26 - Math.sin(timeMs * 0.008) * 3,
      );
    } else {
      graphics.lineBetween(-5, feetY - 24, -8 - step, feetY - 15);
      graphics.lineBetween(5, feetY - 24, 8 + step, feetY - 15);
    }
  }

  #drawOttoActor(
    graphics: Phaser.GameObjects.Graphics,
    facing: -1 | 1,
    action: RestaurantNpcAction,
    trayVisible: boolean,
    timeMs: number,
  ): void {
    const colors = this.#colors;
    const walking = action === "walking";
    const walkCycle = Math.sin(timeMs * 0.0085);
    const step = walking ? walkCycle * 2 : 0;
    const bob = walking
      ? Math.abs(walkCycle) * 1.5
      : Math.sin(timeMs * 0.0025) * 0.35;
    const feetY = -bob;
    const headY = feetY - 37;
    graphics.fillStyle(colors.ink, 0.18);
    graphics.fillEllipse(0, 2, 27, 7);
    graphics.lineStyle(4, colors.woodDark, 1);
    graphics.lineBetween(-5, feetY - 8, -7 + step, feetY);
    graphics.lineBetween(5, feetY - 8, 7 - step, feetY);
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRoundedRect(-10, feetY - 31, 20, 25, 5);
    graphics.lineStyle(2, colors.woodDark, 1);
    graphics.strokeRoundedRect(-10, feetY - 31, 20, 25, 5);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillRoundedRect(-10, headY - 8, 20, 16, 5);
    graphics.lineStyle(2, colors.brassLight, 1);
    graphics.strokeRoundedRect(-10, headY - 8, 20, 16, 5);
    graphics.fillStyle(colors.tealLight, 1);
    graphics.fillCircle(facing * 4, headY - 1, 2.2);
    graphics.lineStyle(2, colors.brass, 1);
    graphics.lineBetween(0, headY - 8, 0, headY - 14);
    graphics.fillStyle(colors.glow, 0.9);
    graphics.fillCircle(0, headY - 16, 2.4);
    if (trayVisible) {
      const trayX = facing * 18;
      const trayY = feetY - 23;
      graphics.lineStyle(3, colors.brassLight, 1);
      graphics.lineBetween(facing * 7, feetY - 24, trayX, trayY);
      graphics.lineStyle(3, colors.woodDark, 1);
      graphics.lineBetween(trayX - 12, trayY, trayX + 12, trayY);
      graphics.fillStyle(colors.creamLight, 1);
      graphics.fillEllipse(trayX, trayY - 3, 15, 6);
      graphics.fillStyle(colors.copperLight, 1);
      graphics.fillCircle(trayX, trayY - 6, 3);
    } else {
      graphics.lineStyle(3, colors.brassLight, 1);
      graphics.lineBetween(-7, feetY - 24, -12, feetY - 15);
      graphics.lineBetween(7, feetY - 24, 12, feetY - 15);
    }
  }
}
