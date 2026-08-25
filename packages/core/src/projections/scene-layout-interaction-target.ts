import type {
  BuildingLayoutSnapshot,
  InteractionTargetResolver,
  MovementTargetReference,
  ResolvedInteractionTarget,
  SceneLayoutModule,
} from "../modules";

export type BuildingNavigationAreaResolver = (building: BuildingLayoutSnapshot) => string | null;
export type InteractionCapacityResolver = (building: BuildingLayoutSnapshot, interactionId: string) => number;

export class SceneLayoutInteractionTargetResolver implements InteractionTargetResolver {
  readonly #layout: SceneLayoutModule;
  readonly #navigationArea: BuildingNavigationAreaResolver;
  readonly #capacity: InteractionCapacityResolver;

  constructor(
    layout: SceneLayoutModule,
    navigationArea: BuildingNavigationAreaResolver,
    capacity: InteractionCapacityResolver = () => 1,
  ) {
    this.#layout = layout;
    this.#navigationArea = navigationArea;
    this.#capacity = capacity;
  }

  resolve(target: MovementTargetReference): ResolvedInteractionTarget | null {
    if (target.type !== "building") return null;
    const snapshot = this.#layout.getSnapshot();
    const building = snapshot.buildings.find((item) => item.id === target.id);
    if (building === undefined || building.worldGeometry === null || !building.enabled || building.stored) return null;
    const navigationAreaId = this.#navigationArea(building);
    if (navigationAreaId === null) return null;
    const candidates = building.worldGeometry.interactionAreas
      .filter((area) => target.interactionId === undefined || area.id === target.interactionId)
      .map((area) => {
        const capacity = this.#capacity(building, area.id);
        if (!Number.isSafeInteger(capacity) || capacity <= 0) {
          throw new RangeError(`Interaction capacity must be positive: ${building.id}/${area.id}`);
        }
        return Object.freeze({
          id: area.id,
          navigationAreaId,
          bounds: Object.freeze({ ...area.bounds }),
          capacity,
        });
      });
    return Object.freeze({ revision: snapshot.revision, candidates: Object.freeze(candidates) });
  }
}
