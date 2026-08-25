import type { ManagementSection } from "@airship-restaurant/contracts";
import type { DesktopWorldLayout } from "./desktop-world-layout";

export type SceneManagementSection = Exclude<ManagementSection, "overview">;

export interface DesktopFunctionalHotspot {
  readonly section: SceneManagementSection;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const HOTSPOT_HIT_PREFIX = "scene-function:";

export function getFunctionalHotspotHitId(
  section: SceneManagementSection,
): string {
  return HOTSPOT_HIT_PREFIX + section;
}

export function getFunctionalSectionFromHitId(
  id: string | undefined,
): SceneManagementSection | null {
  switch (id) {
    case HOTSPOT_HIT_PREFIX + "inventory":
      return "inventory";
    case HOTSPOT_HIT_PREFIX + "recipes":
      return "recipes";
    case HOTSPOT_HIT_PREFIX + "procurement":
      return "procurement";
    case HOTSPOT_HIT_PREFIX + "technology":
      return "technology";
    default:
      return null;
  }
}

export function resolveDesktopFunctionalHotspots(
  layout: DesktopWorldLayout,
): readonly DesktopFunctionalHotspot[] {
  const counterCenterX =
    layout.restaurantArtworkX + layout.restaurantArtworkWidth - 128;
  const counterHeight = layout.restaurantHeight * 0.42;
  const counterTop =
    layout.restaurantY + layout.restaurantHeight * 0.63 - counterHeight / 2;
  const hotspots: readonly DesktopFunctionalHotspot[] = [
    {
      section: "recipes",
      label: "查看食谱",
      x: counterCenterX - 70,
      y: counterTop - 15,
      width: 62,
      height: 34,
    },
    {
      section: "inventory",
      label: "打开仓库",
      x: counterCenterX + 4,
      y: counterTop + 17,
      width: 67,
      height: Math.max(34, counterHeight - 22),
    },
    {
      section: "procurement",
      label: "前往港口采购",
      x: layout.restaurantArtworkX + 12,
      y: layout.restaurantY - 86,
      width: 152,
      height: 68,
    },
    {
      section: "technology",
      label: "查看工程升级",
      x: layout.airshipCenterX + layout.airshipWidth * 0.13,
      y: layout.airshipTop + layout.airshipHeight * 0.41,
      width: layout.airshipWidth * 0.13,
      height: layout.airshipHeight * 0.22,
    },
  ];
  return hotspots.map((hotspot) => {
    const width = Math.min(hotspot.width, layout.viewportWidth);
    const height = Math.min(hotspot.height, layout.viewportHeight);
    return Object.freeze({
      ...hotspot,
      x: Math.min(
        Math.max(0, hotspot.x),
        layout.viewportWidth - width,
      ),
      y: Math.min(
        Math.max(0, hotspot.y),
        layout.viewportHeight - height,
      ),
      width,
      height,
    });
  });
}

export function rectanglesOverlap(
  left: DesktopFunctionalHotspot,
  right: DesktopFunctionalHotspot,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
