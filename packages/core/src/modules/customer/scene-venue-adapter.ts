import type { DomainModule } from "../domain-module";
import type {
  BuildingInstanceState,
  BuildingTransitionConstraintPort,
  BuildingTransitionConstraintRequest,
  SceneLayoutModule,
} from "../scene-layout";
import type {
  CustomerModule,
  CustomerTableDefinition,
  CustomerVenueDefinition,
  CustomerVenuePort,
} from "./index";

export interface SceneCustomerVenueDefinition {
  readonly sceneId: string;
  readonly waitingAreaBuildingDefinitionId: string;
  readonly waitingAreaSlotId: string;
  readonly waitingSlotCountValueKey: string;
  readonly tables: readonly CustomerTableDefinition[];
}

const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 180;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const cloneTable = (table: CustomerTableDefinition): CustomerTableDefinition => Object.freeze({
  id: table.id,
  seatIds: Object.freeze([...table.seatIds]),
});

export class SceneCustomerVenueAdapter implements
  DomainModule,
  CustomerVenuePort,
  BuildingTransitionConstraintPort {
  readonly moduleId = "module.scene-customer-venue-adapter";
  readonly #definitions: readonly SceneCustomerVenueDefinition[];
  #layout: SceneLayoutModule | null = null;
  #runtime: CustomerModule | null = null;

  constructor(definitions: readonly SceneCustomerVenueDefinition[]) {
    const scenes = new Set<string>();
    if (definitions.length === 0) throw new Error("Scene customer venue definitions are required.");
    this.#definitions = Object.freeze(definitions.map((definition) => {
      if (!validId(definition.sceneId) || !validId(definition.waitingAreaBuildingDefinitionId) ||
        !validId(definition.waitingAreaSlotId) || !validId(definition.waitingSlotCountValueKey) ||
        scenes.has(definition.sceneId) || definition.tables.length === 0) {
        throw new Error("Invalid scene customer venue definition: " + definition.sceneId);
      }
      scenes.add(definition.sceneId);
      const resourceIds = new Set<string>();
      for (const table of definition.tables) {
        if (!validId(table.id) || table.seatIds.length === 0 || resourceIds.has(table.id) ||
          table.seatIds.some((seatId) => !validId(seatId) || resourceIds.has(seatId))) {
          throw new Error("Invalid scene customer table definition: " + table.id);
        }
        resourceIds.add(table.id);
        for (const seatId of table.seatIds) resourceIds.add(seatId);
      }
      return Object.freeze({ ...definition, tables: Object.freeze(definition.tables.map(cloneTable)) });
    }));
  }

  attachLayout(layout: SceneLayoutModule): void {
    if (this.#layout !== null && this.#layout !== layout) throw new Error("Scene customer venue adapter already has a layout.");
    for (const definition of this.#definitions) {
      const building = layout.getDefinition(definition.waitingAreaBuildingDefinitionId);
      if (building === null) throw new Error("Unknown waiting area building: " + definition.waitingAreaBuildingDefinitionId);
      for (const level of building.levels) {
        if (!level.components.some((component) => component.slotId === definition.waitingAreaSlotId) ||
          !positiveInteger(level.capabilityValues?.[definition.waitingSlotCountValueKey] ?? Number.NaN)) {
          throw new Error("Waiting area level capability is invalid: " + definition.waitingAreaBuildingDefinitionId + "/" + level.level);
        }
      }
    }
    this.#layout = layout;
  }

  attachRuntime(runtime: CustomerModule): void {
    if (this.#runtime !== null && this.#runtime !== runtime) throw new Error("Scene customer venue adapter already has a runtime.");
    this.#runtime = runtime;
  }

  listVenues(): readonly CustomerVenueDefinition[] {
    const layout = this.#layout;
    if (layout === null) return Object.freeze([]);
    const buildings = layout.getSnapshot().buildings;
    return Object.freeze(this.#definitions.flatMap((definition) => {
      const building = buildings
        .filter((entry) => entry.sceneId === definition.sceneId &&
          entry.definitionId === definition.waitingAreaBuildingDefinitionId &&
          !entry.stored && entry.enabled)
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (building === undefined) return [];
      const venue = this.#project(definition, building);
      return venue === null ? [] : [venue];
    }));
  }

  validate(request: BuildingTransitionConstraintRequest): readonly string[] {
    const definition = this.#definitions.find((entry) =>
      entry.waitingAreaBuildingDefinitionId === request.current.definitionId
    );
    if (definition === undefined || this.#runtime === null) return Object.freeze([]);
    const current = this.#project(definition, request.current);
    if (current === null) return Object.freeze([]);
    const waiting = this.#runtime.exportState().visits.filter((visit) =>
      visit.phase === "waiting" && visit.waitingAreaId === current.waitingArea.id
    );
    if (waiting.length === 0) return Object.freeze([]);
    const target = request.target === null || request.kind === "remove" || request.target.stored || !request.target.enabled
      ? null
      : this.#project(definition, request.target);
    const waitingPeople = waiting.reduce((sum, visit) => sum + visit.memberCharacterIds.length, 0);
    if (target === null) return Object.freeze(["Waiting area still serves " + waitingPeople + " customers."]);
    if (target.waitingArea.id !== current.waitingArea.id) {
      return Object.freeze(["Waiting area transition would replace an occupied stable component slot."]);
    }
    if (target.waitingArea.slotIds.length < waitingPeople) {
      return Object.freeze(["Waiting area target capacity is below the current waiting customer count."]);
    }
    return Object.freeze([]);
  }

  #project(
    definition: SceneCustomerVenueDefinition,
    building: BuildingInstanceState,
  ): CustomerVenueDefinition | null {
    const layout = this.#layout;
    if (layout === null) return null;
    const waitingAreaId = building.components.find((component) =>
      component.slotId === definition.waitingAreaSlotId
    )?.componentId;
    const level = layout.getDefinition(building.definitionId)?.levels.find((entry) =>
      entry.level === building.level
    );
    if (waitingAreaId === undefined || level === undefined) return null;
    const slotCount = level.capabilityValues?.[definition.waitingSlotCountValueKey];
    if (slotCount === undefined || !positiveInteger(slotCount)) return null;
    return Object.freeze({
      sceneId: definition.sceneId,
      waitingArea: Object.freeze({
        id: waitingAreaId,
        slotIds: Object.freeze(Array.from(
          { length: slotCount },
          (_, index) => waitingAreaId + ".waiting_" + (index + 1),
        )),
      }),
      tables: Object.freeze(definition.tables.map(cloneTable)),
    });
  }
}