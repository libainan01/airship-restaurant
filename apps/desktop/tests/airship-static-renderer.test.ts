import { describe, expect, it } from "vitest";
import {
  createAirshipHitPoints,
  resolveGroundExchangeStationBounds,
} from "../src/renderer/desktop/airship-static-renderer";
import { resolveDesktopFunctionalHotspots } from "../src/renderer/desktop/desktop-functional-hotspots";
import { resolveDesktopWorldLayout } from "../src/renderer/desktop/desktop-world-layout";

describe("airship hit geometry", () => {
  it("builds the interaction polygon from rendered dimensions", () => {
    const points = createAirshipHitPoints({
      centerX: 500,
      top: 10,
      width: 600,
      height: 200,
    });

    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ x: 230, y: 72 });
    expect(points[2]).toEqual({ x: 500, y: 11 });
    expect(points[4]).toEqual({ x: 782, y: 72 });
    expect(points[8]).toEqual({ x: 560, y: 206 });
    expect(points[12]).toEqual({ x: 266, y: 114 });
  });

  it("translates every hit point with the airship", () => {
    const original = createAirshipHitPoints({
      centerX: 500,
      top: 10,
      width: 600,
      height: 200,
    });
    const moved = createAirshipHitPoints({
      centerX: 620,
      top: 45,
      width: 600,
      height: 200,
    });

    expect(moved).toEqual(original.map((point) => ({
      x: point.x + 120,
      y: point.y + 35,
    })));
  });
});
describe("ground exchange station geometry", () => {
  it.each([
    [640, 480],
    [1_280, 720],
    [3_000, 2_000],
  ])("stays compact and clears the warehouse at %sx%s", (width, height) => {
    const layout = resolveDesktopWorldLayout(width, height);
    const bounds = resolveGroundExchangeStationBounds({
      x: layout.groundExchangePoint.x,
      restaurantY: layout.restaurantY,
    });
    const inventory = resolveDesktopFunctionalHotspots(layout).find(
      (hotspot) => hotspot.section === "inventory",
    )!;

    expect(bounds.width).toBe(92);
    expect(bounds.height).toBe(66);
    expect(bounds.bottom).toBeLessThan(inventory.y);
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(
      layout.viewportWidth,
    );
  });
});