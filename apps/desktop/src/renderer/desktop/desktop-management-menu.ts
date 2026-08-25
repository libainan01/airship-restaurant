import type { ManagementSection } from "@airship-restaurant/contracts";

export interface DesktopManagementMenuRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopManagementMenuItem {
  readonly section: Exclude<ManagementSection, "overview">;
  readonly rect: DesktopManagementMenuRect;
}

export interface DesktopManagementMenuLayout {
  readonly launcher: DesktopManagementMenuRect;
  readonly panel: DesktopManagementMenuRect;
  readonly overview: DesktopManagementMenuRect;
  readonly items: readonly DesktopManagementMenuItem[];
}

export const MANAGEMENT_LAUNCHER_HIT_ID = "management:launcher";
export const MANAGEMENT_PANEL_HIT_ID = "management:panel";
export const MANAGEMENT_OVERVIEW_HIT_ID = "management:overview";

export const MANAGEMENT_MENU_SECTIONS = [
  "inventory",
  "recipes",
  "procurement",
  "finance",
  "staff",
  "roster",
  "instance-upgrades",
  "technology",
] as const satisfies readonly Exclude<ManagementSection, "overview">[];

const OPENING_LABELS: Readonly<Record<ManagementSection, string>> = {
  overview: "经营总览",
  inventory: "仓库",
  recipes: "食谱",
  procurement: "采购",
  finance: "经营账本",
  "instance-upgrades": "场景布置",
  technology: "科技树",
  staff: "员工",
  roster: "花名册",
};

export function getManagementOpeningLabel(section: ManagementSection): string {
  return OPENING_LABELS[section];
}

export function getManagementMenuHitId(section: ManagementSection): string {
  return `management:${section}`;
}

export function getManagementSectionFromHitId(hitId: string | undefined): ManagementSection | null {
  if (hitId === MANAGEMENT_OVERVIEW_HIT_ID) return "overview";
  const section = MANAGEMENT_MENU_SECTIONS.find(
    (candidate) => getManagementMenuHitId(candidate) === hitId,
  );
  return section ?? null;
}

export function resolveDesktopManagementMenuLayout(
  viewportWidth: number,
  viewportHeight: number,
): DesktopManagementMenuLayout {
  const margin = 16;
  const launcherSize = 52;
  const panelWidth = 352;
  const panelHeight = 184;
  const launcher = {
    x: viewportWidth - margin - launcherSize,
    y: viewportHeight - margin - launcherSize,
    width: launcherSize,
    height: launcherSize,
  };
  const panel = {
    x: Math.max(margin, launcher.x + launcher.width - panelWidth),
    y: Math.max(margin, launcher.y - 10 - panelHeight),
    width: panelWidth,
    height: panelHeight,
  };
  const overview = {
    x: panel.x + 10,
    y: panel.y + 10,
    width: panel.width - 20,
    height: 46,
  };
  const gap = 6;
  const itemWidth = (panel.width - 20 - gap * 3) / 4;
  const itemHeight = 50;
  const itemTop = overview.y + overview.height + 8;
  const items = MANAGEMENT_MENU_SECTIONS.map((section, index) => ({
    section,
    rect: {
      x: panel.x + 10 + (index % 4) * (itemWidth + gap),
      y: itemTop + Math.floor(index / 4) * (itemHeight + gap),
      width: itemWidth,
      height: itemHeight,
    },
  }));
  return { launcher, panel, overview, items };
}
