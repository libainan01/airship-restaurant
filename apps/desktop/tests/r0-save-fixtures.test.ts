import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameSaveService } from "../src/main/game-save-service";

interface SaveScenario {
  readonly id: string;
  readonly directory: string;
  readonly expectedStatus: "missing" | "loaded" | "recovered-backup" | "corrupt";
  readonly expectedLoadSource: "new" | "primary" | "backup" | "reset-corrupt";
}

interface SaveScenarioFixture {
  readonly fixtureVersion: 1;
  readonly scenarios: readonly SaveScenario[];
}

const SAVE_FIXTURE_ROOT = path.resolve(
  process.cwd(),
  "packages/test-support/fixtures/r0/saves",
);
const temporaryDirectories: string[] = [];

async function createScenarioDirectory(scenario: SaveScenario): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "airship-r0-save-"));
  temporaryDirectories.push(directory);
  await fs.cp(path.join(SAVE_FIXTURE_ROOT, scenario.directory), directory, {
    recursive: true,
  });
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("R0 fixed save fixtures", () => {
  it("loads every fixed primary, backup, missing, and corrupt scenario", async () => {
    const fixture = JSON.parse(
      await fs.readFile(path.join(SAVE_FIXTURE_ROOT, "scenarios.json"), "utf8"),
    ) as SaveScenarioFixture;

    for (const scenario of fixture.scenarios) {
      const directory = await createScenarioDirectory(scenario);
      const service = new GameSaveService(directory, () => 90_000);
      const result = await service.load();
      expect(result.status, scenario.id).toBe(scenario.expectedStatus);
      expect(service.getDiagnostics().loadSource, scenario.id).toBe(
        scenario.expectedLoadSource,
      );      const expectedMigrationStatus = scenario.expectedStatus === "loaded"
        ? "migrated-primary"
        : scenario.expectedStatus === "recovered-backup"
          ? "recovered-backup-and-migrated"
          : scenario.expectedStatus === "corrupt"
            ? "reset-corrupt"
            : "not-needed";
      expect(service.getDiagnostics().migrationStatus, scenario.id).toBe(
        expectedMigrationStatus,
      );
      if (scenario.expectedStatus === "corrupt" || scenario.expectedStatus === "recovered-backup") {
        expect(service.getDiagnostics().loadDiagnostics.length, scenario.id).toBeGreaterThan(0);
      }

      if (scenario.id === "operating") {
        expect(result.envelope?.payload.cooking.activeJob).not.toBeNull();
      }
      if (scenario.id === "transporting") {
        expect(result.envelope?.payload.logistics).toMatchObject({
          phase: "outbound",
          activeShipment: { id: "shipment-1" },
        });
      }
      if (scenario.id === "story-active") {
        expect(result.envelope?.payload.story?.active).toMatchObject({
          stageId: "story.test.stage-1",
          lineIndex: 0,
        });
      }
    }
  });
});
