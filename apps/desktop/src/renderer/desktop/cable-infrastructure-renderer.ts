import type Phaser from "phaser";
import {
  createEdgeCableRoute,
  sampleCableRoute,
  type CablePoint,
  type CableRoute,
} from "./cable-route";

export interface CableInfrastructureColors {
  readonly ink: number;
  readonly wood: number;
  readonly woodDark: number;
  readonly brass: number;
  readonly brassLight: number;
}

export function resolveCableInfrastructureRoute(options: {
  readonly airshipTrackPoint: CablePoint;
  readonly groundExchangePoint: CablePoint;
  readonly transportEdgeX: number;
}): CableRoute {
  return createEdgeCableRoute(
    options.airshipTrackPoint,
    options.groundExchangePoint,
    options.transportEdgeX,
  );
}

export class CableInfrastructureRenderer {
  readonly #colors: CableInfrastructureColors;

  constructor(colors: CableInfrastructureColors) {
    this.#colors = colors;
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    options: {
      readonly airshipTrackPoint: CablePoint;
      readonly groundExchangePoint: CablePoint;
      readonly transportEdgeX: number;
    },
  ): CableRoute {
    graphics.clear();
    const route = resolveCableInfrastructureRoute(options);
    const colors = this.#colors;

    graphics.lineStyle(8, colors.woodDark, 0.2);
    this.#drawCableLine(graphics, route, 0);
    graphics.lineStyle(2, colors.brass, 0.92);
    this.#drawCableLine(graphics, route, -5);
    this.#drawCableLine(graphics, route, 5);

    for (let index = 1; index < 10; index += 1) {
      const left = sampleCableRoute(route, index / 10, -7);
      const right = sampleCableRoute(route, index / 10, 7);
      graphics.lineStyle(2, colors.wood, 0.7);
      graphics.lineBetween(left.x, left.y, right.x, right.y);
    }

    for (const [index, point] of route.points.entries()) {
      const isStation =
        index === 0 || index === route.points.length - 1;
      graphics.fillStyle(colors.woodDark, 0.96);
      graphics.fillCircle(point.x, point.y, isStation ? 15 : 12);
      graphics.fillStyle(colors.brassLight, 1);
      graphics.fillCircle(point.x, point.y, isStation ? 8 : 7);
      graphics.fillStyle(colors.ink, 1);
      graphics.fillCircle(point.x, point.y, 3);
    }
    return route;
  }

  #drawCableLine(
    graphics: Phaser.GameObjects.Graphics,
    route: CableRoute,
    trackOffset: number,
  ): void {
    graphics.beginPath();
    for (const segment of route.segments) {
      graphics.moveTo(
        segment.start.x + segment.normal.x * trackOffset,
        segment.start.y + segment.normal.y * trackOffset,
      );
      graphics.lineTo(
        segment.end.x + segment.normal.x * trackOffset,
        segment.end.y + segment.normal.y * trackOffset,
      );
    }
    graphics.strokePath();
  }
}
