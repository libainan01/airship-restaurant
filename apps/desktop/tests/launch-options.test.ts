import { describe, expect, it } from "vitest";
import {
  getRendererBaseUrl,
  parseLaunchOptions,
} from "../src/main/launch-options";

describe("parseLaunchOptions", () => {
  it("keeps the management window lazy by default", () => {
    expect(parseLaunchOptions(["electron", "main.js"])).toEqual({
      showManagement: false,
      smokeTest: false,
    });
  });

  it("opens management explicitly", () => {
    expect(
      parseLaunchOptions([
        "electron",
        "main.js",
        "--show-management",
      ]),
    ).toEqual({
      showManagement: true,
      smokeTest: false,
    });
  });

  it("opens management during smoke tests", () => {
    expect(
      parseLaunchOptions(["electron", "main.js", "--smoke-test"]),
    ).toEqual({
      showManagement: true,
      smokeTest: true,
    });
  });
});

describe("getRendererBaseUrl", () => {
  it("uses production files when no development URL is configured", () => {
    expect(getRendererBaseUrl({})).toBeNull();
  });

  it("accepts local HTTP renderer servers", () => {
    expect(
      getRendererBaseUrl({
        AIRSHIP_RENDERER_URL: "http://127.0.0.1:5173/",
      }),
    ).toBe("http://127.0.0.1:5173/");
  });

  it("rejects privileged local file URLs from the environment", () => {
    expect(() =>
      getRendererBaseUrl({
        AIRSHIP_RENDERER_URL: "file:///unexpected/renderer/",
      }),
    ).toThrow("http or https");
  });
});
