import type {
  AppSettingsSnapshot,
  DesktopCursorPoint,
  WindowBoundsDto,
} from "@airship-restaurant/contracts";
import type { HitPoint } from "./semantic-hit-map";

export const DESKTOP_SCENE_KEYS = {
  boot: "Boot",
  world: "DesktopWorld",
  environment: "Environment",
  ui: "DesktopUi",
  interactionDebug: "InteractionDebug",
} as const;

export const DESKTOP_REGISTRY_KEYS = {
  settings: "desktop:settings",
  debugSnapshot: "desktop:debug-snapshot",
} as const;

export const DESKTOP_EVENTS = {
  settingsChanged: "desktop:settings-changed",
  debugSnapshotChanged: "desktop:debug-snapshot-changed",
} as const;

export interface DesktopDebugSnapshot {
  readonly viewport: WindowBoundsDto;
  readonly airshipHitPoints: readonly HitPoint[];
  readonly restaurantBounds: WindowBoundsDto;
  readonly cursor: DesktopCursorPoint;
  readonly hoveredZoneId: "airship" | "restaurant" | null;
  readonly interactive: boolean;
  readonly interactionReason: string;
}

export const DEFAULT_DESKTOP_SETTINGS: AppSettingsSnapshot = {
  revision: 0,
  onboardingCompleted: false,
  targetDisplayId: "",
  alwaysOnTop: false,
  presentationMode: "normal",
  uiScale: 1,
  managementWindowBounds: null,
  needsDisplayConfirmation: false,
};
