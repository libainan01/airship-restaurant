import { describe, expect, it } from "vitest";
import {
  SemanticHitMap,
  type HitZone,
} from "../src/renderer/desktop/semantic-hit-map";

describe("SemanticHitMap", () => {
  it("supports rectangle, circle, and polygon zones", () => {
    const hitMap = new SemanticHitMap();
    hitMap.setZones([
      {
        id: "restaurant",
        kind: "rect",
        x: 0,
        y: 500,
        width: 1000,
        height: 200,
      },
      {
        id: "bubble",
        kind: "circle",
        x: 300,
        y: 300,
        radius: 40,
      },
      {
        id: "airship",
        kind: "polygon",
        points: [
          { x: 400, y: 20 },
          { x: 600, y: 20 },
          { x: 650, y: 160 },
          { x: 350, y: 160 },
        ],
      },
    ]);

    expect(hitMap.hitTest(10, 520)?.id).toBe("restaurant");
    expect(hitMap.hitTest(300, 300)?.id).toBe("bubble");
    expect(hitMap.hitTest(500, 80)?.id).toBe("airship");
    expect(hitMap.hitTest(40, 40)).toBeNull();
  });

  it("treats polygon edges as part of the zone", () => {
    const hitMap = new SemanticHitMap();
    hitMap.upsert({
      id: "hull",
      kind: "polygon",
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 50, y: 60 },
      ],
    });

    expect(hitMap.hitTest(50, 10)?.id).toBe("hull");
    expect(hitMap.hitTest(50, 60)?.id).toBe("hull");
  });

  it("chooses the highest-priority enabled zone", () => {
    const zones: HitZone[] = [
      {
        id: "restaurant",
        kind: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
      {
        id: "dialog",
        kind: "rect",
        x: 20,
        y: 20,
        width: 60,
        height: 60,
        priority: 20,
      },
      {
        id: "disabled",
        kind: "circle",
        x: 50,
        y: 50,
        radius: 40,
        priority: 30,
        enabled: false,
      },
    ];
    const hitMap = new SemanticHitMap();
    hitMap.setZones(zones);

    expect(hitMap.hitTest(50, 50)?.id).toBe("dialog");
    hitMap.remove("dialog");
    expect(hitMap.hitTest(50, 50)?.id).toBe("restaurant");
  });

  it("returns defensive snapshots", () => {
    const hitMap = new SemanticHitMap();
    hitMap.upsert({
      id: "airship",
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
    });

    const snapshot = hitMap.snapshot();
    const polygon = snapshot[0];
    expect(polygon?.kind).toBe("polygon");

    if (polygon?.kind === "polygon") {
      expect(polygon.points).not.toBe(
        (
          hitMap.hitTest(5, 5) as Extract<
            HitZone,
            { kind: "polygon" }
          >
        ).points,
      );
    }
  });
});
