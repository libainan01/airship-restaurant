import { createM2ContentRegistry } from "@airship-restaurant/content";
import type {
  AppSettingsSnapshot,
  CharacterPresentationReadModel,
  InventoryReadModel,
  DesktopWorldReadModel,
  ManagementSection,
  PresentationMode,
  RuntimeReadModelSlice,
} from "@airship-restaurant/contracts";
import Phaser from "phaser";
import { SemanticHitMap } from "./semantic-hit-map";
import {
  getManagementMenuHitId,
  getManagementOpeningLabel,
  getManagementSectionFromHitId,
  MANAGEMENT_LAUNCHER_HIT_ID,
  MANAGEMENT_OVERVIEW_HIT_ID,
  MANAGEMENT_PANEL_HIT_ID,
} from "./desktop-management-menu";
import {
  getFunctionalHotspotHitId,
  getFunctionalSectionFromHitId,
  resolveDesktopFunctionalHotspots,
  type DesktopFunctionalHotspot,
  type SceneManagementSection,
} from "./desktop-functional-hotspots";
import {
  resolveAirshipStatusLabel,
  resolveDesktopQuietMode,
  resolveRestaurantStatusLabel,
} from "./desktop-world-presenter";
import { createDefaultRestaurantLayoutRuntime } from "./restaurant-layout";
import { RestaurantNpcProjector } from "./restaurant-npc-projector";
import type { RestaurantNpcFrame } from "./restaurant-npc-presentation";
import { DesktopRuntimeConnector } from "./desktop-runtime-connector";
import { DesktopWorldPresentationModel } from "./desktop-world-presentation-model";
import { CableCarRenderer } from "./cable-car-renderer";
import { CharacterPresentationInterpolator } from "./character-presentation-interpolator";
import { RestaurantMotionRenderer } from "./restaurant-motion-renderer";
import { RestaurantOutdoorRenderer } from "./restaurant-outdoor-renderer";
import { DesktopRestaurantAudioFeedback } from "./restaurant-event-audio";
import { DialogueBubbleRenderer } from "./dialogue-bubble-renderer";
import { CableInfrastructureRenderer } from "./cable-infrastructure-renderer";
import { DesktopWorldHud } from "./desktop-world-hud";
import { DesktopWorldArtworkRenderer } from "./world-artwork-renderer";
import {
  resolveDesktopWorldLayout,
  type DesktopWorldLayout,
} from "./desktop-world-layout";
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

