import type Phaser from "phaser";
import type { CablePoint } from "./cable-route";
import type { HitPoint } from "./semantic-hit-map";

export interface AirshipStaticColors {
  readonly ink: number;
  readonly cream: number;
  readonly creamLight: number;
  readonly brass: number;
  readonly brassLight: number;
  readonly copper: number;
  readonly copperLight: number;
  readonly wood: number;
  readonly woodDark: number;
  readonly teal: number;
  readonly glass: number;
  readonly glow: number;
}

export interface AirshipGeometry {
  readonly centerX: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface GroundExchangeStationBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly bodyTop: number;
  readonly bottom: number;
}

export function resolveGroundExchangeStationBounds(options: {
  readonly x: number;
  readonly restaurantY: number;
}): GroundExchangeStationBounds {
  const width = 92;
  const bodyTop = options.restaurantY + 2;
  const bottom = options.restaurantY + 48;
  const top = bodyTop - 20;
  return {
    left: options.x - width / 2,
    top,
    width,
    height: bottom - top,
    bodyTop,
    bottom,
  };
}

export function createAirshipHitPoints(
  geometry: AirshipGeometry,
): readonly HitPoint[] {
  const x = geometry.centerX;
  const y = geometry.top;
  const halfWidth = geometry.width / 2;
  const height = geometry.height;
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

export class AirshipStaticRenderer {
  readonly #colors: AirshipStaticColors;

  constructor(colors: AirshipStaticColors) {
    this.#colors = colors;
  }

  drawAirship(
    graphics: Phaser.GameObjects.Graphics,
    options: AirshipGeometry & {
      readonly hovered: boolean;
      readonly hitPoints: readonly HitPoint[];
    },
  ): void {
    const colors = this.#colors;
    const x = options.centerX;
    const y = options.top;
    const width = options.width;
    const height = options.height;

    graphics.fillStyle(colors.ink, 0.14);
    graphics.fillEllipse(
      x + 8,
      y + height * 0.56,
      width * 0.88,
      height * 0.52,
    );
    graphics.fillStyle(
      options.hovered ? colors.creamLight : colors.cream,
      0.98,
    );
    graphics.fillEllipse(x, y + height * 0.3, width * 0.9, height * 0.56);
    graphics.lineStyle(
      options.hovered ? 4 : 3,
      options.hovered ? colors.brassLight : colors.wood,
      1,
    );
    graphics.strokeEllipse(x, y + height * 0.3, width * 0.9, height * 0.56);

    graphics.fillStyle(colors.copper, 0.96);
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

    graphics.lineStyle(3, colors.brass, 0.84);
    for (const offset of [-0.24, -0.08, 0.08, 0.24]) {
      const bandX = x + width * offset;
      const distance = Math.abs(offset) / 0.24;
      const top = y + height * (0.035 + distance * 0.055);
      const bottom = y + height * (0.565 - distance * 0.055);
      graphics.lineBetween(bandX, top, bandX, bottom);
    }

    graphics.fillStyle(colors.copperLight, 1);
    graphics.fillRoundedRect(
      x - width * 0.26,
      y + height * 0.57,
      width * 0.52,
      height * 0.3,
      12,
    );
    graphics.lineStyle(3, colors.woodDark, 1);
    graphics.strokeRoundedRect(
      x - width * 0.26,
      y + height * 0.57,
      width * 0.52,
      height * 0.3,
      12,
    );
    graphics.fillStyle(colors.wood, 1);
    graphics.fillTriangle(
      x + width * 0.26,
      y + height * 0.62,
      x + width * 0.36,
      y + height * 0.73,
      x + width * 0.26,
      y + height * 0.84,
    );
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillRoundedRect(
      x - width * 0.23,
      y + height * 0.83,
      width * 0.47,
      8,
      4,
    );

    graphics.lineStyle(2, colors.wood, 0.9);
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
      graphics.fillStyle(colors.teal, 1);
      graphics.fillCircle(x + width * offset, y + height * 0.7, 13);
      graphics.fillStyle(colors.glass, 0.95);
      graphics.fillCircle(
        x + width * offset - 2,
        y + height * 0.68,
        7,
      );
      graphics.lineStyle(2, colors.woodDark, 1);
      graphics.strokeCircle(x + width * offset, y + height * 0.7, 13);
    }

    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillRect(
      x + width * 0.18,
      y + height * 0.48,
      14,
      height * 0.11,
    );
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRoundedRect(
      x + width * 0.17,
      y + height * 0.45,
      28,
      10,
      4,
    );

    if (options.hovered) {
      graphics.lineStyle(3, colors.glow, 0.92);
      this.#strokePolygon(graphics, options.hitPoints);
    }
  }

  drawStations(
    graphics: Phaser.GameObjects.Graphics,
    options: {
      readonly airshipExchangePoint: CablePoint;
      readonly groundExchangePoint: CablePoint;
      readonly restaurantY: number;
      readonly restaurantHeight: number;
    },
  ): void {
    this.#drawAirshipExchangeStation(
      graphics,
      options.airshipExchangePoint,
    );
    this.#drawGroundExchangeStation(graphics, options);
    this.#drawPortPlaceholder(graphics, options.restaurantY);
  }

  #drawAirshipExchangeStation(
    graphics: Phaser.GameObjects.Graphics,
    point: CablePoint,
  ): void {
    const colors = this.#colors;
    const { x, y } = point;
    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillRoundedRect(x - 72, y - 19, 72, 42, 8);
    graphics.fillStyle(colors.wood, 1);
    graphics.fillRoundedRect(x - 75, y - 23, 72, 40, 8);
    graphics.lineStyle(3, colors.woodDark, 1);
    graphics.strokeRoundedRect(x - 75, y - 23, 72, 40, 8);
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRect(x - 80, y + 13, 92, 8);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillTriangle(x - 68, y + 21, x - 53, y + 21, x - 60, y + 35);
    graphics.fillTriangle(x - 12, y + 21, x + 3, y + 21, x - 5, y + 35);
    graphics.fillStyle(colors.copperLight, 1);
    graphics.fillRoundedRect(x - 62, y - 13, 22, 24, 4);
    graphics.fillStyle(colors.cream, 1);
    graphics.fillRoundedRect(x - 35, y - 10, 20, 21, 4);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillRoundedRect(x - 17, y - 17, 34, 35, 5);
    graphics.lineStyle(3, colors.brassLight, 1);
    graphics.strokeRoundedRect(x - 17, y - 17, 34, 35, 5);
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRoundedRect(x - 22, y - 11, 5, 23, 2);
    graphics.fillRoundedRect(x + 17, y - 11, 5, 23, 2);
    graphics.fillStyle(colors.ink, 1);
    graphics.fillCircle(x - 20, y, 2);
    graphics.fillCircle(x + 20, y, 2);
  }

  #drawGroundExchangeStation(
    graphics: Phaser.GameObjects.Graphics,
    options: {
      readonly groundExchangePoint: CablePoint;
      readonly restaurantY: number;
      readonly restaurantHeight: number;
    },
  ): void {
    const colors = this.#colors;
    const { x, y } = options.groundExchangePoint;
    const bounds = resolveGroundExchangeStationBounds({
      x,
      restaurantY: options.restaurantY,
    });
    const bodyHeight = bounds.bottom - bounds.bodyTop;

    graphics.lineStyle(6, colors.woodDark, 1);
    graphics.lineBetween(x, y + 8, x, bounds.bottom);
    graphics.lineStyle(2, colors.brass, 1);
    graphics.lineBetween(x, y + 8, x, bounds.bottom);
    graphics.lineBetween(x, y + 22, bounds.left + 12, bounds.bodyTop + 9);
    graphics.lineBetween(
      x,
      y + 22,
      bounds.left + bounds.width - 12,
      bounds.bodyTop + 9,
    );

    graphics.fillStyle(colors.ink, 0.14);
    graphics.fillRoundedRect(
      bounds.left + 2,
      bounds.bodyTop + 4,
      bounds.width,
      bodyHeight,
      7,
    );
    graphics.fillStyle(colors.cream, 1);
    graphics.fillRoundedRect(
      bounds.left,
      bounds.bodyTop,
      bounds.width,
      bodyHeight,
      7,
    );
    graphics.lineStyle(2, colors.woodDark, 1);
    graphics.strokeRoundedRect(
      bounds.left,
      bounds.bodyTop,
      bounds.width,
      bodyHeight,
      7,
    );
    graphics.fillStyle(colors.copper, 1);
    graphics.fillTriangle(
      bounds.left - 6,
      bounds.bodyTop + 4,
      bounds.left + bounds.width + 6,
      bounds.bodyTop + 4,
      x,
      bounds.top,
    );
    graphics.fillStyle(colors.teal, 1);
    graphics.fillRoundedRect(
      bounds.left + 11,
      bounds.bodyTop + 18,
      23,
      19,
      4,
    );
    graphics.fillStyle(colors.glass, 1);
    graphics.fillRoundedRect(
      bounds.left + 41,
      bounds.bodyTop + 17,
      20,
      16,
      4,
    );
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRoundedRect(
      bounds.left + 68,
      bounds.bodyTop + 18,
      13,
      28,
      3,
    );
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillCircle(x, y, 11);
    graphics.fillStyle(colors.brassLight, 1);
    graphics.fillCircle(x, y, 6);
    graphics.fillStyle(colors.ink, 1);
    graphics.fillCircle(x, y, 2);
  }

  #drawPortPlaceholder(
    graphics: Phaser.GameObjects.Graphics,
    restaurantY: number,
  ): void {
    const colors = this.#colors;
    const y = restaurantY - 18;
    graphics.fillStyle(colors.ink, 0.2);
    graphics.fillRoundedRect(12, y - 38, 152, 38, 8);
    graphics.lineStyle(2, colors.brass, 0.5);
    graphics.strokeRoundedRect(12, y - 38, 152, 38, 8);
    graphics.lineBetween(26, y - 38, 26, y - 68);
    graphics.lineBetween(26, y - 68, 62, y - 57);
    graphics.fillStyle(colors.copperLight, 0.42);
    graphics.fillTriangle(27, y - 67, 61, y - 57, 27, y - 50);
  }

  #strokePolygon(
    graphics: Phaser.GameObjects.Graphics,
    points: readonly HitPoint[],
  ): void {
    const first = points[0];
    if (first === undefined) return;
    graphics.beginPath();
    graphics.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.closePath();
    graphics.strokePath();
  }
}
