import { describe, expect, it } from "vitest";
import { resolveDesktopWorldLayout } from "../src/renderer/desktop/desktop-world-layout";

describe("desktop world layout", () => {
  it("separates the compact service hub from outdoor dining", () => {
    const layout = resolveDesktopWorldLayout(1_280, 720);

    expect(layout).toMatchObject({
      viewportWidth: 1_280,
      viewportHeight: 720,
      airshipCenterX: 486,
      airshipTop: -72,
      airshipWidth: 280,
      airshipHeight: 172,
      restaurantX: 38,
      restaurantWidth: 973,
      restaurantY: 572,
      restaurantHeight: 148,
      restaurantArtworkX: 986,
      restaurantArtworkY: 524,
      restaurantArtworkWidth: 294,
      restaurantArtworkHeight: 196,
      airshipExchangePoint: { x: 486, y: 86 },
      airshipTrackPoint: { x: 499, y: 40 },
      groundExchangePoint: { x: 1_228, y: 544 },
      transportEdgeX: 1_258,
    });
    expect(layout.restaurantWidth).toBeGreaterThan(
      layout.restaurantArtworkWidth,
    );
    expect(
      layout.restaurantArtworkX + layout.restaurantArtworkWidth,
    ).toBe(layout.viewportWidth);
    const rightmostStartingTableX =
      layout.restaurantX + layout.restaurantWidth * 0.68;
    expect(rightmostStartingTableX).toBeLessThan(
      layout.restaurantArtworkX,
    );
    expect(layout.viewportWidth - layout.transportEdgeX).toBe(22);
    expect(layout.airshipHitPoints).toHaveLength(13);
    expect(layout.hud).toMatchObject({
      runtimeStatus: { x: 486, y: 12 },
      airshipTitle: { x: 486, y: 52 },
      airshipStatus: { x: 486, y: 74 },
      restaurantTitle: { x: 1_008, y: 614 },
      restaurantHint: { x: 1_260, y: 620 },
      groundExchange: { x: 1_228, y: 588 },
      toast: { x: 640, y: 534 },
      portStatus: { x: 1_062, y: 508 },
    });
    expect(layout.hud.saleFeedback.x).toBeCloseTo(466.12);
    expect(layout.hud.saleFeedback.y).toBeCloseTo(632.68);
  });

  it("applies the minimum supported viewport before positioning modules", () => {
    const layout = resolveDesktopWorldLayout(320, 240);

    expect(layout).toMatchObject({
      viewportWidth: 640,
      viewportHeight: 480,
      airshipCenterX: 243,
      airshipTop: -72,
      airshipWidth: 280,
      airshipHeight: 172,
      restaurantX: 19,
      restaurantWidth: 616,
      restaurantArtworkX: 380,
      restaurantArtworkY: 307,
      restaurantArtworkWidth: 260,
      restaurantArtworkHeight: 173,
      restaurantY: 332,
      restaurantHeight: 148,
      airshipExchangePoint: { x: 243, y: 86 },
      airshipTrackPoint: { x: 256, y: 40 },
      groundExchangePoint: { x: 588, y: 304 },
      transportEdgeX: 618,
    });
    expect(layout.hud.restaurantHint).toEqual({ x: 620, y: 380 });
    expect(layout.hud.toast).toEqual({ x: 320, y: 294 });
  });

  it("caps artwork while allowing the outdoor dining area to grow", () => {
    const layout = resolveDesktopWorldLayout(3_000, 2_000);

    expect(layout.airshipWidth).toBe(440);
    expect(layout.airshipHeight).toBe(271);
    expect(layout.restaurantArtworkWidth).toBe(360);
    expect(layout.restaurantArtworkHeight).toBe(240);
    expect(layout.restaurantWidth).toBe(1_080);
    expect(layout.restaurantHeight).toBe(210);
  });
});
