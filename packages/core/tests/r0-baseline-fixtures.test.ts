import { promises as fs } from "node:fs";
import path from "node:path";
import type { CommandResult, GameCommand } from "@airship-restaurant/contracts";
import {
  M2_CONTENT_DEFINITIONS,
  M2_INITIAL_INGREDIENTS,
} from "../../content/src";
import { describe, expect, it } from "vitest";
import {
  GameRuntime,
  GameplayRuntime,
  type GameplayRuntimeConfig,
  type GameplayRuntimeSaveSlices,
} from "../src";

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  "packages/test-support/fixtures/r0",
);

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await fs.readFile(path.join(FIXTURE_ROOT, name), "utf8"),
  ) as T;
}

function summarizeCommandResult(label: string, result: CommandResult) {
  return {
    label,
    accepted: result.accepted,
    commandId: result.commandId,
    ...(result.accepted
      ? {}
      : { code: result.code, message: result.message }),

  };
}

function captureCommandResults() {
  const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
  const quietCommand = {
    id: "r0.quiet-on",
    type: "settings.set-quiet-mode",
    payload: { enabled: true },
  } as const;
  const results = [
    summarizeCommandResult(
      "runtime-not-ready",
      runtime.dispatch({ ...quietCommand, id: "r0.before-ready" }),
    ),
  ];
  runtime.markReady();
  results.push(
    summarizeCommandResult("accepted-change", runtime.dispatch(quietCommand)),
    summarizeCommandResult(
      "accepted-no-change",
      runtime.dispatch({
        id: "r0.quiet-on-again",
        type: "settings.set-quiet-mode",
        payload: { enabled: true },
      }),
    ),
    summarizeCommandResult("duplicate", runtime.dispatch(quietCommand)),
  );
  const unavailableCommands: readonly GameCommand[] = [
    { id: "r0.select", type: "gameplay.select-recipe", payload: { recipeId: "recipe.test" } },
    { id: "r0.repeat", type: "gameplay.set-auto-repeat", payload: { enabled: false } },
    { id: "r0.procure", type: "gameplay.place-procurement-order", payload: { items: [{ itemId: "ingredient.test", quantity: 1 }] } },
    { id: "r0.automation", type: "gameplay.configure-procurement-automation", payload: { reserveCopper: 0, policies: [] } },
    { id: "r0.view", type: "narrative.mark-viewed", payload: { eventId: "story.test" } },
    { id: "r0.complete", type: "narrative.complete", payload: { eventId: "story.test" } },
    { id: "r0.replay", type: "story.replay-dialogue", payload: { stageId: "stage.test" } },
    { id: "r0.dialogue", type: "dialogue.request-ambient", payload: { opportunityId: "opportunity.test", context: "idle", availableSpeakerCount: 1 } },
  ];
  for (const command of unavailableCommands) {
    results.push(
      summarizeCommandResult(command.type, runtime.dispatch(command)),
    );
  }
  return { fixtureVersion: 2, results };
}

function createConfig(initialSlices?: GameplayRuntimeSaveSlices): GameplayRuntimeConfig {
  const supply = M2_CONTENT_DEFINITIONS.supplyBundles[0];
  if (supply === undefined) throw new Error("Missing R0 supply bundle.");
  const config: GameplayRuntimeConfig = {
    startUtcMs: initialSlices?.gameplayRuntime.currentUtcMs ?? Date.UTC(2026, 0, 1),
    randomSeed: 0x0a17_5eed,
    ingredients: M2_CONTENT_DEFINITIONS.ingredients.map((ingredient) => ({
      id: ingredient.id,
      capacity: ingredient.capacity,
    })),
    recipes: M2_CONTENT_DEFINITIONS.recipes.map((recipe) => ({ ...recipe })),
    initialIngredients: M2_INITIAL_INGREDIENTS,
    supply: { intervalMs: supply.intervalMs, items: supply.items },
    defaultRecipeId: "recipe.hearth_flatbread",
  };
  return initialSlices === undefined ? config : { ...config, initialSlices };
}

function summarizeSimulation(simulation: GameplayRuntime) {
  const snapshot = simulation.getSnapshot();
  return {
    fixtureVersion: 1,
    startUtcMs: Date.UTC(2026, 0, 1),
    targetUtcMs: snapshot.currentUtcMs,
    randomState: simulation.exportSaveSlices().gameplayRuntime.randomState,
    supplyBoxesReceived: snapshot.supplyBoxesReceived,
    cookingBatches: snapshot.cooking.completedBatches,
    deliveredQuantity: snapshot.logistics.totalDeliveredQuantity,
    soldQuantity: snapshot.restaurant.totalSoldQuantity,
    customersLeft: snapshot.restaurant.totalCustomersLeft,
    copperBalance: snapshot.restaurant.copperBalance,
    inventory: Object.fromEntries(
      Object.entries(snapshot.inventory).map(([id, container]) => [
        id,
        container.totalQuantity,
      ]),
    ),
  };
}

describe("R0 fixed baseline fixtures", () => {
  it("keeps command acceptance, rejection, no-change, and duplicate results", async () => {
    expect(captureCommandResults()).toEqual(
      await readFixture("command-results.json"),
    );
  });

  it("keeps the production eight-hour deterministic summary", async () => {
    const expected = await readFixture<{ readonly targetUtcMs: number }>(
      "determinism-summary.json",
    );
    const oneJump = new GameplayRuntime(createConfig());
    oneJump.advanceTo(expected.targetUtcMs);

    let restored = new GameplayRuntime(createConfig());
    const midpoint = Date.UTC(2026, 0, 1) + 4 * 60 * 60_000;
    restored.advanceTo(midpoint);
    const serialized = JSON.parse(
      JSON.stringify(restored.exportSaveSlices()),
    ) as GameplayRuntimeSaveSlices;
    restored = new GameplayRuntime(createConfig(serialized));
    restored.advanceTo(expected.targetUtcMs);

    expect(summarizeSimulation(oneJump)).toEqual(expected);
    expect(summarizeSimulation(restored)).toEqual(expected);
  });
});
