import {
  isAppSettingsSnapshot,
  type AppSettingsSnapshot,
  type AppSettingsUpdate,
} from "@airship-restaurant/contracts";
import { createSaveEnvelope } from "@airship-restaurant/persistence";
import { promises as fs } from "node:fs";
import path from "node:path";

const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_FILE_NAME = "settings.json";

export type SettingsListener = (snapshot: AppSettingsSnapshot) => void;

function snapshotsAreEqual(
  left: AppSettingsSnapshot,
  right: AppSettingsSnapshot,
): boolean {
  return (
    left.onboardingCompleted === right.onboardingCompleted &&
    left.targetDisplayId === right.targetDisplayId &&
    left.alwaysOnTop === right.alwaysOnTop &&
    left.presentationMode === right.presentationMode &&
    left.uiScale === right.uiScale &&
    left.needsDisplayConfirmation === right.needsDisplayConfirmation &&
    JSON.stringify(left.managementWindowBounds) ===
      JSON.stringify(right.managementWindowBounds)
  );
}

function freezeSnapshot(
  snapshot: AppSettingsSnapshot,
): AppSettingsSnapshot {
  return Object.freeze({
    ...snapshot,
    managementWindowBounds:
      snapshot.managementWindowBounds === null
        ? null
        : Object.freeze({ ...snapshot.managementWindowBounds }),
  });
}

export function createDefaultAppSettings(
  targetDisplayId: string,
): AppSettingsSnapshot {
  return freezeSnapshot({
    revision: 0,
    onboardingCompleted: false,
    targetDisplayId,
    alwaysOnTop: false,
    presentationMode: "normal",
    uiScale: 1,
    managementWindowBounds: null,
    needsDisplayConfirmation: false,
  });
}

export class SettingsStore {
  readonly #settingsPath: string;
  readonly #listeners = new Set<SettingsListener>();
  #snapshot: AppSettingsSnapshot;
  #pendingWrite: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, initialTargetDisplayId: string) {
    this.#settingsPath = path.join(userDataPath, SETTINGS_FILE_NAME);
    this.#snapshot = createDefaultAppSettings(initialTargetDisplayId);
  }

  async load(): Promise<AppSettingsSnapshot> {
    try {
      const rawSettings = await fs.readFile(this.#settingsPath, "utf8");
      const envelope: unknown = JSON.parse(rawSettings);

      if (
        typeof envelope !== "object" ||
        envelope === null ||
        !("schemaVersion" in envelope) ||
        envelope.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
        !("payload" in envelope) ||
        !isAppSettingsSnapshot(envelope.payload)
      ) {
        throw new Error("Settings file failed schema validation.");
      }

      this.#snapshot = freezeSnapshot(envelope.payload);
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        console.warn(
          "[SettingsStore] Unable to load settings; defaults will be used.",
          error,
        );
      }
    }

    return this.getSnapshot();
  }

  getSnapshot(): AppSettingsSnapshot {
    return freezeSnapshot(this.#snapshot);
  }

  async update(
    update: AppSettingsUpdate,
  ): Promise<AppSettingsSnapshot> {
    const candidate = freezeSnapshot({
      ...this.#snapshot,
      ...update,
      revision: this.#snapshot.revision + 1,
      managementWindowBounds:
        update.managementWindowBounds === undefined
          ? this.#snapshot.managementWindowBounds
          : update.managementWindowBounds,
    });

    if (snapshotsAreEqual(this.#snapshot, candidate)) {
      return this.getSnapshot();
    }

    this.#snapshot = candidate;
    const publishedSnapshot = this.getSnapshot();
    for (const listener of this.#listeners) {
      listener(publishedSnapshot);
    }

    this.#pendingWrite = this.#pendingWrite
      .catch(() => undefined)
      .then(() => this.#writeSnapshot(publishedSnapshot));
    await this.#pendingWrite;
    return this.getSnapshot();
  }

  subscribe(listener: SettingsListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async flush(): Promise<void> {
    await this.#pendingWrite;
  }

  async #writeSnapshot(snapshot: AppSettingsSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.#settingsPath), { recursive: true });
    const envelope = createSaveEnvelope(
      SETTINGS_SCHEMA_VERSION,
      Date.now(),
      snapshot,
    );
    const temporaryPath = `${this.#settingsPath}.${process.pid}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporaryPath, this.#settingsPath);
  }
}