function formatFocusStatus(
  phase: "waiting-for-dialogue" | "focusing" | "break",
  phaseEndsAtUtcMs: number | null,
  nowUtcMs: number,
): string {
  if (phase === "waiting-for-dialogue") return "专注 · 等待对白";
  const totalSeconds = Math.max(0, Math.ceil(((phaseEndsAtUtcMs ?? nowUtcMs) - nowUtcMs) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${phase === "focusing" ? "专注" : "休息"} · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const getRecipeName = (recipeId: string | null): string =>
  recipeId === null
    ? "未选择食谱"
    : (RECIPE_NAMES[recipeId] ?? recipeId);

type ManagementPointerTarget = ManagementSection | "launcher";

const EMPTY_RESTAURANT_NPC_FRAME: RestaurantNpcFrame = Object.freeze({
  actors: Object.freeze([]),
  conversation: null,
  dialogueOpportunity: null,
  delivery: null,
  orderConfirmation: null,
  kitchenNotification: null,
});

export class DesktopWorldScene extends Phaser.Scene {
  readonly #hitMap = new SemanticHitMap();
  readonly #presentationModel = new DesktopWorldPresentationModel(DESKTOP_CONTENT);
  readonly #audioFeedback = new DesktopRestaurantAudioFeedback();
  readonly #restaurantLayout = createDefaultRestaurantLayoutRuntime();
  readonly #npcProjector = new RestaurantNpcProjector(this.#restaurantLayout);
  readonly #cableCarRenderer = new CableCarRenderer(COLORS);
  readonly #characterPresentation = new CharacterPresentationInterpolator();
  readonly #restaurantMotionRenderer = new RestaurantMotionRenderer(
    COLORS,
    this.#restaurantLayout,
  );
  readonly #restaurantOutdoorRenderer = new RestaurantOutdoorRenderer(
    COLORS,
    this.#restaurantLayout,
  );
  readonly #dialogueBubbleRenderer = new DialogueBubbleRenderer(COLORS);
  readonly #cableInfrastructureRenderer =
    new CableInfrastructureRenderer(COLORS);
  readonly #runtimeConnector = new DesktopRuntimeConnector({
    getBridge: () => window.airshipDesktop,
    isActive: () => this.scene.isActive(),

    onSettings: (settings) => this.#applySettings(settings),
    onReadModel: (slice) => this.#applyReadModel(slice),
    onCursor: (point) => this.#routeCursor(point),
    onConnectionStatus: (status) => {
      if (status === "preview") {
        this.#runtimePhase = "浏览器预览 · 原生交互未连接";
      } else if (status === "runtime-error") {
        this.#runtimePhase = "运行时连接失败";
      } else {
        return;
      }
      this.#hud.runtimeStatus.setText(this.#runtimePhase);
    },
    reportError: (message, error) => {
      console.error(message, error);
    },
  });

  #cableGraphics!: Phaser.GameObjects.Graphics;
  #worldGraphics!: Phaser.GameObjects.Graphics;
  #artworkRenderer!: DesktopWorldArtworkRenderer;
  #motionGraphics!: Phaser.GameObjects.Graphics;
  #dialogueBubbleGraphics!: Phaser.GameObjects.Graphics;
  #hud!: DesktopWorldHud;

  #worldLayout: DesktopWorldLayout = resolveDesktopWorldLayout(1280, 720);

  #cursor: CursorPoint = { x: -1, y: -1, inside: false };
  #hoveredZoneId: InteractiveZoneId | null = null;
  #functionalHotspots: readonly DesktopFunctionalHotspot[] = [];
  #hoveredFunctionalSection: SceneManagementSection | null = null;
  #managementMenuOpen = false;
  #managementLauncherHovered = false;
  #hoveredManagementTarget: ManagementSection | null = null;
  #pressedManagementTarget: ManagementPointerTarget | null = null;
  #lastInteractive: boolean | null = null;
  #lastInteractionReason = "";
  #inputLock = false;
  #presentationMode: PresentationMode = "normal";

  get #quietMode(): boolean {
    return resolveDesktopQuietMode(
      this.#presentationModel.runtimeQuietMode,
      this.#presentationMode,
    );
  }
  #runtimePhase = "正在连接主进程";
  #inventoryReadModel: InventoryReadModel | null = null;
  #characterReadModel: CharacterPresentationReadModel | null = null;

  #npcFrame: RestaurantNpcFrame = EMPTY_RESTAURANT_NPC_FRAME;


  constructor() {
    super(DESKTOP_SCENE_KEYS.world);
  }

  create(): void {
    this.#cableGraphics = this.add.graphics().setDepth(3);
    this.#worldGraphics = this.add.graphics().setDepth(4);
    this.#motionGraphics = this.add.graphics().setDepth(7);
    this.#artworkRenderer = new DesktopWorldArtworkRenderer(this);
    this.#dialogueBubbleGraphics = this.add
      .graphics()
      .setDepth(30);

    this.#hud = new DesktopWorldHud(this, {
      fontFamily: FONT_FAMILY,
      runtimePhase: this.#runtimePhase,
    });
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
    window.addEventListener("keydown", this.#handleKeyDown);

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
      window.removeEventListener("keydown", this.#handleKeyDown);
      this.#runtimeConnector.disconnect();
      this.#audioFeedback.destroy();
      this.#artworkRenderer.destroy();
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
    if (this.#pressedManagementTarget !== null) {
      this.#finishPointerInteraction(this.#cursor.x, this.#cursor.y);
    }
  };

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#managementMenuOpen) return;
    event.preventDefault();
    this.#setManagementMenuOpen(false);
  };

  #setManagementMenuOpen(open: boolean): void {
    if (open === this.#managementMenuOpen) return;
    this.#managementMenuOpen = open;
    this.#pressedManagementTarget = null;
    this.#inputLock = false;
    this.#hud.setManagementMenuOpen(open);
    this.#syncHitMap();
    this.#routeCursor(this.#cursor);
  }

  #resolveManagementTarget(
    hitId: string | undefined,
  ): ManagementPointerTarget | null {
    if (hitId === MANAGEMENT_LAUNCHER_HIT_ID) return "launcher";
    if (this.#managementMenuOpen) {
      return getManagementSectionFromHitId(hitId);
    }
    return getFunctionalSectionFromHitId(hitId);
  }

  #layoutWorld(width: number, height: number): void {
    this.#worldLayout = resolveDesktopWorldLayout(width, height);
    this.#functionalHotspots = resolveDesktopFunctionalHotspots(
      this.#worldLayout,
    );
    this.#syncHitMap();
    this.#hud.applyLayout(this.#worldLayout);
    this.#artworkRenderer.applyLayout(this.#worldLayout);
    this.#drawStaticWorld();
    this.#routeCursor(this.#cursor);
  }

  #syncHitMap(): void {
    const layout = this.#worldLayout;
    this.#hitMap.setZones([
      {
        id: "airship",
        kind: "polygon",
        points: layout.airshipHitPoints,
        priority: 10,
      },
      {
        id: "restaurant",
        kind: "rect",
        x: layout.restaurantX,
        y: layout.restaurantArtworkY,
        width:
          Math.max(
            layout.restaurantX + layout.restaurantWidth,
            layout.restaurantArtworkX + layout.restaurantArtworkWidth,
          ) - layout.restaurantX,
        height: layout.viewportHeight - layout.restaurantArtworkY,
        priority: 5,
      },
      ...this.#functionalHotspots.map((hotspot) => ({
        id: getFunctionalHotspotHitId(hotspot.section),
        kind: "rect" as const,
        x: hotspot.x,
        y: hotspot.y,
        width: hotspot.width,
        height: hotspot.height,
        priority: 110,
      })),
      {
        id: MANAGEMENT_LAUNCHER_HIT_ID,
        kind: "rect",
        ...layout.managementMenu.launcher,
        priority: 140,
      },
      ...(this.#managementMenuOpen ? [
        {
          id: MANAGEMENT_PANEL_HIT_ID,
          kind: "rect" as const,
          ...layout.managementMenu.panel,
          priority: 120,
        },
        {
          id: MANAGEMENT_OVERVIEW_HIT_ID,
          kind: "rect" as const,
          ...layout.managementMenu.overview,
          priority: 130,
        },
        ...layout.managementMenu.items.map((item) => ({
          id: getManagementMenuHitId(item.section),
          kind: "rect" as const,
          ...item.rect,
          priority: 130,
        })),
      ] : []),
    ]);
  }

  #drawStaticWorld(): void {
    const graphics = this.#worldGraphics;
    const layout = this.#worldLayout;
    graphics.clear();
    this.#artworkRenderer.applyLayout(layout);
    this.#restaurantOutdoorRenderer.draw(graphics, {
      x: layout.restaurantX,
      width: layout.restaurantWidth,
      y: layout.restaurantY,
      height: layout.restaurantHeight,
      hovered: this.#hoveredZoneId === "restaurant",
    });

    if (this.#hoveredZoneId === "airship") {
      const first = layout.airshipHitPoints[0];
      if (first !== undefined) {
        graphics.lineStyle(3, COLORS.glow, 0.82);
        graphics.beginPath();
        graphics.moveTo(first.x, first.y);
        for (const point of layout.airshipHitPoints.slice(1)) {
          graphics.lineTo(point.x, point.y);
        }
        graphics.closePath();
        graphics.strokePath();
      }
    }
    if (this.#hoveredZoneId === "restaurant") {
      graphics.lineStyle(3, COLORS.glow, 0.74);
      graphics.strokeRoundedRect(
        layout.restaurantArtworkX + 2,
        layout.restaurantArtworkY + 2,
        layout.restaurantArtworkWidth - 4,
        layout.restaurantArtworkHeight - 4,
        8,
      );
    }
    this.#refreshLabels();
  }
  #drawMotion(time: number): void {
    const graphics = this.#motionGraphics;
    graphics.clear();
    const focusSession = this.#presentationModel.focusSession;
    if (focusSession === null || focusSession.phase === "idle") {
      this.#hud.focusStatus.setVisible(false);
    } else {
      this.#hud.focusStatus
        .setText(formatFocusStatus(focusSession.phase, focusSession.phaseEndsAtUtcMs, Date.now()))
        .setVisible(true);
    }
    const motionScale =
      this.#presentationMode === "quiet"
        ? 0.25
        : this.#presentationMode === "reduced"
          ? 0.55
          : 1;

    this.#artworkRenderer.update(time, motionScale);

    const npcFrame = this.#npcProjector.project({
      timeMs: time,
      nowUtcMs: this.#presentationModel.gameplay?.currentUtcMs ?? Date.now(),
      dialogue: this.#presentationModel.dialogueBubble,
      restaurant: this.#presentationModel.gameplay?.restaurant ?? null,
      characters: this.#characterReadModel,
      deliveryRevision: this.#presentationModel.deliveryRevision,
      guestFlowRevision: this.#presentationModel.guestFlowRevision,
      seatCapacity: this.#presentationModel.gameplay?.restaurant.seatCapacity ?? 3,
    });
    this.#npcFrame = this.#characterPresentation.project(npcFrame, time);
    const cableRoute = this.#cableInfrastructureRenderer.draw(
      this.#cableGraphics,
      {
        airshipTrackPoint: this.#worldLayout.airshipTrackPoint,
        groundExchangePoint: this.#worldLayout.groundExchangePoint,
        transportEdgeX: this.#worldLayout.transportEdgeX,
      },
    );
    const cableCar = this.#cableCarRenderer.draw(graphics, cableRoute, {
      logistics: this.#presentationModel.gameplay?.logistics,
      animationTimeMs: time,
      motionScale,
      nowUtcMs: Date.now(),
      viewportWidth: this.#worldLayout.viewportWidth,
      drawCabin: false,
    });
    this.#artworkRenderer.setCargoTrackPoint(
      cableCar.trackX,
      cableCar.trackY,
    );
    this.#hud.cableStatus
      .setPosition(cableCar.labelX, cableCar.labelY)
      .setText(cableCar.status);
    const restaurantMotion = this.#restaurantMotionRenderer.draw(graphics, {
      frame: this.#npcFrame,
      dialogue: this.#presentationModel.dialogueBubble,
      latestSale: this.#presentationModel.gameplay?.restaurant.recentSales.at(-1),
      timeMs: time,
      motionScale,
      nowUtcMs: Date.now(),
      viewportWidth: this.#worldLayout.viewportWidth,
      restaurantX: this.#worldLayout.restaurantX,
      restaurantWidth: this.#worldLayout.restaurantWidth,
      restaurantY: this.#worldLayout.restaurantY,
      restaurantHeight: this.#worldLayout.restaurantHeight,
    });
    this.#hud.dialogueContext
      .setText(restaurantMotion.dialogueContext.text)
      .setPosition(
        restaurantMotion.dialogueContext.x,
        restaurantMotion.dialogueContext.y,
      )
      .setVisible(restaurantMotion.dialogueContext.visible);
    this.#hud.saleFeedback
      .setText(restaurantMotion.saleFeedback.text)
      .setVisible(restaurantMotion.saleFeedback.visible);
    this.#hud.ottoStatus
      .setText(restaurantMotion.ottoStatus.text)
      .setPosition(
        restaurantMotion.ottoStatus.x,
        restaurantMotion.ottoStatus.y,
      )
      .setVisible(restaurantMotion.ottoStatus.visible);
    if (this.#presentationModel.showLayoutAnchors) this.#drawLayoutAnchors(graphics);
    this.#drawFunctionalHotspotHighlight(graphics, time);
    this.#dialogueBubbleRenderer.draw({
      graphics: this.#dialogueBubbleGraphics,
      speakerText: this.#hud.dialogueSpeaker,
      lineText: this.#hud.dialogueLine,
      bubble: this.#presentationModel.dialogueBubble,
      frame: this.#npcFrame,
      viewportWidth: this.#worldLayout.viewportWidth,
      restaurantX: this.#worldLayout.restaurantX,
      restaurantWidth: this.#worldLayout.restaurantWidth,
      restaurantY: this.#worldLayout.restaurantY,
      restaurantHeight: this.#worldLayout.restaurantHeight,
      timeMs: time,
      motionScale,
    });
  }

  #drawFunctionalHotspotHighlight(
    graphics: Phaser.GameObjects.Graphics,
    time: number,
  ): void {
    if (this.#hoveredFunctionalSection === null) return;
    const hotspot = this.#functionalHotspots.find(
      (candidate) => candidate.section === this.#hoveredFunctionalSection,
    );
    if (hotspot === undefined) return;
    const alpha = 0.62 + Math.sin(time * 0.008) * 0.16;
    graphics.fillStyle(COLORS.glow, 0.08);
    graphics.fillRoundedRect(
      hotspot.x,
      hotspot.y,
      hotspot.width,
      hotspot.height,
      7,
    );
    graphics.lineStyle(2, COLORS.glow, alpha);
    graphics.strokeRoundedRect(
      hotspot.x,
      hotspot.y,
      hotspot.width,
      hotspot.height,
      7,
    );
  }
  #drawLayoutAnchors(graphics: Phaser.GameObjects.Graphics): void {
    for (const slot of this.#restaurantLayout.getPositionSlots()) {
      const x = this.#worldLayout.restaurantX + slot.xRatio * this.#worldLayout.restaurantWidth;
      const y = this.#worldLayout.restaurantY + slot.yRatio * this.#worldLayout.restaurantHeight;
      graphics.lineStyle(2, slot.kind === "seat" ? COLORS.tealLight : COLORS.glow, 0.9);
      graphics.strokeCircle(x, y, slot.kind === "seat" ? 9 : 6);
    }
    for (const role of ["guest-entry", "guest-exit", "otto-home", "otto-pickup", "delivery-table"] as const) {
      const anchor = this.#restaurantLayout.requireAnchor(role);
      const x = this.#worldLayout.restaurantX + anchor.xRatio * this.#worldLayout.restaurantWidth;
      const y = this.#worldLayout.restaurantY + anchor.yRatio * this.#worldLayout.restaurantHeight;
      graphics.fillStyle(COLORS.copperLight, 0.9);
      graphics.fillRect(x - 4, y - 4, 8, 8);
    }
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

    const functionalSection = this.#managementMenuOpen
      ? null
      : getFunctionalSectionFromHitId(hit?.id);
    if (functionalSection !== this.#hoveredFunctionalSection) {
      this.#hoveredFunctionalSection = functionalSection;
      this.#hud.showFunctionalHint(
        functionalSection === null
          ? null
          : (this.#functionalHotspots.find(
              (hotspot) => hotspot.section === functionalSection,
            ) ?? null),
      );
    }
    const launcherHovered = hit?.id === MANAGEMENT_LAUNCHER_HIT_ID;
    if (launcherHovered !== this.#managementLauncherHovered) {
      this.#managementLauncherHovered = launcherHovered;
      this.#hud.setManagementLauncherHovered(launcherHovered);
    }
    const managementTarget = this.#managementMenuOpen
      ? getManagementSectionFromHitId(hit?.id)
      : null;
    if (managementTarget !== this.#hoveredManagementTarget) {
      this.#hoveredManagementTarget = managementTarget;
      this.#hud.setManagementTargetHovered(managementTarget);
    }

    const target = this.#resolveManagementTarget(hit?.id);
    const interactive =
      this.#inputLock || target !== null || hit?.id === MANAGEMENT_PANEL_HIT_ID;
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
    this.#runtimeConnector.setInteraction({ interactive, reason });
  }

  #handlePointerDown(pointer: Phaser.Input.Pointer): void {
    void this.#audioFeedback.unlock();
    const hit = this.#hitMap.hitTest(pointer.x, pointer.y);
    const target = this.#resolveManagementTarget(hit?.id);
    if (target === null) {
      if (this.#managementMenuOpen && hit?.id !== MANAGEMENT_PANEL_HIT_ID) {
        this.#setManagementMenuOpen(false);
      }
      return;
    }

    this.#pressedManagementTarget = target;
    this.#inputLock = true;
    this.#routeCursor({ x: pointer.x, y: pointer.y, inside: true });
  }

  #handlePointerUp(pointer: Phaser.Input.Pointer): void {
    this.#finishPointerInteraction(pointer.x, pointer.y);
  }

  #finishPointerInteraction(x: number, y: number): void {
    const pressedTarget = this.#pressedManagementTarget;
    if (pressedTarget === null) return;

    const hit = this.#hitMap.hitTest(x, y);
    const releasedTarget = this.#resolveManagementTarget(hit?.id);
    this.#pressedManagementTarget = null;
    this.#inputLock = false;
    if (releasedTarget === pressedTarget) {
      if (pressedTarget === "launcher") {
        this.#setManagementMenuOpen(!this.#managementMenuOpen);
      } else {
        this.#setManagementMenuOpen(false);
        this.#activateManagementSection(pressedTarget);
      }
    }
    this.#routeCursor({ x, y, inside: true });
  }

  #activateManagementSection(section: ManagementSection): void {
    this.#showToast("正在打开" + getManagementOpeningLabel(section) + "…");
    void this.#runtimeConnector.openManagement(section).then((opened) => {
      if (!opened) this.#showToast("管理窗口暂时无法打开");
    });
  }

  #showToast(message: string): void {
    this.tweens.killTweensOf(this.#hud.toast);
    this.#hud.toast
      .setText(message)
      .setAlpha(1)
      .setVisible(true);
    this.tweens.add({
      targets: this.#hud.toast,
      alpha: 0,
      delay: 1_400,
      duration: 450,
      onComplete: () => {
        this.#hud.toast.setVisible(false);
      },
    });
  }

  #connectRuntimeBridge(): void {
    this.#runtimeConnector.connect();
    this.#routeCursor(this.#cursor);
  }
  #applyDesktopWorld(snapshot: DesktopWorldReadModel): void {
    const update = this.#presentationModel.applyReadModel(snapshot);
    this.#audioFeedback.observe(snapshot.restaurantActivity.events, {
      quiet: this.#quietMode,
      procurementArrived: update.procurementArrivalMessage !== null,
    });
    if (update.procurementArrivalMessage !== null) {
      this.#showToast(update.procurementArrivalMessage);
    }
    this.#hud.portStatus.setText(update.portStatusLabel);
    this.#restaurantLayout.setSeatCapacity(update.seatCapacity);
    if (update.seatCapacityChanged) this.#drawStaticWorld();
    this.#runtimePhase = update.runtimePhaseLabel;
    this.#hud.runtimeStatus.setText(this.#runtimePhase);
    this.#refreshLabels();
  }

  #applyReadModel(slice: RuntimeReadModelSlice): void {
    this.registry.set(`read-model.${slice.key}`, slice.value);
    if (slice.key === "desktop-world") {
      this.#applyDesktopWorld(slice.value);
      return;
    }
    if (slice.key === "inventory") {
      this.#inventoryReadModel = slice.value;
      this.#refreshLabels();
      return;
    }
    if (slice.key === "characters") {
      this.#characterReadModel = slice.value;
      this.#characterPresentation.apply(slice.value, this.time.now);
      return;
    }
    this.#drawStaticWorld();
  }
  #applySettings(settings: AppSettingsSnapshot): void {
    this.#presentationMode = settings.presentationMode;
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
        width: this.#worldLayout.viewportWidth,
        height: this.#worldLayout.viewportHeight,
      },
      airshipHitPoints: this.#worldLayout.airshipHitPoints,
      restaurantBounds: {
        x: this.#worldLayout.restaurantX,
        y: this.#worldLayout.restaurantArtworkY,
        width:
          Math.max(
            this.#worldLayout.restaurantX +
              this.#worldLayout.restaurantWidth,
            this.#worldLayout.restaurantArtworkX +
              this.#worldLayout.restaurantArtworkWidth,
          ) - this.#worldLayout.restaurantX,
        height:
          this.#worldLayout.viewportHeight -
          this.#worldLayout.restaurantArtworkY,
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
    const gameplay = this.#presentationModel.gameplay;
    this.#hud.airshipStatus.setText(
      resolveAirshipStatusLabel({
        hovered: this.#hoveredZoneId === "airship",
        quietMode: this.#quietMode,
        cooking: gameplay?.cooking ?? null,
        kitchenNotification: this.#npcFrame.kitchenNotification,
        getRecipeName,
      }),
    );
    this.#hud.restaurantStatus.setText(
      resolveRestaurantStatusLabel({
        hovered: this.#hoveredZoneId === "restaurant",
        quietMode: this.#quietMode,
        stockQuantity:
          this.#inventoryReadModel?.locations
            .find((location) => location.id === "restaurant.storage")
            ?.items.reduce((sum, item) => sum + item.quantity, 0) ?? null,
        restaurant: gameplay?.restaurant ?? null,
      }),
    );
  }
}
