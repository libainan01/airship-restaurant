import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  legacyGameplayRuntimeStateToSaveSlices,
  type LegacyGameplayRuntimeState,
} from "@airship-restaurant/core";
import { GameSaveService } from "../src/main/game-save-service";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("R0 save fixture migration", () => {
  for (const scenario of [
    { id: "new-progress", status: "loaded", source: "save.json" },
    { id: "operating", status: "loaded", source: "save.json" },
    { id: "transporting", status: "loaded", source: "save.json" },
    { id: "story-active", status: "loaded", source: "save.json" },
    { id: "backup-recovery", status: "recovered-backup", source: "save.json.bak" },
  ] as const) {
    it(`migrates ${scenario.id} equivalently without changing either source file`, async () => {
      const fixtureDirectory = path.resolve("packages/test-support/fixtures/r0/saves", scenario.id);
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), `airship-r0-${scenario.id}-`));
      temporaryDirectories.push(directory);
      await fs.cp(fixtureDirectory, directory, { recursive: true });
      const before = new Map<string, string>();
      for (const fileName of ["save.json", "save.json.bak"]) {
        try { before.set(fileName, await fs.readFile(path.join(directory, fileName), "utf8")); } catch {}
      }
      const expectedEnvelope = JSON.parse(await fs.readFile(path.join(directory, scenario.source), "utf8"));
      const legacy = expectedEnvelope.payload as LegacyGameplayRuntimeState & Record<string, unknown>;
      const {
        version: _version, revision: _revision, currentUtcMs: _currentUtcMs,
        nextSupplyAtUtcMs: _nextSupplyAtUtcMs,
        supplyBoxesReceived: _supplyBoxesReceived, randomState: _randomState,
        kitchenActivated: _kitchenActivated, inventory: _inventory,
        cooking: _cooking, logistics: _logistics, restaurant: _restaurant,
        upgrades: _upgrades, procurement: _procurement, ...extensions
      } = legacy;
      const expectedPayload = {
        ...legacyGameplayRuntimeStateToSaveSlices(legacy),
        ...extensions,
      };
      const service = new GameSaveService(directory, () => 9_000_000);
      const result = await service.load();
      expect(result.status).toBe(scenario.status);
      expect(result.envelope?.payload).toEqual(expectedPayload);
      expect(service.getDiagnostics()).toMatchObject({
        loadSource: scenario.status === "recovered-backup" ? "backup" : "primary",
        migrationStatus: scenario.status === "recovered-backup"
          ? "recovered-backup-and-migrated"
          : "migrated-primary",
      });
      expect(service.getDiagnostics().loadDiagnostics.some((message) =>
        message.toLowerCase().includes("migrated"),
      )).toBe(true);
      for (const [fileName, contents] of before) {
        expect(await fs.readFile(path.join(directory, fileName), "utf8")).toBe(contents);
      }
    });
  }
});