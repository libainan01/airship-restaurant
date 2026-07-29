import { describe, expect, it } from "vitest";
import { SemanticHitMap } from "./hit-map";

describe("SemanticHitMap", () => {
  it("keeps disconnected interaction islands independent", () => {
    const map = new SemanticHitMap();
    map.setZones([
      {
        id: "kitchen",
        kind: "rect",
        x: 0,
        y: 0,
        width: 800,
        height: 120,
      },
      {
        id: "restaurant",
        kind: "rect",
        x: 0,
        y: 600,
        width: 800,
        height: 120,
      },
    ]);

    expect(map.hitTest(400, 40)?.id).toBe("kitchen");
    expect(map.hitTest(400, 360)).toBeNull();
    expect(map.hitTest(400, 680)?.id).toBe("restaurant");
  });

  it("supports temporary circular interaction bubbles", () => {
    const map = new SemanticHitMap();
    map.upsert({
      id: "recipe-bubble",
      kind: "circle",
      x: 300,
      y: 260,
      radius: 36,
      priority: 20,
    });

    expect(map.hitTest(300, 260)?.id).toBe("recipe-bubble");
    expect(map.hitTest(340, 300)).toBeNull();
    map.remove("recipe-bubble");
    expect(map.hitTest(300, 260)).toBeNull();
  });

  it("chooses a higher-priority control over its containing shell", () => {
    const map = new SemanticHitMap();
    map.setZones([
      {
        id: "top-shell",
        kind: "rect",
        x: 0,
        y: 0,
        width: 800,
        height: 120,
        priority: 1,
      },
      {
        id: "quit-button",
        kind: "rect",
        x: 720,
        y: 16,
        width: 64,
        height: 36,
        priority: 10,
      },
    ]);

    expect(map.hitTest(750, 30)?.id).toBe("quit-button");
  });

  it("ignores disabled zones", () => {
    const map = new SemanticHitMap();
    map.upsert({
      id: "disabled-port",
      kind: "rect",
      x: 0,
      y: 200,
      width: 100,
      height: 200,
      enabled: false,
    });

    expect(map.hitTest(20, 220)).toBeNull();
  });
});
