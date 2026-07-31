import { createM2ContentRegistry } from "@airship-restaurant/content";
import type {
  AppSettingsSnapshot,
  GameSnapshot,
  GameplaySnapshot,
  PresentationMode,
} from "@airship-restaurant/contracts";
import Phaser from "phaser";
import {
  SemanticHitMap,
  type HitPoint,
} from "./semantic-hit-map";
import {
  createEdgeCableRoute,
  alignTrackPointToCargoTarget,
  CABLE_CARGO_OFFSET,
  sampleCableRoute,
  sampleCableTangent,
  type CablePoint,
  type CableRoute,
} from "./cable-route";
import {
  resolveDialogueBubblePresentation,
  type DialogueBubblePresentation,
} from "./dialogue-bubble-presenter";
import {
  createDefaultRestaurantLayoutRuntime,
  type RestaurantLayoutPropInstance,
} from "./restaurant-layout";
import {
  RestaurantNpcDirector,
  type RestaurantNpcFrame,
} from "./restaurant-npc-director";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_EVENTS,
  DESKTOP_REGISTRY_KEYS,
  DESKTOP_SCENE_KEYS,
  type DesktopDebugSnapshot,
} from "./scene-contracts";

type InteractiveZoneId = "airship" | "restaurant";

interface CursorPoint {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}

const COLORS = {
  ink: 0x2f2925,
  inkSoft: 0x5d5047,
  cream: 0xfff1d2,
  creamLight: 0xfff9e9,
  brass: 0xc58a42,
  brassLight: 0xe4b96e,
  copper: 0xa94f36,
  copperLight: 0xd8754f,
  wood: 0x654333,
  woodDark: 0x3f2d27,
  teal: 0x477d7b,
  tealLight: 0x8bc4bd,
  glass: 0xa8d7d2,
  smoke: 0xeee3d5,
  restaurantWall: 0xe4c997,
  restaurantFloor: 0xb88255,
  glow: 0xffcf6b,
};

const FONT_FAMILY =
  '"Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif';

const DESKTOP_CONTENT = createM2ContentRegistry();

const RECIPE_NAMES: Readonly<Record<string, string>> = {
  "recipe.hearth_flatbread": "炉火云麦饼",
  "recipe.windroot_soup": "风根浓汤",
  "recipe.homecoming_stew": "贝尔家的炉火炖菜",
};

const getRecipeName = (recipeId: string | null): string =>
  recipeId === null
    ? "未选择食谱"
    : (RECIPE_NAMES[recipeId] ?? recipeId);

const EMPTY_RESTAURANT_NPC_FRAME: RestaurantNpcFrame = Object.freeze({
  actors: Object.freeze([]),
  conversation: null,
});

export class DesktopWorldScene extends Phaser.Scene {
  readonly #hitMap = new SemanticHitMap();
  readonly #restaurantLayout = createDefaultRestaurantLayoutRuntime();
  readonly #npcDirector = new RestaurantNpcDirector(this.#restaurantLayout);

  #cableGraphics!: Phaser.GameObjects.Graphics;
  #worldGraphics!: Phaser.GameObjects.Graphics;
  #motionGraphics!: Phaser.GameObjects.Graphics;
  #dialogueBubbleGraphics!: Phaser.GameObjects.Graphics;
  #dialogueSpeakerText!: Phaser.GameObjects.Text;
  #dialogueLineText!: Phaser.GameObjects.Text;
  #dialogueContextText!: Phaser.GameObjects.Text;
  #ottoStatusText!: Phaser.GameObjects.Text;
  #runtimeStatusText!: Phaser.GameObjects.Text;
  #airshipTitleText!: Phaser.GameObjects.Text;
  #airshipStatusText!: Phaser.GameObjects.Text;
  #restaurantTitleText!: Phaser.GameObjects.Text;
  #restaurantStatusText!: Phaser.GameObjects.Text;
  #restaurantHintText!: Phaser.GameObjects.Text;
  #airshipExchangeText!: Phaser.GameObjects.Text;
  #groundExchangeText!: Phaser.GameObjects.Text;
  #cableStatusText!: Phaser.GameObjects.Text;
  #toastText!: Phaser.GameObjects.Text;
  #portStatusText!: Phaser.GameObjects.Text;

  #viewportWidth = 1280;
  #viewportHeight = 720;
  #airshipCenterX = 560;
  #airshipTop = 14;
  #airshipWidth = 620;
  #airshipHeight = 190;
  #airshipHitPoints: readonly HitPoint[] = [];
  #restaurantY = 560;
  #restaurantHeight = 160;
  #airshipExchangePoint: CablePoint = { x: 720, y: 170 };
  #airshipTrackPoint: CablePoint = { x: 733, y: 10 };
  #groundExchangePoint: CablePoint = { x: 1050, y: 530 };
  #transportEdgeX = 1234;

  #cursor: CursorPoint = { x: -1, y: -1, inside: false };
  #hoveredZoneId: InteractiveZoneId | null = null;
  #pressedZoneId: InteractiveZoneId | null = null;
  #lastInteractive: boolean | null = null;
  #lastInteractionReason = "";
  #inputLock = false;
  #quietMode = false;
  #presentationMode: PresentationMode = "normal";
  #runtimePhase = "正在连接主进程";
  #gameplaySnapshot: GameplaySnapshot | null = null;
  #dialogueBubble: DialogueBubblePresentation | null = null;
  #npcFrame: RestaurantNpcFrame = EMPTY_RESTAURANT_NPC_FRAME;
  #lastDeliveredQuantity: number | null = null;
  #unsubscribeSnapshot: (() => void) | null = null;
  #unsubscribeCursor: (() => void) | null = null;
  #unsubscribeSettings: (() => void) | null = null;

  constructor() {
    super(DESKTOP_SCENE_KEYS.world);
  }

