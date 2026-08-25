import { describe, expect, it } from "vitest";
import {
  SequentialInstanceIdGenerator,
  contentId,
  createSubresourceId,
  instanceId,
  isContentId,
  isInstanceId,
  isSubresourceId,
} from "../src";

describe("stable ids", () => {
  it("keeps content, instance, and stable subresource namespaces separate", () => {
    expect(contentId("recipe.tomato_egg")).toBe("recipe.tomato_egg");
    expect(isContentId("instance.character.runtime_1")).toBe(false);
    expect(isInstanceId("instance.character.runtime_1")).toBe(true);
    expect(isSubresourceId("subresource.character_runtime_1.inventory")).toBe(true);
    expect(() => contentId("番茄炒蛋")).toThrow("Content id is invalid");
  });

  it("generates deterministic instance ids and owner-derived subresource ids", () => {
    const generator = new SequentialInstanceIdGenerator("save_a", 35);
    const character = generator.next("character");
    expect(character).toBe("instance.character.save_a_z");
    expect(generator.next("character")).toBe("instance.character.save_a_10");
    const restored = SequentialInstanceIdGenerator.fromState(generator.exportState());
    expect(restored.next("building")).toBe("instance.building.save_a_11");
    expect(createSubresourceId(character, "inventory")).toBe(
      "subresource.character_save_a_z.inventory",
    );
  });

  it("rejects unstable display names and malformed instance ids", () => {
    expect(() => instanceId("character.otto")).toThrow("Instance id is invalid");
    expect(() => new SequentialInstanceIdGenerator("bad namespace")).toThrow(
      "stable lowercase identifier segment",
    );
  });
});