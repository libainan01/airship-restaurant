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
      residentStability: null,
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
      residentStability: null,
    });
  });

  it("opens management during smoke tests", () => {
    expect(
      parseLaunchOptions(["electron", "main.js", "--smoke-test"]),
    ).toEqual({
      showManagement: true,
      smokeTest: true,
      residentStability: null,
    });
  });

  it("parses an isolated resident stability run", () => {
    expect(
      parseLaunchOptions([
        "electron",
        "main.js",
        "--stability-test",
        "--stability-duration-minutes=120",
        "--stability-sample-seconds=30",
      ]),
    ).toEqual({
      showManagement: true,
      smokeTest: false,
      residentStability: {
        durationMs: 7_200_000,
        sampleIntervalMs: 30_000,
      },
    });
  });

  it("rejects invalid or ambiguous stability options", () => {
    expect(() =>
      parseLaunchOptions([
        "--smoke-test",
        "--stability-test",
      ]),
    ).toThrow("cannot run together");
    expect(() =>
      parseLaunchOptions([
        "--stability-test",
        "--stability-duration-minutes=0",
      ]),
    ).toThrow("between 0.05 and 1440");
    expect(() =>
      parseLaunchOptions([
        "--stability-sample-seconds=10",
      ]),
    ).toThrow("require --stability-test");
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