  create(): void {
    this.#cableGraphics = this.add.graphics();
    this.#worldGraphics = this.add.graphics();
    this.#motionGraphics = this.add.graphics();
    this.#dialogueBubbleGraphics = this.add
      .graphics()
      .setDepth(30);

    this.#dialogueSpeakerText = this.add
      .text(0, 0, "", {
        color: "#a94f36",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setDepth(31)
      .setVisible(false);

    this.#dialogueLineText = this.add
      .text(0, 0, "", {
        color: "#3f2d27",
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        lineSpacing: 3,
        wordWrap: {
          width: 220,
          useAdvancedWrap: true,
        },
      })
      .setDepth(31)
      .setVisible(false);

    this.#dialogueContextText = this.add
      .text(0, 0, "", {
        backgroundColor: "#654333",
        color: "#fff1d2",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);

    this.#ottoStatusText = this.add
      .text(0, 0, "", {
        backgroundColor: "#2f2925",
        color: "#e4b96e",
        fontFamily: FONT_FAMILY,
        fontSize: "9px",
        fontStyle: "bold",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);
    this.#runtimeStatusText = this.add
      .text(0, 0, this.#runtimePhase, {
        color: "#61564e",
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
      })
      .setOrigin(0.5);

    this.#airshipTitleText = this.add
      .text(0, 0, "云灶号 · 空中厨房", {
        color: "#fff4da",
        fontFamily: FONT_FAMILY,
        fontSize: "17px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.#airshipStatusText = this.add
      .text(0, 0, "炉火稳定 · 厨房待命", {
        color: "#efd7ad",
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
      })
      .setOrigin(0.5);

    this.#restaurantTitleText = this.add.text(0, 0, "风铃餐厅", {
      color: "#3d2d27",
      fontFamily: FONT_FAMILY,
      fontSize: "21px",
      fontStyle: "bold",
    });

    this.#restaurantStatusText = this.add.text(
      0,
      0,
      "晨间准备中 · 等待厨房送来第一批餐点",
      {
        color: "#6d5545",
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
      },
    );

    this.#restaurantHintText = this.add
      .text(0, 0, "点击餐厅进入经营管理", {
        color: "#71503b",
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "bold",
      })
      .setOrigin(1, 0);

    this.#airshipExchangeText = this.add
      .text(0, 0, "空中装卸站", {
        color: "#f3d6a4",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.#groundExchangeText = this.add
      .text(0, 0, "地面交换站", {
        color: "#49352c",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.#cableStatusText = this.add
      .text(0, 0, "运输缆车", {
        backgroundColor: "#fff1d2",
        color: "#735747",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5);

    this.#toastText = this.add
      .text(0, 0, "", {
        align: "center",
        backgroundColor: "#fff4dc",
        color: "#47332a",
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        fontStyle: "bold",
        padding: { x: 15, y: 9 },
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.#portStatusText = this.add
      .text(0, 0, "港口预留位 · M3开放", {
        color: "#e5c28e",
        fontFamily: FONT_FAMILY,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.72);

    this.registry.set(
      DESKTOP_REGISTRY_KEYS.settings,
      DEFAULT_DESKTOP_SETTINGS,
    );
    this.#layoutWorld(this.scale.width, this.scale.height);
    this.scale.on(
      Phaser.Scale.Events.RESIZE,
      this.#handleResize,
      this,
    );
    this.input.on("pointerdown", this.#handlePointerDown, this);
    this.input.on("pointerup", this.#handlePointerUp, this);

    window.addEventListener("mousemove", this.#handleMouseMove);
    window.addEventListener("mouseleave", this.#handleMouseLeave);
    window.addEventListener("mouseup", this.#handleWindowMouseUp);

    this.#connectRuntimeBridge();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(
        Phaser.Scale.Events.RESIZE,
        this.#handleResize,
        this,
      );
      this.input.off("pointerdown", this.#handlePointerDown, this);
      this.input.off("pointerup", this.#handlePointerUp, this);
      window.removeEventListener("mousemove", this.#handleMouseMove);
      window.removeEventListener("mouseleave", this.#handleMouseLeave);
      window.removeEventListener("mouseup", this.#handleWindowMouseUp);
      this.#unsubscribeSnapshot?.();
      this.#unsubscribeSnapshot = null;
      this.#unsubscribeCursor?.();
      this.#unsubscribeCursor = null;
      this.#unsubscribeSettings?.();
      this.#unsubscribeSettings = null;
    });
  }

  override update(time: number): void {
    this.#drawMotion(time);
    this.#routeCursor(this.#cursor);
  }

  readonly #handleResize = (gameSize: Phaser.Structs.Size): void => {
    this.#layoutWorld(gameSize.width, gameSize.height);
  };

  readonly #handleMouseMove = (event: MouseEvent): void => {
    this.#routeCursor({
      x: event.clientX,
      y: event.clientY,
      inside: true,
    });
  };

  readonly #handleMouseLeave = (): void => {
    this.#routeCursor({
      x: this.#cursor.x,
      y: this.#cursor.y,
      inside: false,
    });
  };

  readonly #handleWindowMouseUp = (): void => {
    if (this.#pressedZoneId !== null) {
      this.#finishPointerInteraction(this.#cursor.x, this.#cursor.y);
    }
  };

  #layoutWorld(width: number, height: number): void {
    this.#viewportWidth = Math.max(640, width);
    this.#viewportHeight = Math.max(480, height);
    this.#restaurantHeight = Phaser.Math.Clamp(
      Math.round(this.#viewportHeight * 0.155),
      148,
      210,
    );
    this.#restaurantY =
      this.#viewportHeight - this.#restaurantHeight;

    this.#airshipWidth = Phaser.Math.Clamp(
      Math.round(this.#viewportWidth * 0.34),
      480,
      760,
    );
    this.#airshipHeight = Phaser.Math.Clamp(
      Math.round(this.#viewportHeight * 0.15),
      172,
      210,
    );
    this.#airshipTop = 12;
    this.#airshipCenterX = Phaser.Math.Clamp(
      Math.round(this.#viewportWidth * 0.44),
      this.#airshipWidth / 2 + 20,
      this.#viewportWidth - this.#airshipWidth / 2 - 110,
    );

    const topTrackY = 10;
    this.#airshipExchangePoint = {
      x: this.#airshipCenterX + this.#airshipWidth * 0.38,
      y: topTrackY + CABLE_CARGO_OFFSET.y,
    };
    this.#airshipTrackPoint = alignTrackPointToCargoTarget(
      this.#airshipExchangePoint,
    );
    this.#transportEdgeX = this.#viewportWidth - 46;
    this.#groundExchangePoint = {
      x: this.#viewportWidth - 112,
      y: this.#restaurantY - 38,
    };
    this.#airshipHitPoints = this.#createAirshipHitPoints();

    this.#hitMap.setZones([
      {
        id: "airship",
        kind: "polygon",
        points: this.#airshipHitPoints,
        priority: 10,
      },
      {
        id: "restaurant",
        kind: "rect",
        x: 0,
        y: this.#restaurantY,
        width: this.#viewportWidth,
        height: this.#restaurantHeight,
        priority: 5,
      },
    ]);

    const cabinY = this.#airshipTop + this.#airshipHeight - 54;
    this.#runtimeStatusText.setPosition(
      this.#airshipCenterX,
      this.#airshipTop + 55,
    );
    this.#airshipTitleText.setPosition(
      this.#airshipCenterX,
      cabinY,
    );
    this.#airshipStatusText.setPosition(
      this.#airshipCenterX,
      cabinY + 24,
    );
    this.#restaurantTitleText.setPosition(
      34,
      this.#restaurantY + 47,
    );
    this.#restaurantStatusText.setPosition(
      35,
      this.#restaurantY + 79,
    );
    this.#restaurantHintText.setPosition(
      this.#viewportWidth - 32,
      this.#restaurantY + 55,
    );
    this.#airshipExchangeText.setPosition(
      this.#airshipExchangePoint.x - 38,
      this.#airshipExchangePoint.y + 27,
    );
    this.#groundExchangeText.setPosition(
      this.#groundExchangePoint.x,
      this.#restaurantY + 57,
    );
    this.#toastText.setPosition(
      this.#viewportWidth / 2,
      this.#restaurantY - 46,
    );
    this.#portStatusText.setPosition(
      88,
      this.#restaurantY - 29,
    );

    this.#drawStaticWorld();
    this.#routeCursor(this.#cursor);
  }

  #createAirshipHitPoints(): readonly HitPoint[] {
    const x = this.#airshipCenterX;
    const y = this.#airshipTop;
    const halfWidth = this.#airshipWidth / 2;
    const height = this.#airshipHeight;

    return [
      { x: x - halfWidth * 0.9, y: y + height * 0.31 },
      { x: x - halfWidth * 0.7, y: y + height * 0.1 },
      { x, y: y + 1 },
      { x: x + halfWidth * 0.7, y: y + height * 0.1 },
      { x: x + halfWidth * 0.94, y: y + height * 0.31 },
      { x: x + halfWidth * 0.82, y: y + height * 0.53 },
      { x: x + halfWidth * 0.38, y: y + height * 0.58 },
      { x: x + halfWidth * 0.34, y: y + height * 0.86 },
      { x: x + halfWidth * 0.2, y: y + height * 0.98 },
      { x: x - halfWidth * 0.34, y: y + height * 0.98 },
      { x: x - halfWidth * 0.48, y: y + height * 0.84 },
      { x: x - halfWidth * 0.4, y: y + height * 0.58 },
      { x: x - halfWidth * 0.78, y: y + height * 0.52 },
    ];
  }

  #drawStaticWorld(): void {

    const graphics = this.#worldGraphics;
    graphics.clear();
    this.#drawAirship(graphics);
    this.#drawRestaurant(graphics);
    this.#drawAirshipExchangeStation(graphics);
    this.#drawGroundExchangeStation(graphics);
    this.#drawPortPlaceholder(graphics);
    this.#refreshLabels();
  }

  #drawCableInfrastructure(): CableRoute {
    const graphics = this.#cableGraphics;
    graphics.clear();

    const route = createEdgeCableRoute(
      this.#airshipTrackPoint,
      this.#groundExchangePoint,
      this.#transportEdgeX,
    );

    graphics.lineStyle(8, COLORS.woodDark, 0.2);
    this.#drawCableLine(graphics, route, 0);

    graphics.lineStyle(2, COLORS.brass, 0.92);
    this.#drawCableLine(graphics, route, -5);
    this.#drawCableLine(graphics, route, 5);

    for (let index = 1; index < 10; index += 1) {
      const left = sampleCableRoute(route, index / 10, -7);
      const right = sampleCableRoute(route, index / 10, 7);
      graphics.lineStyle(2, COLORS.wood, 0.7);
      graphics.lineBetween(left.x, left.y, right.x, right.y);
    }

    graphics.fillStyle(COLORS.woodDark, 0.96);
    for (const [index, point] of route.points.entries()) {
      const isStation =
        index === 0 || index === route.points.length - 1;
      graphics.fillStyle(COLORS.woodDark, 0.96);
      graphics.fillCircle(point.x, point.y, isStation ? 15 : 12);
      graphics.fillStyle(COLORS.brassLight, 1);
      graphics.fillCircle(point.x, point.y, isStation ? 8 : 7);
      graphics.fillStyle(COLORS.ink, 1);
      graphics.fillCircle(point.x, point.y, 3);
    }

    return route;
  }

  #drawCableLine(
    graphics: Phaser.GameObjects.Graphics,
    route: CableRoute,
    trackOffset: number,
  ): void {
    graphics.beginPath();
    for (const segment of route.segments) {
      graphics.moveTo(
        segment.start.x + segment.normal.x * trackOffset,
        segment.start.y + segment.normal.y * trackOffset,
      );
      graphics.lineTo(
        segment.end.x + segment.normal.x * trackOffset,
        segment.end.y + segment.normal.y * trackOffset,
      );
    }
    graphics.strokePath();
  }

  #drawAirship(graphics: Phaser.GameObjects.Graphics): void {
    const x = this.#airshipCenterX;
    const y = this.#airshipTop;
    const width = this.#airshipWidth;
    const height = this.#airshipHeight;
    const hovered = this.#hoveredZoneId === "airship";

    graphics.fillStyle(COLORS.ink, 0.14);
    graphics.fillEllipse(
      x + 8,
      y + height * 0.56,
      width * 0.88,
      height * 0.52,
    );

    graphics.fillStyle(
      hovered ? COLORS.creamLight : COLORS.cream,
      0.98,
    );
    graphics.fillEllipse(
      x,
      y + height * 0.3,
      width * 0.9,
      height * 0.56,
    );
    graphics.lineStyle(
      hovered ? 4 : 3,
      hovered ? COLORS.brassLight : COLORS.wood,
      1,
    );
    graphics.strokeEllipse(
      x,
      y + height * 0.3,
      width * 0.9,
      height * 0.56,
    );

    graphics.fillStyle(COLORS.copper, 0.96);
    graphics.fillTriangle(
      x - width * 0.43,
      y + height * 0.2,
      x - width * 0.53,
      y + height * 0.3,
      x - width * 0.43,
      y + height * 0.4,
    );
    graphics.fillTriangle(
      x + width * 0.43,
      y + height * 0.2,
      x + width * 0.51,
      y + height * 0.31,
      x + width * 0.43,
      y + height * 0.4,
    );

    graphics.lineStyle(3, COLORS.brass, 0.84);
    for (const offset of [-0.24, -0.08, 0.08, 0.24]) {
      const bandX = x + width * offset;
      const distance = Math.abs(offset) / 0.24;
      const top = y + height * (0.035 + distance * 0.055);
      const bottom = y + height * (0.565 - distance * 0.055);
      graphics.lineBetween(bandX, top, bandX, bottom);
    }

    graphics.fillStyle(COLORS.copperLight, 1);
    graphics.fillRoundedRect(
      x - width * 0.26,
      y + height * 0.57,
      width * 0.52,
      height * 0.3,
      12,
    );
    graphics.lineStyle(3, COLORS.woodDark, 1);
    graphics.strokeRoundedRect(
      x - width * 0.26,
      y + height * 0.57,
      width * 0.52,
      height * 0.3,
      12,
    );
    graphics.fillStyle(COLORS.wood, 1);
    graphics.fillTriangle(
      x + width * 0.26,
      y + height * 0.62,
      x + width * 0.36,
      y + height * 0.73,
      x + width * 0.26,
      y + height * 0.84,
    );
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillRoundedRect(
      x - width * 0.23,
      y + height * 0.83,
      width * 0.47,
      8,
      4,
    );

    graphics.lineStyle(2, COLORS.wood, 0.9);
    graphics.lineBetween(
      x - width * 0.31,
      y + height * 0.47,
      x - width * 0.22,
      y + height * 0.57,
    );
    graphics.lineBetween(
      x + width * 0.31,
      y + height * 0.47,
      x + width * 0.22,
      y + height * 0.57,
    );

    for (const offset of [-0.16, 0.16]) {
      graphics.fillStyle(COLORS.teal, 1);
      graphics.fillCircle(
        x + width * offset,
        y + height * 0.7,
        13,
      );
      graphics.fillStyle(COLORS.glass, 0.95);
      graphics.fillCircle(
        x + width * offset - 2,
        y + height * 0.68,
        7,
      );
      graphics.lineStyle(2, COLORS.woodDark, 1);
      graphics.strokeCircle(
        x + width * offset,
        y + height * 0.7,
        13,
      );
    }

    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillRect(
      x + width * 0.18,
      y + height * 0.48,
      14,
      height * 0.11,
    );
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRoundedRect(
      x + width * 0.17,
      y + height * 0.45,
      28,
      10,
      4,
    );

    if (hovered) {
      graphics.lineStyle(3, COLORS.glow, 0.92);
      this.#strokePolygon(graphics, this.#airshipHitPoints);
    }
  }

  #drawRestaurant(graphics: Phaser.GameObjects.Graphics): void {
    const y = this.#restaurantY;
    const width = this.#viewportWidth;
    const height = this.#restaurantHeight;
    const hovered = this.#hoveredZoneId === "restaurant";

    graphics.fillStyle(COLORS.ink, 0.16);
    graphics.fillRect(0, y - 5, width, height + 5);
    graphics.fillStyle(COLORS.restaurantWall, 0.98);
    graphics.fillRect(0, y, width, height);
    graphics.fillStyle(COLORS.restaurantFloor, 1);
    graphics.fillRect(0, y + height * 0.72, width, height * 0.28);

    const awningHeight = 28;
    const stripeWidth = 54;
    const stripeCount = Math.ceil(width / stripeWidth);
    for (let index = 0; index < stripeCount; index += 1) {
      graphics.fillStyle(
        index % 2 === 0 ? COLORS.copper : COLORS.creamLight,
        1,
      );
      graphics.fillRect(index * stripeWidth, y, stripeWidth, awningHeight);
      graphics.fillTriangle(
        index * stripeWidth,
        y + awningHeight,
        (index + 1) * stripeWidth,
        y + awningHeight,
        index * stripeWidth + stripeWidth / 2,
        y + awningHeight + 12,
      );
    }

    graphics.lineStyle(
      hovered ? 4 : 3,
      hovered ? COLORS.glow : COLORS.woodDark,
      1,
    );
    graphics.lineBetween(0, y, width, y);
    graphics.lineBetween(0, y + height - 2, width, y + height - 2);

    for (const prop of this.#restaurantLayout.getProps()) {
      if (prop.renderLayer !== "lighting") {
        this.#drawRestaurantProp(graphics, prop);
      }
    }

    if (hovered) {
      graphics.lineStyle(3, COLORS.glow, 0.74);
      graphics.strokeRect(2, y + 2, width - 4, height - 4);
    }
  }

  #drawRestaurantProp(
    graphics: Phaser.GameObjects.Graphics,
    prop: RestaurantLayoutPropInstance,
  ): void {
    const bounds = this.#resolveRestaurantPropBounds(prop);
    switch (prop.kind) {
      case "pillar":
        graphics.fillStyle(COLORS.wood, 0.95);
        graphics.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
        break;
      case "window":
        graphics.fillStyle(COLORS.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          8,
        );
        graphics.fillStyle(COLORS.glow, 0.86);
        graphics.fillRoundedRect(
          bounds.left + 7,
          bounds.top + 7,
          Math.max(0, bounds.width - 14),
          Math.max(0, bounds.height - 14),
          5,
        );
        graphics.lineStyle(2, COLORS.wood, 0.9);
        graphics.lineBetween(
          bounds.x,
          bounds.top + 7,
          bounds.x,
          bounds.top + bounds.height - 7,
        );
        break;
      case "table":
        graphics.fillStyle(COLORS.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          6,
        );
        graphics.fillRect(bounds.x - 4, bounds.top + bounds.height - 1, 8, 24);
        graphics.fillStyle(COLORS.creamLight, 1);
        graphics.fillCircle(bounds.x, bounds.top - 4, 5);
        break;
      case "counter":
        graphics.fillStyle(COLORS.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          8,
        );
        graphics.fillStyle(COLORS.brassLight, 1);
        graphics.fillRect(
          bounds.left + 11,
          bounds.top + bounds.height * 0.14,
          Math.max(0, bounds.width - 22),
          7,
        );
        graphics.fillStyle(COLORS.creamLight, 1);
        graphics.fillCircle(bounds.x - 38, bounds.top + bounds.height * 0.38, 8);
        graphics.fillCircle(bounds.x - 8, bounds.top + bounds.height * 0.38, 8);
        break;
      case "lamp":
        break;
    }
  }

  #resolveRestaurantPropBounds(prop: RestaurantLayoutPropInstance): {
    readonly x: number;
    readonly y: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } {
    const width =
      (prop.dimensions.widthRatio ?? 0) * this.#viewportWidth +
      (prop.dimensions.widthPx ?? 0) +
      (prop.dimensions.widthOffsetPx ?? 0);
    const height =
      (prop.dimensions.heightRatio ?? 0) * this.#restaurantHeight +
      (prop.dimensions.heightPx ?? 0) +
      (prop.dimensions.heightOffsetPx ?? 0);
    const x =
      prop.transform.xRatio * this.#viewportWidth +
      (prop.transform.offsetXPx ?? 0);
    const y =
      this.#restaurantY +
      prop.transform.yRatio * this.#restaurantHeight +
      (prop.transform.offsetYPx ?? 0);
    return {
      x,
      y,
      left: x - width * (prop.transform.originX ?? 0.5),
      top: y - height * (prop.transform.originY ?? 0.5),
      width,
      height,
    };
  }

  #drawAirshipExchangeStation(
    graphics: Phaser.GameObjects.Graphics,
  ): void {
    const { x, y } = this.#airshipExchangePoint;

    graphics.fillStyle(COLORS.ink, 0.16);
    graphics.fillRoundedRect(x - 72, y - 19, 72, 42, 8);
    graphics.fillStyle(COLORS.wood, 1);
    graphics.fillRoundedRect(x - 75, y - 23, 72, 40, 8);
    graphics.lineStyle(3, COLORS.woodDark, 1);
    graphics.strokeRoundedRect(x - 75, y - 23, 72, 40, 8);

    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRect(x - 80, y + 13, 92, 8);
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillTriangle(
      x - 68,
      y + 21,
      x - 53,
      y + 21,
      x - 60,
      y + 35,
    );
    graphics.fillTriangle(
      x - 12,
      y + 21,
      x + 3,
      y + 21,
      x - 5,
      y + 35,
    );

    graphics.fillStyle(COLORS.copperLight, 1);
    graphics.fillRoundedRect(x - 62, y - 13, 22, 24, 4);
    graphics.fillStyle(COLORS.cream, 1);
    graphics.fillRoundedRect(x - 35, y - 10, 20, 21, 4);
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillRoundedRect(x - 17, y - 17, 34, 35, 5);
    graphics.lineStyle(3, COLORS.brassLight, 1);
    graphics.strokeRoundedRect(x - 17, y - 17, 34, 35, 5);
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRoundedRect(x - 22, y - 11, 5, 23, 2);
    graphics.fillRoundedRect(x + 17, y - 11, 5, 23, 2);
    graphics.fillStyle(COLORS.ink, 1);
    graphics.fillCircle(x - 20, y, 2);
    graphics.fillCircle(x + 20, y, 2);
  }

  #drawGroundExchangeStation(
    graphics: Phaser.GameObjects.Graphics,
  ): void {
    const { x, y } = this.#groundExchangePoint;
    const buildingTop = this.#restaurantY + 14;
    const buildingBottom =
      this.#restaurantY + this.#restaurantHeight * 0.72;

    graphics.lineStyle(7, COLORS.woodDark, 1);
    graphics.lineBetween(x, y + 10, x, buildingBottom);
    graphics.lineStyle(3, COLORS.brass, 1);
    graphics.lineBetween(x, y + 10, x, buildingBottom);
    graphics.lineBetween(x, y + 30, x - 42, buildingTop + 8);
    graphics.lineBetween(x, y + 30, x + 42, buildingTop + 8);

    graphics.fillStyle(COLORS.ink, 0.15);
    graphics.fillRoundedRect(
      x - 72,
      buildingTop + 5,
      144,
      buildingBottom - buildingTop,
      9,
    );
    graphics.fillStyle(COLORS.cream, 1);
    graphics.fillRoundedRect(
      x - 72,
      buildingTop,
      144,
      buildingBottom - buildingTop,
      9,
    );
    graphics.lineStyle(3, COLORS.woodDark, 1);
    graphics.strokeRoundedRect(
      x - 72,
      buildingTop,
      144,
      buildingBottom - buildingTop,
      9,
    );

    graphics.fillStyle(COLORS.copper, 1);
    graphics.fillTriangle(
      x - 83,
      buildingTop + 5,
      x + 83,
      buildingTop + 5,
      x,
      buildingTop - 28,
    );
    graphics.fillStyle(COLORS.teal, 1);
    graphics.fillRoundedRect(x - 55, buildingTop + 38, 35, 32, 5);
    graphics.fillStyle(COLORS.glass, 1);
    graphics.fillRoundedRect(x + 18, buildingTop + 37, 34, 25, 5);
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRoundedRect(x - 8, buildingTop + 48, 16, 22, 3);

    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillCircle(x, y, 14);
    graphics.fillStyle(COLORS.brassLight, 1);
    graphics.fillCircle(x, y, 8);
    graphics.fillStyle(COLORS.ink, 1);
    graphics.fillCircle(x, y, 3);
  }

  #drawPortPlaceholder(
    graphics: Phaser.GameObjects.Graphics,
  ): void {
    const y = this.#restaurantY - 18;
    graphics.fillStyle(COLORS.ink, 0.2);
    graphics.fillRoundedRect(12, y - 38, 152, 38, 8);
    graphics.lineStyle(2, COLORS.brass, 0.5);
    graphics.strokeRoundedRect(12, y - 38, 152, 38, 8);
    graphics.lineBetween(26, y - 38, 26, y - 68);
    graphics.lineBetween(26, y - 68, 62, y - 57);
    graphics.fillStyle(COLORS.copperLight, 0.42);
    graphics.fillTriangle(27, y - 67, 61, y - 57, 27, y - 50);
  }

  #drawMotion(time: number): void {
    const graphics = this.#motionGraphics;
    graphics.clear();
    const motionScale =
      this.#presentationMode === "quiet"
        ? 0.25
        : this.#presentationMode === "reduced"
          ? 0.55
          : 1;

    const cableRoute = this.#drawCableInfrastructure();
    this.#drawCableCar(graphics, cableRoute, time, motionScale);
    this.#drawAirshipMotion(graphics, time, motionScale);
    this.#npcFrame = this.#npcDirector.update({
      timeMs: time,
      dialogue: this.#dialogueBubble,
      deliveryRevision: this.#lastDeliveredQuantity,
    });
    this.#drawRestaurantMotion(graphics, time, motionScale);
    this.#drawDialogueBubble(time, motionScale);
  }

  #drawCableCar(
    graphics: Phaser.GameObjects.Graphics,
    route: CableRoute,
    time: number,
    motionScale: number,
  ): void {
    const logistics = this.#gameplaySnapshot?.logistics;
    let progress: number;
    let isDescending: boolean;
    if (logistics === undefined) {
      const cycle = time * 0.00042 * motionScale;
      const cycleAngle = cycle * Math.PI * 2;
      progress = (Math.cos(cycleAngle) + 1) / 2;
      isDescending = Math.sin(cycleAngle) < 0;
    } else {
      const nowUtcMs = Date.now();
      switch (logistics.phase) {
        case "outbound": {
          const departure = logistics.departedAtUtcMs ?? nowUtcMs;
          const arrival = logistics.arriveAtUtcMs ?? departure;
          progress = Phaser.Math.Clamp(
            (nowUtcMs - departure) / Math.max(1, arrival - departure),
            0,
            1,
          );
          isDescending = true;
          break;
        }
        case "waiting-unload":
          progress = 1;
          isDescending = true;
          break;
        case "returning": {
          const departure =
            logistics.returnStartedAtUtcMs ?? nowUtcMs;
          const arrival = logistics.returnAtUtcMs ?? departure;
          progress =
            1 -
            Phaser.Math.Clamp(
              (nowUtcMs - departure) / Math.max(1, arrival - departure),
              0,
              1,
            );
          isDescending = false;
          break;
        }
        case "idle":
          progress = 0;
          isDescending = false;
          break;
      }
    }
    const cablePoint = sampleCableRoute(route, progress);
    const tangent = sampleCableTangent(route, progress);
    const wheelSpacing = 19;
    const firstWheel = {
      x: cablePoint.x - tangent.x * wheelSpacing,
      y: cablePoint.y - tangent.y * wheelSpacing,
    };
    const secondWheel = {
      x: cablePoint.x + tangent.x * wheelSpacing,
      y: cablePoint.y + tangent.y * wheelSpacing,
    };
    const cabinX = cablePoint.x;
    const cabinY = cablePoint.y + CABLE_CARGO_OFFSET.y;
    const cabinTop = cabinY - 24;
    const cargoCenterX = cabinX + CABLE_CARGO_OFFSET.x;

    graphics.lineStyle(4, COLORS.woodDark, 1);
    graphics.lineBetween(
      firstWheel.x,
      firstWheel.y + 5,
      cabinX - 20,
      cabinTop + 2,
    );
    graphics.lineBetween(
      secondWheel.x,
      secondWheel.y + 5,
      cabinX + 20,
      cabinTop + 2,
    );

    graphics.fillStyle(COLORS.brassLight, 1);
    graphics.fillCircle(firstWheel.x, firstWheel.y, 8);
    graphics.fillCircle(secondWheel.x, secondWheel.y, 8);
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillCircle(firstWheel.x, firstWheel.y, 3);
    graphics.fillCircle(secondWheel.x, secondWheel.y, 3);

    graphics.fillStyle(COLORS.ink, 0.16);
    graphics.fillRoundedRect(
      cabinX - 35,
      cabinTop + 4,
      72,
      53,
      9,
    );
    graphics.fillStyle(COLORS.copper, 1);
    graphics.fillRoundedRect(
      cabinX - 34,
      cabinTop,
      68,
      50,
      9,
    );
    graphics.lineStyle(3, COLORS.woodDark, 1);
    graphics.strokeRoundedRect(
      cabinX - 34,
      cabinTop,
      68,
      50,
      9,
    );

    graphics.fillStyle(COLORS.cream, 1);
    graphics.fillRoundedRect(
      cargoCenterX - 10,
      cabinY - 11,
      20,
      23,
      3,
    );
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRoundedRect(
      cabinX + 3,
      cabinY - 8,
      19,
      20,
      3,
    );
    graphics.lineStyle(2, COLORS.wood, 1);
    graphics.lineBetween(
      cargoCenterX - 10,
      cabinY,
      cargoCenterX + 10,
      cabinY,
    );
    graphics.lineBetween(
      cabinX + 3,
      cabinY + 2,
      cabinX + 22,
      cabinY + 2,
    );

    let status: string;
    if (logistics === undefined) {
      status = isDescending
        ? "下行 · 热餐配送"
        : "上行 · 回收空箱";
      if (progress > 0.985) {
        status = "地面站 · 正在卸货";
      } else if (progress < 0.015) {
        status = "空中站 · 正在装货";
      }
    } else {
      switch (logistics.phase) {
        case "outbound":
          status = `配送中 · ${logistics.cargoQuantity}/6 份`;
          break;
        case "waiting-unload":
          status = `等待卸货 · ${logistics.cargoQuantity}/6 份`;
          break;
        case "returning":
          status = "空箱返航";
          break;
        case "idle":
          status =
            logistics.kitchenWaitingQuantity > 0
              ? `空中集货 · ${logistics.kitchenWaitingQuantity} 份`
              : "空中站 · 待命";
          break;
      }
    }
    this.#cableStatusText
      .setPosition(
        Math.min(cabinX, this.#viewportWidth - 86),
        cabinTop + 66,
      )
      .setText(status);
  }

  #drawAirshipMotion(
    graphics: Phaser.GameObjects.Graphics,
    time: number,
    motionScale: number,
  ): void {
    const x = this.#airshipCenterX;
    const y = this.#airshipTop;
    const width = this.#airshipWidth;
    const height = this.#airshipHeight;
    const stir = Math.sin(time * 0.006 * motionScale);

    const propellerX = x - width * 0.5;
    const propellerY = y + height * 0.72;
    graphics.lineStyle(4, COLORS.woodDark, 1);
    graphics.lineBetween(
      propellerX,
      propellerY,
      x - width * 0.28,
      propellerY,
    );
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillCircle(propellerX, propellerY, 7);
    graphics.lineStyle(5, COLORS.copperLight, 0.9);
    const propellerAngle = time * 0.008 * motionScale;
    const bladeX = Math.cos(propellerAngle) * 28;
    const bladeY = Math.sin(propellerAngle) * 28;
    graphics.lineBetween(
      propellerX - bladeX,
      propellerY - bladeY,
      propellerX + bladeX,
      propellerY + bladeY,
    );

    const chefX = x + width * 0.02;
    const chefY = y + height * 0.67;
    graphics.fillStyle(COLORS.creamLight, 1);
    graphics.fillCircle(chefX, chefY - 9, 8);
    graphics.fillRoundedRect(chefX - 9, chefY - 22, 18, 9, 4);
    graphics.fillStyle(COLORS.teal, 1);
    graphics.fillRoundedRect(chefX - 8, chefY, 16, 20, 5);
    graphics.lineStyle(3, COLORS.creamLight, 1);
    graphics.lineBetween(
      chefX + 4,
      chefY + 5,
      chefX + 20 + stir * 4,
      chefY + 15,
    );
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillEllipse(chefX + 23, chefY + 19, 28, 8);

    const steamCount = this.#quietMode ? 2 : 4;
    for (let index = 0; index < steamCount; index += 1) {
      const phase =
        (time * 0.022 * motionScale + index * 29) % 105;
      const steamX =
        x + width * 0.19 + Math.sin(index * 1.8 + time * 0.001) * 7;
      const steamY = y + height * 0.44 - phase;
      graphics.fillStyle(
        COLORS.smoke,
        Math.max(0, 0.42 * (1 - phase / 105)),
      );
      graphics.fillCircle(steamX, steamY, 5 + phase * 0.055);
    }
  }

  #drawRestaurantMotion(
    graphics: Phaser.GameObjects.Graphics,
    time: number,
    motionScale: number,
  ): void {
    const y = this.#restaurantY;
    const height = this.#restaurantHeight;
    const bubble = this.#dialogueBubble;
    const conversation = this.#npcFrame.conversation;

    const lampAlpha = 0.66 + Math.sin(time * 0.002) * 0.08;
    for (const lamp of this.#restaurantLayout.getProps("lamp")) {
      const bounds = this.#resolveRestaurantPropBounds(lamp);
      graphics.lineStyle(2, COLORS.woodDark, 1);
      graphics.lineBetween(bounds.x, y + 28, bounds.x, bounds.y - 7);
      graphics.fillStyle(COLORS.glow, lampAlpha);
      graphics.fillCircle(bounds.x, bounds.y, Math.max(6, bounds.width / 2));
    }

    if (conversation === null || bubble === null) {
      this.#dialogueContextText.setVisible(false);
    } else {
      const participantPoints = conversation.participantActorIds
        .map((actorId) => {
          const actor = this.#npcFrame.actors.find(
            (candidate) => candidate.instanceId === actorId,
          );
          return actor === undefined
            ? null
            : {
                x: actor.xRatio * this.#viewportWidth,
                y:
                  this.#restaurantY +
                  actor.yRatio * this.#restaurantHeight -
                  38,
              };
        })
        .filter(
          (point): point is { readonly x: number; readonly y: number } =>
            point !== null,
        );
      if (participantPoints.length >= 2) {
        this.#drawConversationLink(graphics, participantPoints, time);
      }

      const participantNames = bubble.participants
        .map((participant) => participant.speakerName)
        .join(" ↔ ");
      const includesOtto = bubble.participants.length === 1;
      const relationship = includesOtto
        ? `${participantNames} ↔ 奥托`
        : participantNames;
      this.#dialogueContextText
        .setText(
          `${relationship} · ${
            conversation.ready ? "交谈中" : "正在靠近桌边"
          }`,
        )
        .setPosition(this.#viewportWidth * 0.5, y + height * 0.9)
        .setVisible(true);
    }

    const bodyColors = [COLORS.teal, COLORS.copper, COLORS.brass] as const;
    let ottoStatus = "";
    let ottoX = 0;
    let ottoFeetY =
      y + height * this.#restaurantLayout.requireAnchor("otto-home").yRatio;
    for (const actor of this.#npcFrame.actors) {
      if (!actor.visible) {
        continue;
      }
      const x = actor.xRatio * this.#viewportWidth;
      const feetY = y + actor.yRatio * height;
      const actorTime =
        time * Math.max(0.35, motionScale) +
        actor.instanceId.length * 137;
      if (actor.kind === "guest") {
        const guestIndex = Number(actor.instanceId.split(".").at(-1)) || 0;
        const guestAction =
          actor.action === "walking" ||
          actor.action === "waiting" ||
          actor.action === "talking"
            ? actor.action
            : "eating";
        this.#drawRestaurantGuest(
          graphics,
          x,
          feetY,
          actor.facing,
          bodyColors[guestIndex % bodyColors.length] ?? COLORS.teal,
          guestAction,
          actorTime,
          actor.activeSpeaker,
        );
      } else {
        this.#drawOttoActor(
          graphics,
          x,
          feetY,
          actor.facing,
          actor.trayVisible,
          actorTime,
        );
        ottoX = x;
        ottoFeetY = feetY;
        if (actor.trayVisible || actor.action === "serving") {
          ottoStatus = "奥托 · 送餐中";
        } else if (actor.conversationParticipant) {
          ottoStatus =
            actor.action === "listening"
              ? "奥托 · 在听"
              : "奥托 · 走向客人";
        }
      }
    }
    this.#ottoStatusText
      .setText(ottoStatus)
      .setPosition(ottoX, ottoFeetY - 58)
      .setVisible(ottoStatus.length > 0);
  }

  #drawConversationLink(
    graphics: Phaser.GameObjects.Graphics,
    actorPoints: readonly { readonly x: number; readonly y: number }[],
    time: number,
  ): void {
    const sorted = [...actorPoints].sort((left, right) => left.x - right.x);
    const first = sorted[0];
    const last = sorted.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }

    const linkY =
      sorted.reduce((sum, point) => sum + point.y, 0) / sorted.length;
    graphics.lineStyle(2, COLORS.copper, 0.48);
    graphics.lineBetween(first.x + 11, linkY, last.x - 11, linkY);
    const pulse = 0.68 + Math.sin(time * 0.008) * 0.2;
    for (let index = 1; index <= 3; index += 1) {
      const progress = index / 4;
      graphics.fillStyle(COLORS.copperLight, pulse);
      graphics.fillCircle(
        first.x + (last.x - first.x) * progress,
        linkY,
        2.5,
      );
    }
  }

  #drawRestaurantGuest(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feetY: number,
    facing: -1 | 1,
    bodyColor: number,
    action: "walking" | "waiting" | "eating" | "talking",
    time: number,
    activeSpeaker: boolean,
  ): void {
    const walking = action === "walking";
    const step = walking ? Math.sin(time * 0.015) * 4 : 0;
    const bob = walking
      ? Math.abs(Math.sin(time * 0.015)) * 2
      : Math.sin(time * 0.005) * 1.2;
    const actorFeetY = feetY - bob;
    const headY = actorFeetY - 38;

    graphics.fillStyle(COLORS.ink, 0.16);
    graphics.fillEllipse(x, feetY + 2, 24, 7);
    if (activeSpeaker) {
      const halo = 0.48 + Math.sin(time * 0.01) * 0.18;
      graphics.lineStyle(3, COLORS.glow, halo);
      graphics.strokeCircle(x, headY, 13);
    }

    graphics.lineStyle(4, COLORS.woodDark, 1);
    graphics.lineBetween(x - 4, actorFeetY - 8, x - 5 + step, actorFeetY);
    graphics.lineBetween(x + 4, actorFeetY - 8, x + 5 - step, actorFeetY);
    graphics.fillStyle(bodyColor, 1);
    graphics.fillRoundedRect(x - 9, actorFeetY - 31, 18, 24, 6);
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillCircle(x, headY - 2, 8.5);
    graphics.fillStyle(COLORS.creamLight, 1);
    graphics.fillCircle(x, headY, 7);
    graphics.fillStyle(COLORS.ink, 1);
    graphics.fillCircle(x + facing * 3, headY - 1, 1.2);

    graphics.lineStyle(3, COLORS.creamLight, 1);
    if (action === "talking" && activeSpeaker) {
      const gesture = 3 + Math.sin(time * 0.012) * 3;
      graphics.lineBetween(
        x + facing * 5,
        actorFeetY - 25,
        x + facing * (13 + gesture),
        actorFeetY - 29,
      );
    } else if (action === "eating") {
      graphics.lineBetween(x - 5, actorFeetY - 23, x - 1, actorFeetY - 17);
      graphics.lineBetween(x + 5, actorFeetY - 23, x + 1, actorFeetY - 17);
      graphics.fillStyle(COLORS.creamLight, 1);
      graphics.fillEllipse(x, actorFeetY - 15, 14, 5);
      graphics.lineStyle(2, COLORS.brass, 1);
      graphics.lineBetween(
        x + 3,
        actorFeetY - 17,
        x + 8,
        actorFeetY - 26 - Math.sin(time * 0.008) * 3,
      );
    } else {
      graphics.lineBetween(x - 5, actorFeetY - 24, x - 8 - step, actorFeetY - 15);
      graphics.lineBetween(x + 5, actorFeetY - 24, x + 8 + step, actorFeetY - 15);
    }
  }

  #drawOttoActor(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    feetY: number,
    facing: -1 | 1,
    trayVisible: boolean,
    time: number,
  ): void {
    const bob = Math.abs(Math.sin(time * 0.012)) * 1.5;
    const actorFeetY = feetY - bob;
    const headY = actorFeetY - 37;

    graphics.fillStyle(COLORS.ink, 0.18);
    graphics.fillEllipse(x, feetY + 2, 27, 7);
    graphics.lineStyle(4, COLORS.woodDark, 1);
    graphics.lineBetween(x - 5, actorFeetY - 8, x - 7, actorFeetY);
    graphics.lineBetween(x + 5, actorFeetY - 8, x + 7, actorFeetY);
    graphics.fillStyle(COLORS.brass, 1);
    graphics.fillRoundedRect(x - 10, actorFeetY - 31, 20, 25, 5);
    graphics.lineStyle(2, COLORS.woodDark, 1);
    graphics.strokeRoundedRect(x - 10, actorFeetY - 31, 20, 25, 5);
    graphics.fillStyle(COLORS.woodDark, 1);
    graphics.fillRoundedRect(x - 10, headY - 8, 20, 16, 5);
    graphics.lineStyle(2, COLORS.brassLight, 1);
    graphics.strokeRoundedRect(x - 10, headY - 8, 20, 16, 5);
    graphics.fillStyle(COLORS.tealLight, 1);
    graphics.fillCircle(x + facing * 4, headY - 1, 2.2);
    graphics.lineStyle(2, COLORS.brass, 1);
    graphics.lineBetween(x, headY - 8, x, headY - 14);
    graphics.fillStyle(COLORS.glow, 0.9);
    graphics.fillCircle(x, headY - 16, 2.4);

    if (trayVisible) {
      const trayX = x + facing * 18;
      const trayY = actorFeetY - 23;
      graphics.lineStyle(3, COLORS.brassLight, 1);
      graphics.lineBetween(x + facing * 7, actorFeetY - 24, trayX, trayY);
      graphics.lineStyle(3, COLORS.woodDark, 1);
      graphics.lineBetween(trayX - 12, trayY, trayX + 12, trayY);
      graphics.fillStyle(COLORS.creamLight, 1);
      graphics.fillEllipse(trayX, trayY - 3, 15, 6);
      graphics.fillStyle(COLORS.copperLight, 1);
      graphics.fillCircle(trayX, trayY - 6, 3);
    } else {
      graphics.lineStyle(3, COLORS.brassLight, 1);
      graphics.lineBetween(x - 7, actorFeetY - 24, x - 12, actorFeetY - 15);
      graphics.lineBetween(x + 7, actorFeetY - 24, x + 12, actorFeetY - 15);
    }
  }

  #drawDialogueBubble(
    time: number,
    motionScale: number,
  ): void {
    const graphics = this.#dialogueBubbleGraphics;
    graphics.clear();

    const bubble = this.#dialogueBubble;
    const conversation = this.#npcFrame.conversation;
    const speakerActor = this.#npcFrame.actors.find(
      (actor) =>
        actor.instanceId === conversation?.activeSpeakerActorId,
    );
    if (
      bubble === null ||
      conversation === null ||
      !conversation.ready ||
      speakerActor === undefined
    ) {
      this.#dialogueSpeakerText.setVisible(false);
      this.#dialogueLineText.setVisible(false);
      return;
    }

    const bubbleWidth = Phaser.Math.Clamp(
      Math.round(this.#viewportWidth * 0.2),
      200,
      270,
    );
    const textWidth = bubbleWidth - 24;
    this.#dialogueSpeakerText
      .setText(bubble.speakerName)
      .setVisible(true);
    this.#dialogueLineText
      .setWordWrapWidth(textWidth, true)
      .setText(bubble.text)
      .setVisible(true);

    const bubbleHeight = Math.ceil(
      10 +
        this.#dialogueSpeakerText.height +
        2 +
        this.#dialogueLineText.height +
        11,
    );
    const seatX = speakerActor.xRatio * this.#viewportWidth;
    const actorTime =
      time * Math.max(0.35, motionScale) +
      speakerActor.instanceId.length * 137;
    const bounce = Math.sin(actorTime * 0.005) * 1.2;
    const speakerHeadY =
      this.#restaurantY +
      this.#restaurantHeight * speakerActor.yRatio -
      bounce -
      38;
    const bubbleLeft = Phaser.Math.Clamp(
      seatX - bubbleWidth / 2,
      12,
      this.#viewportWidth - bubbleWidth - 12,
    );
    const bubbleTop = speakerHeadY - bubbleHeight - 19;
    const bubbleBottom = bubbleTop + bubbleHeight;
    const tailX = Phaser.Math.Clamp(
      seatX,
      bubbleLeft + 18,
      bubbleLeft + bubbleWidth - 18,
    );

    graphics.fillStyle(COLORS.ink, 0.16);
    graphics.fillRoundedRect(
      bubbleLeft + 3,
      bubbleTop + 4,
      bubbleWidth,
      bubbleHeight,
      10,
    );
    graphics.fillStyle(COLORS.creamLight, 0.98);
    graphics.fillRoundedRect(
      bubbleLeft,
      bubbleTop,
      bubbleWidth,
      bubbleHeight,
      10,
    );
    graphics.fillTriangle(
      tailX - 8,
      bubbleBottom - 1,
      tailX + 8,
      bubbleBottom - 1,
      tailX,
      bubbleBottom + 9,
    );
    graphics.lineStyle(2, COLORS.copper, 0.92);
    graphics.strokeRoundedRect(
      bubbleLeft,
      bubbleTop,
      bubbleWidth,
      bubbleHeight,
      10,
    );

    this.#dialogueSpeakerText.setPosition(
      bubbleLeft + 12,
      bubbleTop + 8,
    );
    this.#dialogueLineText.setPosition(
      bubbleLeft + 12,
      bubbleTop + 10 + this.#dialogueSpeakerText.height,
    );
  }

  #strokePolygon(
    graphics: Phaser.GameObjects.Graphics,
    points: readonly HitPoint[],
  ): void {
    const first = points[0];
    if (first === undefined) {
      return;
    }

    graphics.beginPath();
    graphics.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.closePath();
    graphics.strokePath();
  }

  #routeCursor(point: CursorPoint): void {
    this.#cursor = point;
    const hit = point.inside
      ? this.#hitMap.hitTest(point.x, point.y)
      : null;
    const hoveredZoneId =
      hit?.id === "airship" || hit?.id === "restaurant"
        ? hit.id
        : null;

    if (hoveredZoneId !== this.#hoveredZoneId) {
      this.#hoveredZoneId = hoveredZoneId;
      this.#drawStaticWorld();
    }

    const interactive = this.#inputLock || hit !== null;
    const reason = this.#inputLock
      ? "input-lock"
      : (hit?.id ?? "desktop");

    this.#publishDebugSnapshot(interactive, reason);

    if (
      interactive === this.#lastInteractive &&
      reason === this.#lastInteractionReason
    ) {
      return;
    }

    this.#lastInteractive = interactive;
    this.#lastInteractionReason = reason;

    const bridge = window.airshipDesktop;
    if (bridge !== undefined) {
      void bridge
        .setInteraction({ interactive, reason })
        .catch((error: unknown) => {
          console.error("Unable to update desktop interaction.", error);
        });
    }
  }

  #handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const hit = this.#hitMap.hitTest(pointer.x, pointer.y);
    if (hit?.id !== "airship" && hit?.id !== "restaurant") {
      return;
    }

    this.#pressedZoneId = hit.id;
    this.#inputLock = true;
    this.#routeCursor({
      x: pointer.x,
      y: pointer.y,
      inside: true,
    });
  }

  #handlePointerUp(pointer: Phaser.Input.Pointer): void {
    this.#finishPointerInteraction(pointer.x, pointer.y);
  }

  #finishPointerInteraction(x: number, y: number): void {
    const pressedZoneId = this.#pressedZoneId;
    if (pressedZoneId === null) {
      return;
    }

    const releasedZone = this.#hitMap.hitTest(x, y);
    this.#pressedZoneId = null;
    this.#inputLock = false;
    this.#routeCursor({ x, y, inside: true });

    if (releasedZone?.id === pressedZoneId) {
      this.#activateZone(pressedZoneId);
    }
  }

  #activateZone(zoneId: InteractiveZoneId): void {
    this.#showToast(
      zoneId === "airship"
        ? "正在打开空中厨房管理…"
        : "正在打开餐厅经营管理…",
    );

    const bridge = window.airshipDesktop;
    if (bridge !== undefined) {
      void bridge.openManagement().catch((error: unknown) => {
        console.error("Unable to open management window.", error);
        this.#showToast("管理窗口暂时无法打开");
      });
    }
  }

  #showToast(message: string): void {
    this.tweens.killTweensOf(this.#toastText);
    this.#toastText
      .setText(message)
      .setAlpha(1)
      .setVisible(true);
    this.tweens.add({
      targets: this.#toastText,
      alpha: 0,
      delay: 1_400,
      duration: 450,
      onComplete: () => {
        this.#toastText.setVisible(false);
      },
    });
  }

  #connectRuntimeBridge(): void {
    const bridge = window.airshipDesktop;

    if (bridge === undefined) {
      this.#runtimePhase = "浏览器预览 · 原生交互未连接";
      this.#runtimeStatusText.setText(this.#runtimePhase);
      return;
    }

    this.#unsubscribeSnapshot = bridge.onSnapshotChanged((snapshot) => {
      this.#applySnapshot(snapshot);
    });

    this.#unsubscribeCursor = bridge.onCursorPosition((point) => {
      this.#routeCursor(point);
    });
    this.#unsubscribeSettings = bridge.onSettingsChanged((settings) => {
      this.#applySettings(settings);
    });
    void bridge
      .getSettings()
      .then((settings) => {
        if (this.scene.isActive()) {
          this.#applySettings(settings);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to read desktop settings.", error);
      });
    void bridge
      .getSnapshot()
      .then((snapshot) => {
        if (this.scene.isActive()) {
          this.#applySnapshot(snapshot);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to read runtime snapshot.", error);
        this.#runtimePhase = "运行时连接失败";
        this.#runtimeStatusText.setText(this.#runtimePhase);
      });

    this.#routeCursor(this.#cursor);
  }

  #applySnapshot(snapshot: GameSnapshot): void {
    this.#lastDeliveredQuantity =
      snapshot.gameplay?.logistics.totalDeliveredQuantity ?? null;
    this.#quietMode = snapshot.settings.quietMode;
    this.#gameplaySnapshot = snapshot.gameplay;
    this.#dialogueBubble = resolveDialogueBubblePresentation(
      snapshot.dialogue,
      DESKTOP_CONTENT,
    );
    this.#runtimePhase =
      snapshot.phase === "ready"
        ? `世界在线 · 经营修订 ${
            snapshot.gameplay?.revision ?? snapshot.revision
          }`
        : "世界正在启动";
    this.#runtimeStatusText.setText(this.#runtimePhase);
    this.#refreshLabels();
  }

  #applySettings(settings: AppSettingsSnapshot): void {
    this.#presentationMode = settings.presentationMode;
    this.#quietMode = settings.presentationMode === "quiet";
    this.registry.set(DESKTOP_REGISTRY_KEYS.settings, settings);
    this.game.events.emit(DESKTOP_EVENTS.settingsChanged, settings);
    this.#refreshLabels();
  }

  #publishDebugSnapshot(
    interactive: boolean,
    interactionReason: string,
  ): void {
    const snapshot: DesktopDebugSnapshot = {
      viewport: {
        x: 0,
        y: 0,
        width: this.#viewportWidth,
        height: this.#viewportHeight,
      },
      airshipHitPoints: this.#airshipHitPoints,
      restaurantBounds: {
        x: 0,
        y: this.#restaurantY,
        width: this.#viewportWidth,
        height: this.#restaurantHeight,
      },
      cursor: this.#cursor,
      hoveredZoneId: this.#hoveredZoneId,
      interactive,
      interactionReason,
    };
    this.registry.set(DESKTOP_REGISTRY_KEYS.debugSnapshot, snapshot);
    this.game.events.emit(DESKTOP_EVENTS.debugSnapshotChanged, snapshot);
  }

  #refreshLabels(): void {
    const gameplay = this.#gameplaySnapshot;
    if (this.#hoveredZoneId === "airship") {
      this.#airshipStatusText.setText("点击进入厨房、仓库与工程管理");
    } else if (gameplay !== null) {
      const cooking = gameplay.cooking;
      if (cooking.activeJob?.status === "waiting-output") {
        this.#airshipStatusText.setText(
          `${getRecipeName(cooking.activeJob.recipeId)} · 等待缆车取餐`,
        );
      } else if (cooking.activeJob !== null) {
        this.#airshipStatusText.setText(
          `${getRecipeName(cooking.activeJob.recipeId)} · 已完成 ${
            cooking.completedBatches
          } 批`,
        );
      } else if (
        cooking.blockedReason === "insufficient-ingredients"
      ) {
        this.#airshipStatusText.setText("原料不足 · 等待公会补给");
      } else {
        this.#airshipStatusText.setText("厨房待命");
      }
    } else {
      this.#airshipStatusText.setText(
        this.#quietMode
          ? "安静模式 · 炉火低声运转"
          : "炉火稳定 · 厨房待命",
      );
    }

    if (this.#hoveredZoneId === "restaurant") {
      this.#restaurantStatusText.setText(
        "餐厅已选中 · 点击打开经营管理",
      );
    } else if (gameplay !== null) {
      const stock =
        gameplay.inventory.restaurantStorage.totalQuantity;
      const { copperBalance, totalSoldQuantity } =
        gameplay.restaurant;
      this.#restaurantStatusText.setText(
        `库存 ${stock} 份 · 累计售出 ${totalSoldQuantity} 份 · ${
          copperBalance
        } 铜币`,
      );
    } else {
      this.#restaurantStatusText.setText(
        this.#quietMode
          ? "安静营业中 · 动作频率已降低"
          : "晨间准备中 · 等待厨房送来第一批餐点",
      );
    }
  }
}
