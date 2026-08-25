import type {
  DomainEvent,
  InstanceId,
  SubresourceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { createSubresourceId, instanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";

export const SCENE_LAYOUT_MODULE_ID = "module.scene-layout";
export const SCENE_LAYOUT_SCHEMA_VERSION = 1;

export interface Rect2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface ScenePlacementRegion {
  readonly id: string;
  readonly tag: string;
  readonly bounds: Rect2D;
}

export interface SceneLayoutDefinition {
  readonly id: string;
  readonly placementRegions: readonly ScenePlacementRegion[];
}

export interface BuildingInteractionAreaDefinition {
  readonly id: string;
  readonly bounds: Rect2D;
  readonly required: boolean;
}

export interface BuildingLayoutVariantDefinition {
  readonly hardFootprints: readonly Rect2D[];
  readonly visualBounds: Rect2D;
  readonly interactionAreas: readonly BuildingInteractionAreaDefinition[];
}

export interface BuildingComponentDefinition {
  readonly slotId: string;
  readonly capabilityId: string;
}

export interface BuildingLevelRuntimeDefinition {
  readonly level: number;
  readonly layouts: Readonly<Record<string, BuildingLayoutVariantDefinition>>;
  readonly components: readonly BuildingComponentDefinition[];
  readonly upgradeCostCopper: number;
  readonly maxDurability: number;
  readonly capabilityValues?: Readonly<Record<string, number>>;
}

export interface BuildingRuntimeDefinition {
  readonly id: string;
  readonly buildCostCopper: number;
  readonly allowedRegionTags: readonly string[];
  readonly styleIds: readonly string[];
  readonly defaultStyleId: string;
  readonly defaultOrientation: string;
  readonly necessary: boolean;
  readonly movable: boolean;
  readonly storable: boolean;
  readonly removable: boolean;
  readonly levels: readonly BuildingLevelRuntimeDefinition[];
}

export interface BuildingComponentInstanceState {
  readonly slotId: string;
  readonly capabilityId: string;
  readonly componentId: SubresourceId;
}

export interface BuildingTransformState extends Point2D {
  readonly orientation: string;
}

export interface BuildingInstanceState {
  readonly id: InstanceId;
  readonly definitionId: string;
  readonly sceneId: string | null;
  readonly transform: BuildingTransformState;
  readonly styleId: string;
  readonly level: number;
  readonly durability: number;
  readonly enabled: boolean;
  readonly stored: boolean;
  readonly totalInvestmentCopper: number;
  readonly components: readonly BuildingComponentInstanceState[];
}

export interface SceneLayoutState {
  readonly schemaVersion: typeof SCENE_LAYOUT_SCHEMA_VERSION;
  readonly revision: number;
  readonly buildings: readonly BuildingInstanceState[];
  readonly processedOperationIds: readonly string[];
}

export interface BuildingWorldGeometry {
  readonly hardFootprints: readonly Rect2D[];
  readonly visualBounds: Rect2D;
  readonly interactionAreas: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly bounds: Rect2D;
  }[];
}

export interface BuildingLayoutSnapshot extends BuildingInstanceState {
  readonly capabilityValues: Readonly<Record<string, number>>;
  readonly worldGeometry: BuildingWorldGeometry | null;
  readonly renderSortY: number;
}

export interface SceneLayoutSnapshot {
  readonly schemaVersion: typeof SCENE_LAYOUT_SCHEMA_VERSION;
  readonly revision: number;
  readonly buildings: readonly BuildingLayoutSnapshot[];
}

export type BuildingTransitionKind = "upgrade" | "store" | "remove" | "disable";

export interface BuildingTransitionConstraintRequest {
  readonly kind: BuildingTransitionKind;
  readonly current: BuildingInstanceState;
  readonly target: BuildingInstanceState | null;
  readonly removedComponentIds: readonly SubresourceId[];
}

export interface BuildingTransitionConstraintPort {
  validate(request: BuildingTransitionConstraintRequest): readonly string[];
}

export type PlacementFailureCode =
  | "UNKNOWN_SCENE"
  | "UNKNOWN_DEFINITION"
  | "UNKNOWN_LEVEL"
  | "UNKNOWN_ORIENTATION"
  | "INVALID_TRANSFORM"
  | "OUTSIDE_ALLOWED_REGION"
  | "HARD_FOOTPRINT_OVERLAP"
  | "INTERACTION_AREA_BLOCKED";

export interface PlacementIssue {
  readonly code: PlacementFailureCode;
  readonly message: string;
  readonly conflictingBuildingId?: InstanceId;
}

export interface PlacementValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PlacementIssue[];
  readonly geometry: BuildingWorldGeometry | null;
}

