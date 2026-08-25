import { describe, expect, it } from "vitest";
import type { RestaurantLayoutPropInstance } from "../src/renderer/desktop/restaurant-layout";
import { resolveRestaurantPropBounds } from "../src/renderer/desktop/restaurant-static-renderer";

const PROP: RestaurantLayoutPropInstance = {
  id: "prop.test",
  kind: "table",
  visualKey: "placeholder.test",
  renderLayer: "furniture",
  transform: {
    xRatio: 0.5,
    yRatio: 0.25,
    offsetXPx: 10,
    offsetYPx: -5,
    originX: 0.25,
    originY: 0.75,
  },
  dimensions: {
    widthRatio: 0.2,
    widthPx: 20,
    widthOffsetPx: -10,
    heightRatio: 0.5,
    heightPx: 10,
    heightOffsetPx: -5,
  },
  capabilities: ["seating"],
  tags: ["test"],
};

describe("restaurant prop bounds", () => {
  it("combines ratio, pixel offsets and custom origins", () => {
    expect(resolveRestaurantPropBounds(PROP, {
      viewportWidth: 1_000,
      restaurantY: 500,
      restaurantHeight: 200,
    })).toEqual({
      x: 510,
      y: 545,
      left: 457.5,
      top: 466.25,
      width: 210,
      height: 105,
    });
  });

  it("defaults an omitted origin to the center", () => {
    const bounds = resolveRestaurantPropBounds({
      ...PROP,
      transform: { xRatio: 0.2, yRatio: 0.4 },
      dimensions: { widthPx: 80, heightPx: 20 },
    }, {
      viewportWidth: 1_000,
      restaurantY: 400,
      restaurantHeight: 250,
    });

    expect(bounds).toEqual({
      x: 200,
      y: 500,
      left: 160,
      top: 490,
      width: 80,
      height: 20,
    });
  });
});
