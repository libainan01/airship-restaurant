import { describe, expect, it } from "vitest";
import { resolveCableInfrastructureRoute } from "../src/renderer/desktop/cable-infrastructure-renderer";

describe("cable infrastructure route", () => {
  it("keeps both station anchors and the configured edge", () => {
    const route = resolveCableInfrastructureRoute({
      airshipTrackPoint: { x: 140, y: 20 },
      groundExchangePoint: { x: 760, y: 610 },
      transportEdgeX: 930,
    });

    expect(route.points).toEqual([
      { x: 140, y: 20 },
      { x: 930, y: 20 },
      { x: 930, y: 610 },
      { x: 760, y: 610 },
    ]);
    expect(route.start).toEqual({ x: 140, y: 20 });
    expect(route.end).toEqual({ x: 760, y: 610 });
  });
});
