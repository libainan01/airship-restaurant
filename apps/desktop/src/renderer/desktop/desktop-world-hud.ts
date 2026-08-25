import type { ManagementSection } from "@airship-restaurant/contracts";
import type Phaser from "phaser";
import type { DesktopWorldLayout } from "./desktop-world-layout";
import type { DesktopFunctionalHotspot } from "./desktop-functional-hotspots";
import {
  getManagementOpeningLabel,
  MANAGEMENT_MENU_SECTIONS,
} from "./desktop-management-menu";

export class DesktopWorldHud {
  readonly dialogueSpeaker: Phaser.GameObjects.Text;
  readonly dialogueLine: Phaser.GameObjects.Text;
  readonly dialogueContext: Phaser.GameObjects.Text;
  readonly ottoStatus: Phaser.GameObjects.Text;
  readonly runtimeStatus: Phaser.GameObjects.Text;
  readonly focusStatus: Phaser.GameObjects.Text;
  readonly managementLauncherButton: Phaser.GameObjects.Text;
  readonly managementMenuPanel: Phaser.GameObjects.Rectangle;
  readonly managementOverviewButton: Phaser.GameObjects.Text;
  readonly managementMenuButtons: ReadonlyMap<
    Exclude<ManagementSection, "overview">,
    Phaser.GameObjects.Text
  >;
  readonly functionalHint: Phaser.GameObjects.Text;
  readonly airshipTitle: Phaser.GameObjects.Text;
  readonly airshipStatus: Phaser.GameObjects.Text;
  readonly restaurantTitle: Phaser.GameObjects.Text;
  readonly restaurantStatus: Phaser.GameObjects.Text;
  readonly restaurantHint: Phaser.GameObjects.Text;
  readonly airshipExchange: Phaser.GameObjects.Text;
  readonly groundExchange: Phaser.GameObjects.Text;
  readonly cableStatus: Phaser.GameObjects.Text;
  readonly toast: Phaser.GameObjects.Text;
  readonly saleFeedback: Phaser.GameObjects.Text;
  readonly portStatus: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    options: {
      readonly fontFamily: string;
      readonly runtimePhase: string;
    },
  ) {
    const fontFamily = options.fontFamily;
    this.dialogueSpeaker = scene.add
      .text(0, 0, "", {
        color: "#a94f36",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setDepth(31)
      .setVisible(false);
    this.dialogueLine = scene.add
      .text(0, 0, "", {
        color: "#3f2d27",
        fontFamily,
        fontSize: "12px",
        lineSpacing: 3,
        wordWrap: { width: 220, useAdvancedWrap: true },
      })
      .setDepth(31)
      .setVisible(false);
    this.dialogueContext = scene.add
      .text(0, 0, "", {
        backgroundColor: "#654333",
        color: "#fff1d2",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);
    this.ottoStatus = scene.add
      .text(0, 0, "", {
        backgroundColor: "#2f2925",
        color: "#e4b96e",
        fontFamily,
        fontSize: "9px",
        fontStyle: "bold",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);
    this.runtimeStatus = scene.add
      .text(0, 0, options.runtimePhase, {
        color: "#61564e",
        fontFamily,
        fontSize: "11px",
      })
      .setOrigin(0.5);
    this.focusStatus = scene.add
      .text(0, 0, "", {
        backgroundColor: "rgba(63, 93, 82, 0.82)",
        color: "#f5f1dc",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
        padding: { x: 8, y: 7 },
      })
      .setDepth(40)
      .setVisible(false);
    this.managementLauncherButton = scene.add
      .text(0, 0, "☰\n控制台", {
        align: "center",
        backgroundColor: "rgba(55, 40, 34, 0.94)",
        color: "#fff1d2",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
        lineSpacing: 2,
        padding: { y: 8 },
      })
      .setDepth(60);
    this.managementMenuPanel = scene.add
      .rectangle(0, 0, 0, 0, 0x2f2925, 0.96)
      .setOrigin(0)
      .setStrokeStyle(1, 0xc58a42, 0.9)
      .setDepth(58)
      .setVisible(false);
    this.managementOverviewButton = scene.add
      .text(0, 0, "经营总览  ·  餐厅运行中", {
        align: "left",
        backgroundColor: "rgba(119, 73, 49, 0.92)",
        color: "#fff1d2",
        fontFamily,
        fontSize: "11px",
        fontStyle: "bold",
        padding: { x: 12, y: 14 },
      })
      .setDepth(59)
      .setVisible(false);
    this.managementMenuButtons = new Map(
      MANAGEMENT_MENU_SECTIONS.map((section) => [
        section,
        scene.add
          .text(0, 0, getManagementOpeningLabel(section), {
            align: "center",
            backgroundColor: "rgba(76, 58, 48, 0.96)",
            color: "#f7e6c8",
            fontFamily,
            fontSize: "10px",
            fontStyle: "bold",
            padding: { y: 17 },
          })
          .setDepth(59)
          .setVisible(false),
      ]),
    );
    this.functionalHint = scene.add
      .text(0, 0, "", {
        backgroundColor: "rgba(47, 41, 37, 0.9)",
        color: "#fff1d2",
        fontFamily,
        fontSize: "11px",
        fontStyle: "bold",
        padding: { x: 9, y: 5 },
      })
      .setOrigin(0.5, 1)
      .setDepth(41)
      .setVisible(false);
    this.airshipTitle = scene.add
      .text(0, 0, "云灶号 · 空中厨房", {
        color: "#fff4da",
        fontFamily,
        fontSize: "17px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.airshipStatus = scene.add
      .text(0, 0, "炉火稳定 · 厨房待命", {
        color: "#efd7ad",
        fontFamily,
        fontSize: "11px",
      })
      .setOrigin(0.5);
    this.restaurantTitle = scene.add.text(0, 0, "风铃交换站", {
      color: "#3d2d27",
      fontFamily,
      fontSize: "21px",
      fontStyle: "bold",
    });
    this.restaurantStatus = scene.add.text(
      0,
      0,
      "资源交换待命 · 室外餐区准备中",
      { color: "#6d5545", fontFamily, fontSize: "12px" },
    );
    this.restaurantHint = scene.add
      .text(0, 0, "", {
        color: "#71503b",
        fontFamily,
        fontSize: "12px",
        fontStyle: "bold",
      })
      .setOrigin(1, 0)
      .setVisible(false);
    this.airshipExchange = scene.add
      .text(0, 0, "空中装卸站", {
        color: "#f3d6a4",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.groundExchange = scene.add
      .text(0, 0, "地面交换站", {
        color: "#49352c",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.cableStatus = scene.add
      .text(0, 0, "运输缆车", {
        backgroundColor: "#fff1d2",
        color: "#735747",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5);
    this.toast = scene.add
      .text(0, 0, "", {
        align: "center",
        backgroundColor: "#fff4dc",
        color: "#47332a",
        fontFamily,
        fontSize: "13px",
        fontStyle: "bold",
        padding: { x: 15, y: 9 },
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.saleFeedback = scene.add
      .text(0, 0, "", {
        backgroundColor: "#fff1d2",
        color: "#a94f36",
        fontFamily,
        fontSize: "11px",
        fontStyle: "bold",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(14)
      .setVisible(false);
    this.portStatus = scene.add
      .text(0, 0, "港口预留位 · M3开放", {
        color: "#e5c28e",
        fontFamily,
        fontSize: "10px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.72);
  }

  setManagementMenuOpen(open: boolean): void {
    this.managementLauncherButton.setText(open ? "×\n收起" : "☰\n控制台");
    this.managementMenuPanel.setVisible(open);
    this.managementOverviewButton.setVisible(open);
    for (const button of this.managementMenuButtons.values()) {
      button.setVisible(open);
    }
  }

  setManagementLauncherHovered(hovered: boolean): void {
    this.managementLauncherButton.setBackgroundColor(
      hovered ? "rgba(197, 138, 66, 0.98)" : "rgba(55, 40, 34, 0.94)",
    );
    this.managementLauncherButton.setColor(hovered ? "#2f2925" : "#fff1d2");
  }

  setManagementTargetHovered(section: ManagementSection | null): void {
    this.managementOverviewButton.setBackgroundColor(
      section === "overview" ? "rgba(197, 138, 66, 0.98)" : "rgba(119, 73, 49, 0.92)",
    );
    this.managementOverviewButton.setColor(section === "overview" ? "#2f2925" : "#fff1d2");
    for (const [candidate, button] of this.managementMenuButtons) {
      const hovered = candidate === section;
      button.setBackgroundColor(hovered ? "rgba(197, 138, 66, 0.98)" : "rgba(76, 58, 48, 0.96)");
      button.setColor(hovered ? "#2f2925" : "#f7e6c8");
    }
  }

  showFunctionalHint(hotspot: DesktopFunctionalHotspot | null): void {
    if (hotspot === null) {
      this.functionalHint.setVisible(false);
      return;
    }
    this.functionalHint
      .setText(hotspot.label)
      .setPosition(hotspot.x + hotspot.width / 2, hotspot.y - 6)
      .setVisible(true);
  }

  applyLayout(layout: DesktopWorldLayout): void {
    const hud = layout.hud;
    this.runtimeStatus.setPosition(hud.runtimeStatus.x, hud.runtimeStatus.y);
    this.focusStatus.setPosition(hud.focusStatus.x, hud.focusStatus.y);
    this.managementLauncherButton
      .setPosition(
        layout.managementMenu.launcher.x,
        layout.managementMenu.launcher.y,
      )
      .setFixedSize(
        layout.managementMenu.launcher.width,
        layout.managementMenu.launcher.height,
      );
    this.managementMenuPanel
      .setPosition(layout.managementMenu.panel.x, layout.managementMenu.panel.y)
      .setSize(layout.managementMenu.panel.width, layout.managementMenu.panel.height);
    this.managementOverviewButton
      .setPosition(layout.managementMenu.overview.x, layout.managementMenu.overview.y)
      .setFixedSize(layout.managementMenu.overview.width, layout.managementMenu.overview.height);
    for (const item of layout.managementMenu.items) {
      this.managementMenuButtons.get(item.section)
        ?.setPosition(item.rect.x, item.rect.y)
        .setFixedSize(item.rect.width, item.rect.height);
    }
    this.airshipTitle.setPosition(hud.airshipTitle.x, hud.airshipTitle.y);
    this.airshipStatus.setPosition(hud.airshipStatus.x, hud.airshipStatus.y);
    this.restaurantTitle.setPosition(
      hud.restaurantTitle.x,
      hud.restaurantTitle.y,
    );
    this.restaurantStatus.setPosition(
      hud.restaurantStatus.x,
      hud.restaurantStatus.y,
    );
    this.restaurantHint.setPosition(
      hud.restaurantHint.x,
      hud.restaurantHint.y,
    );
    this.airshipExchange.setPosition(
      hud.airshipExchange.x,
      hud.airshipExchange.y,
    );
    this.groundExchange.setPosition(
      hud.groundExchange.x,
      hud.groundExchange.y,
    );
    this.toast.setPosition(hud.toast.x, hud.toast.y);
    this.portStatus.setPosition(hud.portStatus.x, hud.portStatus.y);
    this.saleFeedback.setPosition(
      hud.saleFeedback.x,
      hud.saleFeedback.y,
    );
  }
}
