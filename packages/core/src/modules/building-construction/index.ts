import {
  DomainEventBus,
  TransactionScope,
  type DomainEvent,
  type InstanceIdGenerator,
} from "../../kernel";
import type { DomainModule } from "../domain-module";
import {
  type FinanceOperationResult,
  FinanceModule,
} from "../finance";
import {
  type BuildingInstanceState,
  type BuildingTransformState,
  type PlacementValidationResult,
  SceneLayoutModule,
} from "../scene-layout";

export const BUILDING_CONSTRUCTION_MODULE_ID = "module.building-construction";

export interface EditModePausePort {
  pause(reason: "scene-edit-mode"): string;
  resume(token: string): void;
}

export interface BuildingUnlockPort {
  isBuildingUnlocked(definitionId: string): boolean;
}

export interface BuildingPreviewState {
  readonly id: string;
  readonly buildingInstanceId: string;
  readonly definitionId: string;
  readonly sceneId: string;
  readonly styleId: string;
  readonly level: number;
  readonly transform: BuildingTransformState | null;
  readonly placement: PlacementValidationResult | null;
  readonly costCopper: number;
  readonly reservationId: string | null;
  readonly free: boolean;
  readonly createdAtUtcMs: number;
}

export interface BuildingConstructionSnapshot {
  readonly revision: number;
  readonly editModeSceneId: string | null;
  readonly previews: readonly BuildingPreviewState[];
}

export type BuildingConstructionRejectionCode =
  | "INVALID_REQUEST"
  | "NOT_IN_EDIT_MODE"
  | "ALREADY_IN_EDIT_MODE"
  | "UNKNOWN_PREVIEW"
  | "BUILDING_LOCKED"
  | "UNKNOWN_DEFINITION"
  | "INSUFFICIENT_FUNDS"
  | "PLACEMENT_INVALID"
  | "RESERVATION_INVALID"
  | "TRANSACTION_FAILED";

export type BuildingConstructionResult<TValue = undefined> =
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
      readonly code: BuildingConstructionRejectionCode;
      readonly message: string;
      readonly issues: readonly string[];
    };

interface RejectedOperation {
  readonly code: BuildingConstructionRejectionCode;
  readonly message: string;
  readonly issues: readonly string[];
}

class CoordinatedOperationRejected extends Error {
  readonly rejection: RejectedOperation;

