import type Phaser from "phaser";
import type { RestaurantLayoutRuntime } from "./restaurant-layout";

export interface RestaurantOutdoorColors {
  readonly ink: number;
  readonly wood: number;
  readonly woodDark: number;
  readonly brassLight: number;
  readonly creamLight: number;
  readonly glow: number;
}

export class RestaurantOutdoorRenderer {
  readonly #colors: RestaurantOutdoorColors;
  readonly #layout: RestaurantLayoutRuntime;

  constructor(
    colors: RestaurantOutdoorColors,
    layout: RestaurantLayoutRuntime,
  ) {
    this.#colors = colors;
    this.#layout = layout;
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    metrics: {
      readonly x: number;
      readonly width: number;
      readonly y: number;
      readonly height: number;
      readonly hovered: boolean;
    },
  ): void {
    const colors = this.#colors;
    for (const table of this.#layout.getProps("table")) {
      const x = metrics.x + table.transform.xRatio * metrics.width;
      const y = metrics.y + table.transform.yRatio * metrics.height;

      graphics.fillStyle(colors.ink, 0.14);
      graphics.fillEllipse(x, y + 13, 84, 16);
      graphics.fillStyle(colors.wood, 0.92);
      graphics.fillRoundedRect(x - 38, y - 6, 76, 13, 4);
      graphics.lineStyle(2, colors.woodDark, 0.95);
      graphics.strokeRoundedRect(x - 38, y - 6, 76, 13, 4);
      graphics.lineBetween(x - 22, y + 6, x - 26, y + 24);
      graphics.lineBetween(x + 22, y + 6, x + 26, y + 24);

      graphics.fillStyle(colors.woodDark, 0.9);
      graphics.fillRoundedRect(x - 48, y + 2, 15, 20, 4);
      graphics.fillRoundedRect(x + 33, y + 2, 15, 20, 4);
      graphics.fillStyle(colors.creamLight, 0.94);
      graphics.fillCircle(x, y - 8, 4);

      if (metrics.hovered) {
        graphics.lineStyle(2, colors.glow, 0.56);
        graphics.strokeEllipse(x, y + 7, 92, 34);
      }
    }
  }
}
