import Phaser from "phaser";
import {
  DESKTOP_EVENTS,
  DESKTOP_REGISTRY_KEYS,
  DESKTOP_SCENE_KEYS,
  type DesktopDebugSnapshot,
} from "./scene-contracts";

const FONT_FAMILY =
  '"Cascadia Mono", "Microsoft YaHei UI", monospace';

export class InteractionDebugScene extends Phaser.Scene {
  #graphics!: Phaser.GameObjects.Graphics;
  #status!: Phaser.GameObjects.Text;

  constructor() {
    super(DESKTOP_SCENE_KEYS.interactionDebug);
  }

  create(): void {
    this.#graphics = this.add.graphics().setDepth(200);
    this.#status = this.add
      .text(12, 48, "", {
        backgroundColor: "#1f2529dd",
        color: "#9ee8df",
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        padding: { x: 8, y: 6 },
      })
      .setDepth(201);
    this.game.events.on(
      DESKTOP_EVENTS.debugSnapshotChanged,
      this.#drawSnapshot,
      this,
    );
    const snapshot = this.registry.get(
      DESKTOP_REGISTRY_KEYS.debugSnapshot,
    ) as DesktopDebugSnapshot | undefined;
    if (snapshot !== undefined) {
      this.#drawSnapshot(snapshot);
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(
        DESKTOP_EVENTS.debugSnapshotChanged,
        this.#drawSnapshot,
        this,
      );
    });
  }

  readonly #drawSnapshot = (snapshot: DesktopDebugSnapshot): void => {
    const graphics = this.#graphics;
    graphics.clear();
    graphics.lineStyle(2, 0x50e3c2, 0.9);
    const firstPoint = snapshot.airshipHitPoints[0];
    if (firstPoint !== undefined) {
      graphics.beginPath();
      graphics.moveTo(firstPoint.x, firstPoint.y);
      for (const point of snapshot.airshipHitPoints.slice(1)) {
        graphics.lineTo(point.x, point.y);
      }
      graphics.closePath();
      graphics.strokePath();
    }
    graphics.lineStyle(2, 0xffcc66, 0.82);
    graphics.strokeRect(
      snapshot.restaurantBounds.x,
      snapshot.restaurantBounds.y,
      snapshot.restaurantBounds.width,
      snapshot.restaurantBounds.height,
    );
    graphics.fillStyle(
      snapshot.interactive ? 0x50e3c2 : 0xe26363,
      0.95,
    );
    graphics.fillCircle(snapshot.cursor.x, snapshot.cursor.y, 5);

    this.#status.setText(
      [
        `DIP ${Math.round(snapshot.cursor.x)}, ${Math.round(snapshot.cursor.y)}`,
        `hit: ${snapshot.hoveredZoneId ?? "desktop"}`,
        `input: ${snapshot.interactive ? "INTERACTIVE" : "PASS_THROUGH"}`,
        `reason: ${snapshot.interactionReason}`,
      ].join("\n"),
    );
  };
}
