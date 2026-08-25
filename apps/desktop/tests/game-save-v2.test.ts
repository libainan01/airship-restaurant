import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonSaveStore,
  createModularSaveDocument,
  isModularSaveDocument,
} from "@airship-restaurant/persistence";
import {
  createM2ContentRegistry,
  M2_INITIAL_PROCUREMENT_AIRSHIPS,
  M2_PROCUREMENT_AIRSHIPS,
} from "@airship-restaurant/content";
import {
  FinanceModule,
  FleetModule,
  FocusSessionModule,
  PayrollModule,
  ProgressionModule,
  TechnologyModule,
  legacyGameplayRuntimeStateToSaveSlices,
  instanceId,
} from "@airship-restaurant/core";
import { GameSaveService } from "../src/main/game-save-service";
import { createDesktopRecruitmentRuntime } from "../src/main/recruitment-runtime";
import { createR3SceneLayout } from "../src/main/r3-runtime";
import { createR4PeopleModules } from "../src/main/r4-people-runtime";

const directories: string[] = [];
async function makeDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "airship-v2-save-"));
  directories.push(directory);
  return directory;
}
async function legacyState() {
  const envelope = JSON.parse(await fs.readFile(
    path.resolve("packages/test-support/fixtures/r0/saves/new-progress/save.json"),
    "utf8",
  ));
  return envelope.payload;
}
async function state() {
  return legacyGameplayRuntimeStateToSaveSlices(await legacyState());
}afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("GameSaveService modular v2", () => {
  it("keeps the v1 file untouched while loading, then retains it as backup after a successful v2 save", async () => {
    const directory = await makeDirectory();
    const legacyEnvelope = { schemaVersion: 1, savedAtUtcMs: 2_000, payload: await legacyState() };
    const legacyText = `${JSON.stringify(legacyEnvelope)}\n`;
    const filePath = path.join(directory, "save.json");
    await fs.writeFile(filePath, legacyText, "utf8");
    const service = new GameSaveService(directory, () => 3_000);
    const loaded = await service.load();
    expect(await fs.readFile(filePath, "utf8")).toBe(legacyText);
    expect(loaded.diagnostics[0]).toContain("migrated");
    expect(service.getDiagnostics()).toMatchObject({
      migrationStatus: "migrated-primary",
      loadSource: "primary",
    });
    await service.saveAndFlush(loaded.envelope!.payload);
    const current = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(current.schemaVersion).toBe(2);
    expect(current.payload.modules["module.simulation"]).toBeUndefined();
    expect(Object.keys(current.payload.modules)).toEqual(expect.arrayContaining([
      "module.gameplay-runtime",
      "module.gameplay-inventory",
      "module.cooking",
      "module.logistics",
      "module.restaurant",
      "module.procurement-history",
    ]));
    expect(JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8"))).toEqual(legacyEnvelope);
  });

  it("preserves an unknown module across a normal game save", async () => {
    const directory = await makeDirectory();
    const simulation = await legacyState();
    const document = createModularSaveDocument(simulation.revision, {
      "module.simulation": { schemaVersion: 1, payload: simulation },
      "mod.weather": { schemaVersion: 4, payload: { wind: "north" } },
    });
    const store = new JsonSaveStore({
      filePath: path.join(directory, "save.json"), schemaVersion: 2,
      validatePayload: isModularSaveDocument, nowUtcMs: () => 2_000,
    });
    await store.save(document);
    const service = new GameSaveService(directory, () => 3_000);
    const loaded = await service.load();
    await service.saveAndFlush(loaded.envelope!.payload);
    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["mod.weather"]).toEqual({ schemaVersion: 4, payload: { wind: "north" } });
  });
  it("persists and restores the story roster as an independent optional module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const storyRoster = {
      schemaVersion: 1 as const,
      revision: 3,
      characters: [{
        characterId: "character.martha_bell",
        discoveredAtUtcMs: 100,
        affinity: 2,
        availableNodeIds: ["story_node.martha_bell.first_service"],
        completedNodes: [],
      }],
      processedOperationIds: ["discover:martha", "available:martha", "meal:martha"],
    };
    const service = new GameSaveService(directory, () => 4_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, storyRoster });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.story-roster"]).toEqual({
      schemaVersion: 1,
      payload: storyRoster,
    });
    const restored = await new GameSaveService(directory, () => 5_000).load();
    expect(restored.envelope?.payload.storyRoster).toEqual(storyRoster);
  });
  it("persists and restores an active focus session as an independent optional module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const config = {
      focusDurationMs: 25 * 60 * 1_000,
      breakDurationMs: 5 * 60 * 1_000,
      customerArrivalIntervalRateBasisPoints: 7_500,
      incomeBonusRateBasisPoints: 2_000,
    };
    const focus = new FocusSessionModule(config);
    expect(focus.requestStart("focus:save:start", 10_000, false)).toMatchObject({ accepted: true });

    const service = new GameSaveService(directory, () => 20_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, focusSession: focus.exportState() });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.focus-session"]).toEqual({
      schemaVersion: 1,
      payload: focus.exportState(),
    });
    const loaded = await new GameSaveService(directory, () => 30_000).load();
    expect(loaded.envelope?.payload.focusSession).toEqual(focus.exportState());
    const restored = new FocusSessionModule(config, loaded.envelope?.payload.focusSession);
    expect(restored.createReadModel(30_000)).toMatchObject({
      phase: "focusing",
      remainingMs: 25 * 60 * 1_000 - 20_000,
      effects: { active: true, incomeBonusRateBasisPoints: 2_000 },
    });
  });
  it("persists and restores technology as an independent optional module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const technology = {
      schemaVersion: 1 as const,
      revision: 2,
      nodes: [
        { id: "technology.cargo_lift_speed", level: 1 },
        { id: "technology.cargo_lift_count", level: 0 },
      ],
      processedOperationIds: ["technology-speed-1"],
    };
    const service = new GameSaveService(directory, () => 4_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, technology });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.technology"]).toEqual({
      schemaVersion: 1,
      payload: technology,
    });
    const restored = await new GameSaveService(directory, () => 5_000).load();
    expect(restored.envelope?.payload.technology).toEqual(technology);
  });

  it("persists permanent progression qualifications without replaying unlocks after restart", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const content = createM2ContentRegistry();
    const facts = new Map<string, boolean | number>([
      ["story_node.martha_bell.first_service.completed", true],
    ]);
    const progression = new ProgressionModule({
      definitions: content.listProgression(),
      facts: { getFactValue: (factId) => facts.get(factId) ?? null },
    });
    expect(progression.evaluate("progression:save-windroot", 5)).toMatchObject({
      accepted: true,
      unlockedContentIds: expect.arrayContaining(["region.windroot", "recipe.windroot_soup"]),
    });

    const service = new GameSaveService(directory, () => 6_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, progression: progression.exportState() });
    const document = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(document.payload.modules["module.progression"].schemaVersion).toBe(1);

    const loaded = await new GameSaveService(directory, () => 7_000).load();
    const restored = new ProgressionModule({
      definitions: content.listProgression(),
      facts: { getFactValue: (factId) => facts.get(factId) ?? null },
      initialState: loaded.envelope!.payload.progression!,
    });
    expect(restored.isContentUnlocked("region", "region.windroot")).toBe(true);
    expect(restored.isContentUnlocked("recipe", "recipe.windroot_soup")).toBe(true);
    expect(restored.evaluate("progression:restart-audit", 8)).toMatchObject({
      accepted: true,
      changed: false,
      events: [],
    });
  });
  it("persists and restores an active Fleet voyage with frozen ship and captain snapshots", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const captainId = instanceId("instance.character.test_captain");
    const fleet = new FleetModule({
      definitions: M2_PROCUREMENT_AIRSHIPS,
      initialShips: M2_INITIAL_PROCUREMENT_AIRSHIPS,
      captains: { getCaptainSnapshot: () => ({ eligible: true, pilotingLevel: 4 }) },
      routes: { isRouteUnlocked: () => true },
      policy: {
        calculateVoyageDurationMs: ({ roundTripDistanceUnits, shipSpeedUnitsPerSecond }) => Math.ceil(roundTripDistanceUnits * 1_000 / shipSpeedUnitsPerSecond),
        calculateDurabilityLoss: () => 3,
        calculateCooldownDurationMs: () => 20_000,
      },
    });
    expect(fleet.startVoyage("fleet:save:start", {
      voyageId: "voyage.save.active",
      batchId: "batch.save.active",
      routeId: "route.greyfeather_windroot",
      shipId: "instance.airship.skylark_01",
      captainId,
      cargoQuantity: 6,
      roundTripDistanceUnits: 1_200,
      occurredAtUtcMs: 1_000,
    })).toMatchObject({ accepted: true });

    const service = new GameSaveService(directory, () => 2_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, fleet: fleet.exportState() });
    const document = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(document.payload.modules["module.fleet"].schemaVersion).toBe(1);

    const loaded = await new GameSaveService(directory, () => 3_000).load();
    const restored = new FleetModule({
      definitions: M2_PROCUREMENT_AIRSHIPS,
      initialShips: M2_INITIAL_PROCUREMENT_AIRSHIPS,
      captains: { getCaptainSnapshot: () => ({ eligible: true, pilotingLevel: 99 }) },
      routes: { isRouteUnlocked: () => true },
      policy: {
        calculateVoyageDurationMs: () => 1,
        calculateDurabilityLoss: () => 99,
        calculateCooldownDurationMs: () => 1,
      },
      initialState: loaded.envelope!.payload.fleet!,
    });
    expect(restored.exportState()).toEqual(fleet.exportState());
    expect(restored.exportState().voyages[0]).toMatchObject({
      captainPilotingLevelSnapshot: 4,
      cargoCapacitySnapshot: 8,
      durabilityLossSnapshot: 3,
      cooldownDurationMsSnapshot: 20_000,
    });
  });
  it("persists and restores scene layout as an independent validated module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const layout = createR3SceneLayout(createM2ContentRegistry().listBuildings());
    const sceneLayout = layout.exportState();
    const service = new GameSaveService(directory, () => 6_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, sceneLayout });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.scene-layout"]).toEqual({
      schemaVersion: 1,
      payload: sceneLayout,
    });
    const restored = await new GameSaveService(directory, () => 7_000).load();
    expect(restored.envelope?.payload.sceneLayout).toEqual(sceneLayout);
  });
  it("persists and restores local procurement cart state as an independent v2 module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const localProcurement = {
      schemaVersion: 2 as const,
      revision: 1,
      orders: [],
      batches: [],
      carts: [{ id: "cart.greyfeather_1", level: 2, capacity: 5, speedUnitsPerSecond: 28, activeBatchId: null }],
      nextOrderSequence: 1,
      nextSubmissionSequence: 1,
      lastAdvancedAtUtcMs: 0,
      processedOperationIds: ["upgrade-cart-once"],
    };
    const service = new GameSaveService(directory, () => 8_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, localProcurement });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.local-procurement"]).toEqual({
      schemaVersion: 2,
      payload: localProcurement,
    });
    const restored = await new GameSaveService(directory, () => 9_000).load();
    expect(restored.envelope?.payload.localProcurement).toEqual(localProcurement);
  });
  it("round-trips recruited characters, employment and the remaining candidate pool across a restart", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const content = createM2ContentRegistry();
    const finance = new FinanceModule(1_000);
    const technology = new TechnologyModule({
      definitions: content.listTechnologies(),
      finance,
    });
    const people = createR4PeopleModules(content);
    const recruitment = createDesktopRecruitmentRuntime({
      content,
      finance,
      characters: people.characters,
      employment: people.employment,
      technology,
      nowUtcMs: () => 10_000,
    });
    const candidate = recruitment.exportState().candidates[0]!;
    const hired = recruitment.hire(
      "desktop-save-hire",
      candidate.id,
      { startMinuteInclusive: 480, endMinuteExclusive: 1_020 },
      10_100,
    );
    expect(hired).toMatchObject({ accepted: true });

    const service = new GameSaveService(directory, () => 11_000);
    await service.load();
    await service.saveAndFlush({
      ...simulation,
      characters: people.characters.exportState(),
      employment: people.employment.exportState(),
      recruitment: recruitment.exportState(),
    });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.character"].schemaVersion).toBe(2);
    expect(current.payload.modules["module.employment"].schemaVersion).toBe(1);
    expect(current.payload.modules["module.recruitment"].schemaVersion).toBe(1);

    const loaded = await new GameSaveService(directory, () => 12_000).load();
    const payload = loaded.envelope!.payload;
    const restoredPeople = createR4PeopleModules(content, {
      characters: payload.characters!,
      employment: payload.employment!,
    });
    const restoredRecruitment = createDesktopRecruitmentRuntime({
      content,
      finance: new FinanceModule(1_000),
      characters: restoredPeople.characters,
      employment: restoredPeople.employment,
      technology: new TechnologyModule({
        definitions: content.listTechnologies(),
        finance: new FinanceModule(1_000),
      }),
      nowUtcMs: () => 12_000,
      initialState: payload.recruitment!,
    });

    expect(restoredPeople.characters.exportState()).toEqual(people.characters.exportState());
    expect(restoredPeople.employment.exportState()).toEqual(people.employment.exportState());
    expect(restoredRecruitment.exportState()).toEqual(recruitment.exportState());
    expect(restoredPeople.employment.createReadModel(600).employees).toContainEqual(
      expect.objectContaining({
        characterId: hired.accepted ? hired.value.characterId : "",
        name: candidate.name,
        kind: "recruited",
        learnedJobIds: candidate.learnedJobIds,
        primaryJobId: candidate.primaryJobId,
      }),
    );
  });

  it("round-trips finance and frozen payroll attendance, then closes wages once after restart", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const content = createM2ContentRegistry();
    const finance = new FinanceModule(1_000);
    const technology = new TechnologyModule({
      definitions: content.listTechnologies(),
      finance,
    });
    const people = createR4PeopleModules(content);
    const recruitment = createDesktopRecruitmentRuntime({
      content,
      finance,
      characters: people.characters,
      employment: people.employment,
      technology,
      nowUtcMs: () => 0,
    });
    const candidate = recruitment.exportState().candidates[0]!;
    const hired = recruitment.hire(
      "payroll-save-hire",
      candidate.id,
      { startMinuteInclusive: 0, endMinuteExclusive: 100 },
      1,
    );
    expect(hired).toMatchObject({ accepted: true });
    const payroll = new PayrollModule({
      characters: people.characters,
      employment: people.employment,
      finance,
      talentQuality: {
        getTalentQuality: (talentId) => content.getTalent(talentId)?.qualityTier ?? null,
      },
      dayDurationMs: 1_440,
      initialUtcMs: 0,
    });
    payroll.advanceTo(50);
    expect(payroll.exportState().attendance).toHaveLength(1);

    const service = new GameSaveService(directory, () => 60);
    await service.load();
    await service.saveAndFlush({
      ...simulation,
      characters: people.characters.exportState(),
      employment: people.employment.exportState(),
      recruitment: recruitment.exportState(),
      finance: finance.exportState(),
      payroll: payroll.exportState(),
    });

    const document = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(document.payload.modules["module.finance"].schemaVersion).toBe(1);
    expect(document.payload.modules["module.payroll"].schemaVersion).toBe(1);

    const loaded = await new GameSaveService(directory, () => 70).load();
    const payload = loaded.envelope!.payload;
    const restoredPeople = createR4PeopleModules(content, {
      characters: payload.characters!,
      employment: payload.employment!,
    });
    const restoredFinance = new FinanceModule(0, 1, payload.finance!);
    const restoredPayroll = new PayrollModule({
      characters: restoredPeople.characters,
      employment: restoredPeople.employment,
      finance: restoredFinance,
      talentQuality: {
        getTalentQuality: (talentId) => content.getTalent(talentId)?.qualityTier ?? null,
      },
      dayDurationMs: 1_440,
      initialState: payload.payroll!,
    });
    restoredPayroll.advanceTo(1_440);
    expect(restoredFinance.getSnapshot()).toMatchObject({
      currentGameDay: 2,
      dailyClosures: [{ gameDay: 1 }],
    });
    expect(restoredFinance.getSnapshot().ledger.filter(
      (entry) => entry.category === "employee-wages",
    )).toHaveLength(1);
  });

  it("rejects an incomplete people-module set before entering the saving state", async () => {
    const directory = await makeDirectory();
    const content = createM2ContentRegistry();
    const people = createR4PeopleModules(content);
    const service = new GameSaveService(directory, () => 13_000);
    await service.load();

    await expect(service.saveAndFlush({
      ...(await state()),
      characters: people.characters.exportState(),
    })).rejects.toThrow("Character and employment save modules must be written together");
    expect(service.getDiagnostics().status).toBe("ready");

    await expect(service.saveAndFlush({
      ...(await state()),
      characters: people.characters.exportState(),
      employment: people.employment.exportState(),
      finance: new FinanceModule(100).exportState(),
    })).rejects.toThrow("finance/payroll must be paired");
    expect(service.getDiagnostics().status).toBe("ready");
  });

  it("persists and restores pending building upgrades as an independent validated module", async () => {
    const directory = await makeDirectory();
    const simulation = await state();
    const buildingUpgrade = {
      schemaVersion: 1 as const,
      revision: 3,
      previews: [],
    };
    const service = new GameSaveService(directory, () => 8_000);
    await service.load();
    await service.saveAndFlush({ ...simulation, buildingUpgrade });

    const current = JSON.parse(await fs.readFile(path.join(directory, "save.json"), "utf8"));
    expect(current.payload.modules["module.building-upgrade"]).toEqual({
      schemaVersion: 1,
      payload: buildingUpgrade,
    });
    const restored = await new GameSaveService(directory, () => 9_000).load();
    expect(restored.envelope?.payload.buildingUpgrade).toEqual(buildingUpgrade);
  });
});
