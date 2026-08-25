import type { BuildingUpgradeEditModePort } from "../modules";

export interface SceneEditModeClockPort {
  isPaused(): boolean;
  pause(): boolean;
  resume(): boolean;
}

export interface SceneEditModeSnapshot {
  readonly revision: number;
  readonly active: boolean;
  readonly sceneId: string | null;
}

export type SceneEditModeResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly message: string;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly message: string;
    };

function validSceneId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

/** Owns the single paused scene-edit session used by building placement and upgrades. */
export class SceneEditModeController implements BuildingUpgradeEditModePort {
  readonly #clock: SceneEditModeClockPort;
  #activeSceneId: string | null = null;
  #revision = 0;

  constructor(clock: SceneEditModeClockPort) {
    this.#clock = clock;
  }

  getSnapshot(): SceneEditModeSnapshot {
    return Object.freeze({
      revision: this.#revision,
      active: this.#activeSceneId !== null,
      sceneId: this.#activeSceneId,
    });
  }

  isEditModeActive(sceneId: string): boolean {
    return this.#activeSceneId === sceneId && this.#clock.isPaused();
  }

  enter(sceneId: string): SceneEditModeResult {
    if (!validSceneId(sceneId)) {
      return Object.freeze({
        accepted: false,
        changed: false,
        message: "Scene edit mode requires a valid scene id.",
      });
    }
    if (this.#activeSceneId === sceneId && this.#clock.isPaused()) {
      return Object.freeze({
        accepted: true,
        changed: false,
        message: "Scene edit mode is already active.",
      });
    }
    if (this.#activeSceneId !== null) {
      return Object.freeze({
        accepted: false,
        changed: false,
        message: "Exit the current scene edit mode before editing another scene.",
      });
    }
    this.#clock.pause();
    this.#activeSceneId = sceneId;
    this.#revision += 1;
    return Object.freeze({
      accepted: true,
      changed: true,
      message: "Scene edit mode entered and game time paused.",
    });
  }

  exit(): SceneEditModeResult {
    if (this.#activeSceneId === null) {
      return Object.freeze({
        accepted: true,
        changed: false,
        message: "Scene edit mode is already inactive.",
      });
    }
    this.#activeSceneId = null;
    this.#clock.resume();
    this.#revision += 1;
    return Object.freeze({
      accepted: true,
      changed: true,
      message: "Scene edit mode exited and game time resumed.",
    });
  }
}