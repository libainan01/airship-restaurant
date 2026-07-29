import { describe, expect, it } from "vitest";
import {
  alignTrackPointToCargoTarget,
  CABLE_CARGO_OFFSET,
  createEdgeCableRoute,
  sampleCableRoute,
  sampleCableTangent,
} from "../src/renderer/desktop/cable-route";

describe("edge cable route", () => {
  it("keeps both exchange-station anchors exact", () => {
    const route = createEdgeCableRoute(
      { x: 120, y: 80 },
      { x: 760, y: 620 },
      940,
    );

    expect(sampleCableRoute(route, 0)).toEqual({ x: 120, y: 80 });
    expect(sampleCableRoute(route, 1)).toEqual({
      x: 760,
      y: 620,
    });
  });

  it("routes through the right edge before reaching the ground station", () => {
    const route = createEdgeCableRoute(
      { x: 120, y: 80 },
      { x: 760, y: 620 },
      940,
    );

    expect(route.points).toEqual([
      { x: 120, y: 80 },
      { x: 940, y: 80 },
      { x: 940, y: 620 },
      { x: 760, y: 620 },
    ]);
    expect(route.edgeX).toBe(940);
  });

  it("rebuilds every segment when an exchange station moves", () => {
    const original = createEdgeCableRoute(
      { x: 100, y: 100 },
      { x: 700, y: 600 },
      900,
    );
    const moved = createEdgeCableRoute(
      { x: 220, y: 140 },
      { x: 820, y: 540 },
      960,
    );

    expect(moved.points).toContainEqual({ x: 960, y: 140 });
    expect(moved.points).toContainEqual({ x: 960, y: 540 });
    expect(sampleCableRoute(moved, 0.5)).not.toEqual(
      sampleCableRoute(original, 0.5),
    );
  });

  it("samples by traveled distance and exposes segment direction", () => {
    const route = createEdgeCableRoute(
      { x: 0, y: 0 },
      { x: 80, y: 100 },
      100,
    );
    const verticalPoint = sampleCableRoute(route, 0.5);
    const tangent = sampleCableTangent(route, 0.5);

    expect(verticalPoint).toEqual({ x: 100, y: 10 });
    expect(tangent).toEqual({ x: 0, y: 1 });
  });

  it("covers every segment from the airship station to the ground station", () => {
    const route = createEdgeCableRoute(
      { x: 120, y: 80 },
      { x: 760, y: 620 },
      940,
    );
    const firstTurnProgress =
      route.segments[0]!.length / route.length;
    const secondTurnProgress =
      (route.segments[0]!.length + route.segments[1]!.length) /
      route.length;
    const firstTurn = sampleCableRoute(route, firstTurnProgress);
    const secondTurn = sampleCableRoute(route, secondTurnProgress);

    expect(sampleCableRoute(route, 0)).toEqual(route.start);
    expect(firstTurn.x).toBeCloseTo(route.edgeStart.x);
    expect(firstTurn.y).toBeCloseTo(route.edgeStart.y);
    expect(secondTurn.x).toBeCloseTo(route.edgeEnd.x);
    expect(secondTurn.y).toBeCloseTo(route.edgeEnd.y);
    expect(sampleCableRoute(route, 1)).toEqual(route.end);
  });

  it("aligns the cargo box with an exchange-station target", () => {
    const target = { x: 640, y: 56 };
    const trackPoint = alignTrackPointToCargoTarget(target);

    expect(trackPoint).toEqual({ x: 653, y: 10 });
    expect({
      x: trackPoint.x + CABLE_CARGO_OFFSET.x,
      y: trackPoint.y + CABLE_CARGO_OFFSET.y,
    }).toEqual(target);
  });
});
