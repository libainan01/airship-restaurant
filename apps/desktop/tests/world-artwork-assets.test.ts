import { describe, expect, it } from "vitest";
import {
  WORLD_ARTWORK_ASSETS,
  WORLD_ARTWORK_TEXTURES,
} from "../src/renderer/desktop/world-artwork-assets";

describe("world artwork assets", () => {
  it("uses production-safe relative URLs for every orthographic sprite", () => {
    expect(WORLD_ARTWORK_ASSETS).toEqual([
      {
        key: WORLD_ARTWORK_TEXTURES.airship,
        url: "assets/world/airship-pixel/sprite-airship-orthographic.png",
      },
      {
        key: WORLD_ARTWORK_TEXTURES.restaurant,
        url: "assets/world/airship-pixel/sprite-restaurant-orthographic.png",
      },
      {
        key: WORLD_ARTWORK_TEXTURES.cargoLift,
        url: "assets/world/airship-pixel/sprite-cargo-lift-orthographic.png",
      },
    ]);
  });
});