  constructor(rejection: RejectedOperation) {
    super(rejection.message);
    this.rejection = rejection;
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 160;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function clonePlacement(
  placement: PlacementValidationResult | null,
): PlacementValidationResult | null {
  if (placement === null) return null;
  return Object.freeze({
    valid: placement.valid,
    issues: Object.freeze(placement.issues.map((issue) => Object.freeze({ ...issue }))),
    geometry: placement.geometry === null
      ? null
      : Object.freeze({
          hardFootprints: Object.freeze(placement.geometry.hardFootprints.map((rect) => Object.freeze({ ...rect }))),
          visualBounds: Object.freeze({ ...placement.geometry.visualBounds }),
          interactionAreas: Object.freeze(placement.geometry.interactionAreas.map((area) => Object.freeze({
            ...area,
            bounds: Object.freeze({ ...area.bounds }),
          }))),
        }),
  });
}

function clonePreview(preview: BuildingPreviewState): BuildingPreviewState {
  return Object.freeze({
    ...preview,
    transform: preview.transform === null ? null : Object.freeze({ ...preview.transform }),
    placement: clonePlacement(preview.placement),
  });
}

export class BuildingConstructionModule implements DomainModule {
  readonly moduleId = BUILDING_CONSTRUCTION_MODULE_ID;
  readonly #finance: FinanceModule;
  readonly #layout: SceneLayoutModule;
  readonly #eventBus: DomainEventBus;
  readonly #transaction: TransactionScope;
  readonly #ids: InstanceIdGenerator;
  readonly #unlocks: BuildingUnlockPort;
  readonly #pausePort: EditModePausePort;
  #pauseToken: string | null = null;
  #editModeSceneId: string | null = null;
  #revision = 0;
  readonly #previews = new Map<string, BuildingPreviewState>();

  constructor(options: {
    readonly finance: FinanceModule;
    readonly layout: SceneLayoutModule;
    readonly eventBus: DomainEventBus;
    readonly instanceIds: InstanceIdGenerator;
    readonly unlocks: BuildingUnlockPort;
    readonly pausePort: EditModePausePort;
  }) {
    this.#finance = options.finance;
    this.#layout = options.layout;
    this.#eventBus = options.eventBus;
    this.#transaction = new TransactionScope(options.eventBus);
    this.#ids = options.instanceIds;
    this.#unlocks = options.unlocks;
    this.#pausePort = options.pausePort;
  }

  getSnapshot(): BuildingConstructionSnapshot {
    return Object.freeze({
      revision: this.#revision,
      editModeSceneId: this.#editModeSceneId,
      previews: Object.freeze(
        [...this.#previews.values()]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(clonePreview),
      ),
    });
  }

  enterEditMode(
    operationId: string,
    sceneId: string,
    occurredAtUtcMs: number,
  ): BuildingConstructionResult<string> {
    if (!validId(operationId) || !validId(sceneId) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Edit mode request is invalid.");
    }
    if (this.#editModeSceneId !== null) {
      return this.#reject(operationId, "ALREADY_IN_EDIT_MODE", "Scene edit mode is already active.");
    }
    const token = this.#pausePort.pause("scene-edit-mode");
    if (!validId(token)) throw new Error("Edit mode pause port returned an invalid token.");
    this.#pauseToken = token;
    this.#editModeSceneId = sceneId;
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.edit-mode-entered", occurredAtUtcMs, { sceneId }));
    return this.#accept(operationId, sceneId);
  }

  startPreview(
    operationId: string,
    previewId: string,
    definitionId: string,
    options: {
      readonly styleId?: string;
      readonly free?: boolean;
      readonly occurredAtUtcMs: number;
    },
  ): BuildingConstructionResult<BuildingPreviewState> {
    if (this.#editModeSceneId === null) {
      return this.#reject(operationId, "NOT_IN_EDIT_MODE", "Building preview requires edit mode.");
    }
    if (!validId(operationId) || !validId(previewId) || !validId(definitionId) ||
      !nonNegativeInteger(options.occurredAtUtcMs) || this.#previews.has(previewId)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building preview request is invalid.");
    }

    const definition = this.#layout.getDefinition(definitionId);
    if (definition === null) {
      return this.#reject(operationId, "UNKNOWN_DEFINITION", `Unknown building definition: ${definitionId}`);
    }
    if (!this.#unlocks.isBuildingUnlocked(definitionId)) {
      return this.#reject(operationId, "BUILDING_LOCKED", "Building is not unlocked.");
    }
    const free = options.free === true;
    const costCopper = free ? 0 : definition.buildCostCopper;
    const reservationId = free ? null : `reservation.building_${previewId.replaceAll(".", "_")}`;
    if (reservationId !== null) {
      const reservation = this.#coordinateFinance(() => this.#finance.reserveFunds(
        `${operationId}:reserve`,
        reservationId,
        costCopper,
        {
          sourceType: "building-preview",
          sourceId: previewId,
          regionId: this.#editModeSceneId!,
        },
        options.occurredAtUtcMs,
      ));
      if (!reservation.accepted) {
        return this.#reject(
          operationId,
          reservation.code === "INSUFFICIENT_FUNDS" ? "INSUFFICIENT_FUNDS" : "RESERVATION_INVALID",
          reservation.message,
        );
      }
    }
    const preview = clonePreview({
      id: previewId,
      buildingInstanceId: this.#ids.next("building"),
      definitionId,
      sceneId: this.#editModeSceneId,
      styleId: options.styleId ?? definition.defaultStyleId,
      level: 1,
      transform: null,
      placement: null,
      costCopper,
      reservationId,
      free,
      createdAtUtcMs: options.occurredAtUtcMs,
    });
    this.#previews.set(previewId, preview);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.preview-created", options.occurredAtUtcMs, {
      previewId,
      buildingInstanceId: preview.buildingInstanceId,
      definitionId,
      costCopper,
      reservationId,
    }));
    return this.#accept(operationId, clonePreview(preview));
  }

  updatePreviewPlacement(
    operationId: string,
    previewId: string,
    transform: BuildingTransformState,
    occurredAtUtcMs: number,
  ): BuildingConstructionResult<BuildingPreviewState> {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) {
      return this.#reject(operationId, "UNKNOWN_PREVIEW", `Unknown building preview: ${previewId}`);
    }
    const placement = this.#layout.validatePlacement(
      preview.definitionId,
      preview.sceneId,
      transform,
      preview.level,
    );
    const next = clonePreview({
      ...preview,
      transform: Object.freeze({ ...transform }),
      placement,
    });
    this.#previews.set(previewId, next);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.preview-updated", occurredAtUtcMs, {
      previewId,
      valid: placement.valid,
      issues: placement.issues,
    }));
    return this.#accept(operationId, clonePreview(next));
  }

  confirmPreview(
    operationId: string,
    previewId: string,
    occurredAtUtcMs: number,
  ): BuildingConstructionResult<BuildingInstanceState> {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) {
      return this.#reject(operationId, "UNKNOWN_PREVIEW", `Unknown building preview: ${previewId}`);
    }
    if (preview.transform === null || preview.placement?.valid !== true) {
      const issues = preview.placement?.issues.map((issue) => issue.message) ?? [];
      this.#discardPreview(`${operationId}:invalid`, preview, occurredAtUtcMs);
      return this.#reject(
        operationId,
        "PLACEMENT_INVALID",
        "Building preview does not have a valid placement.",
        issues,
      );
    }
    if (!this.#unlocks.isBuildingUnlocked(preview.definitionId)) {
      this.#discardPreview(`${operationId}:locked`, preview, occurredAtUtcMs);
      return this.#reject(operationId, "BUILDING_LOCKED", "Building became locked before confirmation.");
    }
    try {
      const result = this.#transaction.run(
        preview.reservationId === null ? [this.#layout] : [this.#finance, this.#layout],
        ({ emit }) => {
          const placed = this.#layout.placeBuilding(`${operationId}:place`, {
            instanceId: preview.buildingInstanceId as BuildingInstanceState["id"],
            definitionId: preview.definitionId,
            sceneId: preview.sceneId,
            transform: preview.transform!,
            styleId: preview.styleId,
            level: preview.level,
            totalInvestmentCopper: preview.costCopper,
            occurredAtUtcMs,
          });
          if (!placed.accepted) {
            throw new CoordinatedOperationRejected({
              code: "PLACEMENT_INVALID",
              message: placed.message,
              issues: placed.issues,
            });
          }
          placed.events.forEach(emit);
          if (preview.reservationId !== null) {
            const committed = this.#finance.commitReservation(
              `${operationId}:commit-funds`,
              preview.reservationId,
              `ledger.building_${preview.buildingInstanceId.replaceAll(".", "_")}`,
              "building-purchase",
              occurredAtUtcMs,
              preview.costCopper,
            );
            if (!committed.accepted) {
              throw new CoordinatedOperationRejected({
                code: "RESERVATION_INVALID",
                message: committed.message,
                issues: [committed.message],
              });
            }
            committed.events.forEach(emit);
          }
          emit(this.#event(operationId, "building-construction.preview-confirmed", occurredAtUtcMs, {
            previewId,
            buildingInstanceId: placed.value.id,
          }));
          return placed.value;
        },
      );
      this.#previews.delete(previewId);
      this.#revision += 1;
      return this.#accept(operationId, result.value);
    } catch (error: unknown) {
      this.#discardPreview(`${operationId}:rollback`, preview, occurredAtUtcMs);
      if (error instanceof CoordinatedOperationRejected) {
        return this.#reject(
          operationId,
          error.rejection.code,
          error.rejection.message,
          error.rejection.issues,
        );
      }
      return this.#reject(
        operationId,
        "TRANSACTION_FAILED",
        error instanceof Error ? error.message : "Building confirmation transaction failed.",
      );
    }
  }

  cancelPreview(
    operationId: string,
    previewId: string,
    occurredAtUtcMs: number,
  ): BuildingConstructionResult<BuildingPreviewState> {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) {
      return this.#reject(operationId, "UNKNOWN_PREVIEW", `Unknown building preview: ${previewId}`);
    }
    if (preview.reservationId !== null) {
      const released = this.#coordinateFinance(() => this.#finance.releaseReservation(
        `${operationId}:release`,
        preview.reservationId!,
        occurredAtUtcMs,
      ));
      if (!released.accepted) {
        return this.#reject(operationId, "RESERVATION_INVALID", released.message);
      }
    }
    this.#previews.delete(previewId);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.preview-cancelled", occurredAtUtcMs, {
      previewId,
      reservationId: preview.reservationId,
    }));
    return this.#accept(operationId, clonePreview(preview));
  }

  exitEditMode(
    operationId: string,
    occurredAtUtcMs: number,
  ): BuildingConstructionResult<string> {
    if (this.#editModeSceneId === null || this.#pauseToken === null) {
      return this.#reject(operationId, "NOT_IN_EDIT_MODE", "Scene edit mode is not active.");
    }
    for (const preview of [...this.#previews.values()]) {
      const cancelled = this.cancelPreview(
        `${operationId}:cancel:${preview.id}`,
        preview.id,
        occurredAtUtcMs,
      );
      if (!cancelled.accepted) return cancelled;
    }
    const sceneId = this.#editModeSceneId;
    const token = this.#pauseToken;
    this.#editModeSceneId = null;
    this.#pauseToken = null;
    this.#pausePort.resume(token);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.edit-mode-exited", occurredAtUtcMs, { sceneId }));
    return this.#accept(operationId, sceneId);
  }

  #discardPreview(
    operationId: string,
    preview: BuildingPreviewState,
    occurredAtUtcMs: number,
  ): void {
    if (preview.reservationId !== null) {
      const released = this.#coordinateFinance(() => this.#finance.releaseReservation(
        `${operationId}:release`,
        preview.reservationId!,
        occurredAtUtcMs,
      ));
      if (!released.accepted && released.code !== "UNKNOWN_RESERVATION") {
        throw new Error(`Failed to release rejected building preview: ${released.message}`);
      }
    }
    this.#previews.delete(preview.id);
    this.#revision += 1;
    this.#eventBus.publish(this.#event(operationId, "building-construction.preview-discarded", occurredAtUtcMs, {
      previewId: preview.id,
      reservationId: preview.reservationId,
    }));
  }
  #coordinateFinance<TValue>(
    action: () => FinanceOperationResult<TValue>,
  ): FinanceOperationResult<TValue> {
    try {
      return this.#transaction.run([this.#finance], ({ emit }) => {
        const result = action();
        if (!result.accepted) {
          throw new CoordinatedOperationRejected({
            code: result.code === "INSUFFICIENT_FUNDS" ? "INSUFFICIENT_FUNDS" : "RESERVATION_INVALID",
            message: result.message,
            issues: [result.message],
          });
        }
        result.events.forEach(emit);
        return result;
      }).value;
    } catch (error: unknown) {
      if (error instanceof CoordinatedOperationRejected) {
        return Object.freeze({
          accepted: false,
          changed: false,
          operationId: "coordinated-finance-operation",
          code: error.rejection.code === "INSUFFICIENT_FUNDS"
            ? "INSUFFICIENT_FUNDS"
            : "INVALID_REQUEST",
          message: error.rejection.message,
          events: [] as const,
        });
      }
      throw error;
    }
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

  #accept<TValue>(operationId: string, value: TValue): BuildingConstructionResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value });
  }

  #reject(
    operationId: string,
    code: BuildingConstructionRejectionCode,
    message: string,
    issues: readonly string[] = [message],
  ): BuildingConstructionResult<never> {
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