export type SceneLayoutRejectionCode =
  | PlacementFailureCode
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_INSTANCE"
  | "UNKNOWN_BUILDING"
  | "STYLE_NOT_ALLOWED"
  | "BUILDING_NOT_MOVABLE"
  | "BUILDING_NOT_STORABLE"
  | "BUILDING_NOT_REMOVABLE"
  | "BUILDING_IS_NECESSARY"
  | "TRANSITION_BLOCKED";

export type SceneLayoutOperationResult<TValue = undefined> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly events: readonly DomainEvent[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: SceneLayoutRejectionCode;
      readonly message: string;
      readonly issues: readonly string[];
      readonly events: readonly [];
    };

export interface PlaceBuildingRequest {
  readonly instanceId: InstanceId;
  readonly definitionId: string;
  readonly sceneId: string;
  readonly transform: BuildingTransformState;
  readonly styleId?: string;
  readonly level?: number;
  readonly durability?: number;
  readonly totalInvestmentCopper: number;
  readonly occurredAtUtcMs: number;
}

const OPERATION_HISTORY_LIMIT = 2_048;

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 160;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validRect(rect: Rect2D): boolean {
  return finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height) &&
    rect.width > 0 && rect.height > 0;
}

function translateRect(rect: Rect2D, transform: BuildingTransformState): Rect2D {
  return Object.freeze({
    x: rect.x + transform.x,
    y: rect.y + transform.y,
    width: rect.width,
    height: rect.height,
  });
}

function overlaps(left: Rect2D, right: Rect2D): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
}

function contains(outer: Rect2D, inner: Rect2D): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function cloneGeometry(geometry: BuildingWorldGeometry): BuildingWorldGeometry {
  return Object.freeze({
    hardFootprints: Object.freeze(geometry.hardFootprints.map((rect) => Object.freeze({ ...rect }))),
    visualBounds: Object.freeze({ ...geometry.visualBounds }),
    interactionAreas: Object.freeze(geometry.interactionAreas.map((area) => Object.freeze({
      ...area,
      bounds: Object.freeze({ ...area.bounds }),
    }))),
  });
}

function cloneBuilding(building: BuildingInstanceState): BuildingInstanceState {
  return Object.freeze({
    ...building,
    transform: Object.freeze({ ...building.transform }),
    components: Object.freeze(building.components.map((component) => Object.freeze({ ...component }))),
  });
}

function cloneState(state: SceneLayoutState): SceneLayoutState {
  return Object.freeze({
    ...state,
    buildings: Object.freeze(state.buildings.map(cloneBuilding)),
    processedOperationIds: Object.freeze([...state.processedOperationIds]),
  });
}

function componentId(ownerId: InstanceId, slotId: string): SubresourceId {
  return createSubresourceId(ownerId, slotId.replaceAll(".", "_"));
}

function stateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stateId(value: unknown): value is string {
  return typeof value === "string" && validId(value);
}

