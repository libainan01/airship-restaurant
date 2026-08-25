import type { BuildingDefinition, ContentRegistry } from "@airship-restaurant/content";
import {
  type InteractionTargetResolver,
  type MovementTargetReference,
  type ResolvedInteractionTarget,
  type SceneLayoutModule,
} from "@airship-restaurant/core";
import { DESKTOP_RESTAURANT_IDS } from "./restaurant-operational-modules";

const SCENE_WIDTH = 1_920;
const SCENE_HEIGHT = 1_080;

interface VirtualTargetDefinition {
  readonly navigationAreaId: string;
  readonly x: number;
  readonly y: number;
  readonly capacity: number;
}

const VIRTUAL_TARGETS = new Map<string, VirtualTargetDefinition>([
  [DESKTOP_RESTAURANT_IDS.tableId, {
    navigationAreaId: "area.restaurant.ground",
    x: 0.68,
    y: 0.765,
    capacity: 2,
  }],
  [DESKTOP_RESTAURANT_IDS.personnelGroundStationId, {
    navigationAreaId: "area.restaurant.ground",
    x: 0.94,
    y: 0.765,
    capacity: 1,
  }],
  [DESKTOP_RESTAURANT_IDS.personnelAirshipStationId, {
    navigationAreaId: "area.airship.kitchen",
    x: 0.08,
    y: 0.3,
    capacity: 1,
  }],
]);

function navigationArea(definition: BuildingDefinition): string {
  return definition.placementZoneTags.includes("zone.airship")
    ? "area.airship.kitchen"
    : "area.restaurant.ground";
}

function virtualKey(target: MovementTargetReference): string | null {
  if (target.type === "table" || target.type === "personnel-elevator-station") {
    return target.id;
  }
  return null;
}

/**
 * Resolves the desktop's 2D interaction points from the live SceneLayout.
 * Building edits therefore take effect on the next movement plan without
 * rewriting character or task state.
 */
export class DesktopRestaurantInteractionTargetResolver implements InteractionTargetResolver {
  readonly #layout: SceneLayoutModule;
  readonly #buildings: ReadonlyMap<string, BuildingDefinition>;

  constructor(content: ContentRegistry, layout: SceneLayoutModule) {
    this.#layout = layout;
    this.#buildings = new Map(content.listBuildings().map((building) => [building.id, building]));
  }

  resolve(target: MovementTargetReference): ResolvedInteractionTarget | null {
    const virtual = virtualKey(target);
    if (virtual !== null) {
      const definition = VIRTUAL_TARGETS.get(virtual);
      if (definition === undefined) return null;
      return Object.freeze({
        revision: this.#layout.getSnapshot().revision,
        candidates: Object.freeze([Object.freeze({
          id: target.interactionId ?? "interaction.main",
          navigationAreaId: definition.navigationAreaId,
          bounds: Object.freeze({ x: definition.x, y: definition.y, width: 0, height: 0 }),
          capacity: definition.capacity,
        })]),
      });
    }
    if (target.type !== "building") return null;

    const snapshot = this.#layout.getSnapshot();
    const building = snapshot.buildings.find((entry) => entry.id === target.id);
    if (building === undefined || building.worldGeometry === null || !building.enabled || building.stored) {
      return null;
    }
    const definition = this.#buildings.get(building.definitionId);
    if (definition === undefined) return null;
    const visual = building.worldGeometry.visualBounds;
    const x = (visual.x + visual.width / 2) / SCENE_WIDTH;
    const y = (visual.y + visual.height) / SCENE_HEIGHT;
    return Object.freeze({
      revision: snapshot.revision,
      candidates: Object.freeze([Object.freeze({
        id: target.interactionId ?? "interaction.main",
        navigationAreaId: navigationArea(definition),
        bounds: Object.freeze({ x, y, width: 0, height: 0 }),
        capacity: 1,
      })]),
    });
  }
}