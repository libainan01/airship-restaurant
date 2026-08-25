import Phaser from "phaser";
import type { DesktopWorldLayout } from "./desktop-world-layout";
import { WORLD_ARTWORK_TEXTURES } from "./world-artwork-assets";

export class DesktopWorldArtworkRenderer {
  readonly #airship: Phaser.GameObjects.Image;
  readonly #restaurant: Phaser.GameObjects.Image;
  readonly #cargoLift: Phaser.GameObjects.Image;
  #airshipBaseY = 0;

  constructor(scene: Phaser.Scene) {
    this.#restaurant = scene.add
      .image(0, 0, WORLD_ARTWORK_TEXTURES.restaurant)
      .setOrigin(0, 0)
      .setDepth(1);
    this.#airship = scene.add
      .image(0, 0, WORLD_ARTWORK_TEXTURES.airship)
      .setOrigin(0.5, 0)
      .setDepth(2);
    this.#cargoLift = scene.add
      .image(0, 0, WORLD_ARTWORK_TEXTURES.cargoLift)
      .setOrigin(0.5, 0.12)
      .setDepth(6);

    for (const image of [this.#restaurant, this.#airship, this.#cargoLift]) {
      image.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  applyLayout(layout: DesktopWorldLayout): void {
    this.#airshipBaseY = layout.airshipTop;
    this.#airship
      .setPosition(layout.airshipCenterX, layout.airshipTop)
      .setDisplaySize(layout.airshipWidth, layout.airshipHeight);
    this.#restaurant
      .setPosition(layout.restaurantArtworkX, layout.restaurantArtworkY)
      .setDisplaySize(
        layout.restaurantArtworkWidth,
        layout.restaurantArtworkHeight,
      );

    const cargoHeight = Math.min(
      82,
      Math.max(62, layout.restaurantHeight * 0.44),
    );
    this.#cargoLift.setDisplaySize(cargoHeight * (556 / 1003), cargoHeight);
  }

  update(timeMs: number, motionScale: number): void {
    const bob = Math.sin(timeMs * 0.0015) * 3 * motionScale;
    this.#airship.setY(this.#airshipBaseY + bob);
  }

  setCargoTrackPoint(x: number, y: number): void {
    this.#cargoLift.setPosition(x, y);
  }

  destroy(): void {
    this.#airship.destroy();
    this.#restaurant.destroy();
    this.#cargoLift.destroy();
  }
}
