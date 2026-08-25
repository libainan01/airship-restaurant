import { describe, expect, it } from "vitest";
import { resolveDesktopFpsLimit } from "../src/renderer/desktop/desktop-performance-governor";

describe("desktop performance governor", () => {
  it("keeps every visible presentation mode at its selected steady frame rate", () => {
    expect(resolveDesktopFpsLimit("normal", false)).toBe(30);
    expect(resolveDesktopFpsLimit("reduced", false)).toBe(15);
    expect(resolveDesktopFpsLimit("quiet", false)).toBe(5);
  });

  it("uses the minimum frame rate only when the document is actually hidden", () => {
    expect(resolveDesktopFpsLimit("normal", true)).toBe(2);
    expect(resolveDesktopFpsLimit("reduced", true)).toBe(2);
    expect(resolveDesktopFpsLimit("quiet", true)).toBe(2);
  });
});