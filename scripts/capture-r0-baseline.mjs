import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

if (!process.argv.includes("--write")) {
  console.error("Refusing to replace fixed R0 fixtures without --write.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const {
  GameRuntime,
  GameplayRuntime,
} = require("../packages/core/dist/index.js");
const {
  M2_CONTENT_DEFINITIONS,
  M2_INITIAL_INGREDIENTS,
} = require("../packages/content/dist/index.js");

const outputRoot = path.resolve(
  process.cwd(),
  "packages/test-support/fixtures/r0",
);

async function writeJson(relativePath, value) {
  const outputPath = path.join(outputRoot, relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeCommandResult(label, result) {
  return {
    label,
    accepted: result.accepted,
    commandId: result.commandId,
    ...(result.accepted ? {} : { code: result.code, message: result.message }),

  };
}

function captureCommandResults() {
  const clock = { nowUtcMs: () => 5_000 };
  const runtime = new GameRuntime(clock);
  const quietCommand = {
    id: "r0.quiet-on",
    type: "settings.set-quiet-mode",
    payload: { enabled: true },
  };
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

  const unavailableCommands = [
    { id: "r0.select", type: "gameplay.select-recipe", payload: { recipeId: "recipe.test" } },
    { id: "r0.repeat", type: "gameplay.set-auto-repeat", payload: { enabled: false } },
    { id: "r0.procure", type: "gameplay.place-procurement-order", payload: { items: [{ itemId: "ingredient.test", quantity: 1 }] } },
    { id: "r0.automation", type: "gameplay.configure-procurement-automation", payload: { reserveCopper: 0, policies: [] } },
    { id: "r0.view", type: "narrative.mark-viewed", payload: { eventId: "story.test" } },
    { id: "r0.complete", type: "narrative.complete", payload: { eventId: "story.test" } },
    { id: "r0.replay", type: "story.replay-dialogue", payload: { stageId: "stage.test" } },
    { id: "r0.dialogue", type: "dialogue.request-ambient", payload: { opportunityId: "opportunity.test", context: "idle", availableSpeakerCount: 1 } },
    { id: "r0.demo-start", type: "presentation.start-demo", payload: { scenario: "layout" } },
    { id: "r0.demo-stop", type: "presentation.stop-demo", payload: {} },
  ];
  for (const command of unavailableCommands) {
    results.push(summarizeCommandResult(command.type, runtime.dispatch(command)));
  }
  return { fixtureVersion: 1, results };
}

function createProductionConfig() {
  const supply = M2_CONTENT_DEFINITIONS.supplyBundles[0];
  if (supply === undefined) throw new Error("Missing production supply bundle.");
  const config = {
    startUtcMs: Date.UTC(2026, 0, 1),
    randomSeed: 0x0a17_5eed,
    ingredients: M2_CONTENT_DEFINITIONS.ingredients.map((ingredient) => ({
      id: ingredient.id,
      capacity: ingredient.capacity,
    })),
    recipes: M2_CONTENT_DEFINITIONS.recipes.map((recipe) => ({ ...recipe })),
    initialIngredients: M2_INITIAL_INGREDIENTS,
    supply: {
      intervalMs: supply.intervalMs,
      items: supply.items,
    },
    defaultRecipeId: "recipe.hearth_flatbread",
  };
  return config;
}

function captureDeterminismSummary() {
  const startUtcMs = Date.UTC(2026, 0, 1);
  const simulation = new GameplayRuntime(createProductionConfig());
  simulation.advanceTo(startUtcMs + 8 * 60 * 60_000);
  const snapshot = simulation.getSnapshot();
  return {
    fixtureVersion: 1,
    startUtcMs,
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

function createSaveSimulation() {
  return new GameplayRuntime({
    startUtcMs: 1_000,
    randomSeed: 123,
    ingredients: [{ id: "ingredient.test", capacity: 20 }],
    recipes: [{
      id: "recipe.test",
      durationMs: 1_000,
      outputItemId: "dish.test",
      outputQuantity: 1,
      unitPriceCopper: 1,
      ingredients: [{ itemId: "ingredient.test", quantity: 1 }],
    }],
    initialIngredients: [{ itemId: "ingredient.test", quantity: 10 }],
    supply: {
      intervalMs: 60_000,
      items: [{ itemId: "ingredient.test", quantity: 1 }],
    },
    defaultRecipeId: "recipe.test",
  });
}

function legacySimulationState(simulation) {
  const slices = simulation.exportSaveSlices();
  return {
    ...slices.gameplayRuntime,
    inventory: slices.gameplayInventory,
    cooking: slices.cooking,
    logistics: slices.logistics,
    restaurant: slices.restaurant,
    procurement: slices.procurementHistory,
  };
}

function saveEnvelope(payload, savedAtUtcMs) {
  return { schemaVersion: 1, savedAtUtcMs, payload };
}

async function captureSaveFixtures() {
  const empty = createSaveSimulation();
  const operating = createSaveSimulation();
  operating.advanceTo(67_500);
  const transporting = createSaveSimulation();
  transporting.advanceTo(80_000);
  const storyPayload = {
    ...legacySimulationState(operating),
    story: {
      version: 1,
      revision: 1,
      completedStages: [],
      active: { stageId: "story.test.stage-1", lineIndex: 0, replay: false },
      onlineSales: 0,
      storyOrderFulfilled: 0,
    },
  };
  const validEmpty = saveEnvelope(legacySimulationState(empty), 2_000);

  await writeJson("saves/new-progress/save.json", validEmpty);
  await writeJson("saves/operating/save.json", saveEnvelope(legacySimulationState(operating), 68_000));
  await writeJson("saves/transporting/save.json", saveEnvelope(legacySimulationState(transporting), 81_000));
  await writeJson("saves/story-active/save.json", saveEnvelope(storyPayload, 68_000));

  for (const directory of ["missing", "corrupt", "backup-recovery"]) {
    await fs.mkdir(path.join(outputRoot, "saves", directory), { recursive: true });
  }
  await fs.writeFile(path.join(outputRoot, "saves/corrupt/save.json"), "{broken-primary\n", "utf8");
  await fs.writeFile(path.join(outputRoot, "saves/corrupt/save.json.bak"), "[]\n", "utf8");
  await fs.writeFile(path.join(outputRoot, "saves/backup-recovery/save.json"), "{broken-primary\n", "utf8");
  await writeJson("saves/backup-recovery/save.json.bak", validEmpty);
  await writeJson("saves/scenarios.json", {
    fixtureVersion: 1,
    scenarios: [
      { id: "missing", directory: "missing", expectedStatus: "missing", expectedLoadSource: "new" },
      { id: "new-progress", directory: "new-progress", expectedStatus: "loaded", expectedLoadSource: "primary" },
      { id: "operating", directory: "operating", expectedStatus: "loaded", expectedLoadSource: "primary" },
      { id: "transporting", directory: "transporting", expectedStatus: "loaded", expectedLoadSource: "primary" },
      { id: "story-active", directory: "story-active", expectedStatus: "loaded", expectedLoadSource: "primary" },
      { id: "corrupt", directory: "corrupt", expectedStatus: "corrupt", expectedLoadSource: "reset-corrupt" },
      { id: "backup-recovery", directory: "backup-recovery", expectedStatus: "recovered-backup", expectedLoadSource: "backup" }
    ],
  });
}

await writeJson("command-results.json", captureCommandResults());
await writeJson("determinism-summary.json", captureDeterminismSummary());
await captureSaveFixtures();
console.log(`R0 fixtures captured at ${outputRoot}`);
