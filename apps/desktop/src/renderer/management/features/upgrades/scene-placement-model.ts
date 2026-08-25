export const PLACEMENT_SCENE_WIDTH = 1_920;
export const PLACEMENT_SCENE_HEIGHT = 1_080;
export const PLACEMENT_GRID_SIZE = 16;

export type PlacementRegionTag =
  | "zone.airship"
  | "zone.edge"
  | "zone.ground";

export interface PlacementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacementRegion extends PlacementRect {
  readonly tag: PlacementRegionTag;
  readonly label: string;
}

export const PLACEMENT_REGIONS: readonly PlacementRegion[] = Object.freeze([
  Object.freeze({
    tag: "zone.airship" as const,
    label: "飞艇厨房",
    x: 0,
    y: 0,
    width: PLACEMENT_SCENE_WIDTH,
    height: 448,
  }),
  Object.freeze({
    tag: "zone.edge" as const,
    label: "人员 / 货物升降区",
    x: 0,
    y: 448,
    width: PLACEMENT_SCENE_WIDTH,
    height: 192,
  }),
  Object.freeze({
    tag: "zone.ground" as const,
    label: "地面餐厅",
    x: 0,
    y: 640,
    width: PLACEMENT_SCENE_WIDTH,
    height: 440,
  }),
]);

export function getPlacementRegion(
  allowedRegionTags: readonly string[],
): PlacementRegion {
  return (
    PLACEMENT_REGIONS.find((region) =>
      allowedRegionTags.includes(region.tag),
    ) ?? PLACEMENT_REGIONS[2]!
  );
}

export function snapSceneCoordinate(value: number): number {
  return Math.round(value / PLACEMENT_GRID_SIZE) * PLACEMENT_GRID_SIZE;
}

export function clampPlacementToRegion(
  position: { readonly x: number; readonly y: number },
  footprint: { readonly width: number; readonly height: number },
  allowedRegionTags: readonly string[],
): { readonly x: number; readonly y: number } {
  const region = getPlacementRegion(allowedRegionTags);
  const maxX = region.x + Math.max(0, region.width - footprint.width);
  const maxY = region.y + Math.max(0, region.height - footprint.height);
  return Object.freeze({
    x: Math.min(maxX, Math.max(region.x, snapSceneCoordinate(position.x))),
    y: Math.min(maxY, Math.max(region.y, snapSceneCoordinate(position.y))),
  });
}

export function clientPointToScene(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } {
  return Object.freeze({
    x: ((clientX - bounds.left) / Math.max(1, bounds.width)) *
      PLACEMENT_SCENE_WIDTH,
    y: ((clientY - bounds.top) / Math.max(1, bounds.height)) *
      PLACEMENT_SCENE_HEIGHT,
  });
}

export function sceneRectStyle(rect: PlacementRect): Readonly<{
  left: string;
  top: string;
  width: string;
  height: string;
}> {
  return Object.freeze({
    left: (rect.x / PLACEMENT_SCENE_WIDTH) * 100 + "%",
    top: (rect.y / PLACEMENT_SCENE_HEIGHT) * 100 + "%",
    width: (rect.width / PLACEMENT_SCENE_WIDTH) * 100 + "%",
    height: (rect.height / PLACEMENT_SCENE_HEIGHT) * 100 + "%",
  });
}

export function placementRectsOverlap(
  left: PlacementRect,
  right: PlacementRect,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function findOpenPlacement(
  footprint: { readonly width: number; readonly height: number },
  allowedRegionTags: readonly string[],
  occupied: readonly PlacementRect[],
): { readonly x: number; readonly y: number } {
  const region = getPlacementRegion(allowedRegionTags);
  const preferredX = region.tag === "zone.edge" ? 1_280 : 960;
  const preferredY = region.y + Math.max(
    PLACEMENT_GRID_SIZE,
    Math.round((region.height - footprint.height) / 2),
  );
  const preferred = clampPlacementToRegion(
    { x: preferredX, y: preferredY },
    footprint,
    allowedRegionTags,
  );
  if (
    !occupied.some((rect) =>
      placementRectsOverlap({ ...preferred, ...footprint }, rect),
    )
  ) {
    return preferred;
  }

  const maxX = region.x + region.width - footprint.width;
  const maxY = region.y + region.height - footprint.height;
  for (
    let y = region.y;
    y <= maxY;
    y += PLACEMENT_GRID_SIZE
  ) {
    for (
      let x = region.x;
      x <= maxX;
      x += PLACEMENT_GRID_SIZE
    ) {
      const candidate = { x, y, ...footprint };
      if (!occupied.some((rect) => placementRectsOverlap(candidate, rect))) {
        return Object.freeze({ x, y });
      }
    }
  }
  return clampPlacementToRegion(
    { x: region.x, y: region.y },
    footprint,
    allowedRegionTags,
  );
}