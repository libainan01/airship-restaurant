import { describe, expect, it } from "vitest";
import {
  isAppSettingsSnapshot,
  isAppSettingsUpdate,
} from "../src";

const validSnapshot = {
  revision: 2,
  onboardingCompleted: true,
  targetDisplayId: "2528732444",
  alwaysOnTop: false,
  presentationMode: "reduced",
  uiScale: 1.1,
  managementWindowBounds: {
    x: 120,
    y: 80,
    width: 1024,
    height: 720,
  },
  needsDisplayConfirmation: false,
} as const;

describe("isAppSettingsSnapshot", () => {
  it("accepts the complete persisted settings schema", () => {
    expect(isAppSettingsSnapshot(validSnapshot)).toBe(true);
  });

  it("rejects unsafe scale values and incomplete snapshots", () => {
    expect(
      isAppSettingsSnapshot({ ...validSnapshot, uiScale: 5 }),
    ).toBe(false);
    expect(
      isAppSettingsSnapshot({
        revision: 0,
        onboardingCompleted: false,
      }),
    ).toBe(false);
  });
});

describe("isAppSettingsUpdate", () => {
  it("accepts bounded partial updates", () => {
    expect(
      isAppSettingsUpdate({
        alwaysOnTop: true,
        presentationMode: "quiet",
      }),
    ).toBe(true);
  });

  it("rejects unknown keys and unavailable presentation modes", () => {
    expect(isAppSettingsUpdate({ secret: true })).toBe(false);
    expect(
      isAppSettingsUpdate({ presentationMode: "cinematic" }),
    ).toBe(false);
  });
});
