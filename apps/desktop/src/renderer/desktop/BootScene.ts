import Phaser from "phaser";
import { DESKTOP_SCENE_KEYS } from "./scene-contracts";
import { WORLD_ARTWORK_ASSETS } from "./world-artwork-assets";

export class BootScene extends Phaser.Scene {
  constructor() {
    super(DESKTOP_SCENE_KEYS.boot);
  }

  preload(): void {
    for (const asset of WORLD_ARTWORK_ASSETS) {
      this.load.image(asset.key, asset.url);
    }
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
