import type {
  LayoutReadModel,
  LayoutReadModelBuilding,
  LayoutReadModelRect,
} from "@airship-restaurant/contracts";
import type {
  BuildingLayoutSnapshot,
  Rect2D,
  SceneLayoutSnapshot,
} from "../modules";

export const LAYOUT_READ_MODEL_KEY = "layout" as const;

function projectRect(rect: Rect2D): LayoutReadModelRect {
  return Object.freeze({ ...rect });
}

function projectBuilding(
  building: BuildingLayoutSnapshot,
): LayoutReadModelBuilding {
  return Object.freeze({
    id: building.id,
    definitionId: building.definitionId,
    sceneId: building.sceneId,
    x: building.transform.x,
    y: building.transform.y,
    orientation: building.transform.orientation,
    styleId: building.styleId,
    level: building.level,
    durability: building.durability,
    enabled: building.enabled,
    stored: building.stored,
    renderSortY: building.renderSortY,
    hardFootprints: Object.freeze(
      building.worldGeometry?.hardFootprints.map(projectRect) ?? [],
    ),
    visualBounds:
      building.worldGeometry === null
        ? null
        : projectRect(building.worldGeometry.visualBounds),
    interactionAreas: Object.freeze(
      building.worldGeometry?.interactionAreas.map((area) =>
        Object.freeze({
          id: area.id,
          required: area.required,
          bounds: projectRect(area.bounds),
        }),
      ) ?? [],
    ),
    capabilityValues: Object.freeze({ ...building.capabilityValues }),
    components: Object.freeze(
      building.components.map((component) =>
        Object.freeze({
          slotId: component.slotId,
          capabilityId: component.capabilityId,
          componentId: component.componentId,
        }),
      ),
    ),
  });
}

export function projectLayoutReadModel(
  snapshot: SceneLayoutSnapshot,
): LayoutReadModel {
  const scenes = new Map<string, LayoutReadModelBuilding[]>();
  const storedBuildings: LayoutReadModelBuilding[] = [];

  for (const building of snapshot.buildings) {
    const projected = projectBuilding(building);
    if (building.sceneId === null || building.stored) {
      storedBuildings.push(projected);
      continue;
    }
    const buildings = scenes.get(building.sceneId) ?? [];
    buildings.push(projected);
    scenes.set(building.sceneId, buildings);
  }

  const byRenderOrder = (
    left: LayoutReadModelBuilding,
    right: LayoutReadModelBuilding,
  ): number => left.renderSortY - right.renderSortY || left.id.localeCompare(right.id);

  return Object.freeze({
    sourceRevision: snapshot.revision,
    scenes: Object.freeze(
      [...scenes]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sceneId, buildings]) =>
          Object.freeze({
            sceneId,
            buildings: Object.freeze([...buildings].sort(byRenderOrder)),
          }),
        ),
    ),
    storedBuildings: Object.freeze(storedBuildings.sort(byRenderOrder)),
  });
}