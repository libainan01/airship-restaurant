export type RectHitZone = {
  id: string;
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  priority?: number;
  enabled?: boolean;
};

export type CircleHitZone = {
  id: string;
  kind: "circle";
  x: number;
  y: number;
  radius: number;
  priority?: number;
  enabled?: boolean;
};

export type HitZone = RectHitZone | CircleHitZone;

function contains(zone: HitZone, x: number, y: number): boolean {
  if (zone.enabled === false) {
    return false;
  }

  if (zone.kind === "circle") {
    const offsetX = x - zone.x;
    const offsetY = y - zone.y;
    return offsetX * offsetX + offsetY * offsetY <= zone.radius * zone.radius;
  }

  return (
    x >= zone.x &&
    y >= zone.y &&
    x < zone.x + zone.width &&
    y < zone.y + zone.height
  );
}

export class SemanticHitMap {
  readonly #zones = new Map<string, HitZone>();

  setZones(zones: HitZone[]): void {
    this.#zones.clear();
    for (const zone of zones) {
      this.#zones.set(zone.id, { ...zone });
    }
  }

  upsert(zone: HitZone): void {
    this.#zones.set(zone.id, { ...zone });
  }

  remove(id: string): void {
    this.#zones.delete(id);
  }

  hitTest(x: number, y: number): HitZone | null {
    let bestMatch: HitZone | null = null;
    let bestPriority = Number.NEGATIVE_INFINITY;

    for (const zone of this.#zones.values()) {
      const priority = zone.priority ?? 0;
      if (
        priority >= bestPriority &&
        contains(zone, x, y)
      ) {
        bestMatch = zone;
        bestPriority = priority;
      }
    }

    return bestMatch;
  }

  snapshot(): HitZone[] {
    return [...this.#zones.values()].map((zone) => ({ ...zone }));
  }
}
