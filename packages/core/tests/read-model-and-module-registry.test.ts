import { describe, expect, it, vi } from "vitest";
import { ReadModelRegistry } from "../src/projections/read-model-registry";
import { RuntimeModuleRegistry } from "../src/runtime/runtime-module-registry";

describe("ReadModelRegistry", () => {
  it("keeps independent revisions and supports current-state hydration", () => {
    const registry = new ReadModelRegistry();
    registry.register("inventory", { total: 1 });
    registry.register("finance", { copper: 5 });
    const listener = vi.fn();
    const unsubscribe = registry.subscribe<{ readonly total: number }>(
      "inventory",
      listener,
      { emitCurrent: true },
    );

    expect(listener).toHaveBeenLastCalledWith({
      key: "inventory",
      revision: 0,
      value: { total: 1 },
    });
    expect(registry.publish("inventory", { total: 2 })).toEqual({
      key: "inventory",
      revision: 1,
      value: { total: 2 },
    });
    expect(registry.get("finance")).toEqual({
      key: "finance",
      revision: 0,
      value: { copper: 5 },
    });
    unsubscribe();
    registry.publish("inventory", { total: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.listKeys()).toEqual(["finance", "inventory"]);
  });
});

describe("RuntimeModuleRegistry", () => {
  it("registers modules once and exposes only their public object", () => {
    const registry = new RuntimeModuleRegistry();
    const inventory = { moduleId: "inventory", count: 2 };
    const unregister = registry.register(inventory);

    expect(registry.require<typeof inventory>("inventory")).toBe(inventory);
    expect(registry.listModuleIds()).toEqual(["inventory"]);
    expect(() => registry.register(inventory)).toThrow("already registered");
    unregister();
    expect(registry.get("inventory")).toBeNull();
  });
});
