import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSaveStore } from "../src";

interface TestPayload {
  readonly counter: number;
}

const temporaryDirectories: string[] = [];

function isTestPayload(value: unknown): value is TestPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "counter" in value &&
    typeof value.counter === "number" &&
    Number.isSafeInteger(value.counter) &&
    value.counter >= 0
  );
}

async function createStore(): Promise<{
  readonly directory: string;
  readonly filePath: string;
  readonly store: JsonSaveStore<TestPayload>;
}> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "airship-save-test-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "save.json");
  return {
    directory,
    filePath,
    store: new JsonSaveStore({
      filePath,
      schemaVersion: 1,
      validatePayload: isTestPayload,
      nowUtcMs: () => 123_456,
      processId: 42,
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonSaveStore", () => {
  it("reports a missing save and round-trips a valid envelope", async () => {
    const { store } = await createStore();

    expect(await store.load()).toMatchObject({
      status: "missing",
      envelope: null,
    });
    await store.save({ counter: 7 });

    expect(await store.load()).toMatchObject({
      status: "loaded",
      envelope: {
        schemaVersion: 1,
        savedAtUtcMs: 123_456,
        payload: { counter: 7 },
      },
    });
  });

  it("recovers the previous valid save when the primary is corrupt", async () => {
    const { filePath, store } = await createStore();
    await store.save({ counter: 1 });
    await store.save({ counter: 2 });
    await fs.writeFile(filePath, "{broken", "utf8");

    const recoveredStore = new JsonSaveStore({
      filePath,
      schemaVersion: 1,
      validatePayload: isTestPayload,
      nowUtcMs: () => 200_000,
      processId: 43,
    });
    expect(await recoveredStore.load()).toMatchObject({
      status: "recovered-backup",
      envelope: { payload: { counter: 1 } },
    });

    await recoveredStore.save({ counter: 3 });
    await fs.writeFile(filePath, "{broken-again", "utf8");
    const secondRecovery = new JsonSaveStore({
      filePath,
      schemaVersion: 1,
      validatePayload: isTestPayload,
    });
    expect(await secondRecovery.load()).toMatchObject({
      status: "recovered-backup",
      envelope: { payload: { counter: 1 } },
    });
  });

  it("reports corruption when neither primary nor backup is valid", async () => {
    const { filePath, store } = await createStore();
    await fs.writeFile(filePath, "{}", "utf8");
    await fs.writeFile(store.getBackupPath(), "[]", "utf8");

    expect(await store.load()).toMatchObject({
      status: "corrupt",
      envelope: null,
    });
  });
});
