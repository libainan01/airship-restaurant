import type { GameplayLogisticsSnapshot } from "@airship-restaurant/contracts";
import type Phaser from "phaser";
import {
  CABLE_CARGO_OFFSET,
  sampleCableRoute,
  sampleCableTangent,
  type CableRoute,
} from "./cable-route";

export interface CableCarColors {
  readonly woodDark: number;
  readonly brassLight: number;
  readonly ink: number;
  readonly copper: number;
  readonly cream: number;
  readonly brass: number;
  readonly wood: number;
}

export interface CableCarPresentation {
  readonly progress: number;
  readonly isDescending: boolean;
  readonly status: string;
}

export interface CableCarDrawResult {
  readonly status: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly trackX: number;
  readonly trackY: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveCableCarPresentation(options: {
  readonly logistics: GameplayLogisticsSnapshot | undefined;
  readonly animationTimeMs: number;
  readonly motionScale: number;
  readonly nowUtcMs: number;
}): CableCarPresentation {
  const logistics = options.logistics;
  let progress: number;
  let isDescending: boolean;

  if (logistics === undefined) {
    const cycle =
      options.animationTimeMs * 0.00042 * options.motionScale;
    const cycleAngle = cycle * Math.PI * 2;
    progress = (Math.cos(cycleAngle) + 1) / 2;
    isDescending = Math.sin(cycleAngle) < 0;
  } else {
    switch (logistics.phase) {
      case "outbound": {
        const departure =
          logistics.departedAtUtcMs ?? options.nowUtcMs;
        const arrival = logistics.arriveAtUtcMs ?? departure;
        progress = clamp(
          (options.nowUtcMs - departure) /
            Math.max(1, arrival - departure),
          0,
          1,
        );
        isDescending = true;
        break;
      }
      case "waiting-unload":
        progress = 1;
        isDescending = true;
        break;
      case "returning": {
        const departure =
          logistics.returnStartedAtUtcMs ?? options.nowUtcMs;
        const arrival = logistics.returnAtUtcMs ?? departure;
        progress = 1 - clamp(
          (options.nowUtcMs - departure) /
            Math.max(1, arrival - departure),
          0,
          1,
        );
        isDescending = false;
        break;
      }
      case "idle":
        progress = 0;
        isDescending = false;
        break;
    }
  }

  let status: string;
  if (logistics === undefined) {
    status = isDescending
      ? "下行 · 热餐配送"
      : "上行 · 回收空箱";
    if (progress > 0.985) {
      status = "地面站 · 正在卸货";
    } else if (progress < 0.015) {
      status = "空中站 · 正在装货";
    }
  } else {
    switch (logistics.phase) {
      case "outbound":
        status = "配送中 · " + logistics.cargoQuantity + "/6 份";
        break;
      case "waiting-unload":
        status = "等待卸货 · " + logistics.cargoQuantity + "/6 份";
        break;
      case "returning":
        status = "空箱返航";
        break;
      case "idle":
        status = logistics.kitchenWaitingQuantity > 0
          ? "空中集货 · " +
              logistics.kitchenWaitingQuantity +
              " 份"
          : "空中站 · 待命";
        break;
    }
  }

  return { progress, isDescending, status };
}

export class CableCarRenderer {
  readonly #colors: CableCarColors;

  constructor(colors: CableCarColors) {
    this.#colors = colors;
  }

  draw(
    graphics: Phaser.GameObjects.Graphics,
    route: CableRoute,
    options: {
      readonly logistics: GameplayLogisticsSnapshot | undefined;
      readonly animationTimeMs: number;
      readonly motionScale: number;
      readonly nowUtcMs: number;
      readonly viewportWidth: number;
      readonly drawCabin?: boolean;
    },
  ): CableCarDrawResult {
    const presentation = resolveCableCarPresentation(options);
    const cablePoint = sampleCableRoute(
      route,
      presentation.progress,
    );
    const tangent = sampleCableTangent(
      route,
      presentation.progress,
    );
    const wheelSpacing = 19;
    const firstWheel = {
      x: cablePoint.x - tangent.x * wheelSpacing,
      y: cablePoint.y - tangent.y * wheelSpacing,
    };
    const secondWheel = {
      x: cablePoint.x + tangent.x * wheelSpacing,
      y: cablePoint.y + tangent.y * wheelSpacing,
    };
    const cabinX = cablePoint.x;
    const cabinY = cablePoint.y + CABLE_CARGO_OFFSET.y;
    const cabinTop = cabinY - 24;
    const cargoCenterX = cabinX + CABLE_CARGO_OFFSET.x;
    const colors = this.#colors;

    if (options.drawCabin !== false) {
      graphics.lineStyle(4, colors.woodDark, 1);
    graphics.lineBetween(
      firstWheel.x,
      firstWheel.y + 5,
      cabinX - 20,
      cabinTop + 2,
    );
    graphics.lineBetween(
      secondWheel.x,
      secondWheel.y + 5,
      cabinX + 20,
      cabinTop + 2,
    );

    graphics.fillStyle(colors.brassLight, 1);
    graphics.fillCircle(firstWheel.x, firstWheel.y, 8);
    graphics.fillCircle(secondWheel.x, secondWheel.y, 8);
    graphics.fillStyle(colors.woodDark, 1);
    graphics.fillCircle(firstWheel.x, firstWheel.y, 3);
    graphics.fillCircle(secondWheel.x, secondWheel.y, 3);

    graphics.fillStyle(colors.ink, 0.16);
    graphics.fillRoundedRect(
      cabinX - 35,
      cabinTop + 4,
      72,
      53,
      9,
    );
    graphics.fillStyle(colors.copper, 1);
    graphics.fillRoundedRect(
      cabinX - 34,
      cabinTop,
      68,
      50,
      9,
    );
    graphics.lineStyle(3, colors.woodDark, 1);
    graphics.strokeRoundedRect(
      cabinX - 34,
      cabinTop,
      68,
      50,
      9,
    );

    graphics.fillStyle(colors.cream, 1);
    graphics.fillRoundedRect(
      cargoCenterX - 10,
      cabinY - 11,
      20,
      23,
      3,
    );
    graphics.fillStyle(colors.brass, 1);
    graphics.fillRoundedRect(
      cabinX + 3,
      cabinY - 8,
      19,
      20,
      3,
    );
    graphics.lineStyle(2, colors.wood, 1);
    graphics.lineBetween(
      cargoCenterX - 10,
      cabinY,
      cargoCenterX + 10,
      cabinY,
    );
      graphics.lineBetween(
        cabinX + 3,
        cabinY + 2,
        cabinX + 22,
        cabinY + 2,
      );
    }

    return {
      status: presentation.status,
      labelX: Math.min(cabinX, options.viewportWidth - 86),
      labelY: cabinTop + 66,
      trackX: cablePoint.x,
      trackY: cablePoint.y,
    };
  }
}
