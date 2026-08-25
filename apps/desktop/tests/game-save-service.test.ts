import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GameplayRuntime,
  NarrativeSystem,
  RESTAURANT_OPERATIONAL_SAVE_MANIFEST,
  type RestaurantOperationalInitialStates,
} from "@airship-restaurant/core";
import { GameSaveService } from "../src/main/game-save-service";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "airship-game-save-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function createRestaurantOperationalState(): RestaurantOperationalInitialStates {
  const states: Record<string, unknown> = {};
  for (const entry of RESTAURANT_OPERATIONAL_SAVE_MANIFEST) {
    states[entry.key] = entry.key === "applicationRuntime"
      ? {
        schemaVersion: entry.schemaVersion,
        revision: 0,
        currentUtcMs: 1_000,
        cycle: 0,
        processes: [{ id: "process.test", nextTransitionUtcMs: null }],
      }
      : { schemaVersion: entry.schemaVersion, revision: 0 };
  }
  return states as unknown as RestaurantOperationalInitialStates;
}

function createSimulation(): GameplayRuntime {
  return new GameplayRuntime({
    startUtcMs: 1_000,
    randomSeed: 123,
    ingredients: [{ id: "ingredient.test", capacity: 20 }],
    recipes: [
      {
        id: "recipe.test",
        durationMs: 1_000,
        outputItemId: "dish.test",
        outputQuantity: 1,
        unitPriceCopper: 1,
        ingredients: [
          { itemId: "ingredient.test", quantity: 1 },
        ],
      },
    ],
    initialIngredients: [{ itemId: "ingredient.test", quantity: 10 }],
    supply: {
      intervalMs: 60_000,
      items: [{ itemId: "ingredient.test", quantity: 1 }],
    },
    defaultRecipeId: "recipe.test",
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("GameSaveService narrative compatibility", () => {
  it("loads a legacy M2 payload without narrative state", async () => {
    const directory = await createTemporaryDirectory();
    const slices = createSimulation().exportSaveSlices();
    const legacyPayload = {
      ...slices.gameplayRuntime,
      inventory: slices.gameplayInventory,
      cooking: slices.cooking,
      logistics: slices.logistics,
      restaurant: slices.restaurant,
      procurement: slices.procurementHistory,
    };
    await fs.writeFile(
      path.join(directory, "save.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        savedAtUtcMs: 2_000,
        payload: legacyPayload,
      })}\n`,
      "utf8",
    );

    const loaded = await new GameSaveService(
      directory,
      () => 3_000,
    ).load();

    expect(loaded.status).toBe("loaded");
    expect(loaded.envelope?.payload).toEqual(createSimulation().exportSaveSlices());
    expect(loaded.envelope?.payload.narrative).toBeUndefined();
  });

  it("round-trips a complete restaurant operational module set", async () => {
    const directory = await createTemporaryDirectory();
    const restaurantOperational = createRestaurantOperationalState();
    const service = new GameSaveService(directory, () => 3_000);

    await service.saveAndFlush({
      ...createSimulation().exportSaveSlices(),
      restaurantOperational,
    });

    const loaded = await new GameSaveService(directory, () => 4_000).load();
    expect(loaded.status).toBe("loaded");
    expect(loaded.envelope?.payload.restaurantOperational).toEqual(
      restaurantOperational,
    );
  });

  it("skips an incomplete operational set without discarding the legacy gameplay save", async () => {
    const directory = await createTemporaryDirectory();
    const service = new GameSaveService(directory, () => 3_000);
    await service.saveAndFlush({
      ...createSimulation().exportSaveSlices(),
      restaurantOperational: createRestaurantOperationalState(),
    });

    const filePath = path.join(directory, "save.json");
    const envelope = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      schemaVersion: number;
      savedAtUtcMs: number;
      checksumAlgorithm: "sha256";
      checksum: string;
      payload: { modules: Record<string, unknown> };
    };
    delete envelope.payload.modules[RESTAURANT_OPERATIONAL_SAVE_MANIFEST[0].moduleId];
    envelope.checksum = createHash("sha256")
      .update(JSON.stringify({
        schemaVersion: envelope.schemaVersion,
        savedAtUtcMs: envelope.savedAtUtcMs,
        payload: envelope.payload,
      }))
      .digest("hex");
    await fs.writeFile(filePath, `${JSON.stringify(envelope)}\n`, "utf8");

    const loaded = await new GameSaveService(directory, () => 4_000).load();
    expect(loaded.status).toBe("loaded");
    expect(loaded.envelope?.payload.restaurantOperational).toBeUndefined();
    expect(loaded.envelope?.payload.gameplayRuntime).toEqual(
      createSimulation().exportSaveSlices().gameplayRuntime,
    );
    expect(loaded.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining("incomplete"),
      expect.stringContaining("safe operational world"),
    ]));
  });

  it("round-trips narrative progress in the existing schema", async () => {
    const directory = await createTemporaryDirectory();
    const narrative = new NarrativeSystem([
      {
        id: "story.test",
        priority: 1,
        prerequisiteEventIds: [],
        conditions: [
          {
            type: "online-dish-sales",
            dishItemId: "dish.test",
            quantity: 1,
          },
        ],
      },
    ]);
    narrative.observeOnline(
      { soldByDish: [{ dishItemId: "dish.test", quantity: 0 }] },
      { soldByDish: [{ dishItemId: "dish.test", quantity: 1 }] },
      2_000,
    );
    narrative.markViewed("story.test", 2_100);

    const service = new GameSaveService(directory, () => 3_000);
    await service.saveAndFlush({
      ...createSimulation().exportSaveSlices(),
      narrative: narrative.exportState(),
    });

    const loaded = await new GameSaveService(
      directory,
      () => 4_000,
    ).load();
    expect(loaded.status).toBe("loaded");
    expect(loaded.envelope?.payload.narrative).toEqual(
      narrative.exportState(),
    );
  });
});
