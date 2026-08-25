import type { SubresourceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type {
  BuildingComponentInstanceState,
  BuildingInstanceState,
  BuildingTransitionConstraintPort,
  BuildingTransitionConstraintRequest,
  SceneLayoutModule,
} from "../scene-layout";
import type {
  InventoryCompartmentDefinition,
  InventoryItemCategory,
  InventoryLocationDefinition,
  InventoryModule,
  InventoryStorageDefinitionPort,
} from "../inventory";

export const STORAGE_CAPABILITY_MODULE_ID = "module.storage-capability";

export interface StorageCompartmentCapabilityDefinition {
  readonly id: string;
  readonly capacity: number;
  readonly capacityValueKey?: string;
  readonly acceptedCategories: readonly InventoryItemCategory[];
  readonly acceptedItemIds?: readonly string[];
}

export interface StorageCapabilityLevelDefinition {
  readonly buildingDefinitionId: string;
  readonly level: number;
  readonly slotId: string;
  readonly compartments: readonly StorageCompartmentCapabilityDefinition[];
}

export interface StorageCapabilitySnapshot {
  readonly revision: number;
  readonly locations: readonly InventoryLocationDefinition[];
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 180;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function cloneCompartment(
  value: StorageCompartmentCapabilityDefinition,
  capacity = value.capacity,
): InventoryCompartmentDefinition {
  return Object.freeze({
    id: value.id,
    capacity,
    acceptedCategories: Object.freeze([...value.acceptedCategories]),
    ...(value.acceptedItemIds === undefined
      ? {}
      : { acceptedItemIds: Object.freeze([...value.acceptedItemIds]) }),
  });
}

function cloneLocation(value: InventoryLocationDefinition): InventoryLocationDefinition {
  return Object.freeze({
    id: value.id,
    compartments: Object.freeze(value.compartments.map((entry) => Object.freeze({
      ...entry,
      acceptedCategories: Object.freeze([...entry.acceptedCategories]),
      ...(entry.acceptedItemIds === undefined
        ? {}
        : { acceptedItemIds: Object.freeze([...entry.acceptedItemIds]) }),
    }))),
  });
}

/**
 * Turns stable building component slots into Inventory locations. It deliberately
 * owns no quantities, reservations, or item state.
 */
export class StorageCapabilityAdapter implements
  DomainModule,
  InventoryStorageDefinitionPort,
  BuildingTransitionConstraintPort {
  readonly moduleId = STORAGE_CAPABILITY_MODULE_ID;
  readonly #definitions = new Map<string, StorageCapabilityLevelDefinition>();
  #layout: SceneLayoutModule | null = null;
  #inventory: InventoryModule | null = null;

  constructor(definitions: readonly StorageCapabilityLevelDefinition[]) {
    if (definitions.length === 0) throw new Error("Storage capability definitions are required.");
    for (const definition of definitions) this.#register(definition);
  }

  attachLayout(layout: SceneLayoutModule): void {
    if (this.#layout !== null && this.#layout !== layout) {
      throw new Error("Storage capability adapter already has a SceneLayout owner.");
    }
    for (const definition of this.#definitions.values()) {
      for (const compartment of definition.compartments) {
        if (compartment.capacityValueKey === undefined) continue;
        const value = layout.getDefinition(definition.buildingDefinitionId)?.levels
          .find((level) => level.level === definition.level)?.capabilityValues?.[compartment.capacityValueKey];
        if (value === undefined || !nonNegativeInteger(value)) throw new Error(`Missing or invalid storage capability value: ${definition.buildingDefinitionId}/${definition.level}/${compartment.capacityValueKey}`);
      }
    }
    this.#layout = layout;
  }

  attachInventory(inventory: InventoryModule): void {
    if (this.#inventory !== null && this.#inventory !== inventory) {
      throw new Error("Storage capability adapter already has an Inventory owner.");
    }
    this.#inventory = inventory;
  }

  getLocation(locationId: string): InventoryLocationDefinition | null {
    return this.listLocations().find((location) => location.id === locationId) ?? null;
  }

  listLocations(): readonly InventoryLocationDefinition[] {
    if (this.#layout === null) return Object.freeze([]);
    const locations = this.#layout.getSnapshot().buildings.flatMap((building) =>
      this.#locationsForBuilding(building),
    ).sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze(locations.map(cloneLocation));
  }

  getSnapshot(): StorageCapabilitySnapshot {
    return Object.freeze({
      revision: this.#layout?.getSnapshot().revision ?? 0,
      locations: this.listLocations(),
    });
  }

  validate(request: BuildingTransitionConstraintRequest): readonly string[] {
    const currentLocations = this.#locationsForBuilding(request.current, true);
    if (currentLocations.length === 0) return Object.freeze([]);
    if (this.#inventory === null) {
      return Object.freeze(["Storage Inventory owner is not attached."]);
    }
    const targetLocations = request.target === null || request.target.stored ||
      !request.target.enabled || request.kind === "remove"
      ? []
      : this.#locationsForBuilding(request.target, true);
    const targetById = new Map(targetLocations.map((location) => [location.id, location]));
    const issues: string[] = [];
    for (const current of currentLocations) {
      const target = targetById.get(current.id);
      if (target === undefined) {
        const snapshot = this.#inventory.getLocationSnapshot(current.id);
        const occupied = snapshot === null
          ? 0
          : snapshot.stacks.reduce((sum, entry) => sum + entry.quantity, 0) +
            snapshot.instances.length + snapshot.stackCargo.length;
        const reserved = snapshot?.compartments.reduce(
          (sum, compartment) => sum + compartment.reservedCapacity,
          0,
        ) ?? 0;
        const resourceReservations = this.#inventory.getSnapshot().reservations.some((reservation) =>
          reservation.stackAllocations.some((entry) => entry.locationId === current.id) ||
          reservation.instanceIds.some((id) => snapshot?.instances.some((entry) => entry.id === id) === true) ||
          reservation.stackCargoIds.some((id) => snapshot?.stackCargo.some((entry) => entry.id === id) === true),
        );
        if (occupied > 0 || reserved > 0 || resourceReservations) {
          issues.push(`Storage ${current.id} still owns inventory or reservations.`);
        }
        continue;
      }
      issues.push(...this.#inventory.validateStorageDefinition(target)
        .map((issue) => `Storage ${target.id}: ${issue}`));
    }
    return Object.freeze(issues);
  }

  #locationsForBuilding(
    building: BuildingInstanceState,
    includeUnavailable = false,
  ): InventoryLocationDefinition[] {
    if (!includeUnavailable && (building.stored || !building.enabled)) return [];
    return building.components.flatMap((component) => {
      const definition = this.#definitions.get(this.#key(
        building.definitionId,
        building.level,
        component.slotId,
      ));
      return definition === undefined
        ? []
        : [this.#location(building, component, definition)];
    });
  }

  #location(
    building: BuildingInstanceState,
    component: BuildingComponentInstanceState,
    definition: StorageCapabilityLevelDefinition,
  ): InventoryLocationDefinition {
    const values = this.#layout?.getDefinition(building.definitionId)?.levels
      .find((level) => level.level === building.level)?.capabilityValues ?? {};
    return Object.freeze({
      id: component.componentId,
      compartments: Object.freeze(definition.compartments.map((entry) =>
        cloneCompartment(entry, entry.capacityValueKey === undefined ? entry.capacity : values[entry.capacityValueKey]!),
      )),
    });
  }

  #register(definition: StorageCapabilityLevelDefinition): void {
    const key = this.#key(definition.buildingDefinitionId, definition.level, definition.slotId);
    if (!validId(definition.buildingDefinitionId) || !positiveInteger(definition.level) ||
      !validId(definition.slotId) || definition.compartments.length === 0 || this.#definitions.has(key)) {
      throw new Error(`Invalid or duplicate storage capability definition: ${key}`);
    }
    const compartmentIds = new Set<string>();
    for (const compartment of definition.compartments) {
      if (!validId(compartment.id) || compartmentIds.has(compartment.id) ||
        !nonNegativeInteger(compartment.capacity) || (compartment.capacityValueKey !== undefined && !validId(compartment.capacityValueKey)) || compartment.acceptedCategories.length === 0 ||
        new Set(compartment.acceptedCategories).size !== compartment.acceptedCategories.length ||
        (compartment.acceptedItemIds !== undefined &&
          new Set(compartment.acceptedItemIds).size !== compartment.acceptedItemIds.length)) {
        throw new Error(`Invalid storage compartment capability: ${key}/${compartment.id}`);
      }
      compartmentIds.add(compartment.id);
    }
    this.#definitions.set(key, Object.freeze({
      ...definition,
      compartments: Object.freeze(definition.compartments.map((entry) => Object.freeze({
        ...entry,
        acceptedCategories: Object.freeze([...entry.acceptedCategories]),
        ...(entry.acceptedItemIds === undefined
          ? {}
          : { acceptedItemIds: Object.freeze([...entry.acceptedItemIds]) }),
      }))),
    }));
  }

  #key(buildingDefinitionId: string, level: number, slotId: string): string {
    return `${buildingDefinitionId}\u0000${level}\u0000${slotId}`;
  }
}

export function storageLocationId(componentId: SubresourceId): string {
  return componentId;
}
