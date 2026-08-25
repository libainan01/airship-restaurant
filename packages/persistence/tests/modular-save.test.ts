import { describe, expect, it } from "vitest";
import {
  createModularSaveDocument,
  getSaveModule,
  isModularSaveDocument,
  mergeSaveModules,
} from "../src";

describe("ModularSaveDocument", () => {
  it("preserves unknown modules while known modules are replaced or removed", () => {
    const original = createModularSaveDocument(4, {
      "module.simulation": { schemaVersion: 1, payload: { value: 1 } },
      "mod.example.weather": { schemaVersion: 3, payload: { rain: true } },
    });
    const modules = mergeSaveModules(original, {
      "module.simulation": { schemaVersion: 1, payload: { value: 2 } },
    }, ["module.story"]);
    const next = createModularSaveDocument(5, modules);

    expect(isModularSaveDocument(next)).toBe(true);
    expect(next.modules["mod.example.weather"]?.payload).toEqual({ rain: true });
    expect(getSaveModule(
      next,
      "module.simulation",
      1,
      (value): value is { value: number } => typeof value === "object" && value !== null && "value" in value && typeof value.value === "number",
    )?.payload.value).toBe(2);
  });

  it("rejects invalid module ids and schema versions", () => {
    expect(() => createModularSaveDocument(0, {
      bad: { schemaVersion: 1, payload: {} },
    })).toThrow("invalid");
    expect(() => createModularSaveDocument(0, {
      "module.bad": { schemaVersion: 0, payload: {} },
    })).toThrow("invalid");
  });
});