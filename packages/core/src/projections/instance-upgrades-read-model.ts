import type {
  BuildingInstanceUpgradeReadModel,
  InstanceUpgradesReadModel,
  ProcurementCartUpgradeReadModel,
  ProcurementAirshipUpgradeReadModel,
} from "@airship-restaurant/contracts";
import type {
  BuildingConstructionSnapshot,
  BuildingUpgradeSnapshot,
  LocalProcurementState,
  FleetState,
  ProcurementAirshipDefinition,
  ProcurementCartLevelDefinition,
  SceneLayoutModule,
} from "../modules";

export const INSTANCE_UPGRADES_READ_MODEL_KEY = "instance-upgrades";

export interface BuildingUpgradeReadModelSource {
  getSnapshot(): BuildingUpgradeSnapshot;
}

export interface BuildingConstructionReadModelSource {
  getSnapshot(): BuildingConstructionSnapshot;
}

export interface SceneEditModeReadModelSource {
  getSnapshot(): {
    readonly revision: number;
    readonly active: boolean;
    readonly sceneId: string | null;
  };
}

export interface ProcurementCartUpgradeReadModelSource {
  exportState(): LocalProcurementState;
  listCartLevels(cartId: string): readonly ProcurementCartLevelDefinition[];
}

export interface ProcurementAirshipUpgradeReadModelSource {
  exportState(): FleetState;
  listShipDefinitions(): readonly ProcurementAirshipDefinition[];
}
export const EMPTY_INSTANCE_UPGRADES_READ_MODEL: InstanceUpgradesReadModel = Object.freeze({
  sourceRevision: 0,
  editMode: Object.freeze({ active: false, sceneId: null }),
  buildingCommandsAvailable: false,
  constructionCommandsAvailable: false,
  buildingCatalog: Object.freeze([]),
  constructionPreviews: Object.freeze([]),
  procurementCartCommandsAvailable: false,
  procurementAirshipCommandsAvailable: false,
  buildings: Object.freeze([]),
  procurementCarts: Object.freeze([]),
  procurementAirships: Object.freeze([]),
});

function footprintSize(rectangles: readonly {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}[]): { readonly width: number; readonly height: number } {
  if (rectangles.length === 0) return Object.freeze({ width: 0, height: 0 });
  const left = Math.min(...rectangles.map((entry) => entry.x));
  const top = Math.min(...rectangles.map((entry) => entry.y));
  const right = Math.max(...rectangles.map((entry) => entry.x + entry.width));
  const bottom = Math.max(...rectangles.map((entry) => entry.y + entry.height));
  return Object.freeze({ width: right - left, height: bottom - top });
}

