import type { AppSettingsSnapshot } from "@airship-restaurant/contracts";
import Phaser from "phaser";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_EVENTS,
  DESKTOP_REGISTRY_KEYS,
  DESKTOP_SCENE_KEYS,
} from "./scene-contracts";

const FONT_FAMILY =
  '"Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif';

export class DesktopUiScene extends Phaser.Scene {
  #notice!: Phaser.GameObjects.Text;

  constructor() {
    super(DESKTOP_SCENE_KEYS.ui);
  }

  create(): void {
    this.#notice = this.add
      .text(16, 16, "", {
        backgroundColor: "#fff1d2",
        color: "#4a372d",
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        fontStyle: "bold",
        padding: { x: 9, y: 5 },
      })
      .setDepth(100)
      .setVisible(false);

    const settings =
      this.registry.get(DESKTOP_REGISTRY_KEYS.settings) ??
      DEFAULT_DESKTOP_SETTINGS;
    this.#applySettings(settings);
    this.game.events.on(
      DESKTOP_EVENTS.settingsChanged,
      this.#applySettings,
      this,
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(
        DESKTOP_EVENTS.settingsChanged,
        this.#applySettings,
        this,
      );
    });
  }

  readonly #applySettings = (settings: AppSettingsSnapshot): void => {
    if (!settings.onboardingCompleted) {
      this.#notice
        .setText("请在管理窗口完成首次设置")
        .setVisible(true);
      return;
    }

    if (settings.needsDisplayConfirmation) {
      this.#notice
        .setText("原显示器不可用，请重新确认显示器")
        .setVisible(true);
      return;
    }

    this.#notice.setVisible(false);
  };
}
