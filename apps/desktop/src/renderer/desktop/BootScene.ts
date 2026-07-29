import Phaser from "phaser";
import { DESKTOP_SCENE_KEYS } from "./scene-contracts";

export class BootScene extends Phaser.Scene {
  constructor() {
    super(DESKTOP_SCENE_KEYS.boot);
  }

  create(): void {
    this.scene.launch(DESKTOP_SCENE_KEYS.environment);
    this.scene.launch(DESKTOP_SCENE_KEYS.world);
    this.scene.launch(DESKTOP_SCENE_KEYS.ui);

    if (import.meta.env.DEV) {
      this.scene.launch(DESKTOP_SCENE_KEYS.interactionDebug);
    }

    this.scene.stop();
  }
}
