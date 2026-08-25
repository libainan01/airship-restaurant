export interface SaveEnvelope<TPayload> {
  readonly schemaVersion: number;
  readonly savedAtUtcMs: number;
  readonly payload: TPayload;
  readonly checksumAlgorithm?: "sha256";
  readonly checksum?: string;
}

export function createSaveEnvelope<TPayload>(
  schemaVersion: number,
  savedAtUtcMs: number,
  payload: TPayload,
): SaveEnvelope<TPayload> {
  return {
    schemaVersion,
    savedAtUtcMs,
    payload,
  };
}

export * from "./json-save-store";
export * from "./modular-save";