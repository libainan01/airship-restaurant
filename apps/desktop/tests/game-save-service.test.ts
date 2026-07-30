import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  M2Simulation,
  NarrativeSystem,
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

function createSimulation(): M2Simulation {
  return new M2Simulation({
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
    const legacyPayload = createSimulation().exportState();
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
    expect(loaded.envelope?.payload).toMatchObject(legacyPayload);
    expect(loaded.envelope?.payload.narrative).toBeUndefined();
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
      ...createSimulation().exportState(),
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