/** Structural save validation; definition compatibility is rechecked by the module constructor. */
export function isSceneLayoutState(value: unknown): value is SceneLayoutState {
  if (!stateRecord(value) || value.schemaVersion !== SCENE_LAYOUT_SCHEMA_VERSION ||
    typeof value.revision !== "number" || !nonNegativeInteger(value.revision) || !Array.isArray(value.buildings) ||
    !Array.isArray(value.processedOperationIds)) return false;
  const buildingIds = new Set<string>();
  for (const candidate of value.buildings) {
    if (!stateRecord(candidate) || !stateId(candidate.id) ||
      buildingIds.has(candidate.id as string) || !stateId(candidate.definitionId) ||
      !(candidate.sceneId === null || stateId(candidate.sceneId)) ||
      !stateRecord(candidate.transform) || !finite(candidate.transform.x as number) ||
      !finite(candidate.transform.y as number) || !stateId(candidate.transform.orientation) ||
      !stateId(candidate.styleId) || !positiveInteger(candidate.level as number) ||
      !finite(candidate.durability as number) || (candidate.durability as number) < 0 ||
      typeof candidate.enabled !== "boolean" || typeof candidate.stored !== "boolean" ||
      !nonNegativeInteger(candidate.totalInvestmentCopper as number) ||
      !Array.isArray(candidate.components)) return false;
    buildingIds.add(candidate.id as string);
    const slots = new Set<string>();
    for (const component of candidate.components) {
      if (!stateRecord(component) || !stateId(component.slotId) ||
        slots.has(component.slotId as string) || !stateId(component.capabilityId) ||
        !stateId(component.componentId)) return false;
      slots.add(component.slotId as string);
    }
  }
  return value.processedOperationIds.every((entry) => typeof entry === "string" && validId(entry)) &&
    new Set(value.processedOperationIds).size === value.processedOperationIds.length;
}
export class SceneLayoutModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = SCENE_LAYOUT_MODULE_ID;
  readonly transactionParticipantId = SCENE_LAYOUT_MODULE_ID;
  readonly #scenes = new Map<string, SceneLayoutDefinition>();
  readonly #definitions = new Map<string, BuildingRuntimeDefinition>();
  readonly #constraints: BuildingTransitionConstraintPort;
  #state: SceneLayoutState;
  #transactionActive = false;

  constructor(
    scenes: readonly SceneLayoutDefinition[],
    definitions: readonly BuildingRuntimeDefinition[],
    constraints: BuildingTransitionConstraintPort = { validate: () => [] },
    initialState?: SceneLayoutState,
  ) {
    if (scenes.length === 0 || definitions.length === 0) {
      throw new Error("SceneLayout requires scenes and building definitions.");
    }
    for (const scene of scenes) this.#registerScene(scene);
    for (const definition of definitions) this.#registerDefinition(definition);
    this.#constraints = constraints;
    this.#state = initialState === undefined
      ? cloneState({
          schemaVersion: SCENE_LAYOUT_SCHEMA_VERSION,
          revision: 0,
          buildings: [],
          processedOperationIds: [],
        })
      : cloneState(initialState);
    this.#validateState();
  }

  exportState(): SceneLayoutState {
    return cloneState(this.#state);
  }

  getSnapshot(): SceneLayoutSnapshot {
    const buildings = this.#state.buildings.map((building): BuildingLayoutSnapshot => {
      const geometry = building.stored ? null : this.#geometry(building);
      return Object.freeze({
        capabilityValues: Object.freeze({ ...(this.#level(building).capabilityValues ?? {}) }),
        ...cloneBuilding(building),
        worldGeometry: geometry === null ? null : cloneGeometry(geometry),
        renderSortY: geometry === null
          ? building.transform.y
          : geometry.visualBounds.y + geometry.visualBounds.height,
      });
    }).sort((left, right) =>
      left.renderSortY - right.renderSortY || left.id.localeCompare(right.id),
    );
    return Object.freeze({
      schemaVersion: SCENE_LAYOUT_SCHEMA_VERSION,
      revision: this.#state.revision,
      buildings: Object.freeze(buildings),
    });
  }

  getBuilding(buildingId: string): BuildingInstanceState | null {
    const building = this.#state.buildings.find((value) => value.id === buildingId);
    return building === undefined ? null : cloneBuilding(building);
  }

  getDefinition(definitionId: string): BuildingRuntimeDefinition | null {
    return this.#definitions.get(definitionId) ?? null;
  }

  validatePlacement(
    definitionId: string,
    sceneId: string,
    transform: BuildingTransformState,
    level = 1,
    excludedBuildingId?: string,
  ): PlacementValidationResult {
    const issues: PlacementIssue[] = [];
    const scene = this.#scenes.get(sceneId);
    const definition = this.#definitions.get(definitionId);
    if (scene === undefined) issues.push({ code: "UNKNOWN_SCENE", message: `Unknown scene: ${sceneId}` });
    if (definition === undefined) issues.push({ code: "UNKNOWN_DEFINITION", message: `Unknown building definition: ${definitionId}` });
    if (!finite(transform.x) || !finite(transform.y) || !validId(transform.orientation)) {
      issues.push({ code: "INVALID_TRANSFORM", message: "Building transform is invalid." });
    }
    const levelDefinition = definition?.levels.find((value) => value.level === level);
    if (definition !== undefined && levelDefinition === undefined) {
      issues.push({ code: "UNKNOWN_LEVEL", message: `Unknown building level: ${level}` });
    }
    const layout = levelDefinition?.layouts[transform.orientation];
    if (levelDefinition !== undefined && layout === undefined) {
      issues.push({ code: "UNKNOWN_ORIENTATION", message: `Orientation is unavailable: ${transform.orientation}` });
    }
    if (scene === undefined || definition === undefined || layout === undefined || issues.length > 0) {
      return Object.freeze({ valid: false, issues: Object.freeze(issues), geometry: null });
    }
    const geometry: BuildingWorldGeometry = Object.freeze({
      hardFootprints: Object.freeze(layout.hardFootprints.map((rect) => translateRect(rect, transform))),
      visualBounds: translateRect(layout.visualBounds, transform),
      interactionAreas: Object.freeze(layout.interactionAreas.map((area) => Object.freeze({
        id: area.id,
        required: area.required,
        bounds: translateRect(area.bounds, transform),
      }))),
    });
    for (const footprint of geometry.hardFootprints) {
      const allowed = scene.placementRegions.some((region) =>
        definition.allowedRegionTags.includes(region.tag) && contains(region.bounds, footprint),
      );
      if (!allowed) {
        issues.push({
          code: "OUTSIDE_ALLOWED_REGION",
          message: `Building footprint is outside an allowed region in scene ${sceneId}.`,
        });
      }
    }
    for (const other of this.#state.buildings) {
      if (other.stored || other.id === excludedBuildingId || other.sceneId !== sceneId) continue;
      const otherGeometry = this.#geometry(other);
      if (geometry.hardFootprints.some((left) => otherGeometry.hardFootprints.some((right) => overlaps(left, right)))) {
        issues.push({
          code: "HARD_FOOTPRINT_OVERLAP",
          message: `Building hard footprint overlaps ${other.id}.`,
          conflictingBuildingId: other.id,
        });
      }
      const candidateBlocked = geometry.interactionAreas.some((area) =>
        area.required && otherGeometry.hardFootprints.some((rect) => overlaps(area.bounds, rect)),
      );
      const otherBlocked = otherGeometry.interactionAreas.some((area) =>
        area.required && geometry.hardFootprints.some((rect) => overlaps(area.bounds, rect)),
      );
      if (candidateBlocked || otherBlocked) {
        issues.push({
          code: "INTERACTION_AREA_BLOCKED",
          message: `Required interaction area conflicts with ${other.id}.`,
          conflictingBuildingId: other.id,
        });
      }
    }
    return Object.freeze({
      valid: issues.length === 0,
      issues: Object.freeze(issues),
      geometry: cloneGeometry(geometry),
    });
  }

  placeBuilding(
    operationId: string,
    request: PlaceBuildingRequest,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    if (this.#state.buildings.some((building) => building.id === request.instanceId)) {
      return this.#reject(operationId, "DUPLICATE_INSTANCE", "Building instance id already exists.");
    }
    const definition = this.#definitions.get(request.definitionId);
    const level = request.level ?? 1;
    const validation = this.validatePlacement(
      request.definitionId,
      request.sceneId,
      request.transform,
      level,
    );
    if (!validation.valid || definition === undefined) return this.#placementRejection(operationId, validation);
    const levelDefinition = definition.levels.find((value) => value.level === level)!;
    const styleId = request.styleId ?? definition.defaultStyleId;
    if (!definition.styleIds.includes(styleId)) {
      return this.#reject(operationId, "STYLE_NOT_ALLOWED", `Style is unavailable: ${styleId}`);
    }
    if (!nonNegativeInteger(request.totalInvestmentCopper) ||
      !nonNegativeInteger(request.occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building placement request is invalid.");
    }
    const durability = request.durability ?? levelDefinition.maxDurability;
    if (!finite(durability) || durability < 0 || durability > levelDefinition.maxDurability) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building durability is invalid.");
    }
    const building = Object.freeze({
      id: request.instanceId,
      definitionId: request.definitionId,
      sceneId: request.sceneId,
      transform: Object.freeze({ ...request.transform }),
      styleId,
      level,
      durability,
      enabled: true,
      stored: false,
      totalInvestmentCopper: request.totalInvestmentCopper,
      components: this.#components(request.instanceId, levelDefinition),
    });
    this.#replace({ buildings: [...this.#state.buildings, building] });
    return this.#accept(operationId, building, [
      this.#event(operationId, "scene-layout.building-placed", request.occurredAtUtcMs, building),
      this.#event(operationId, "scene-layout.geometry-changed", request.occurredAtUtcMs, {
        buildingId: building.id,
        sceneId: building.sceneId,
      }),
    ]);
  }

  moveBuilding(
    operationId: string,
    buildingId: string,
    sceneId: string,
    transform: BuildingTransformState,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    const definition = this.#definitions.get(building.definitionId)!;
    if (!definition.movable) return this.#reject(operationId, "BUILDING_NOT_MOVABLE", "Building cannot be moved.");
    const validation = this.validatePlacement(building.definitionId, sceneId, transform, building.level, building.id);
    if (!validation.valid) return this.#placementRejection(operationId, validation);
    const next = cloneBuilding({ ...building, sceneId, transform: Object.freeze({ ...transform }), stored: false });
    this.#updateBuilding(next);
    return this.#accept(operationId, next, [
      this.#event(operationId, "scene-layout.building-moved", occurredAtUtcMs, {
        buildingId: next.id,
        sceneId,
        transform: next.transform,
      }),
      this.#event(operationId, "scene-layout.interaction-points-changed", occurredAtUtcMs, { buildingId: next.id }),
      this.#event(operationId, "scene-layout.connection-routes-changed", occurredAtUtcMs, { buildingId: next.id }),
    ]);
  }

  changeStyle(
    operationId: string,
    buildingId: string,
    styleId: string,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    const definition = this.#definitions.get(building.definitionId)!;
    if (!definition.styleIds.includes(styleId)) {
      return this.#reject(operationId, "STYLE_NOT_ALLOWED", `Style is unavailable: ${styleId}`);
    }
    if (building.styleId === styleId) return this.#noChange(operationId, building);
    const next = cloneBuilding({ ...building, styleId });
    this.#updateBuilding(next);
    return this.#accept(operationId, next, [
      this.#event(operationId, "scene-layout.building-style-changed", occurredAtUtcMs, {
        buildingId: next.id,
        styleId,
      }),
    ]);
  }

  upgradeBuilding(
    operationId: string,
    buildingId: string,
    targetLevel: number,
    additionalInvestmentCopper: number,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    const definition = this.#definitions.get(building.definitionId)!;
    const level = definition.levels.find((value) => value.level === targetLevel);
    if (targetLevel !== building.level + 1 || level === undefined || !nonNegativeInteger(additionalInvestmentCopper)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building target level or investment is invalid.");
    }
    if (!building.stored && building.sceneId !== null) {
      const validation = this.validatePlacement(
        building.definitionId,
        building.sceneId,
        building.transform,
        targetLevel,
        building.id,
      );
      if (!validation.valid) return this.#placementRejection(operationId, validation);
    }
    const nextComponents = this.#components(building.id, level);
    const nextComponentIds = new Set(nextComponents.map((component) => component.componentId));
    const removed = building.components
      .filter((component) => !nextComponentIds.has(component.componentId))
      .map((component) => component.componentId);
    const next = cloneBuilding({
      ...building,
      level: targetLevel,
      durability: Math.min(building.durability, level.maxDurability),
      totalInvestmentCopper: building.totalInvestmentCopper + additionalInvestmentCopper,
      components: nextComponents,
    });
    const blocked = this.#constraints.validate({
      kind: "upgrade",
      current: building,
      target: next,
      removedComponentIds: removed,
    });
    if (blocked.length > 0) return this.#blocked(operationId, blocked);
    this.#updateBuilding(next);
    return this.#accept(operationId, next, [
      this.#event(operationId, "scene-layout.building-upgraded", occurredAtUtcMs, {
        buildingId: next.id,
        level: targetLevel,
      }),
      this.#event(operationId, "scene-layout.capabilities-changed", occurredAtUtcMs, {
        buildingId: next.id,
        componentIds: next.components.map((component) => component.componentId),
      }),
    ]);
  }

  storeBuilding(
    operationId: string,
    buildingId: string,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    return this.#withdrawFromScene(operationId, buildingId, occurredAtUtcMs, "store");
  }

  removeBuilding(
    operationId: string,
    buildingId: string,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    return this.#withdrawFromScene(operationId, buildingId, occurredAtUtcMs, "remove");
  }

  setEnabled(
    operationId: string,
    buildingId: string,
    enabled: boolean,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    if (building.enabled === enabled) return this.#noChange(operationId, building);
    if (!enabled) {
      const blocked = this.#constraints.validate({
        kind: "disable",
        current: building,
        target: cloneBuilding({ ...building, enabled }),
        removedComponentIds: building.components.map((component) => component.componentId),
      });
      if (blocked.length > 0) return this.#blocked(operationId, blocked);
    }
    const next = cloneBuilding({ ...building, enabled });
    this.#updateBuilding(next);
    return this.#accept(operationId, next, [
      this.#event(operationId, "scene-layout.building-enabled-changed", occurredAtUtcMs, {
        buildingId: next.id,
        enabled,
      }),
    ]);
  }

  setDurability(
    operationId: string,
    buildingId: string,
    durability: number,
    occurredAtUtcMs: number,
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    const level = this.#level(building);
    if (!finite(durability) || durability < 0 || durability > level.maxDurability) {
      return this.#reject(operationId, "INVALID_REQUEST", "Building durability is invalid.");
    }
    if (durability === building.durability) return this.#noChange(operationId, building);
    const next = cloneBuilding({ ...building, durability });
    this.#updateBuilding(next);
    return this.#accept(operationId, next, [
      this.#event(operationId, "scene-layout.building-durability-changed", occurredAtUtcMs, {
        buildingId: next.id,
        durability,
      }),
    ]);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("SceneLayout transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = cloneState(checkpoint);
        this.#transactionActive = false;
      },
    };
  }

  #withdrawFromScene(
    operationId: string,
    buildingId: string,
    occurredAtUtcMs: number,
    kind: "store" | "remove",
  ): SceneLayoutOperationResult<BuildingInstanceState> {
    const prepared = this.#prepare(operationId);
    if (prepared !== null) return prepared;
    const building = this.#find(buildingId);
    if (building === null) return this.#reject(operationId, "UNKNOWN_BUILDING", `Unknown building: ${buildingId}`);
    const definition = this.#definitions.get(building.definitionId)!;
    if (definition.necessary) return this.#reject(operationId, "BUILDING_IS_NECESSARY", "Necessary building cannot be removed or stored.");
    if (kind === "store" && !definition.storable) return this.#reject(operationId, "BUILDING_NOT_STORABLE", "Building cannot be stored.");
    if (kind === "remove" && !definition.removable) return this.#reject(operationId, "BUILDING_NOT_REMOVABLE", "Building cannot be removed.");
    const target = kind === "store"
      ? cloneBuilding({ ...building, sceneId: null, stored: true, enabled: false })
      : null;
    const blocked = this.#constraints.validate({
      kind,
      current: building,
      target,
      removedComponentIds: building.components.map((component) => component.componentId),
    });
    if (blocked.length > 0) return this.#blocked(operationId, blocked);
    if (target === null) {
      this.#replace({ buildings: this.#state.buildings.filter((value) => value.id !== building.id) });
    } else {
      this.#updateBuilding(target);
    }
    return this.#accept(operationId, target ?? building, [
      this.#event(
        operationId,
        kind === "store" ? "scene-layout.building-stored" : "scene-layout.building-removed",
        occurredAtUtcMs,
        { buildingId: building.id, componentIds: building.components.map((component) => component.componentId) },
      ),
      this.#event(operationId, "scene-layout.capabilities-changed", occurredAtUtcMs, { buildingId: building.id }),
    ]);
  }

  #registerScene(scene: SceneLayoutDefinition): void {
    if (!validId(scene.id) || this.#scenes.has(scene.id) || scene.placementRegions.length === 0) {
      throw new Error(`Invalid scene layout definition: ${scene.id}`);
    }
    const regionIds = new Set<string>();
    for (const region of scene.placementRegions) {
      if (!validId(region.id) || !validId(region.tag) || !validRect(region.bounds) || regionIds.has(region.id)) {
        throw new Error(`Invalid placement region in scene: ${scene.id}`);
      }
      regionIds.add(region.id);
    }
    this.#scenes.set(scene.id, scene);
  }

  #registerDefinition(definition: BuildingRuntimeDefinition): void {
    if (!validId(definition.id) || this.#definitions.has(definition.id) ||
      !nonNegativeInteger(definition.buildCostCopper) || definition.allowedRegionTags.length === 0 ||
      definition.styleIds.length === 0 || !definition.styleIds.includes(definition.defaultStyleId) ||
      definition.levels.length === 0) {
      throw new Error(`Invalid building runtime definition: ${definition.id}`);
    }
    const levels = new Set<number>();
    for (const level of definition.levels) {
      if (!positiveInteger(level.level) || levels.has(level.level) ||
        !nonNegativeInteger(level.upgradeCostCopper) || !finite(level.maxDurability) || level.maxDurability <= 0 ||
        Object.keys(level.layouts).length === 0 || !level.layouts[definition.defaultOrientation]) {
        throw new Error(`Invalid building level for ${definition.id}: ${level.level}`);
      }
      levels.add(level.level);
      const slotIds = new Set<string>();
      for (const component of level.components) {
        if (!validId(component.slotId) || !validId(component.capabilityId) || slotIds.has(component.slotId)) {
          throw new Error(`Invalid building component slot for ${definition.id}.`);
        }
        slotIds.add(component.slotId);
      }
      for (const layout of Object.values(level.layouts)) {
        if (layout.hardFootprints.length === 0 || !layout.hardFootprints.every(validRect) ||
          !validRect(layout.visualBounds) ||
          !layout.interactionAreas.every((area) => validId(area.id) && validRect(area.bounds))) {
          throw new Error(`Invalid building 2D layout for ${definition.id}.`);
        }
      }
    }
    for (let level = 1; level <= definition.levels.length; level += 1) {
      if (!levels.has(level)) throw new Error(`Building levels must be contiguous for ${definition.id}.`);
    }
    this.#definitions.set(definition.id, definition);
  }

  #geometry(building: BuildingInstanceState): BuildingWorldGeometry {
    const layout = this.#level(building).layouts[building.transform.orientation];
    if (layout === undefined) throw new Error(`Restored building orientation is unavailable: ${building.id}`);
    return Object.freeze({
      hardFootprints: Object.freeze(layout.hardFootprints.map((rect) => translateRect(rect, building.transform))),
      visualBounds: translateRect(layout.visualBounds, building.transform),
      interactionAreas: Object.freeze(layout.interactionAreas.map((area) => Object.freeze({
        id: area.id,
        required: area.required,
        bounds: translateRect(area.bounds, building.transform),
      }))),
    });
  }

  #level(building: BuildingInstanceState): BuildingLevelRuntimeDefinition {
    const definition = this.#definitions.get(building.definitionId);
    const level = definition?.levels.find((value) => value.level === building.level);
    if (level === undefined) throw new Error(`Building references an unavailable definition level: ${building.id}`);
    return level;
  }

  #components(
    ownerId: InstanceId,
    level: BuildingLevelRuntimeDefinition,
  ): readonly BuildingComponentInstanceState[] {
    return Object.freeze(level.components.map((component) => Object.freeze({
      slotId: component.slotId,
      capabilityId: component.capabilityId,
      componentId: componentId(ownerId, component.slotId),
    })));
  }

  #find(buildingId: string): BuildingInstanceState | null {
    return this.#state.buildings.find((building) => building.id === buildingId) ?? null;
  }

  #updateBuilding(next: BuildingInstanceState): void {
    this.#replace({
      buildings: this.#state.buildings.map((building) => building.id === next.id ? next : building),
    });
  }

  #prepare(operationId: string): SceneLayoutOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "SceneLayout operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "SceneLayout operation was already processed.");
    }
    this.#state = cloneState({
      ...this.#state,
      processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
    });
    return null;
  }

  #replace(update: Partial<SceneLayoutState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #placementRejection(
    operationId: string,
    validation: PlacementValidationResult,
  ): SceneLayoutOperationResult<never> {
    const first = validation.issues[0];
    return this.#reject(
      operationId,
      first?.code ?? "INVALID_REQUEST",
      first?.message ?? "Building placement is invalid.",
      validation.issues.map((issue) => issue.message),
    );
  }

  #blocked(operationId: string, issues: readonly string[]): SceneLayoutOperationResult<never> {
    return this.#reject(operationId, "TRANSITION_BLOCKED", issues[0] ?? "Building transition is blocked.", issues);
  }

  #accept<TValue>(
    operationId: string,
    value: TValue,
    events: readonly DomainEvent[],
  ): SceneLayoutOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: true,
      operationId,
      value,
      events: Object.freeze([...events]),
    });
  }

  #noChange<TValue>(operationId: string, value: TValue): SceneLayoutOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: false,
      operationId,
      value,
      events: Object.freeze([]),
    });
  }

  #reject(
    operationId: string,
    code: SceneLayoutRejectionCode,
    message: string,
    issues: readonly string[] = [message],
  ): SceneLayoutOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      issues: Object.freeze([...issues]),
      events: [] as const,
    });
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

  #validateState(): void {
    if (this.#state.schemaVersion !== SCENE_LAYOUT_SCHEMA_VERSION || !nonNegativeInteger(this.#state.revision)) {
      throw new Error("SceneLayout state header is invalid.");
    }
    const ids = new Set<string>();
    const componentIds = new Set<string>();
    for (const building of this.#state.buildings) {
      instanceId(building.id);
      if (ids.has(building.id)) throw new Error(`Duplicate building instance id: ${building.id}`);
      ids.add(building.id);
      const definition = this.#definitions.get(building.definitionId);
      if (definition === undefined || !definition.styleIds.includes(building.styleId)) {
        throw new Error(`Building references unavailable content: ${building.id}`);
      }
      const level = this.#level(building);
      if (!finite(building.durability) || building.durability < 0 || building.durability > level.maxDurability ||
        !nonNegativeInteger(building.totalInvestmentCopper)) {
        throw new Error(`Building state is invalid: ${building.id}`);
      }
      for (const component of building.components) {
        if (componentIds.has(component.componentId)) throw new Error(`Duplicate building component id: ${component.componentId}`);
        componentIds.add(component.componentId);
      }
      if (building.stored) {
        if (building.sceneId !== null) throw new Error(`Stored building still belongs to a scene: ${building.id}`);
      } else {
        if (building.sceneId === null || !this.validatePlacement(
          building.definitionId,
          building.sceneId,
          building.transform,
          building.level,
          building.id,
        ).valid) {
          throw new Error(`Restored building placement is invalid: ${building.id}`);
        }
      }
    }
  }
}
