import type { DomainModule } from "../domain-module";
import type {
  BuildingInstanceState,
  BuildingTransitionConstraintPort,
  BuildingTransitionConstraintRequest,
  SceneLayoutModule,
} from "../scene-layout";
import type {
  DishwareCabinetDefinition,
  DishwareCabinetDefinitionPort,
  DishwareModule,
} from "./index";

export interface SceneDishwareCabinetDefinition {
  readonly buildingDefinitionId: string;
  readonly supplySlotId: string;
  readonly cleanStorageSlotId: string;
  readonly dirtyStorageSlotId: string;
  readonly washingSlotId: string;
  readonly plateCountValueKey: string;
  readonly washDurationValueKey: string;
  readonly parallelWashCountValueKey: string;
}

export interface DishwareSupplyExpansionNeed {
  readonly cabinetId: string;
  readonly supplyComponentId: string;
  readonly currentPlateCount: number;
  readonly targetPlateCount: number;
  readonly missingPlateCount: number;
}

const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 180;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export class SceneDishwareCabinetAdapter implements
  DomainModule,
  DishwareCabinetDefinitionPort,
  BuildingTransitionConstraintPort {
  readonly moduleId = "module.scene-dishware-cabinet-adapter";
  readonly #definitions = new Map<string, SceneDishwareCabinetDefinition>();
  #layout: SceneLayoutModule | null = null;
  #runtime: DishwareModule | null = null;

  constructor(definitions: readonly SceneDishwareCabinetDefinition[]) {
    if (definitions.length === 0) throw new Error("Scene dishware cabinet definitions are required.");
    for (const definition of definitions) {
      const values = Object.values(definition);
      if (values.some((value) => !validId(value)) || this.#definitions.has(definition.buildingDefinitionId) ||
        new Set([
          definition.supplySlotId,
          definition.cleanStorageSlotId,
          definition.dirtyStorageSlotId,
          definition.washingSlotId,
        ]).size !== 4) {
        throw new Error("Invalid scene dishware cabinet definition: " + definition.buildingDefinitionId);
      }
      this.#definitions.set(definition.buildingDefinitionId, Object.freeze({ ...definition }));
    }
  }

  attachLayout(layout: SceneLayoutModule): void {
    if (this.#layout !== null && this.#layout !== layout) throw new Error("Scene dishware adapter already has a layout.");
    for (const definition of this.#definitions.values()) {
      const building = layout.getDefinition(definition.buildingDefinitionId);
      if (building === null) throw new Error("Unknown dishware cabinet building: " + definition.buildingDefinitionId);
      for (const level of building.levels) {
        const slots = new Set(level.components.map((component) => component.slotId));
        const values = level.capabilityValues ?? {};
        if (![definition.supplySlotId, definition.cleanStorageSlotId, definition.dirtyStorageSlotId, definition.washingSlotId]
          .every((slotId) => slots.has(slotId)) ||
          !positiveInteger(values[definition.plateCountValueKey] ?? Number.NaN) ||
          !positiveInteger(values[definition.washDurationValueKey] ?? Number.NaN) ||
          !positiveInteger(values[definition.parallelWashCountValueKey] ?? Number.NaN)) {
          throw new Error("Dishware cabinet level capabilities are invalid: " + definition.buildingDefinitionId + "/" + level.level);
        }
      }
    }
    this.#layout = layout;
  }

  attachRuntime(runtime: DishwareModule): void {
    if (this.#runtime !== null && this.#runtime !== runtime) throw new Error("Scene dishware adapter already has a runtime.");
    this.#runtime = runtime;
  }

  listCabinets(): readonly DishwareCabinetDefinition[] {
    if (this.#layout === null) return Object.freeze([]);
    return Object.freeze(this.#layout.getSnapshot().buildings
      .flatMap((building) => {
        const cabinet = this.#project(building, true);
        return cabinet === null ? [] : [cabinet];
      })
      .sort((left, right) => left.id.localeCompare(right.id)));
  }

  listSupplyExpansionNeeds(): readonly DishwareSupplyExpansionNeed[] {
    if (this.#runtime === null) return Object.freeze([]);
    const state = this.#runtime.exportState();
    return Object.freeze(this.listCabinets().flatMap((cabinet) => {
      if (!state.initializedSupplyComponentIds.includes(cabinet.supplyComponentId)) return [];
      const currentPlateCount = state.plates.filter((plate) =>
        plate.supplyComponentId === cabinet.supplyComponentId
      ).length;
      return currentPlateCount >= cabinet.suppliedPlateCount ? [] : [Object.freeze({
        cabinetId: cabinet.id,
        supplyComponentId: cabinet.supplyComponentId,
        currentPlateCount,
        targetPlateCount: cabinet.suppliedPlateCount,
        missingPlateCount: cabinet.suppliedPlateCount - currentPlateCount,
      })];
    }));
  }

  validate(request: BuildingTransitionConstraintRequest): readonly string[] {
    const current = this.#project(request.current, false);
    if (current === null || this.#runtime === null) return Object.freeze([]);
    const state = this.#runtime.exportState();
    const plates = state.plates.filter((plate) => plate.supplyComponentId === current.supplyComponentId);
    const target = request.target === null || request.kind === "remove" || request.target.stored || !request.target.enabled
      ? null
      : this.#project(request.target, false);
    const issues: string[] = [];
    if (target === null && plates.length > 0) {
      issues.push("Dishware cabinet still owns " + plates.length + " plates.");
      return Object.freeze(issues);
    }
    if (target !== null && target.suppliedPlateCount < plates.length) {
      issues.push("Dishware cabinet target plate capacity is below its existing plate count.");
    }
    if (target !== null && (
      target.supplyComponentId !== current.supplyComponentId ||
      target.cleanStorageLocationId !== current.cleanStorageLocationId ||
      target.dirtyStorageLocationId !== current.dirtyStorageLocationId ||
      target.washingLocationId !== current.washingLocationId
    ) && plates.length > 0) {
      issues.push("Dishware cabinet upgrade would replace occupied stable component slots.");
    }
    const activeWashCount = state.washJobs.filter((job) => job.cabinetId === current.id).length;
    if (target !== null && target.parallelWashCount < activeWashCount) {
      issues.push("Dishware cabinet target parallel washing count is below active wash jobs.");
    }
    return Object.freeze(issues);
  }

  #project(building: BuildingInstanceState, requireActive: boolean): DishwareCabinetDefinition | null {
    const layout = this.#layout;
    const definition = this.#definitions.get(building.definitionId);
    if (layout === null || definition === undefined ||
      (requireActive && (building.sceneId === null || building.stored || !building.enabled))) return null;
    const level = layout.getDefinition(building.definitionId)?.levels.find((entry) => entry.level === building.level);
    if (level === undefined) return null;
    const component = (slotId: string): string | null =>
      building.components.find((entry) => entry.slotId === slotId)?.componentId ?? null;
    const supplyComponentId = component(definition.supplySlotId);
    const cleanStorageLocationId = component(definition.cleanStorageSlotId);
    const dirtyStorageLocationId = component(definition.dirtyStorageSlotId);
    const washingLocationId = component(definition.washingSlotId);
    if (supplyComponentId === null || cleanStorageLocationId === null ||
      dirtyStorageLocationId === null || washingLocationId === null) return null;
    const values = level.capabilityValues ?? {};
    return Object.freeze({
      id: building.id,
      supplyComponentId,
      cleanStorageLocationId,
      dirtyStorageLocationId,
      washingLocationId,
      suppliedPlateCount: values[definition.plateCountValueKey]!,
      washDurationMs: values[definition.washDurationValueKey]!,
      parallelWashCount: values[definition.parallelWashCountValueKey]!,
    });
  }
}