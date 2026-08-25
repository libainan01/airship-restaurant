import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSaveStore } from "../src";

const directories: string[] = [];
async function makePath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "airship-integrity-"));
  directories.push(directory);
  return path.join(directory, "save.json");
}
const isPayload = (value: unknown): value is { counter: number } =>
  typeof value === "object" && value !== null && "counter" in value && typeof value.counter === "number";

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("JsonSaveStore integrity and migration", () => {
  it("writes a SHA-256 checksum and rejects payload tampering", async () => {
    const filePath = await makePath();
    const store = new JsonSaveStore({ filePath, schemaVersion: 2, validatePayload: isPayload, nowUtcMs: () => 10 });
    await store.save({ counter: 1 });
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(raw.checksumAlgorithm).toBe("sha256");
    expect(raw.checksum).toMatch(/^[a-f0-9]{64}$/);
    raw.payload.counter = 99;
    await fs.writeFile(filePath, JSON.stringify(raw), "utf8");
    expect(await store.load()).toMatchObject({ status: "corrupt", envelope: null });
  });

  it("migrates a legacy envelope in memory without rewriting its source file", async () => {
    const filePath = await makePath();
    const legacy = JSON.stringify({ schemaVersion: 1, savedAtUtcMs: 5, payload: { counter: 7 } });
    await fs.writeFile(filePath, legacy, "utf8");
    const store = new JsonSaveStore({
      filePath,
      schemaVersion: 2,
      validatePayload: isPayload,
      migrateEnvelope: (value) => {
        if (typeof value !== "object" || value === null || !("payload" in value) || !isPayload(value.payload)) return null;
        return { savedAtUtcMs: 5, payload: value.payload, diagnostic: "migrated v1" };
      },
    });
    const result = await store.load();
    expect(result).toMatchObject({ status: "loaded", envelope: { schemaVersion: 2, payload: { counter: 7 } } });
    expect(result.diagnostics).toContain("migrated v1");
    expect(await fs.readFile(filePath, "utf8")).toBe(legacy);
  });
});