import type Phaser from "phaser";
import type {
  RestaurantLayoutPropInstance,
  RestaurantLayoutRuntime,
} from "./restaurant-layout";

export interface RestaurantStaticColors {
  readonly ink: number;
  readonly restaurantWall: number;
  readonly restaurantFloor: number;
  readonly copper: number;
  readonly creamLight: number;
  readonly glow: number;
  readonly wood: number;
  readonly woodDark: number;
  readonly brassLight: number;
}

export interface RestaurantStaticMetrics {
  readonly viewportWidth: number;
  readonly restaurantY: number;
  readonly restaurantHeight: number;
}

export interface RestaurantPropBounds {
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function resolveRestaurantPropBounds(
  prop: RestaurantLayoutPropInstance,
  metrics: RestaurantStaticMetrics,
): RestaurantPropBounds {
  const width =
    (prop.dimensions.widthRatio ?? 0) * metrics.viewportWidth +
    (prop.dimensions.widthPx ?? 0) +
    (prop.dimensions.widthOffsetPx ?? 0);
  const height =
    (prop.dimensions.heightRatio ?? 0) * metrics.restaurantHeight +
    (prop.dimensions.heightPx ?? 0) +
    (prop.dimensions.heightOffsetPx ?? 0);
  const x =
    prop.transform.xRatio * metrics.viewportWidth +
    (prop.transform.offsetXPx ?? 0);
  const y =
    metrics.restaurantY +
    prop.transform.yRatio * metrics.restaurantHeight +
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

export class RestaurantStaticRenderer {
  readonly #colors: RestaurantStaticColors;
  readonly #layout: RestaurantLayoutRuntime;

  constructor(
    colors: RestaurantStaticColors,
    layout: RestaurantLayoutRuntime,
  ) {
    this.#colors = colors;
    this.#layout = layout;
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    metrics: RestaurantStaticMetrics & { readonly hovered: boolean },
  ): void {
    const colors = this.#colors;
    const y = metrics.restaurantY;
    const width = metrics.viewportWidth;
    const height = metrics.restaurantHeight;

    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillRect(0, y - 5, width, height + 5);
    graphics.fillStyle(colors.restaurantWall, 0.98);
    graphics.fillRect(0, y, width, height);
    graphics.fillStyle(colors.restaurantFloor, 1);
    graphics.fillRect(0, y + height * 0.72, width, height * 0.28);

    const awningHeight = 28;
    const stripeWidth = 54;
    const stripeCount = Math.ceil(width / stripeWidth);
    for (let index = 0; index < stripeCount; index += 1) {
      graphics.fillStyle(
        index % 2 === 0 ? colors.copper : colors.creamLight,
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
      metrics.hovered ? 4 : 3,
      metrics.hovered ? colors.glow : colors.woodDark,
      1,
    );
    graphics.lineBetween(0, y, width, y);
    graphics.lineBetween(0, y + height - 2, width, y + height - 2);

    for (const prop of this.#layout.getProps()) {
      if (prop.renderLayer !== "lighting") {
        this.#drawProp(graphics, prop, metrics);
      }
    }

    if (metrics.hovered) {
      graphics.lineStyle(3, colors.glow, 0.74);
      graphics.strokeRect(2, y + 2, width - 4, height - 4);
    }
  }

  #drawProp(
    graphics: Phaser.GameObjects.Graphics,
    prop: RestaurantLayoutPropInstance,
    metrics: RestaurantStaticMetrics,
  ): void {
    const colors = this.#colors;
    const bounds = resolveRestaurantPropBounds(prop, metrics);
    switch (prop.kind) {
      case "pillar":
        graphics.fillStyle(colors.wood, 0.95);
        graphics.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
        break;
      case "window":
        graphics.fillStyle(colors.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          8,
        );
        graphics.fillStyle(colors.glow, 0.86);
        graphics.fillRoundedRect(
          bounds.left + 7,
          bounds.top + 7,
          Math.max(0, bounds.width - 14),
          Math.max(0, bounds.height - 14),
          5,
        );
        graphics.lineStyle(2, colors.wood, 0.9);
        graphics.lineBetween(
          bounds.x,
          bounds.top + 7,
          bounds.x,
          bounds.top + bounds.height - 7,
        );
        break;
      case "table":
        graphics.fillStyle(colors.wood, 0.9);
        graphics.fillRoundedRect(bounds.x - 30, bounds.top - 13, 20, 23, 5);
        graphics.fillRoundedRect(bounds.x + 10, bounds.top - 13, 20, 23, 5);
        graphics.fillStyle(colors.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          6,
        );
        graphics.fillRect(bounds.x - 4, bounds.top + bounds.height - 1, 8, 24);
        graphics.fillStyle(colors.creamLight, 1);
        graphics.fillCircle(bounds.x, bounds.top - 4, 5);
        break;
      case "counter":
        graphics.fillStyle(colors.woodDark, 1);
        graphics.fillRoundedRect(
          bounds.left,
          bounds.top,
          bounds.width,
          bounds.height,
          8,
        );
        graphics.fillStyle(colors.brassLight, 1);
        graphics.fillRect(
          bounds.left + 11,
          bounds.top + bounds.height * 0.14,
          Math.max(0, bounds.width - 22),
          7,
        );
        graphics.fillStyle(colors.creamLight, 1);
        graphics.fillCircle(bounds.x - 38, bounds.top + bounds.height * 0.38, 8);
        graphics.fillCircle(bounds.x - 8, bounds.top + bounds.height * 0.38, 8);

        // The recipe book and pantry doors are functional props, not overlay UI.
        graphics.fillStyle(colors.copper, 1);
        graphics.fillRoundedRect(bounds.left + 13, bounds.top - 9, 46, 18, 4);
        graphics.lineStyle(2, colors.brassLight, 0.95);
        graphics.lineBetween(
          bounds.left + 36,
          bounds.top - 7,
          bounds.left + 36,
          bounds.top + 7,
        );
        graphics.fillStyle(colors.wood, 0.96);
        graphics.fillRoundedRect(
          bounds.left + 81,
          bounds.top + 18,
          Math.max(0, bounds.width - 88),
          Math.max(0, bounds.height - 25),
          5,
        );
        graphics.lineStyle(2, colors.brassLight, 0.78);
        graphics.strokeRoundedRect(
          bounds.left + 81,
          bounds.top + 18,
          Math.max(0, bounds.width - 88),
          Math.max(0, bounds.height - 25),
          5,
        );
        graphics.fillStyle(colors.brassLight, 1);
        graphics.fillCircle(
          bounds.left + 89,
          bounds.top + bounds.height * 0.58,
          2,
        );
        break;
      case "lamp":
        break;
    }
  }
}
