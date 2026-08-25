import { DomainEventBus, TransactionScope, type DomainEvent } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { TransactionalFinancePort } from "../finance";
import {
  SceneLayoutModule,
  type BuildingInstanceState,
  type BuildingLayoutVariantDefinition,
  type PlacementValidationResult,
} from "../scene-layout";

export const BUILDING_UPGRADE_MODULE_ID = "module.building-upgrade";
export const BUILDING_UPGRADE_SCHEMA_VERSION = 1;

export interface BuildingUpgradeEditModePort {
  isEditModeActive(sceneId: string): boolean;
}

export interface BuildingUpgradePreviewState {
  readonly id: string;
  readonly buildingId: BuildingInstanceState["id"];
  readonly sourceLevel: number;
  readonly targetLevel: number;
  readonly costCopper: number;
  readonly sceneId: string;
  readonly requiresLayoutPreview: boolean;
  readonly placement: PlacementValidationResult;
  readonly createdAtUtcMs: number;
}

export interface BuildingUpgradeSnapshot {
  readonly revision: number;
  readonly previews: readonly BuildingUpgradePreviewState[];
}

export interface BuildingUpgradeState extends BuildingUpgradeSnapshot {
  readonly schemaVersion: typeof BUILDING_UPGRADE_SCHEMA_VERSION;
}

export type BuildingUpgradeRejectionCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_BUILDING"
  | "BUILDING_STORED"
  | "MAX_LEVEL"
  | "EDIT_MODE_REQUIRED"
  | "INSUFFICIENT_FUNDS"
  | "DUPLICATE_PREVIEW"
  | "UNKNOWN_PREVIEW"
  | "STALE_PREVIEW"
  | "PLACEMENT_INVALID"
  | "TRANSITION_BLOCKED"
  | "TRANSACTION_FAILED";

export type BuildingUpgradeResult<TValue = undefined> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: BuildingUpgradeRejectionCode;
      readonly message: string;
      readonly issues: readonly string[];
    };

interface UpgradeRejectedData {
  readonly code: BuildingUpgradeRejectionCode;
  readonly message: string;
  readonly issues: readonly string[];
}

