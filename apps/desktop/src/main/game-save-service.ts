import type {
  SaveDiagnosticsListener,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import {
  isM2SimulationState,
  isNarrativeSystemState,
  type M2SimulationState,
  type NarrativeSystemState,
} from "@airship-restaurant/core";
import {
  JsonSaveStore,
  type JsonSaveLoadResult,
} from "@airship-restaurant/persistence";
import path from "node:path";

const GAME_SAVE_FILE_NAME = "save.json";
const GAME_SAVE_SCHEMA_VERSION = 1;

export interface GameSavePayload extends M2SimulationState {
  readonly narrative?: NarrativeSystemState;
}

function isGameSavePayload(value: unknown): value is GameSavePayload {
  return (
    isM2SimulationState(value) &&
    (!("narrative" in value) ||
      value.narrative === undefined ||
      isNarrativeSystemState(value.narrative))
  );
}

function getSafeSaveError(error: unknown): string {
  const code =
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;

  switch (code) {
    case "ENOSPC":
      return "磁盘空间不足，暂时无法写入本地存档。";
    case "EACCES":
    case "EPERM":
      return "本地存档文件暂时不可写。";
    case null:
      return "本地存档写入失败。";
    default:
      return `本地存档写入失败（${code}）。`;
  }
}

export class GameSaveService {
  readonly #nowUtcMs: () => number;
  readonly #listeners = new Set<SaveDiagnosticsListener>();
  #pendingSaveCount = 0;
  #diagnostics: SaveDiagnosticsSnapshot = Object.freeze({
    revision: 0,
    status: "loading",
    loadSource: "loading",
    lastSavedAtUtcMs: null,
    lastError: null,
    fileName: "save.json",
    backupFileName: "save.json.bak",
  });

  readonly #store: JsonSaveStore<GameSavePayload>;

  constructor(
    userDataPath: string,
    nowUtcMs: () => number = Date.now,
  ) {
    this.#nowUtcMs = nowUtcMs;
    this.#store = new JsonSaveStore({
      filePath: path.join(userDataPath, GAME_SAVE_FILE_NAME),
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      validatePayload: isGameSavePayload,
      nowUtcMs,
    });
  }

  async load(): Promise<JsonSaveLoadResult<GameSavePayload>> {
    const result = await this.#store.load();
    this.#setDiagnostics({
      status: "ready",
      loadSource:
        result.status === "loaded"
          ? "primary"
          : result.status === "recovered-backup"
            ? "backup"
            : result.status === "corrupt"
              ? "reset-corrupt"
              : "new",
      lastSavedAtUtcMs: result.envelope?.savedAtUtcMs ?? null,
      lastError:
        result.status === "corrupt"
          ? "主存档与备份均未通过校验，已建立新进度。"
          : null,
    });
    return result;
  }

  getDiagnostics(): SaveDiagnosticsSnapshot {
    return Object.freeze({ ...this.#diagnostics });
  }

  subscribe(listener: SaveDiagnosticsListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  requestSave(state: GameSavePayload): void {
    this.#beginSave();
    void this.#store
      .save(state)
      .then(() => {
        this.#finishSave(null);
      })
      .catch((error: unknown) => {
        this.#finishSave(error);
        console.error(
          "[GameSaveService] Background save failed",
          error,
        );
      });
  }

  async saveAndFlush(state: GameSavePayload): Promise<void> {
    this.#beginSave();
    try {
      await this.#store.save(state);
      await this.#store.flush();
      this.#finishSave(null);
    } catch (error: unknown) {
      this.#finishSave(error);
      throw error;
    }
  }

  #beginSave(): void {
    this.#pendingSaveCount += 1;
    this.#setDiagnostics({
      status: "saving",
      lastError: null,
    });
  }

  #finishSave(error: unknown): void {
    this.#pendingSaveCount = Math.max(0, this.#pendingSaveCount - 1);
    if (error === null) {
      this.#setDiagnostics({
        status: this.#pendingSaveCount > 0 ? "saving" : "ready",
        lastSavedAtUtcMs: this.#nowUtcMs(),
        lastError: null,
      });
      return;
    }

    this.#setDiagnostics({
      status: "error",
      lastError: getSafeSaveError(error),
    });
  }

  #setDiagnostics(
    update: Partial<
      Pick<
        SaveDiagnosticsSnapshot,
        | "status"
        | "loadSource"
        | "lastSavedAtUtcMs"
        | "lastError"
      >
    >,
  ): void {
    const next = Object.freeze({
      ...this.#diagnostics,
      ...update,
      revision: this.#diagnostics.revision + 1,
    });
    this.#diagnostics = next;
    for (const listener of this.#listeners) {
      listener(this.getDiagnostics());
    }
  }
}
