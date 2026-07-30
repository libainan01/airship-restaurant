import { promises as fs } from "node:fs";
import path from "node:path";
import type { SaveEnvelope } from "./index";

export interface JsonSaveStoreOptions<TPayload> {
  readonly filePath: string;
  readonly schemaVersion: number;
  readonly validatePayload: (value: unknown) => value is TPayload;
  readonly nowUtcMs?: () => number;
  readonly processId?: number;
}

export type JsonSaveLoadResult<TPayload> =
  | {
      readonly status: "loaded" | "recovered-backup";
      readonly envelope: SaveEnvelope<TPayload>;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: "missing" | "corrupt";
      readonly envelope: null;
      readonly diagnostics: readonly string[];
    };

type ReadEnvelopeResult<TPayload> =
  | {
      readonly status: "loaded";
      readonly envelope: SaveEnvelope<TPayload>;
    }
  | {
      readonly status: "missing" | "invalid";
      readonly message: string;
    };

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class JsonSaveStore<TPayload> {
  readonly #filePath: string;
  readonly #backupPath: string;
  readonly #temporaryPath: string;
  readonly #schemaVersion: number;
  readonly #validatePayload: (value: unknown) => value is TPayload;
  readonly #nowUtcMs: () => number;
  #pendingWrite: Promise<void> = Promise.resolve();
  #skipPrimaryBackup = false;

  constructor(options: JsonSaveStoreOptions<TPayload>) {
    if (
      !Number.isSafeInteger(options.schemaVersion) ||
      options.schemaVersion <= 0
    ) {
      throw new RangeError(
        "JSON save schema version must be a positive integer.",
      );
    }
    this.#filePath = path.resolve(options.filePath);
    this.#backupPath = `${this.#filePath}.bak`;
    this.#temporaryPath = `${this.#filePath}.${
      options.processId ?? process.pid
    }.tmp`;
    this.#schemaVersion = options.schemaVersion;
    this.#validatePayload = options.validatePayload;
    this.#nowUtcMs = options.nowUtcMs ?? Date.now;
  }

  getFilePath(): string {
    return this.#filePath;
  }

  getBackupPath(): string {
    return this.#backupPath;
  }

  async load(): Promise<JsonSaveLoadResult<TPayload>> {
    const primary = await this.#readEnvelope(this.#filePath);
    if (primary.status === "loaded") {
      this.#skipPrimaryBackup = false;
      return Object.freeze({
        status: "loaded",
        envelope: primary.envelope,
        diagnostics: Object.freeze([]),
      });
    }

    const backup = await this.#readEnvelope(this.#backupPath);
    if (backup.status === "loaded") {
      this.#skipPrimaryBackup = true;
      return Object.freeze({
        status: "recovered-backup",
        envelope: backup.envelope,
        diagnostics: Object.freeze([
          `Primary save: ${primary.message}`,
        ]),
      });
    }

    const bothMissing =
      primary.status === "missing" && backup.status === "missing";
    this.#skipPrimaryBackup = !bothMissing;
    return Object.freeze({
      status: bothMissing ? "missing" : "corrupt",
      envelope: null,
      diagnostics: Object.freeze([
        `Primary save: ${primary.message}`,
        `Backup save: ${backup.message}`,
      ]),
    });
  }

  save(payload: TPayload): Promise<void> {
    const savedAtUtcMs = this.#nowUtcMs();
    if (!isNonNegativeInteger(savedAtUtcMs)) {
      return Promise.reject(
        new RangeError(
          "JSON save timestamp must be a non-negative integer.",
        ),
      );
    }
    const envelope: SaveEnvelope<TPayload> = Object.freeze({
      schemaVersion: this.#schemaVersion,
      savedAtUtcMs,
      payload,
    });
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;

    this.#pendingWrite = this.#pendingWrite
      .catch(() => undefined)
      .then(() => this.#writeSerialized(serialized));
    return this.#pendingWrite;
  }

  async flush(): Promise<void> {
    await this.#pendingWrite;
  }

  async #readEnvelope(
    filePath: string,
  ): Promise<ReadEnvelopeResult<TPayload>> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const value: unknown = JSON.parse(raw);
      if (
        typeof value !== "object" ||
        value === null ||
        !("schemaVersion" in value) ||
        value.schemaVersion !== this.#schemaVersion ||
        !("savedAtUtcMs" in value) ||
        !isNonNegativeInteger(value.savedAtUtcMs) ||
        !("payload" in value) ||
        !this.#validatePayload(value.payload)
      ) {
        return {
          status: "invalid",
          message: "schema validation failed",
        };
      }
      return {
        status: "loaded",
        envelope: Object.freeze({
          schemaVersion: value.schemaVersion,
          savedAtUtcMs: value.savedAtUtcMs,
          payload: value.payload,
        }),
      };
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return {
          status: "missing",
          message: "file does not exist",
        };
      }
      return {
        status: "invalid",
        message:
          error instanceof Error
            ? error.message
            : "unknown read failure",
      };
    }
  }

  async #writeSerialized(serialized: string): Promise<void> {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryFile = await fs.open(this.#temporaryPath, "w");
    try {
      await temporaryFile.writeFile(serialized, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    try {
      if (!this.#skipPrimaryBackup) {
        try {
          await fs.copyFile(this.#filePath, this.#backupPath);
        } catch (error: unknown) {
          if (!isMissingFileError(error)) {
            throw error;
          }
        }
      }
      await fs.rename(this.#temporaryPath, this.#filePath);
      this.#skipPrimaryBackup = false;
    } catch (error: unknown) {
      await fs.unlink(this.#temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