export function projectInstanceUpgradesReadModel(options: {
  readonly layout: SceneLayoutModule;
  readonly editMode?: SceneEditModeReadModelSource;
  readonly buildingUpgrades?: BuildingUpgradeReadModelSource;
  readonly buildingConstruction?: BuildingConstructionReadModelSource;
  readonly buildingCatalog?: readonly { readonly definitionId: string; readonly name: string; readonly unlocked: boolean }[];
  readonly procurement?: ProcurementCartUpgradeReadModelSource;
  readonly fleet?: ProcurementAirshipUpgradeReadModelSource;
}): InstanceUpgradesReadModel {
  const layout = options.layout.getSnapshot();
  const editMode = options.editMode?.getSnapshot() ?? null;
  const buildingUpgrade = options.buildingUpgrades?.getSnapshot() ?? null;
  const buildingConstruction = options.buildingConstruction?.getSnapshot() ?? null;
  const procurement = options.procurement?.exportState() ?? null;
  const fleet = options.fleet?.exportState() ?? null;
  const previewsByBuilding = new Map(
    (buildingUpgrade?.previews ?? []).map((preview) => [preview.buildingId, preview]),
  );

  const buildings: BuildingInstanceUpgradeReadModel[] = layout.buildings
    .map((building) => {
      const definition = options.layout.getDefinition(building.definitionId);
      if (definition === null) {
        throw new Error(`Missing runtime definition for building ${building.id}.`);
      }
      const next = definition.levels.find((level) => level.level === building.level + 1) ?? null;
      const nextLayout = next?.layouts[building.transform.orientation] ?? null;
      const size = footprintSize(nextLayout?.hardFootprints ?? []);
      const currentLayout = definition.levels.find((level) => level.level === building.level)
        ?.layouts[building.transform.orientation] ?? null;
      const currentSize = footprintSize(currentLayout?.hardFootprints ?? []);
      const preview = previewsByBuilding.get(building.id) ?? null;
      return Object.freeze({
        id: building.id,
        definitionId: building.definitionId,
        sceneId: building.sceneId,
        x: building.transform.x,
        y: building.transform.y,
        orientation: building.transform.orientation,
        styleId: building.styleId,
        styleIds: Object.freeze([...definition.styleIds]),
        allowedRegionTags: Object.freeze([...definition.allowedRegionTags]),
        movable: definition.movable,
        footprintWidth: currentSize.width,
        footprintHeight: currentSize.height,
        currentLevel: building.level,
        maxLevel: definition.levels.at(-1)?.level ?? building.level,
        currentCapabilityValues: Object.freeze({ ...building.capabilityValues }),
        nextLevel: next === null
          ? null
          : Object.freeze({
              level: next.level,
              costCopper: next.upgradeCostCopper,
              capabilityValues: Object.freeze({ ...(next.capabilityValues ?? {}) }),
              footprintWidth: size.width,
              footprintHeight: size.height,
            }),
        activePreview: preview === null
          ? null
          : Object.freeze({
              id: preview.id,
              targetLevel: preview.targetLevel,
              costCopper: preview.costCopper,
              requiresLayoutPreview: preview.requiresLayoutPreview,
              placementValid: preview.placement.valid,
              issues: Object.freeze(preview.placement.issues.map((issue) => issue.message)),
            }),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const buildingCatalog = (options.buildingCatalog ?? []).map((entry) => {
    const definition = options.layout.getDefinition(entry.definitionId);
    if (definition === null) throw new Error(`Missing runtime building definition ${entry.definitionId}.`);
    const firstLevel = definition.levels[0]!;
    const layout = firstLevel.layouts[definition.defaultOrientation];
    const size = footprintSize(layout?.hardFootprints ?? []);
    return Object.freeze({
      definitionId: entry.definitionId,
      name: entry.name,
      buildCostCopper: definition.buildCostCopper,
      unlocked: entry.unlocked,
      styleIds: Object.freeze([...definition.styleIds]),
      defaultStyleId: definition.defaultStyleId,
      defaultOrientation: definition.defaultOrientation,
      allowedRegionTags: Object.freeze([...definition.allowedRegionTags]),
      footprintWidth: size.width,
      footprintHeight: size.height,
    });
  }).sort((left, right) => left.definitionId.localeCompare(right.definitionId));
  const constructionPreviews = (buildingConstruction?.previews ?? []).map((preview) => Object.freeze({
    id: preview.id,
    buildingInstanceId: preview.buildingInstanceId,
    definitionId: preview.definitionId,
    styleId: preview.styleId,
    costCopper: preview.costCopper,
    x: preview.transform?.x ?? null,
    y: preview.transform?.y ?? null,
    orientation: preview.transform?.orientation ?? null,
    placementValid: preview.placement?.valid === true,
    issues: Object.freeze(preview.placement?.issues.map((issue) => issue.message) ?? []),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const procurementCarts: ProcurementCartUpgradeReadModel[] = (procurement?.carts ?? [])
    .map((cart) => {
      const levels = options.procurement?.listCartLevels(cart.id) ?? [];
      const next = levels.find((level) => level.level === cart.level + 1) ?? null;
      return Object.freeze({
        id: cart.id,
        currentLevel: cart.level,
        maxLevel: levels.at(-1)?.level ?? cart.level,
        capacity: cart.capacity,
        speedUnitsPerSecond: cart.speedUnitsPerSecond,
        activeBatchId: cart.activeBatchId,
        nextLevel: next === null ? null : Object.freeze({
          level: next.level,
          costCopper: next.upgradeCostCopper,
          capacity: next.capacity,
          speedUnitsPerSecond: next.speedUnitsPerSecond,
        }),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const airshipDefinitions = new Map(
    (options.fleet?.listShipDefinitions() ?? []).map((definition) => [definition.id, definition]),
  );
  const procurementAirships: ProcurementAirshipUpgradeReadModel[] = (fleet?.ships ?? [])
    .map((ship) => {
      const definition = airshipDefinitions.get(ship.definitionId);
      const current = definition?.levels[ship.level - 1];
      if (definition === undefined || current === undefined) {
        throw new Error(`Missing procurement airship definition for ${ship.id}.`);
      }
      const next = definition.levels[ship.level] ?? null;
      return Object.freeze({
        id: ship.id,
        name: definition.name,
        currentLevel: ship.level,
        maxLevel: definition.levels.at(-1)?.level ?? ship.level,
        cargoCapacity: current.cargoCapacity,
        speedUnitsPerSecond: current.speedUnitsPerSecond,
        durability: ship.durability,
        maxDurability: current.maxDurability,
        activeVoyageId: ship.activeVoyageId,
        cooldownEndsAtUtcMs: ship.cooldownEndsAtUtcMs,
        nextLevel: next === null ? null : Object.freeze({
          level: next.level,
          costCopper: next.upgradeCostCopper,
          cargoCapacity: next.cargoCapacity,
          speedUnitsPerSecond: next.speedUnitsPerSecond,
          maxDurability: next.maxDurability,
          cooldownEfficiency: next.cooldownEfficiency,
        }),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    sourceRevision:
      layout.revision +
      (editMode?.revision ?? 0) +
      (buildingUpgrade?.revision ?? 0) +
      (buildingConstruction?.revision ?? 0) +
      (procurement?.revision ?? 0) +
      (fleet?.revision ?? 0),
    editMode: Object.freeze({
      active: editMode?.active ?? false,
      sceneId: editMode?.sceneId ?? null,
    }),
    buildingCommandsAvailable: options.buildingUpgrades !== undefined && options.editMode !== undefined,
    constructionCommandsAvailable: options.buildingConstruction !== undefined && options.editMode !== undefined,
    buildingCatalog: Object.freeze(buildingCatalog),
    constructionPreviews: Object.freeze(constructionPreviews),
    procurementCartCommandsAvailable: options.procurement !== undefined,
    procurementAirshipCommandsAvailable: options.fleet !== undefined,
    buildings: Object.freeze(buildings),
    procurementCarts: Object.freeze(procurementCarts),
    procurementAirships: Object.freeze(procurementAirships),
  });
}