class UpgradeRejected extends Error {
  constructor(readonly data: UpgradeRejectedData) {
    super(data.message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sameLayout(
  current: BuildingLayoutVariantDefinition,
  target: BuildingLayoutVariantDefinition,
): boolean {
  return JSON.stringify(current) === JSON.stringify(target);
}

function clonePreview(preview: BuildingUpgradePreviewState): BuildingUpgradePreviewState {
  return Object.freeze({
    ...preview,
    placement: Object.freeze({
      valid: preview.placement.valid,
      issues: Object.freeze(preview.placement.issues.map((issue) => Object.freeze({ ...issue }))),
      geometry: preview.placement.geometry === null
        ? null
        : Object.freeze({
            hardFootprints: Object.freeze(preview.placement.geometry.hardFootprints.map((entry) => Object.freeze({ ...entry }))),
            visualBounds: Object.freeze({ ...preview.placement.geometry.visualBounds }),
            interactionAreas: Object.freeze(preview.placement.geometry.interactionAreas.map((entry) => Object.freeze({
              ...entry,
              bounds: Object.freeze({ ...entry.bounds }),
            }))),
          }),
    }),
  });
}

function upgradeStateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isBuildingUpgradeState(value: unknown): value is BuildingUpgradeState {
  if (!upgradeStateRecord(value) || value.schemaVersion !== BUILDING_UPGRADE_SCHEMA_VERSION ||
    typeof value.revision !== "number" || !nonNegativeInteger(value.revision) ||
    !Array.isArray(value.previews)) return false;
  const ids = new Set<string>();
  return value.previews.every((preview) => {
    if (!upgradeStateRecord(preview) || typeof preview.id !== "string" || !validId(preview.id) ||
      ids.has(preview.id) || typeof preview.buildingId !== "string" || !validId(preview.buildingId) ||
      typeof preview.sourceLevel !== "number" || !nonNegativeInteger(preview.sourceLevel) || preview.sourceLevel < 1 ||
      typeof preview.targetLevel !== "number" || preview.targetLevel !== preview.sourceLevel + 1 ||
      typeof preview.costCopper !== "number" || !nonNegativeInteger(preview.costCopper) ||
      typeof preview.sceneId !== "string" || !validId(preview.sceneId) ||
      typeof preview.requiresLayoutPreview !== "boolean" ||
      typeof preview.createdAtUtcMs !== "number" || !nonNegativeInteger(preview.createdAtUtcMs) ||
      !upgradeStateRecord(preview.placement) || typeof preview.placement.valid !== "boolean" ||
      !Array.isArray(preview.placement.issues)) return false;
    ids.add(preview.id);
    return preview.placement.issues.every((issue) =>
      upgradeStateRecord(issue) && typeof issue.code === "string" && typeof issue.message === "string"
    );
  });
}
/** Coordinates the immediate, paid instance upgrade; capability rules stay in capability modules. */
export class BuildingUpgradeModule implements DomainModule {
  readonly moduleId = BUILDING_UPGRADE_MODULE_ID;
  readonly #finance: TransactionalFinancePort;
  readonly #layout: SceneLayoutModule;
  readonly #eventBus: DomainEventBus;
  readonly #transaction: TransactionScope;
  readonly #editMode: BuildingUpgradeEditModePort;
  readonly #previews = new Map<string, BuildingUpgradePreviewState>();
  #revision = 0;

  constructor(options: {
    readonly finance: TransactionalFinancePort;
    readonly layout: SceneLayoutModule;
    readonly eventBus: DomainEventBus;
    readonly editMode: BuildingUpgradeEditModePort;
    readonly initialState?: BuildingUpgradeState;
  }) {
    this.#finance = options.finance;
    this.#layout = options.layout;
    this.#eventBus = options.eventBus;
    this.#transaction = new TransactionScope(options.eventBus);
    this.#editMode = options.editMode;
    if (options.initialState !== undefined) {
      if (!isBuildingUpgradeState(options.initialState)) {
        throw new Error("Building upgrade restore state is invalid.");
      }
      this.#revision = options.initialState.revision;
      for (const saved of options.initialState.previews) {
        const building = this.#layout.getBuilding(saved.buildingId);
        const definition = building === null ? null : this.#layout.getDefinition(building.definitionId);
        const current = definition?.levels.find((entry) => entry.level === saved.sourceLevel);
        const target = definition?.levels.find((entry) => entry.level === saved.targetLevel);
        if (building === null || building.stored || building.sceneId !== saved.sceneId ||
          building.level !== saved.sourceLevel || current === undefined || target === undefined ||
          target.upgradeCostCopper !== saved.costCopper) {
          throw new Error(`Building upgrade preview is stale: ${saved.id}`);
        }
        const currentLayout = current.layouts[building.transform.orientation];
        const targetLayout = target.layouts[building.transform.orientation];
        if (currentLayout === undefined || targetLayout === undefined) {
          throw new Error(`Building upgrade preview orientation is unavailable: ${saved.id}`);
        }
        this.#previews.set(saved.id, clonePreview({
          ...saved,
          requiresLayoutPreview: !sameLayout(currentLayout, targetLayout),
          placement: this.#layout.validatePlacement(
            building.definitionId,
            saved.sceneId,
            building.transform,
            saved.targetLevel,
            building.id,
          ),
        }));
      }
    }
  }

  exportState(): BuildingUpgradeState {
    const snapshot = this.getSnapshot();
    return Object.freeze({
      schemaVersion: BUILDING_UPGRADE_SCHEMA_VERSION,
      revision: snapshot.revision,
      previews: snapshot.previews,
    });
  }

  getSnapshot(): BuildingUpgradeSnapshot {
    return Object.freeze({
      revision: this.#revision,
      previews: Object.freeze([...this.#previews.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clonePreview)),
    });
  }

  prepareUpgrade(
    operationId: string,
    previewId: string,
    buildingId: string,
    occurredAtUtcMs: number,
  ): BuildingUpgradeResult<BuildingUpgradePreviewState> {
    if (!validId(operationId) || !validId(previewId) || !validId(buildingId) ||
      !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building upgrade preview request is invalid.");
    }
    if (this.#previews.has(previewId)) {
      return this.#reject(operationId, "DUPLICATE_PREVIEW", `Duplicate building upgrade preview: ${previewId}`);
    }
    const building = this.#layout.getBuilding(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    if (building.stored || building.sceneId === null) {
      return this.#reject(operationId, "BUILDING_STORED", "Stored building must be placed before it can be upgraded.");
    }
    if (!this.#editMode.isEditModeActive(building.sceneId)) {
      return this.#reject(operationId, "EDIT_MODE_REQUIRED", "Building upgrades require paused scene edit mode.");
    }
    const definition = this.#layout.getDefinition(building.definitionId)!;
    const current = definition.levels.find((entry) => entry.level === building.level)!;
    const target = definition.levels.find((entry) => entry.level === building.level + 1);
    if (target === undefined) return this.#reject(operationId, "MAX_LEVEL", "Building is already at maximum level.");
    if (this.#finance.getSnapshot().availableCopper < target.upgradeCostCopper) {
      return this.#reject(operationId, "INSUFFICIENT_FUNDS", "Available balance is insufficient for this upgrade.");
    }
    const currentLayout = current.layouts[building.transform.orientation]!;
    const targetLayout = target.layouts[building.transform.orientation];
    if (targetLayout === undefined) {
      return this.#reject(operationId, "PLACEMENT_INVALID", "Target level does not support the current orientation.");
    }
    const placement = this.#layout.validatePlacement(
      building.definitionId,
      building.sceneId,
      building.transform,
      target.level,
      building.id,
    );
    const preview = clonePreview({
      id: previewId,
      buildingId: building.id,
      sourceLevel: building.level,
      targetLevel: target.level,
      costCopper: target.upgradeCostCopper,
      sceneId: building.sceneId,
      requiresLayoutPreview: !sameLayout(currentLayout, targetLayout),
      placement,
      createdAtUtcMs: occurredAtUtcMs,
    });
    this.#previews.set(previewId, preview);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-upgrade.preview-created", occurredAtUtcMs, preview));
    return this.#accept(operationId, clonePreview(preview));
  }

  confirmUpgrade(
    operationId: string,
    previewId: string,
    occurredAtUtcMs: number,
  ): BuildingUpgradeResult<BuildingInstanceState> {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) return this.#reject(operationId, "UNKNOWN_PREVIEW", `Unknown building upgrade preview: ${previewId}`);
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Building upgrade time is invalid.");
    const building = this.#layout.getBuilding(preview.buildingId);
    if (building === null || building.level !== preview.sourceLevel || building.sceneId !== preview.sceneId) {
      this.#previews.delete(previewId);
      this.#revision += 1;
      return this.#reject(operationId, "STALE_PREVIEW", "Building changed after the upgrade preview was created.");
    }
    if (!this.#editMode.isEditModeActive(preview.sceneId)) {
      return this.#reject(operationId, "EDIT_MODE_REQUIRED", "Building upgrades require paused scene edit mode.");
    }
    try {
      const transaction = this.#transaction.run([this.#finance, this.#layout], ({ emit }) => {
        const upgraded = this.#layout.upgradeBuilding(
          `${operationId}:layout`,
          preview.buildingId,
          preview.targetLevel,
          preview.costCopper,
          occurredAtUtcMs,
        );
        if (!upgraded.accepted) {
          throw new UpgradeRejected({
            code: upgraded.code === "TRANSITION_BLOCKED" ? "TRANSITION_BLOCKED" : "PLACEMENT_INVALID",
            message: upgraded.message,
            issues: upgraded.issues,
          });
        }
        const paid = this.#finance.payExpense(`${operationId}:finance`, {
          entryId: `ledger.building_upgrade_${preview.buildingId.replaceAll(".", "_")}_${preview.targetLevel}`,
          amountCopper: preview.costCopper,
          category: "building-purchase",
          occurredAtUtcMs,
          sourceType: "building-upgrade",
          sourceId: preview.buildingId,
          regionId: preview.sceneId,
        });
        if (!paid.accepted) {
          throw new UpgradeRejected({
            code: paid.code === "INSUFFICIENT_FUNDS" ? "INSUFFICIENT_FUNDS" : "TRANSACTION_FAILED",
            message: paid.message,
            issues: [paid.message],
          });
        }
        upgraded.events.forEach(emit);
        paid.events.forEach(emit);
        emit(this.#event(operationId, "building-upgrade.completed", occurredAtUtcMs, {
          previewId,
          buildingId: upgraded.value.id,
          sourceLevel: preview.sourceLevel,
          targetLevel: preview.targetLevel,
          costCopper: preview.costCopper,
        }));
        return upgraded.value;
      });
      this.#previews.delete(previewId);
      this.#revision += 1;
      return this.#accept(operationId, transaction.value);
    } catch (error: unknown) {
      if (error instanceof UpgradeRejected) {
        return this.#reject(operationId, error.data.code, error.data.message, error.data.issues);
      }
      return this.#reject(
        operationId,
        "TRANSACTION_FAILED",
        error instanceof Error ? error.message : "Building upgrade transaction failed.",
      );
    }
  }

  cancelUpgrade(
    operationId: string,
    previewId: string,
    occurredAtUtcMs: number,
  ): BuildingUpgradeResult<BuildingUpgradePreviewState> {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) return this.#reject(operationId, "UNKNOWN_PREVIEW", `Unknown building upgrade preview: ${previewId}`);
    this.#previews.delete(previewId);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-upgrade.preview-cancelled", occurredAtUtcMs, { previewId }));
    return this.#accept(operationId, clonePreview(preview));
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #accept<TValue>(operationId: string, value: TValue): BuildingUpgradeResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value });
  }

  #reject(
    operationId: string,
    code: BuildingUpgradeRejectionCode,
    message: string,
    issues: readonly string[] = [message],
  ): BuildingUpgradeResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      issues: Object.freeze([...issues]),
    });
  }
}
