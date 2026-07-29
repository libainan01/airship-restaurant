export interface HitPoint {
  readonly x: number;
  readonly y: number;
}

interface HitZoneBase {
  readonly id: string;
  readonly priority?: number;
  readonly enabled?: boolean;
}

export interface RectHitZone extends HitZoneBase {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CircleHitZone extends HitZoneBase {
  readonly kind: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface PolygonHitZone extends HitZoneBase {
  readonly kind: "polygon";
  readonly points: readonly HitPoint[];
}

export type HitZone = RectHitZone | CircleHitZone | PolygonHitZone;

function pointIsOnSegment(
  point: Readonly<HitPoint>,
  start: Readonly<HitPoint>,
  end: Readonly<HitPoint>,
): boolean {
  const crossProduct =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);

  if (Math.abs(crossProduct) > 0.001) {
    return false;
  }

  const dotProduct =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dotProduct < 0) {
    return false;
  }

  const squaredLength =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dotProduct <= squaredLength;
}

function polygonContains(
  points: readonly HitPoint[],
  x: number,
  y: number,
): boolean {
  if (points.length < 3) {
    return false;
  }

  const point = { x, y };
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = points.length - 1;
    currentIndex < points.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = points[currentIndex]!;
    const previous = points[previousIndex]!;

    if (pointIsOnSegment(point, previous, current)) {
      return true;
    }

    const crossesHorizontalRay =
      current.y > y !== previous.y > y &&
      x <
        ((previous.x - current.x) * (y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (crossesHorizontalRay) {
      inside = !inside;
    }
  }

  return inside;
}

function contains(zone: Readonly<HitZone>, x: number, y: number): boolean {
  if (zone.enabled === false) {
    return false;
  }

  if (zone.kind === "circle") {
    const offsetX = x - zone.x;
    const offsetY = y - zone.y;
    return offsetX * offsetX + offsetY * offsetY <= zone.radius ** 2;
  }

  if (zone.kind === "polygon") {
    return polygonContains(zone.points, x, y);
  }

  return (
    x >= zone.x &&
    y >= zone.y &&
    x < zone.x + zone.width &&
    y < zone.y + zone.height
  );
}

function cloneZone(zone: Readonly<HitZone>): HitZone {
  if (zone.kind === "polygon") {
    return {
      ...zone,
      points: zone.points.map((point) => ({ ...point })),
    };
  }

  return { ...zone };
}

export class SemanticHitMap {
  readonly #zones = new Map<string, HitZone>();

  setZones(zones: readonly HitZone[]): void {
    this.#zones.clear();

    for (const zone of zones) {
      this.#zones.set(zone.id, cloneZone(zone));
    }
  }

  upsert(zone: Readonly<HitZone>): void {
    this.#zones.set(zone.id, cloneZone(zone));
  }

  remove(id: string): void {
    this.#zones.delete(id);
  }

  hitTest(x: number, y: number): HitZone | null {
    let bestMatch: HitZone | null = null;
    let bestPriority = Number.NEGATIVE_INFINITY;

    for (const zone of this.#zones.values()) {
      const priority = zone.priority ?? 0;

      if (priority >= bestPriority && contains(zone, x, y)) {
        bestMatch = zone;
        bestPriority = priority;
      }
    }

    return bestMatch === null ? null : cloneZone(bestMatch);
  }

  snapshot(): readonly HitZone[] {
    return [...this.#zones.values()].map(cloneZone);
  }
}
