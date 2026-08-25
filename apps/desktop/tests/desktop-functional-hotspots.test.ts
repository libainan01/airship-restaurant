import { describe, expect, it } from "vitest";
import {
  getFunctionalHotspotHitId,
  getFunctionalSectionFromHitId,
  rectanglesOverlap,
  resolveDesktopFunctionalHotspots,
} from "../src/renderer/desktop/desktop-functional-hotspots";
import { resolveDesktopWorldLayout } from "../src/renderer/desktop/desktop-world-layout";

describe("desktop functional hotspots", () => {
  it("maps warehouse, recipe, port, and engineering objects", () => {
    const hotspots = resolveDesktopFunctionalHotspots(
      resolveDesktopWorldLayout(1_000, 700),
    );
    expect(hotspots.map((hotspot) => hotspot.section)).toEqual([
      "recipes",
      "inventory",
      "procurement",
      "technology",
    ]);
  });

  it("keeps object hit ids reversible without accepting scene-wide zones", () => {
    expect(
      getFunctionalSectionFromHitId(
        getFunctionalHotspotHitId("inventory"),
      ),
    ).toBe("inventory");
    expect(getFunctionalSectionFromHitId("restaurant")).toBeNull();
    expect(getFunctionalSectionFromHitId("airship")).toBeNull();
  });

  it("keeps functional objects distinct and inside the viewport", () => {
    const layout = resolveDesktopWorldLayout(1_000, 700);
    const hotspots = resolveDesktopFunctionalHotspots(layout);
    for (const hotspot of hotspots) {
      expect(hotspot.x).toBeGreaterThanOrEqual(0);
      expect(hotspot.y).toBeGreaterThanOrEqual(0);
      expect(hotspot.x + hotspot.width).toBeLessThanOrEqual(
        layout.viewportWidth,
      );
      expect(hotspot.y + hotspot.height).toBeLessThanOrEqual(
        layout.viewportHeight,
      );
    }
    for (let leftIndex = 0; leftIndex < hotspots.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < hotspots.length;
        rightIndex += 1
      ) {
        expect(
          rectanglesOverlap(
            hotspots[leftIndex]!,
            hotspots[rightIndex]!,
          ),
        ).toBe(false);
      }
    }
  });
});
