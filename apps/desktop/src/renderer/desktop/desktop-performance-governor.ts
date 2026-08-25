import type { AppSettingsSnapshot, PresentationMode } from "@airship-restaurant/contracts";
import type Phaser from "phaser";
import { DESKTOP_EVENTS } from "./scene-contracts";

export function resolveDesktopFpsLimit(
  mode: PresentationMode,
  hidden: boolean,
): number {
  if (hidden) return 2;
  switch (mode) {
    case "quiet":
      return 5;
    case "reduced":
      return 15;
    case "normal":
      return 30;
  }
}

export class DesktopPerformanceGovernor {
  readonly #game: Phaser.Game;
  #mode: PresentationMode = "normal";
  #currentLimit = 0;

  constructor(game: Phaser.Game) {
    this.#game = game;
    document.addEventListener("visibilitychange", this.#refresh);
    game.events.on(DESKTOP_EVENTS.settingsChanged, this.#handleSettings);
    this.#refresh();
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.#refresh);
    this.#game.events.off(DESKTOP_EVENTS.settingsChanged, this.#handleSettings);
  }

  readonly #handleSettings = (settings: AppSettingsSnapshot): void => {
    this.#mode = settings.presentationMode;
    this.#refresh();
  };

  readonly #refresh = (): void => {
    const limit = resolveDesktopFpsLimit(this.#mode, document.hidden);
    if (limit === this.#currentLimit) return;
    this.#currentLimit = limit;
    this.#game.loop.setFPSLimit(limit);
  };
}