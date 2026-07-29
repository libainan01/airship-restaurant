import type { AppSettingsSnapshot } from "@airship-restaurant/contracts";
import Phaser from "phaser";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_EVENTS,
  DESKTOP_REGISTRY_KEYS,
  DESKTOP_SCENE_KEYS,
} from "./scene-contracts";

interface Cloud {
  readonly yRatio: number;
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
}

const CLOUDS: readonly Cloud[] = [
  { yRatio: 0.31, radius: 19, speed: 0.007, phase: 0.1 },
  { yRatio: 0.47, radius: 14, speed: 0.005, phase: 0.55 },
  { yRatio: 0.63, radius: 23, speed: 0.0035, phase: 0.82 },
];

export class EnvironmentScene extends Phaser.Scene {
  #graphics!: Phaser.GameObjects.Graphics;
  #settings = DEFAULT_DESKTOP_SETTINGS;

  constructor() {
    super(DESKTOP_SCENE_KEYS.environment);
  }

  create(): void {
    this.#graphics = this.add.graphics();
    this.#settings =
      this.registry.get(DESKTOP_REGISTRY_KEYS.settings) ??
      DEFAULT_DESKTOP_SETTINGS;
    this.game.events.on(
      DESKTOP_EVENTS.settingsChanged,
      this.#handleSettingsChanged,
      this,
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(
        DESKTOP_EVENTS.settingsChanged,
        this.#handleSettingsChanged,
        this,
      );
    });
  }

  override update(time: number): void {
    this.#graphics.clear();
    const motionScale =
      this.#settings.presentationMode === "reduced" ? 0.45 : 1;

    for (const cloud of CLOUDS) {
      const travelWidth = this.scale.width + cloud.radius * 6;
      const x =
        ((time * cloud.speed * motionScale +
          travelWidth * cloud.phase) %
          travelWidth) -
        cloud.radius * 3;
      const y = this.scale.height * cloud.yRatio;
      this.#graphics.fillStyle(0xeee3d5, 0.16);
      this.#graphics.fillCircle(x, y, cloud.radius);
      this.#graphics.fillCircle(
        x + cloud.radius * 0.8,
        y + 3,
        cloud.radius * 0.72,
      );
      this.#graphics.fillCircle(
        x - cloud.radius * 0.78,
        y + 5,
        cloud.radius * 0.6,
      );
    }
  }

  readonly #handleSettingsChanged = (
    settings: AppSettingsSnapshot,
  ): void => {
    this.#settings = settings;
    if (settings.presentationMode === "quiet") {
      this.scene.sleep();
      this.#graphics.clear();
      return;
    }

    if (this.scene.isSleeping(DESKTOP_SCENE_KEYS.environment)) {
      this.scene.wake(DESKTOP_SCENE_KEYS.environment);
    }
  };
}
