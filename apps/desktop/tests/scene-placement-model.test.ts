import { describe, expect, it } from "vitest";
import {
  PLACEMENT_SCENE_HEIGHT,
  PLACEMENT_SCENE_WIDTH,
  clampPlacementToRegion,
  clientPointToScene,
  findOpenPlacement,
  sceneRectStyle,
} from "../src/renderer/management/features/upgrades/scene-placement-model";

describe("scene placement model", () => {
  it("converts a scaled canvas point into logical scene coordinates", () => {
    expect(clientPointToScene(
      { left: 100, top: 50, width: 960, height: 540 },
      580,
      320,
    )).toEqual({
      x: PLACEMENT_SCENE_WIDTH / 2,
      y: PLACEMENT_SCENE_HEIGHT / 2,
    });
  });

  it("snaps and clamps buildings inside their physical region", () => {
    expect(clampPlacementToRegion(
      { x: 1_900, y: 900 },
      { width: 128, height: 128 },
      ["zone.airship"],
    )).toEqual({ x: 1_792, y: 320 });
    expect(clampPlacementToRegion(
      { x: -20, y: 0 },
      { width: 128, height: 64 },
      ["zone.ground"],
    )).toEqual({ x: 0, y: 640 });
  });

  it("finds the next grid position when the preferred position is occupied", () => {
    expect(findOpenPlacement(
      { width: 64, height: 64 },
      ["zone.edge"],
      [{ x: 1_280, y: 512, width: 64, height: 64 }],
    )).toEqual({ x: 0, y: 448 });
  });

  it("converts logical rectangles into percentage styles", () => {
    expect(sceneRectStyle({
      x: 960,
      y: 540,
      width: 192,
      height: 108,
    })).toEqual({
      left: "50%",
      top: "50%",
      width: "10%",
      height: "10%",
    });
  });
});