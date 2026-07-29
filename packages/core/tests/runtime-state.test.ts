import { describe, expect, it } from "vitest";
import { createInitialRuntimeState } from "../src";

describe("createInitialRuntimeState", () => {
  it("creates a deterministic boot state", () => {
    expect(createInitialRuntimeState()).toEqual({
      revision: 0,
      phase: "booting",
    });
  });
});
