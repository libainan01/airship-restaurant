export const MODULAR_SAVE_FORMAT = "airship-restaurant";
export const MODULAR_SAVE_FORMAT_VERSION = 1;

export interface SaveModule<TPayload = unknown> {
  readonly schemaVersion: number;
  readonly payload: TPayload;
}

export interface ModularSaveDocument {
  readonly format: typeof MODULAR_SAVE_FORMAT;
  readonly formatVersion: typeof MODULAR_SAVE_FORMAT_VERSION;
  readonly runtimeRevision: number;
  readonly modules: Readonly<Record<string, SaveModule>>;
}

export type SaveModuleInput = Readonly<Record<string, SaveModule>>;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isSaveModule(value: unknown): value is SaveModule {
  return typeof value === "object" && value !== null &&
    "schemaVersion" in value && isPositiveInteger(value.schemaVersion) &&
    "payload" in value;
}

export function isModularSaveDocument(value: unknown): value is ModularSaveDocument {
  if (typeof value !== "object" || value === null ||
    !("format" in value) || value.format !== MODULAR_SAVE_FORMAT ||
    !("formatVersion" in value) || value.formatVersion !== MODULAR_SAVE_FORMAT_VERSION ||
    !("runtimeRevision" in value) || !isNonNegativeInteger(value.runtimeRevision) ||
    !("modules" in value) || typeof value.modules !== "object" || value.modules === null || Array.isArray(value.modules)) {
    return false;
  }
  return Object.entries(value.modules).every(([moduleId, module]) =>
    /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(moduleId) && isSaveModule(module),
  );
}

export function createModularSaveDocument(
  runtimeRevision: number,
  modules: SaveModuleInput,
): ModularSaveDocument {
  const document: ModularSaveDocument = {
    format: MODULAR_SAVE_FORMAT,
    formatVersion: MODULAR_SAVE_FORMAT_VERSION,
    runtimeRevision,
    modules: Object.freeze(Object.fromEntries(
      Object.entries(modules).map(([moduleId, module]) => [
        moduleId,
        Object.freeze({ schemaVersion: module.schemaVersion, payload: module.payload }),
      ]),
    )),
  };
  if (!isModularSaveDocument(document)) {
    throw new TypeError("Modular save document is invalid.");
  }
  return Object.freeze(document);
}

export function mergeSaveModules(
  source: ModularSaveDocument | null,
  replacements: SaveModuleInput,
  removedModuleIds: readonly string[] = [],
): Readonly<Record<string, SaveModule>> {
  const modules: Record<string, SaveModule> = source === null
    ? {}
    : { ...source.modules };
  for (const moduleId of removedModuleIds) delete modules[moduleId];
  for (const [moduleId, module] of Object.entries(replacements)) {
    modules[moduleId] = Object.freeze({
      schemaVersion: module.schemaVersion,
      payload: module.payload,
    });
  }
  return Object.freeze(modules);
}

export function getSaveModule<TPayload>(
  document: ModularSaveDocument,
  moduleId: string,
  schemaVersion: number,
  validatePayload: (value: unknown) => value is TPayload,
): SaveModule<TPayload> | null {
  const module = document.modules[moduleId];
  if (module === undefined || module.schemaVersion !== schemaVersion || !validatePayload(module.payload)) {
    return null;
  }
  return module as SaveModule<TPayload>;
}