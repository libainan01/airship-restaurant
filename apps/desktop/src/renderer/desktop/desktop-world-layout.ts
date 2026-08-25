import {
  alignTrackPointToCargoTarget,
  type CablePoint,
} from "./cable-route";
import { createAirshipHitPoints } from "./airship-static-renderer";
import type { HitPoint } from "./semantic-hit-map";
import {
  resolveDesktopManagementMenuLayout,
  type DesktopManagementMenuLayout,
} from "./desktop-management-menu";

export interface DesktopHudLayout {
  readonly runtimeStatus: CablePoint;
  readonly focusStatus: CablePoint;
  readonly airshipTitle: CablePoint;
  readonly airshipStatus: CablePoint;
  readonly restaurantTitle: CablePoint;
  readonly restaurantStatus: CablePoint;
  readonly restaurantHint: CablePoint;
  readonly airshipExchange: CablePoint;
  readonly groundExchange: CablePoint;
  readonly toast: CablePoint;
  readonly portStatus: CablePoint;
  readonly saleFeedback: CablePoint;
}

export interface DesktopWorldLayout {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly airshipCenterX: number;
  readonly airshipTop: number;
  readonly airshipWidth: number;
  readonly airshipHeight: number;
  readonly airshipHitPoints: readonly HitPoint[];
  /** Shared outdoor dining and staff movement area. */
  readonly restaurantX: number;
  readonly restaurantWidth: number;
  readonly restaurantY: number;
  readonly restaurantHeight: number;
  /** Compact resource exchange and employee service hub artwork. */
  readonly restaurantArtworkX: number;
  readonly restaurantArtworkY: number;
  readonly restaurantArtworkWidth: number;
  readonly restaurantArtworkHeight: number;
  readonly airshipExchangePoint: CablePoint;
  readonly airshipTrackPoint: CablePoint;
  readonly groundExchangePoint: CablePoint;
  readonly transportEdgeX: number;
  readonly managementMenu: DesktopManagementMenuLayout;
  readonly hud: DesktopHudLayout;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveDesktopWorldLayout(
  width: number,
  height: number,
): DesktopWorldLayout {
  const viewportWidth = Math.max(640, width);
  const viewportHeight = Math.max(480, height);
  const restaurantHeight = clamp(
    Math.round(viewportHeight * 0.155),
    148,
    210,
  );
  const restaurantY = viewportHeight - restaurantHeight;
  const restaurantWidth = Math.min(
    viewportWidth - 24,
    clamp(Math.round(viewportWidth * 0.76), 620, 1_080),
  );
  const restaurantX = clamp(
    Math.round(viewportWidth * 0.03),
    0,
    Math.max(0, viewportWidth - restaurantWidth),
  );
  const restaurantArtworkWidth = clamp(
    Math.round(viewportWidth * 0.23),
    260,
    360,
  );
  const restaurantArtworkHeight = Math.round(
    restaurantArtworkWidth * (831 / 1248),
  );
  const restaurantArtworkX = viewportWidth - restaurantArtworkWidth;
  const restaurantArtworkY = viewportHeight - restaurantArtworkHeight;

  const airshipWidth = clamp(
    Math.round(viewportWidth * 0.21),
    280,
    440,
  );
  const airshipHeight = Math.round(airshipWidth * (821 / 1334));
  const airshipTop = -Math.round(airshipHeight * 0.42);
  const airshipCenterX = clamp(
    Math.round(viewportWidth * 0.38),
    airshipWidth / 2 + 20,
    viewportWidth - airshipWidth / 2 - 100,
  );
  const airshipExchangePoint = {
    x: airshipCenterX,
    y: airshipTop + airshipHeight - 14,
  };
  const airshipTrackPoint = alignTrackPointToCargoTarget(
    airshipExchangePoint,
  );
  const groundExchangePoint = {
    x: restaurantArtworkX + restaurantArtworkWidth - 52,
    y: restaurantY - 28,
  };
  const transportEdgeX = viewportWidth - 22;
  const cabinY = airshipTop + airshipHeight - 48;

  return {
    viewportWidth,
    viewportHeight,
    airshipCenterX,
    airshipTop,
    airshipWidth,
    airshipHeight,
    airshipHitPoints: createAirshipHitPoints({
      centerX: airshipCenterX,
      top: airshipTop,
      width: airshipWidth,
      height: airshipHeight,
    }),
    restaurantX,
    restaurantWidth,
    restaurantY,
    restaurantHeight,
    restaurantArtworkX,
    restaurantArtworkY,
    restaurantArtworkWidth,
    restaurantArtworkHeight,
    airshipExchangePoint,
    airshipTrackPoint,
    groundExchangePoint,
    transportEdgeX,
    managementMenu: resolveDesktopManagementMenuLayout(
      viewportWidth,
      viewportHeight,
    ),
    hud: {
      runtimeStatus: {
        x: airshipCenterX,
        y: Math.max(12, airshipTop + 45),
      },
      focusStatus: { x: 70, y: 12 },
      airshipTitle: { x: airshipCenterX, y: cabinY },
      airshipStatus: { x: airshipCenterX, y: cabinY + 22 },
      restaurantTitle: {
        x: restaurantArtworkX + 22,
        y: restaurantY + 42,
      },
      restaurantStatus: {
        x: restaurantArtworkX + 23,
        y: restaurantY + 72,
      },
      restaurantHint: {
        x: restaurantArtworkX + restaurantArtworkWidth - 20,
        y: restaurantY + 48,
      },
      airshipExchange: {
        x: airshipExchangePoint.x - 32,
        y: airshipExchangePoint.y + 23,
      },
      groundExchange: { x: groundExchangePoint.x, y: restaurantY + 16 },
      toast: { x: viewportWidth / 2, y: restaurantY - 38 },
      portStatus: {
        x: restaurantArtworkX + 76,
        y: restaurantArtworkY - 16,
      },
      saleFeedback: {
        x: restaurantX + restaurantWidth * 0.44,
        y: restaurantY + restaurantHeight * 0.41,
      },
    },
  };
}
