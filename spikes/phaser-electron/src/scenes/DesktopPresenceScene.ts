import Phaser from "phaser";
import {
  type HitZone,
  type RectHitZone,
  SemanticHitMap,
} from "../hit-map";

type ButtonKey =
  | "quiet-button"
  | "pin-button"
  | "debug-button"
  | "quit-button"
  | "restaurant-test";

type ButtonSpec = RectHitZone & {
  label: string;
  accent?: boolean;
};

const COLORS = {
  ink: 0x302923,
  paper: 0xfff8e9,
  paperWarm: 0xfff2dc,
  copper: 0x9e5032,
  copperLight: 0xc46d48,
  brass: 0xb77a36,
  wood: 0x60412f,
  wall: 0xe4ca97,
  floor: 0xd7bf94,
  smoke: 0xe9ded0,
  teal: 0x557b76,
  green: 0x6f8a62,
};

export class DesktopPresenceScene extends Phaser.Scene {
  readonly #hitMap = new SemanticHitMap();

  #staticGraphics!: Phaser.GameObjects.Graphics;
  #dynamicGraphics!: Phaser.GameObjects.Graphics;
  #debugGraphics!: Phaser.GameObjects.Graphics;
  #titleText!: Phaser.GameObjects.Text;
  #inputStatusText!: Phaser.GameObjects.Text;
  #environmentText!: Phaser.GameObjects.Text;
  #metricsText!: Phaser.GameObjects.Text;
  #restaurantStatusText!: Phaser.GameObjects.Text;
  #bubbleText!: Phaser.GameObjects.Text;
  #buttonTexts = new Map<ButtonKey, Phaser.GameObjects.Text>();
  #buttonSpecs = new Map<ButtonKey, ButtonSpec>();

  #viewportWidth = 1280;
  #viewportHeight = 720;
  #topHeight = 170;
  #bottomHeight = 170;
  #quietMode = false;
  #alwaysOnTop = true;
  #showDebugZones = false;
  #recipeBubbleVisible = false;
  #servedCount = 0;
  #hoveredZoneId = "desktop";
  #lastInteractive: boolean | null = null;
  #lastInteractionReason = "";
  #inputLock = false;
  #cursor: DesktopPoint = { x: -1, y: -1, inside: false };
  #unsubscribeCallbacks: Array<() => void> = [];

  constructor() {
    super("DesktopPresence");
  }

