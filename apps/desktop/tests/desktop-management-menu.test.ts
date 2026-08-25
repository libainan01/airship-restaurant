import { describe, expect, it } from "vitest";
import {
  getManagementOpeningLabel,
  getManagementSectionFromHitId,
  MANAGEMENT_LAUNCHER_HIT_ID,
  MANAGEMENT_MENU_SECTIONS,
  resolveDesktopManagementMenuLayout,
} from "../src/renderer/desktop/desktop-management-menu";

describe("desktop management launcher", () => {
  it("anchors a collapsed launcher to the bottom-right and keeps the menu in bounds", () => {
    const layout = resolveDesktopManagementMenuLayout(1_000, 700);
    expect(MANAGEMENT_LAUNCHER_HIT_ID).toBe("management:launcher");
    expect(layout.launcher).toEqual({ x: 932, y: 632, width: 52, height: 52 });
    expect(layout.panel.x).toBeGreaterThanOrEqual(16);
    expect(layout.panel.y).toBeGreaterThanOrEqual(16);
    expect(layout.panel.x + layout.panel.width).toBeLessThanOrEqual(984);
    expect(layout.items).toHaveLength(8);
  });

  it("provides a stable 4 by 2 section grid and hit mapping", () => {
    const layout = resolveDesktopManagementMenuLayout(1_280, 720);
    expect(MANAGEMENT_MENU_SECTIONS).toEqual([
      "inventory", "recipes", "procurement", "finance",
      "staff", "roster", "instance-upgrades", "technology",
    ]);
    expect(new Set(layout.items.slice(0, 4).map((item) => item.rect.y)).size).toBe(1);
    expect(new Set(layout.items.slice(4).map((item) => item.rect.y)).size).toBe(1);
    expect(getManagementSectionFromHitId("management:finance")).toBe("finance");
    expect(getManagementSectionFromHitId("management:roster")).toBe("roster");
  });

  it("provides concise opening labels", () => {
    expect(getManagementOpeningLabel("overview")).toBe("经营总览");
    expect(getManagementOpeningLabel("inventory")).toBe("仓库");
    expect(getManagementOpeningLabel("recipes")).toBe("食谱");
    expect(getManagementOpeningLabel("procurement")).toBe("采购");
    expect(getManagementOpeningLabel("finance")).toBe("经营账本");
    expect(getManagementOpeningLabel("roster")).toBe("花名册");
  });
});
