import { describe, expect, it } from "vitest";
import { fitBoundsToWorkArea } from "../src/main/display-service";

describe("fitBoundsToWorkArea", () => {
  it("keeps a visible management window unchanged", () => {
    expect(
      fitBoundsToWorkArea(
        { x: 120, y: 80, width: 900, height: 640 },
        { x: 0, y: 0, width: 1920, height: 1040 },
      ),
    ).toEqual({ x: 120, y: 80, width: 900, height: 640 });
  });

  it("moves an off-screen window back into the work area", () => {
    expect(
      fitBoundsToWorkArea(
        { x: 2500, y: -900, width: 900, height: 640 },
        { x: 0, y: 0, width: 1920, height: 1040 },
      ),
    ).toEqual({ x: 1020, y: 0, width: 900, height: 640 });
  });

  it("fits the window inside a small display", () => {
    expect(
      fitBoundsToWorkArea(
        { x: -2000, y: 40, width: 1200, height: 900 },
        { x: -1280, y: 0, width: 1280, height: 720 },
      ),
    ).toEqual({ x: -1280, y: 0, width: 1200, height: 720 });
  });
});