  create(): void {
    this.#staticGraphics = this.add.graphics();
    this.#dynamicGraphics = this.add.graphics();
    this.#debugGraphics = this.add.graphics();

    this.#titleText = this.add.text(20, 15, "空艇餐厅 · 桌面陪伴技术验证", {
      color: "#302923",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "17px",
      fontStyle: "bold",
    });
    this.#inputStatusText = this.add.text(21, 43, "输入状态：等待 Electron", {
      color: "#7c6757",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "12px",
    });
    this.#environmentText = this.add.text(21, 64, "正在读取桌面环境…", {
      color: "#8b7768",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "11px",
    });
    this.#metricsText = this.add.text(21, 84, "资源：等待采样", {
      color: "#8b7768",
      fontFamily: '"Microsoft YaHei UI", sans-serif',
      fontSize: "11px",
    });
    this.#restaurantStatusText = this.add.text(
      22,
      0,
      "底部餐厅是固定交互区 · 中央动态内容默认穿透桌面",
      {
        color: "#5f5147",
        fontFamily: '"Microsoft YaHei UI", sans-serif',
        fontSize: "12px",
      },
    );
    this.#bubbleText = this.add
      .text(0, 0, "发现食谱\n点击查看", {
        align: "center",
        color: "#4a3225",
        fontFamily: '"Microsoft YaHei UI", sans-serif',
        fontSize: "13px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.#createButtonTexts();
    this.#layout(this.scale.width, this.scale.height);

    this.scale.on(
      Phaser.Scale.Events.RESIZE,
      (gameSize: Phaser.Structs.Size) => {
        this.#layout(gameSize.width, gameSize.height);
      },
    );
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.#handlePointerDown(pointer.x, pointer.y);
    });
    this.input.on("pointerup", () => {
      this.#releaseInputLock();
    });

    const mouseMoveHandler = (event: MouseEvent) => {
      this.#routeCursor({
        x: event.clientX,
        y: event.clientY,
        inside: true,
      });
    };
    window.addEventListener("mousemove", mouseMoveHandler);

    const bridge = window.desktopShell;
    if (bridge) {
      this.#unsubscribeCallbacks.push(
        bridge.onCursorPosition((point) => this.#routeCursor(point)),
        bridge.onPassthroughState((state) => {
          this.#inputStatusText.setText(
            state.interactive
              ? `输入状态：游戏交互 · ${state.reason}`
              : `输入状态：穿透桌面 · ${state.reason}`,
          );
        }),
        bridge.onMetrics((metrics) => this.#updateMetrics(metrics)),
      );
      void bridge.getEnvironment().then((environment) => {
        this.#environmentText.setText(
          `Electron ${environment.electronVersion} · ` +
            `${environment.workArea.width} × ${environment.workArea.height} · ` +
            `${Math.round(environment.scaleFactor * 100)}%`,
        );
      });
    } else {
      this.#environmentText.setText("浏览器预览模式 · 无原生窗口穿透");
    }

    this.time.delayedCall(3000, () => this.#showRecipeBubble());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("mousemove", mouseMoveHandler);
      for (const unsubscribe of this.#unsubscribeCallbacks) {
        unsubscribe();
      }
      this.#unsubscribeCallbacks = [];
    });
  }

  update(time: number): void {
    this.#drawDynamicWorld(time);
    this.#drawDebugZones();

    if (this.#recipeBubbleVisible) {
      const bubble = this.#getRecipeBubblePosition();
      this.#bubbleText.setPosition(bubble.x, bubble.y);
      this.#hitMap.upsert({
        id: "recipe-bubble",
        kind: "circle",
        x: bubble.x,
        y: bubble.y,
        radius: 52,
        priority: 30,
      });
      this.#routeCursor(this.#cursor);
    }
  }

  #createButtonTexts(): void {
    const definitions: Array<[ButtonKey, string]> = [
      ["quiet-button", "安静模式"],
      ["pin-button", "置顶：开"],
      ["debug-button", "显示热区"],
      ["quit-button", "退出验证"],
      ["restaurant-test", "测试餐厅交互"],
    ];

    for (const [key, label] of definitions) {
      const text = this.add
        .text(0, 0, label, {
          color: key === "quit-button" ? "#fff8e9" : "#302923",
          fontFamily: '"Microsoft YaHei UI", sans-serif',
          fontSize: "12px",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      this.#buttonTexts.set(key, text);
    }
  }

  #layout(width: number, height: number): void {
    this.#viewportWidth = Math.max(960, width);
    this.#viewportHeight = Math.max(600, height);
    this.#topHeight = Phaser.Math.Clamp(
      Math.round(this.#viewportHeight * 0.21),
      155,
      205,
    );
    this.#bottomHeight = Phaser.Math.Clamp(
      Math.round(this.#viewportHeight * 0.2),
      150,
      195,
    );

    const buttonY = 18;
    const buttonHeight = 36;
    const rightMargin = 18;
    const buttonGap = 8;
    const buttonWidths: Record<ButtonKey, number> = {
      "quiet-button": 92,
      "pin-button": 82,
      "debug-button": 88,
      "quit-button": 88,
      "restaurant-test": 128,
    };

    let cursorX = this.#viewportWidth - rightMargin;
    const topButtons: ButtonKey[] = [
      "quit-button",
      "debug-button",
      "pin-button",
      "quiet-button",
    ];
    for (const key of topButtons) {
      const buttonWidth = buttonWidths[key];
      cursorX -= buttonWidth;
      this.#buttonSpecs.set(key, {
        id: key,
        kind: "rect",
        x: cursorX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
        priority: 20,
        label: this.#buttonTexts.get(key)?.text ?? key,
        accent: key === "quit-button",
      });
      cursorX -= buttonGap;
    }

    this.#buttonSpecs.set("restaurant-test", {
      id: "restaurant-test",
      kind: "rect",
      x: this.#viewportWidth - rightMargin - buttonWidths["restaurant-test"],
      y: this.#viewportHeight - this.#bottomHeight + 23,
      width: buttonWidths["restaurant-test"],
      height: 38,
      priority: 20,
      label: "测试餐厅交互",
      accent: true,
    });

    this.#restaurantStatusText.setPosition(
      22,
      this.#viewportHeight - this.#bottomHeight + 23,
    );
    this.#restaurantStatusText.setWordWrapWidth(
      this.#viewportWidth - 230,
      true,
    );

    this.#rebuildHitMap();
    this.#drawStaticWorld();
    this.#positionButtonTexts();
    if (this.#recipeBubbleVisible) {
      this.#reportTestPoints();
    }
  }

  #rebuildHitMap(): void {
    const zones: HitZone[] = [
      {
        id: "top-shell",
        kind: "rect",
        x: 0,
        y: 0,
        width: this.#viewportWidth,
        height: this.#topHeight,
        priority: 1,
      },
      {
        id: "bottom-shell",
        kind: "rect",
        x: 0,
        y: this.#viewportHeight - this.#bottomHeight,
        width: this.#viewportWidth,
        height: this.#bottomHeight,
        priority: 1,
      },
      ...this.#buttonSpecs.values(),
    ];
    this.#hitMap.setZones(zones);
  }

  #positionButtonTexts(): void {
    for (const [key, spec] of this.#buttonSpecs) {
      this.#buttonTexts
        .get(key)
        ?.setPosition(spec.x + spec.width / 2, spec.y + spec.height / 2);
    }
  }

  #drawStaticWorld(): void {
    const graphics = this.#staticGraphics;
    graphics.clear();

    graphics.fillStyle(COLORS.paperWarm, 0.94);
    graphics.fillRect(0, 0, this.#viewportWidth, this.#topHeight);
    graphics.lineStyle(2, COLORS.wood, 0.55);
    graphics.lineBetween(
      0,
      this.#topHeight - 1,
      this.#viewportWidth,
      this.#topHeight - 1,
    );

    const airshipX = this.#viewportWidth * 0.5;
    const airshipY = this.#topHeight * 0.46;
    graphics.fillStyle(0xb85f49, 1);
    graphics.fillEllipse(airshipX, airshipY - 25, 310, 100);
    graphics.lineStyle(3, COLORS.wood, 1);
    graphics.strokeEllipse(airshipX, airshipY - 25, 310, 100);
    graphics.lineStyle(4, 0xd8b578, 0.9);
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const stripeX = airshipX + stripe * 48;
      graphics.lineBetween(
        stripeX,
        airshipY - 72,
        stripeX,
        airshipY + 22,
      );
    }
    graphics.lineStyle(2, COLORS.wood, 1);
    graphics.lineBetween(
      airshipX - 110,
      airshipY + 13,
      airshipX - 92,
      airshipY + 58,
    );
    graphics.lineBetween(
      airshipX + 110,
      airshipY + 13,
      airshipX + 92,
      airshipY + 58,
    );
    graphics.fillStyle(0xbd7441, 1);
    graphics.fillRoundedRect(
      airshipX - 120,
      airshipY + 55,
      240,
      48,
      8,
    );
    graphics.lineStyle(3, COLORS.wood, 1);
    graphics.strokeRoundedRect(
      airshipX - 120,
      airshipY + 55,
      240,
      48,
      8,
    );
    graphics.fillStyle(0xf3c66e, 1);
    graphics.fillRect(airshipX - 92, airshipY + 68, 34, 22);
    graphics.fillCircle(airshipX + 26, airshipY + 77, 13);

    const floorY = this.#viewportHeight - this.#bottomHeight;
    graphics.fillStyle(COLORS.floor, 0.94);
    graphics.fillRect(
      0,
      floorY,
      this.#viewportWidth,
      this.#bottomHeight,
    );
    graphics.lineStyle(2, COLORS.wood, 0.9);
    graphics.lineBetween(0, floorY, this.#viewportWidth, floorY);

    const restaurantWidth = Phaser.Math.Clamp(
      this.#viewportWidth * 0.48,
      470,
      720,
    );
    const restaurantX = (this.#viewportWidth - restaurantWidth) / 2;
    graphics.fillStyle(COLORS.wall, 1);
    graphics.fillRect(
      restaurantX,
      floorY + 30,
      restaurantWidth,
      this.#bottomHeight - 30,
    );
    graphics.fillStyle(0x795139, 1);
    graphics.fillTriangle(
      restaurantX - 20,
      floorY + 39,
      restaurantX + restaurantWidth / 2,
      floorY + 4,
      restaurantX + restaurantWidth + 20,
      floorY + 39,
    );
    graphics.lineStyle(3, COLORS.wood, 1);
    graphics.strokeRect(
      restaurantX,
      floorY + 30,
      restaurantWidth,
      this.#bottomHeight - 30,
    );

    for (const spec of this.#buttonSpecs.values()) {
      graphics.fillStyle(
        spec.accent ? COLORS.copper : COLORS.paper,
        0.98,
      );
      graphics.fillRoundedRect(
        spec.x,
        spec.y,
        spec.width,
        spec.height,
        9,
      );
      graphics.lineStyle(1, COLORS.wood, 0.9);
      graphics.strokeRoundedRect(
        spec.x,
        spec.y,
        spec.width,
        spec.height,
        9,
      );
    }
  }

  #drawDynamicWorld(time: number): void {
    const graphics = this.#dynamicGraphics;
    graphics.clear();
    const motionScale = this.#quietMode ? 0.35 : 1;
    const middleTop = this.#topHeight;
    const middleBottom = this.#viewportHeight - this.#bottomHeight;
    const middleHeight = middleBottom - middleTop;

    const cloudCount = this.#quietMode ? 3 : 6;
    for (let index = 0; index < cloudCount; index += 1) {
      const travelWidth = this.#viewportWidth + 260;
      const cloudX =
        ((time * (0.009 + index * 0.0015) * motionScale +
          index * 290) %
          travelWidth) -
        130;
      const cloudY =
        middleTop + 45 + ((index * 83) % Math.max(90, middleHeight - 90));
      graphics.fillStyle(0xf0e7da, 0.3);
      graphics.fillCircle(cloudX - 26, cloudY, 23);
      graphics.fillCircle(cloudX, cloudY - 7, 31);
      graphics.fillCircle(cloudX + 34, cloudY + 2, 20);
    }

    const merchantTravel = this.#viewportWidth + 360;
    const merchantX =
      ((time * 0.028 * motionScale + 130) % merchantTravel) - 180;
    const merchantY =
      middleTop + middleHeight * 0.3 + Math.sin(time * 0.0011) * 12;
    this.#drawMerchantShip(graphics, merchantX, merchantY);

    const companionX = this.#viewportWidth * 0.52;
    const companionY =
      middleTop + middleHeight * 0.62 + Math.sin(time * 0.0018) * 8;
    this.#drawCompanion(graphics, companionX, companionY);

    const railX = this.#viewportWidth - 52;
    graphics.lineStyle(4, COLORS.wood, 0.75);
    graphics.lineBetween(railX, middleTop, railX, middleBottom);
    const carTravel = Math.max(50, middleHeight - 90);
    const carY =
      middleTop +
      45 +
      ((Math.sin(time * 0.00045 * motionScale) + 1) / 2) * carTravel;
    graphics.fillStyle(COLORS.copper, 0.95);
    graphics.fillRoundedRect(railX - 29, carY - 21, 58, 42, 7);
    graphics.lineStyle(2, COLORS.wood, 1);
    graphics.strokeRoundedRect(railX - 29, carY - 21, 58, 42, 7);

    const steamCount = this.#quietMode ? 2 : 5;
    for (let index = 0; index < steamCount; index += 1) {
      const phase = (time * 0.025 * motionScale + index * 31) % 130;
      const steamX =
        this.#viewportWidth * 0.5 + 96 + Math.sin(index * 1.7) * 16;
      const steamY = this.#topHeight - 35 - phase;
      graphics.fillStyle(COLORS.smoke, 0.34 * (1 - phase / 150));
      graphics.fillCircle(steamX, steamY, 7 + phase * 0.06);
    }

    if (this.#recipeBubbleVisible) {
      const bubble = this.#getRecipeBubblePosition();
      graphics.fillStyle(COLORS.paper, 0.98);
      graphics.fillCircle(bubble.x, bubble.y, 52);
      graphics.lineStyle(3, COLORS.brass, 1);
      graphics.strokeCircle(bubble.x, bubble.y, 52);
      graphics.fillTriangle(
        bubble.x - 8,
        bubble.y + 47,
        bubble.x + 13,
        bubble.y + 47,
        bubble.x,
        bubble.y + 66,
      );
    }
  }

  #drawMerchantShip(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
  ): void {
    graphics.fillStyle(0x718a84, 0.82);
    graphics.fillEllipse(x, y - 24, 142, 52);
    graphics.lineStyle(2, COLORS.wood, 0.85);
    graphics.strokeEllipse(x, y - 24, 142, 52);
    graphics.fillStyle(0xa65c3c, 0.9);
    graphics.fillRoundedRect(x - 55, y + 8, 110, 28, 5);
    graphics.lineStyle(2, COLORS.wood, 0.9);
    graphics.strokeRoundedRect(x - 55, y + 8, 110, 28, 5);
    graphics.lineBetween(x - 42, y - 7, x - 34, y + 8);
    graphics.lineBetween(x + 42, y - 7, x + 34, y + 8);
  }

  #drawCompanion(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
  ): void {
    graphics.fillStyle(0x7e4e3d, 0.96);
    graphics.fillRoundedRect(x - 47, y - 20, 94, 40, 10);
    graphics.lineStyle(2, COLORS.wood, 1);
    graphics.strokeRoundedRect(x - 47, y - 20, 94, 40, 10);
    graphics.fillStyle(0xf0c36e, 1);
    graphics.fillCircle(x - 16, y, 8);
    graphics.fillCircle(x + 16, y, 8);
    graphics.fillStyle(COLORS.smoke, 0.9);
    graphics.fillCircle(x + 44, y - 24, 8);
    graphics.fillCircle(x + 53, y - 35, 6);
  }

  #getRecipeBubblePosition(): Phaser.Math.Vector2 {
    const middleTop = this.#topHeight;
    const middleBottom = this.#viewportHeight - this.#bottomHeight;
    const middleHeight = middleBottom - middleTop;
    return new Phaser.Math.Vector2(
      this.#viewportWidth * 0.52,
      middleTop + middleHeight * 0.62 - 92,
    );
  }

  #showRecipeBubble(): void {
    this.#recipeBubbleVisible = true;
    this.#bubbleText.setVisible(true);
    this.#restaurantStatusText.setText(
      "中央出现了临时食谱气泡：气泡可点击，周围角色和飞艇仍然穿透",
    );
    this.#reportTestPoints();
  }

  #hideRecipeBubble(): void {
    this.#recipeBubbleVisible = false;
    this.#bubbleText.setVisible(false);
    this.#hitMap.remove("recipe-bubble");
    this.#routeCursor(this.#cursor);
    this.time.delayedCall(6500, () => this.#showRecipeBubble());
  }

  #routeCursor(point: DesktopPoint): void {
    this.#cursor = point;
    const hit = point.inside
      ? this.#hitMap.hitTest(point.x, point.y)
      : null;
    const interactive = this.#inputLock || hit !== null;
    const reason = this.#inputLock ? "input-lock" : (hit?.id ?? "desktop");
    this.#hoveredZoneId = reason;

    if (
      interactive === this.#lastInteractive &&
      reason === this.#lastInteractionReason
    ) {
      return;
    }

    this.#lastInteractive = interactive;
    this.#lastInteractionReason = reason;
    if (window.desktopShell) {
      window.desktopShell.setInteractive(interactive, reason);
    } else {
      this.#inputStatusText.setText(
        interactive
          ? `输入状态：浏览器交互 · ${reason}`
          : `输入状态：浏览器模拟穿透 · ${reason}`,
      );
    }
  }

  #handlePointerDown(x: number, y: number): void {
    const zone = this.#hitMap.hitTest(x, y);
    if (!zone) {
      return;
    }

    this.#inputLock = true;
    this.#routeCursor(this.#cursor);

    switch (zone.id as ButtonKey | "recipe-bubble") {
      case "quiet-button":
        this.#quietMode = !this.#quietMode;
        this.#buttonTexts
          .get("quiet-button")
          ?.setText(this.#quietMode ? "恢复活动" : "安静模式");
        break;
      case "pin-button":
        this.#alwaysOnTop = !this.#alwaysOnTop;
        this.#buttonTexts
          .get("pin-button")
          ?.setText(this.#alwaysOnTop ? "置顶：开" : "置顶：关");
        window.desktopShell?.setAlwaysOnTop(this.#alwaysOnTop);
        break;
      case "debug-button":
        this.#showDebugZones = !this.#showDebugZones;
        this.#buttonTexts
          .get("debug-button")
          ?.setText(this.#showDebugZones ? "隐藏热区" : "显示热区");
        break;
      case "quit-button":
        window.desktopShell?.quit();
        break;
      case "restaurant-test":
        this.#servedCount += 1;
        this.#restaurantStatusText.setText(
          `底部输入正常 · 已完成 ${this.#servedCount} 次测试`,
        );
        break;
      case "recipe-bubble":
        this.#servedCount += 1;
        this.#restaurantStatusText.setText(
          `食谱气泡输入正常 · 已记录 ${this.#servedCount} 次互动`,
        );
        this.#hideRecipeBubble();
        break;
      default:
        break;
    }
  }

  #releaseInputLock(): void {
    if (!this.#inputLock) {
      return;
    }
    this.#inputLock = false;
    this.#routeCursor(this.#cursor);
  }

  #drawDebugZones(): void {
    const graphics = this.#debugGraphics;
    graphics.clear();
    if (!this.#showDebugZones) {
      return;
    }

    for (const zone of this.#hitMap.snapshot()) {
      const hovered = zone.id === this.#hoveredZoneId;
      graphics.fillStyle(hovered ? 0x63c174 : 0xe6a141, hovered ? 0.24 : 0.13);
      graphics.lineStyle(2, hovered ? 0x2f9e44 : 0xc97816, 0.9);
      if (zone.kind === "circle") {
        graphics.fillCircle(zone.x, zone.y, zone.radius);
        graphics.strokeCircle(zone.x, zone.y, zone.radius);
      } else {
        graphics.fillRect(zone.x, zone.y, zone.width, zone.height);
        graphics.strokeRect(zone.x, zone.y, zone.width, zone.height);
      }
    }
  }

  #updateMetrics(metrics: DesktopMetrics): void {
    const totalWorkingSetKb = metrics.processes.reduce(
      (total, processMetric) => total + processMetric.workingSetKb,
      0,
    );
    const totalCpu = metrics.processes.reduce(
      (total, processMetric) => total + processMetric.cpuPercent,
      0,
    );
    this.#metricsText.setText(
      `资源：${(totalWorkingSetKb / 1024).toFixed(0)} MB · ` +
        `CPU ${totalCpu.toFixed(1)}% · ${metrics.processes.length} 个进程`,
    );
  }

  #reportTestPoints(): void {
    const bridge = window.desktopShell;
    if (!bridge) {
      return;
    }
    const middleTop = this.#topHeight;
    const middleBottom = this.#viewportHeight - this.#bottomHeight;
    const middleHeight = middleBottom - middleTop;
    const bubble = this.#getRecipeBubblePosition();
    bridge.reportTestPoints({
      topInteractive: { x: 40, y: 40 },
      companionPassthrough: {
        x: this.#viewportWidth * 0.52,
        y: middleTop + middleHeight * 0.62,
      },
      bubbleInteractive: { x: bubble.x, y: bubble.y },
    });
  }
}
