import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SettingsStore,
  createDefaultAppSettings,
} from "../src/main/settings-store";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "airship-settings-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SettingsStore", () => {
  it("starts with safe first-run defaults", async () => {
    const directory = await createTemporaryDirectory();
    const store = new SettingsStore(directory, "primary");

    expect(await store.load()).toEqual(
      createDefaultAppSettings("primary"),
    );
  });

  it("persists and restores settings with a revision", async () => {
    const directory = await createTemporaryDirectory();
    const firstStore = new SettingsStore(directory, "primary");
    await firstStore.update({
      onboardingCompleted: true,
      targetDisplayId: "secondary",
      alwaysOnTop: true,
      presentationMode: "reduced",
      uiScale: 1.2,
      managementWindowBounds: {
        x: 100,
        y: 80,
        width: 900,
        height: 640,
      },
    });

    const secondStore = new SettingsStore(directory, "primary");
    const restored = await secondStore.load();
    expect(restored).toMatchObject({
      revision: 1,
      onboardingCompleted: true,
      targetDisplayId: "secondary",
      alwaysOnTop: true,
      presentationMode: "reduced",
      uiScale: 1.2,
      managementWindowBounds: {
        x: 100,
        y: 80,
        width: 900,
        height: 640,
      },
    });
  });

  it("does not create revisions for identical updates", async () => {
    const directory = await createTemporaryDirectory();
    const store = new SettingsStore(directory, "primary");
    const unchanged = await store.update({ alwaysOnTop: false });
    expect(unchanged.revision).toBe(0);
  });
});
