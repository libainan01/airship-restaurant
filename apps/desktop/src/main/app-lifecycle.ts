import type { FinanceReadModel } from "@airship-restaurant/contracts";
import {
  createM2ContentRegistry,
  M2_INITIAL_INGREDIENTS,
  M2_INITIAL_PROCUREMENT_AIRSHIPS,
  M2_PROCUREMENT_AIRSHIPS,

} from "@airship-restaurant/content";
import {
  AmbientDialogueSystem,
  AutomaticProcurementModule,
  BuildingConstructionModule,
  BuildingUpgradeModule,
  CharacterModule,
  EmploymentModule,

  FleetModule,
  FocusSessionModule,
  FinanceModule,
  FinanceReportProjector,

  createOfflineEarningsSummary,
  DomainEventBus,
  GameRuntime,
  InstanceUpgradeRuntime,
  RuntimeReadModelFacade,
  LocalProcurementModule,
  ManualLogisticsRuntime,

  PayrollModule,
  ProgressionModule,
  projectProgressionReadModel,
  NarrativeSystem,
  R3ReadModelPublisher,



  RecruitmentModule,
  RecruitmentRuntime,
  RuntimeCommandExtensionChain,
  SceneEditModeController,
  SeededRandom,
  SequentialInstanceIdGenerator,
  StorySequenceSystem,
  StoryRosterCustomerEventAdapter,
  StoryRosterModule,

  TechnologyModule,
} from "@airship-restaurant/core";
import { app, type Event } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { DisplayService } from "./display-service";
import { GameSaveService } from "./game-save-service";
import { IpcRouter } from "./ipc-router";
import { createDesktopLocalProcurementRuntime } from "./local-procurement-runtime";
import { createDesktopAutomaticProcurementRuntime } from "./automatic-procurement-runtime";
import { DesktopProcurementRuntime } from "./procurement-runtime";
import { createDesktopRecruitmentRuntime } from "./recruitment-runtime";
import { DesktopProgressionFactAdapter } from "./progression-fact-adapter";
import {
  getRendererBaseUrl,
  parseLaunchOptions,
} from "./launch-options";
import { verifyRendererBridges } from "./renderer-bridge-smoke";
import { ResidentStabilityMonitor } from "./resident-stability-monitor";
import { createR3SceneLayout } from "./r3-runtime";
import { createR4CharacterPresentationRuntimeFromModules } from "./r4-character-presentation-runtime";
import { SettingsStore } from "./settings-store";
import { createR4PeopleModules } from "./r4-people-runtime";
import {
  createDesktopRestaurantOperationalModules,
  DESKTOP_RESTAURANT_IDS,
} from "./restaurant-operational-modules";
import { DesktopRestaurantInteractionTargetResolver } from "./restaurant-interaction-target-resolver";
import { RestaurantGameplayReadProjection } from "./restaurant-gameplay-read-projection";
import {
  createDesktopRestaurantOperationalRuntime,
  type DesktopRestaurantOperationalRuntime,
} from "./restaurant-operational-runtime";
import { calculateResumedGameUtcMs, SystemClock } from "./system-clock";
import { createPrimaryStorySequence } from "./story-runtime";
import {

  createDesktopStoryRosterCustomerAdapter,
  createDesktopStoryRosterRuntime,
  DesktopStoryRosterSequenceRuntime,
} from "./story-roster-runtime";
import { WindowManager } from "./window-manager";

const APPLICATION_NAME = "Airship Restaurant";
const WINDOWS_APP_USER_MODEL_ID = "com.airshiprestaurant.desktop";
const USER_DATA_DIRECTORY = "airship-restaurant-desktop";
const SMOKE_USER_DATA_DIRECTORY = "airship-restaurant-smoke";
const STABILITY_USER_DATA_DIRECTORY = "airship-restaurant-stability";
const RUNTIME_TICK_INTERVAL_MS = 1_000;
const GAME_SAVE_INTERVAL_MS = 30_000;

export class AppLifecycle {
  #windowManager: WindowManager | null = null;
  #ipcRouter: IpcRouter | null = null;
  #settingsStore: SettingsStore | null = null;
  #gameSaveService: GameSaveService | null = null;

  #restaurantOperational: DesktopRestaurantOperationalRuntime | null = null;
  #narrative: NarrativeSystem | null = null;
  #story: StorySequenceSystem | null = null;
  #storyRoster: StoryRosterModule | null = null;
  #focusSession: FocusSessionModule | null = null;
  #technology: TechnologyModule | null = null;
  #buildingUpgrade: BuildingUpgradeModule | null = null;
  #localProcurement: LocalProcurementModule | null = null;
  #automaticProcurement: AutomaticProcurementModule | null = null;
  #characters: CharacterModule | null = null;
  #employment: EmploymentModule | null = null;
  #recruitment: RecruitmentModule | null = null;
  #finance: FinanceModule | null = null;
  #payroll: PayrollModule | null = null;
  #progression: ProgressionModule | null = null;
  #fleet: FleetModule | null = null;
  #sceneLayout: ReturnType<typeof createR3SceneLayout> | null = null;
  #runtimeTimer: NodeJS.Timeout | null = null;
  #gameSaveTimer: NodeJS.Timeout | null = null;
  #unsubscribeRuntimeSave: (() => void) | null = null;
  #storyRosterCustomerAdapter: StoryRosterCustomerEventAdapter | null = null;
  #residentStabilityMonitor: ResidentStabilityMonitor | null = null;
  #isQuitting = false;
  #allowQuit = false;

  async start(): Promise<void> {
    const launchOptions = parseLaunchOptions(process.argv);
    this.#configureApplicationProfile(
      launchOptions.smokeTest
        ? "smoke"
        : launchOptions.residentStability === null
          ? "normal"
          : "stability",
    );

    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on("second-instance", () => {
      this.#windowManager?.handleSecondInstance();
    });

    app.on("before-quit", (event: Event) => {
      if (this.#allowQuit) {
        return;
      }
      event.preventDefault();
      if (this.#isQuitting) {
        return;
      }
      this.#isQuitting = true;
      const stabilityReportWrite =
        this.#residentStabilityMonitor?.finish("interrupted") ??
        null;
      this.#stopRuntimeTicker();
      this.#stopGameSaving();
      this.#storyRosterCustomerAdapter?.dispose();
      this.#storyRosterCustomerAdapter = null;
      this.#ipcRouter?.stop();
      this.#windowManager?.shutdown();
      void this.#flushAndQuit(stabilityReportWrite);
    });

    app.on("will-quit", () => {
      app.releaseSingleInstanceLock();
    });

    app.on("activate", () => {
      this.#windowManager?.ensureDesktopWindow();
    });

    app.on("window-all-closed", () => {
      if (!this.#isQuitting) {
        this.#windowManager?.ensureDesktopWindow();
      }
    });

    await app.whenReady();
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);

    const displayService = new DisplayService();
    const settingsStore = new SettingsStore(
      app.getPath("userData"),
      displayService.getPrimaryDisplayId(),
    );
    this.#settingsStore = settingsStore;
    let settings = await settingsStore.load();
    if (!displayService.hasDisplay(settings.targetDisplayId)) {
      settings = await settingsStore.update({
        targetDisplayId: displayService.getPrimaryDisplayId(),
        needsDisplayConfirmation: true,
      });
    }

    const wallNowUtcMs = Date.now();
    const gameSaveService = new GameSaveService(
      app.getPath("userData"),
      Date.now,
    );
    const loadedSave = await gameSaveService.load();
    this.#gameSaveService = gameSaveService;
    if (loadedSave.status === "recovered-backup") {
      console.warn(
        "[GameSaveService] Recovered the previous valid backup.",
        loadedSave.diagnostics,
      );
    } else if (loadedSave.status === "corrupt") {
      console.warn(
        "[GameSaveService] Both saves were invalid; starting a new game.",
        loadedSave.diagnostics,
      );
    }
    const loadedGameplayUtcMs = loadedSave.envelope?.payload.restaurantOperational
      ?.applicationRuntime.currentUtcMs ??
      loadedSave.envelope?.payload.gameplayRuntime?.currentUtcMs ??
      wallNowUtcMs;
    const initialGameUtcMs = loadedSave.envelope === null
      ? wallNowUtcMs
      : calculateResumedGameUtcMs(
          loadedGameplayUtcMs,
          loadedSave.envelope.savedAtUtcMs,
          wallNowUtcMs,
        );
    const clock = new SystemClock(initialGameUtcMs);
    const content = createM2ContentRegistry();
    const supply = content.getSupplyBundle("supply.guild_basic");
    if (supply === undefined) {
      throw new Error("The M2 basic supply bundle is missing.");
    }
    const nowUtcMs = clock.nowUtcMs();
    const focusSession = new FocusSessionModule({
      focusDurationMs: 25 * 60 * 1_000,
      breakDurationMs: 5 * 60 * 1_000,
      customerArrivalIntervalRateBasisPoints: 7_500,
      incomeBonusRateBasisPoints: 2_000,
    }, loadedSave.envelope?.payload.focusSession);
    this.#focusSession = focusSession;
    const loadedFinanceState = loadedSave.envelope?.payload.finance;
    const initialFinanceBalance = loadedFinanceState?.balanceCopper ??
      loadedSave.envelope?.payload.restaurant?.copperBalance ?? 0;
    const functionalFinance = new FinanceModule(
      initialFinanceBalance,
      loadedFinanceState?.currentGameDay ?? 1,
      loadedFinanceState,
    );
    for (const reservation of functionalFinance.exportState().reservations.filter((entry) => entry.sourceType === "building-preview")) {
      const released = functionalFinance.releaseReservation(
        `building-preview:startup-release:${reservation.id}:${nowUtcMs}`,
        reservation.id,
        nowUtcMs,
      );
      if (!released.accepted) console.warn("[BuildingConstruction] Unable to release abandoned preview reservation.", released.message);
    }    const financeReports = new FinanceReportProjector({ finance: functionalFinance });
    this.#finance = functionalFinance;

    const technology = new TechnologyModule({
      definitions: content.listTechnologies(),
      finance: functionalFinance,
      eventBus: new DomainEventBus(),
      ...(loadedSave.envelope?.payload.technology === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.technology }),
    });
    this.#technology = technology;
    const narrative = new NarrativeSystem(
      content.listStoryEvents(),
      loadedSave.envelope?.payload.narrative,
    );
    this.#narrative = narrative;
    const story = createPrimaryStorySequence(
      content,
      loadedSave.envelope?.payload.story,
    );
    this.#story = story;
    const storyRoster = createDesktopStoryRosterRuntime(
      content,
      loadedSave.envelope?.payload.storyRoster,
    );
    this.#storyRoster = storyRoster;
    const storyRosterEvents = new DomainEventBus();

    const progression = new ProgressionModule({
      definitions: content.listProgression(),
      facts: new DesktopProgressionFactAdapter({ narrative, technology, storyRoster }),
      eventBus: storyRosterEvents,
      ...(loadedSave.envelope?.payload.progression === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.progression }),
    });
    progression.evaluate("progression:startup:" + nowUtcMs, nowUtcMs);
    this.#progression = progression;
    const dialogue = new AmbientDialogueSystem({
      dialogues: content.listAmbientDialogues().map((definition) => ({
        id: definition.id,
        locationId: definition.locationId,
        contexts: definition.contexts,
        minimumFamiliarity: definition.minimumFamiliarity,
        weight: definition.weight,
        cooldownMs: definition.cooldownMs,
        maxPlaysPerSession: definition.maxPlaysPerSession,
        prerequisiteEventIds: definition.prerequisiteEventIds,
        participantCount: new Set(
          definition.lines.map((line) => line.speakerId),
        ).size,
        lineDurationsMs: definition.lines.map(
          (line) => line.durationMs,
        ),
      })),
      random: new SeededRandom(0x0d1a_109e),
      locationId: "location.greyfeather_beacon",
      minimumGapMs: 20_000,
      quietModeGapMultiplier: 3,
      returningAfterSales: 5,
      regularAfterSales: 15,
    });
    const r3SceneLayout = createR3SceneLayout(
      content.listBuildings(),
      loadedSave.envelope?.payload.sceneLayout,
    );
    this.#sceneLayout = r3SceneLayout;
    const editMode = new SceneEditModeController(clock);
    let buildingUpgrades: BuildingUpgradeModule;
    try {
      buildingUpgrades = new BuildingUpgradeModule({
        finance: functionalFinance,
        layout: r3SceneLayout,
        eventBus: new DomainEventBus(),
        editMode,
        ...(loadedSave.envelope?.payload.buildingUpgrade === undefined
          ? {}
          : { initialState: loadedSave.envelope.payload.buildingUpgrade }),
      });
    } catch (error: unknown) {
      console.warn("[BuildingUpgrade] Discarded stale preview state.", error);
      buildingUpgrades = new BuildingUpgradeModule({
        finance: functionalFinance,
        layout: r3SceneLayout,
        eventBus: new DomainEventBus(),
        editMode,
      });
    }
    this.#buildingUpgrade = buildingUpgrades;
    const buildingConstruction = new BuildingConstructionModule({
      finance: functionalFinance,
      layout: r3SceneLayout,
      eventBus: new DomainEventBus(),
      instanceIds: new SequentialInstanceIdGenerator(
        "construction",
        r3SceneLayout.getSnapshot().buildings.length + 1,
      ),
      unlocks: progression,
      pausePort: {
        pause: () => "pause.shared-scene-edit-mode",
        resume: () => undefined,
      },
    });    let runtime: GameRuntime;

    const storyRosterSequenceRuntime = new DesktopStoryRosterSequenceRuntime({
      content,
      eventBus: storyRosterEvents,
      roster: storyRoster,
      story,
    });
    if (storyRosterSequenceRuntime.reconcile()) {
      progression.evaluate("progression:story-roster-startup:" + nowUtcMs, nowUtcMs);
    }
    const savedCharacters = loadedSave.envelope?.payload.characters;
    const savedEmployment = loadedSave.envelope?.payload.employment;
    const r4People = createR4PeopleModules(
      content,
      savedCharacters === undefined || savedEmployment === undefined
        ? undefined
        : { characters: savedCharacters, employment: savedEmployment },
    );
    this.#characters = r4People.characters;
    this.#employment = r4People.employment;
    const fleet = new FleetModule({
      definitions: M2_PROCUREMENT_AIRSHIPS,
      initialShips: M2_INITIAL_PROCUREMENT_AIRSHIPS,
      captains: {
        getCaptainSnapshot: (characterId) => {
          const character = r4People.characters.getCharacter(characterId);
          const employment = r4People.employment.getRecord(characterId);
          if (character === null) return null;
          return Object.freeze({
            eligible: employment !== null && employment.dismissalRequestedAtUtcMs === null && employment.learnedJobIds.includes("job.captain"),
            pilotingLevel: character.skills.piloting.level,
          });
        },
      },
      routes: {
        isRouteUnlocked: (routeId) => progression.isContentUnlocked("route", routeId),
      },
      policy: {
        calculateVoyageDurationMs: ({ roundTripDistanceUnits, shipSpeedUnitsPerSecond, captainPilotingLevel }) =>
          Math.max(1, Math.ceil(roundTripDistanceUnits * 1_000 /
            (shipSpeedUnitsPerSecond * (1 + Math.min(captainPilotingLevel, 100) * 0.01)))),
        calculateDurabilityLoss: ({ roundTripDistanceUnits, captainPilotingLevel }) =>
          Math.max(1, Math.ceil(roundTripDistanceUnits / (150 + Math.min(captainPilotingLevel, 100) * 5))),
        calculateCooldownDurationMs: ({ roundTripDistanceUnits, cooldownEfficiency }) =>
          Math.max(0, Math.ceil(roundTripDistanceUnits * 50 / cooldownEfficiency)),
      },
      eventBus: new DomainEventBus(),
      finance: functionalFinance,
      ...(loadedSave.envelope?.payload.fleet === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.fleet }),
    });
    fleet.advanceTo("fleet:startup:" + nowUtcMs, nowUtcMs);
    this.#fleet = fleet;
    const restaurantTargetResolver = new DesktopRestaurantInteractionTargetResolver(
      content,
      r3SceneLayout,
    );
    let operationalInitialState = loadedSave.envelope?.payload.restaurantOperational;
    let operationalModules;
    try {
      operationalModules = createDesktopRestaurantOperationalModules({
        content,
        layout: r3SceneLayout,
        characters: r4People.characters,
        employment: r4People.employment,
        finance: functionalFinance,
        targetResolver: restaurantTargetResolver,
        initialIngredients: M2_INITIAL_INGREDIENTS,
        ...(operationalInitialState === undefined ? {} : {
          initialStates: operationalInitialState,
        }),
      });
    } catch (error: unknown) {
      console.warn(
        "[RestaurantOperationalRuntime] Deep restore rejected; initialized a safe operational world.",
        error,
      );
      operationalInitialState = undefined;
      operationalModules = createDesktopRestaurantOperationalModules({
        content,
        layout: r3SceneLayout,
        characters: r4People.characters,
        employment: r4People.employment,
        finance: functionalFinance,
        targetResolver: restaurantTargetResolver,
        initialIngredients: M2_INITIAL_INGREDIENTS,
      });
    }
    const r4Presentation = createR4CharacterPresentationRuntimeFromModules({
      characters: r4People.characters,
      employment: r4People.employment,
      tasks: operationalModules.tasks,
      movement: operationalModules.movement,
      personnelElevator: operationalModules.personnelElevator,
    }, () => clock.nowUtcMs());
    const payroll = new PayrollModule({
      characters: r4People.characters,
      employment: r4People.employment,
      finance: functionalFinance,
      talentQuality: {
        getTalentQuality: (talentId) =>
          content.getTalent(talentId)?.qualityTier ?? null,
      },
      activity: {
        isVoyageActive: (characterId) => fleet.isCaptainVoyageActive(characterId),
      },
      ...(loadedSave.envelope?.payload.payroll === undefined
        ? {
            initialGameDay: functionalFinance.getSnapshot().currentGameDay,
            initialUtcMs: nowUtcMs,
          }
        : { initialState: loadedSave.envelope.payload.payroll }),
    });
    payroll.advanceTo(nowUtcMs);
    this.#payroll = payroll;
    const recruitment = createDesktopRecruitmentRuntime({
      content,
      finance: functionalFinance,
      characters: r4People.characters,
      employment: r4People.employment,
      technology,
      nowUtcMs: () => clock.nowUtcMs(),
      ...(loadedSave.envelope?.payload.recruitment === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.recruitment }),
    });
    this.#recruitment = recruitment;
    const recruitmentCommands = new RecruitmentRuntime({
      recruitment,
      characters: r4People.characters,
      employment: r4People.employment,
      progression: technology,
      clock,
      activity: {
        getCurrentTaskId: (characterId) =>
          operationalModules.tasks.createReadModel().inProgress.find(
            (task) => task.assignedCharacterId === characterId,
          )?.taskId ?? null,
        isVoyageActive: (characterId) => fleet.isCaptainVoyageActive(characterId),
      },
      beforeEmploymentMutation: () => {
        payroll.captureCurrentAttendance(clock.nowUtcMs());
      },
      onCharacterHired: r4Presentation.registerCharacterPresentation,
      onChanged: () => { runtime.notifyExternalChange(); },
    });
    const localProcurement = createDesktopLocalProcurementRuntime({
      content,
      finance: functionalFinance,
      inventory: operationalModules.inventory,
      characters: r4People.characters,
      employment: r4People.employment,
      tasks: operationalModules.tasks,
      fleet,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      ...(loadedSave.envelope?.payload.localProcurement === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.localProcurement }),
    });
    this.#localProcurement = localProcurement;
    const automaticProcurement = createDesktopAutomaticProcurementRuntime({
      procurement: localProcurement,
      inventory: operationalModules.inventory,
      finance: functionalFinance,
      employment: r4People.employment,
      destinationLocationId: DESKTOP_RESTAURANT_IDS.locations.groundExchange,
      ...(loadedSave.envelope?.payload.automaticProcurement === undefined
        ? {}
        : { initialState: loadedSave.envelope.payload.automaticProcurement }),
    });
    this.#automaticProcurement = automaticProcurement;
    const procurementCommands = new DesktopProcurementRuntime({
      procurement: localProcurement,
      automatic: automaticProcurement,
      fleet,
      employment: r4People.employment,
      progression,
      clock,
      onChanged: () => { runtime.notifyExternalChange(); },
    });
    const restaurantOperational = createDesktopRestaurantOperationalRuntime({
      content,
      startUtcMs: nowUtcMs,
      modules: operationalModules,
      characters: r4People.characters,
      employment: r4People.employment,
      localProcurement,
      automaticProcurement,
      fleet,
      ingredientTargets: supply.items,
      activeRegionId: "region.greyfeather",
      ...(operationalInitialState === undefined ? {} : {
        initialState: operationalInitialState,
      }),
    });
    this.#restaurantOperational = restaurantOperational;
    const gameplayProjection = new RestaurantGameplayReadProjection({
      content,
      operational: restaurantOperational,
      finance: functionalFinance,
    });
    const beforeOfflineAdvance = gameplayProjection.getSnapshot();
    const offlineAdvance = gameplayProjection.advanceTo(nowUtcMs);
    if (loadedSave.envelope !== null) {
      console.log(
        `[GameSaveService] Operational save restored ${JSON.stringify({
          source: loadedSave.status,
          elapsedMs: offlineAdvance.snapshot.currentUtcMs - beforeOfflineAdvance.currentUtcMs,
          clockRollbackDetected: offlineAdvance.clockRollbackDetected,
          operationalRevision: offlineAdvance.snapshot.revision,
          soldQuantity: offlineAdvance.snapshot.restaurant.totalSoldQuantity,
          copper: offlineAdvance.snapshot.restaurant.copperBalance,
        })}`,
      );
    }
    const offlineEarnings = loadedSave.envelope !== null &&
      offlineAdvance.snapshot.currentUtcMs > beforeOfflineAdvance.currentUtcMs
      ? createOfflineEarningsSummary(beforeOfflineAdvance, offlineAdvance.snapshot)
      : null;
    runtime = new GameRuntime(
      clock,
      gameplayProjection,
      offlineEarnings,
      narrative,
      dialogue,
      story,
      technology,
      focusSession,
    );
    this.#storyRosterCustomerAdapter?.dispose();
    this.#storyRosterCustomerAdapter = createDesktopStoryRosterCustomerAdapter({
      content,
      eventBus: operationalModules.eventBus,
      roster: storyRoster,
      characters: r4People.characters,
      finishedMeals: operationalModules.kitchenProducts,
      onChanged: () => { runtime.notifyExternalChange(); },
    });
    const manualLogistics = new ManualLogisticsRuntime({
      logistics: operationalModules.logistics,
      inventory: operationalModules.inventory,
      stationLocationIds: [
        DESKTOP_RESTAURANT_IDS.locations.groundExchange,
        DESKTOP_RESTAURANT_IDS.locations.airshipExchange,
      ],
      clock,
      onChanged: () => { runtime.notifyExternalChange(); },
    });
    const instanceUpgrades = new InstanceUpgradeRuntime({
      layout: r3SceneLayout,
      editMode,
      buildingUpgrades,
      buildingConstruction,
      buildingCatalog: content.listBuildings().map((building) => ({
        definitionId: building.id,
        name: building.name,
        unlocked: progression.isBuildingUnlocked(building.id),
      })),
      procurement: localProcurement,
      fleet,
      clock,
      onChanged: () => { runtime.notifyExternalChange(); },
    });
    const r3ReadModels = new R3ReadModelPublisher({
      layout: r3SceneLayout,
      inventory: operationalModules.inventory,
      characters: r4Presentation.presentation,
      instanceUpgrades,
      manualLogistics,
      recruitment: recruitmentCommands,
      progression: {
        getSnapshot: () =>
          projectProgressionReadModel(progression.createReadModel()),
      },
    });

    runtime.subscribe(() => {
      r3ReadModels.refresh();
    });
    const runtimeFacade = new RuntimeReadModelFacade(
      runtime,
      r3ReadModels,
      new RuntimeCommandExtensionChain([
        instanceUpgrades,
        recruitmentCommands,
        manualLogistics,
        procurementCommands,
      ]),
      {
        getSnapshot: (): FinanceReadModel => {
          const report = financeReports.getReadModel(clock.nowUtcMs());
          const restaurant = gameplayProjection.getSnapshot().restaurant;
          const totalCopperSpent = report.currentDay.totalExpenseCopper +
            report.historicalDays.reduce(
              (sum, day) => sum + day.totalExpenseCopper,
              0,
            );
          return Object.freeze({
            sourceRevision: report.revision,
            balanceCopper: report.balanceCopper,
            reservedCopper: report.reservedCopper,
            availableCopper: report.availableCopper,
            totalCopperSpent,
            recentSales: restaurant.recentSales,
            currentDay: report.currentDay,
            historicalDays: report.historicalDays,
          });
        },
      },
      procurementCommands,
      { getSnapshot: () => storyRoster.createReadModel() },
    );
    this.#windowManager = new WindowManager(
      displayService,
      settingsStore,
      {
        rendererBaseUrl: getRendererBaseUrl(process.env),
      },
    );
    this.#ipcRouter = new IpcRouter(
      this.#windowManager,
      runtimeFacade,
      settingsStore,
      displayService,
      gameSaveService,
    );

    this.#ipcRouter.start();
    this.#windowManager.start();
    runtime.markReady();
    this.#ipcRouter.syncRuntimeSettings();
    this.#startRuntimeTicker(
      runtime,
      () => {
        const currentUtcMs = clock.nowUtcMs();
        const payrollAdvance = payroll.advanceTo(currentUtcMs);
        const storyRosterSequenceChanged = storyRosterSequenceRuntime.reconcile();
        const progressionEvaluation = progression.evaluate(
          "progression:tick:" + currentUtcMs,
          currentUtcMs,
        );
        recruitmentCommands.reconcilePendingDismissals();
        if (payrollAdvance.closedGameDays.length > 0 || storyRosterSequenceChanged || progressionEvaluation.changed) {
          runtime.notifyExternalChange();
        }
      },
    );

    this.#startGameSaving(
      runtime,
      narrative,
      story,
      storyRoster,
      focusSession,
      technology,
      r3SceneLayout,
      buildingUpgrades,
      localProcurement,
      automaticProcurement,
      r4People.characters,
      r4People.employment,
      recruitment,
      functionalFinance,
      payroll,
      progression,
      fleet,
      restaurantOperational,
      gameSaveService,
    );
    if (
      launchOptions.showManagement ||
      !settings.onboardingCompleted ||
      settings.needsDisplayConfirmation
    ) {
      this.#windowManager.openManagementWindow();
    }

    if (launchOptions.smokeTest) {
      await this.#runSmokeTest(this.#windowManager);
    } else if (launchOptions.residentStability !== null) {
      const monitor = new ResidentStabilityMonitor(
        {
          ...launchOptions.residentStability,
          reportDirectory: path.join(
            app.getPath("userData"),
            "stability-reports",
          ),
        },
        runtime,
        gameSaveService,
        this.#windowManager,
      );
      this.#residentStabilityMonitor = monitor;
      monitor.start(() => {
        app.quit();
      });
    }
  }

  #configureApplicationProfile(
    profile: "normal" | "smoke" | "stability",
  ): void {
    app.setName(APPLICATION_NAME);

    const configuredUserData = app.commandLine
      .getSwitchValue("user-data-dir")
      .trim();
    const userDataPath =
      configuredUserData.length > 0
        ? path.resolve(configuredUserData)
        : path.join(
            app.getPath(profile === "normal" ? "appData" : "temp"),
            profile === "smoke"
              ? SMOKE_USER_DATA_DIRECTORY
              : profile === "stability"
                ? STABILITY_USER_DATA_DIRECTORY
                : USER_DATA_DIRECTORY,
          );

    if (configuredUserData.length === 0) {
      app.commandLine.appendSwitch("user-data-dir", userDataPath);
    }

    app.setPath("userData", userDataPath);
  }

  #startRuntimeTicker(
    runtime: GameRuntime,
    afterTick: () => void = () => undefined,
  ): void {
    this.#stopRuntimeTicker();
    this.#runtimeTimer = setInterval(() => {
      try {
        runtime.tick();
        afterTick();
      } catch (error: unknown) {
        console.error("[GameRuntime] Tick failed", error);
      }
    }, RUNTIME_TICK_INTERVAL_MS);
  }

  #stopRuntimeTicker(): void {
    if (this.#runtimeTimer === null) {
      return;
    }

    clearInterval(this.#runtimeTimer);
    this.#runtimeTimer = null;
  }

  #startGameSaving(
    runtime: GameRuntime,

    narrative: NarrativeSystem,
    story: StorySequenceSystem,
    storyRoster: StoryRosterModule,
    focusSession: FocusSessionModule,
    technology: TechnologyModule,
    sceneLayout: ReturnType<typeof createR3SceneLayout>,
    buildingUpgrade: BuildingUpgradeModule,
    localProcurement: LocalProcurementModule,
    automaticProcurement: AutomaticProcurementModule,
    characters: CharacterModule,
    employment: EmploymentModule,
    recruitment: RecruitmentModule,
    finance: FinanceModule,
    payroll: PayrollModule,
    progression: ProgressionModule,
    fleet: FleetModule,
    restaurantOperational: DesktopRestaurantOperationalRuntime,
    gameSaveService: GameSaveService,
  ): void {
    this.#stopGameSaving();
    const requestSave = (): void => {
      gameSaveService.requestSave(
        Object.freeze({

          narrative: narrative.exportState(),
          story: story.exportState(),
          storyRoster: storyRoster.exportState(),
          focusSession: focusSession.exportState(),
          technology: technology.exportState(),
          sceneLayout: sceneLayout.exportState(),
          buildingUpgrade: buildingUpgrade.exportState(),
          localProcurement: localProcurement.exportState(),
          automaticProcurement: automaticProcurement.exportState(),
          characters: characters.exportState(),
          employment: employment.exportState(),
          recruitment: recruitment.exportState(),
          finance: finance.exportState(),
          payroll: payroll.exportState(),
          progression: progression.exportState(),
          fleet: fleet.exportState(),
          restaurantOperational: restaurantOperational.exportState(),
        }),
      );
    };
    this.#unsubscribeRuntimeSave = runtime.subscribe(requestSave);
    this.#gameSaveTimer = setInterval(
      requestSave,
      GAME_SAVE_INTERVAL_MS,
    );
    requestSave();
  }

  #stopGameSaving(): void {
    this.#unsubscribeRuntimeSave?.();
    this.#unsubscribeRuntimeSave = null;
    if (this.#gameSaveTimer !== null) {
      clearInterval(this.#gameSaveTimer);
      this.#gameSaveTimer = null;
    }
  }

  async #flushAndQuit(
    stabilityReportWrite: Promise<string> | null = null,
  ): Promise<void> {
    const writes: Promise<unknown>[] = [];
    if (stabilityReportWrite !== null) {
      writes.push(stabilityReportWrite);
    }
    if (
      this.#gameSaveService !== null &&

      this.#narrative !== null &&
      this.#story !== null &&
      this.#storyRoster !== null &&
      this.#focusSession !== null &&
      this.#technology !== null &&
      this.#sceneLayout !== null &&
      this.#buildingUpgrade !== null &&
      this.#localProcurement !== null &&
      this.#automaticProcurement !== null &&
      this.#characters !== null &&
      this.#employment !== null &&
      this.#recruitment !== null &&
      this.#finance !== null &&
      this.#payroll !== null &&
      this.#progression !== null &&
      this.#fleet !== null &&
      this.#restaurantOperational !== null
    ) {
      writes.push(
        this.#gameSaveService.saveAndFlush(
          Object.freeze({

            narrative: this.#narrative.exportState(),
            story: this.#story.exportState(),
            storyRoster: this.#storyRoster.exportState(),
            focusSession: this.#focusSession.exportState(),
            technology: this.#technology.exportState(),
            sceneLayout: this.#sceneLayout.exportState(),
            buildingUpgrade: this.#buildingUpgrade.exportState(),
            localProcurement: this.#localProcurement.exportState(),
            automaticProcurement: this.#automaticProcurement.exportState(),
            characters: this.#characters.exportState(),
            employment: this.#employment.exportState(),
            recruitment: this.#recruitment.exportState(),
            finance: this.#finance.exportState(),
            payroll: this.#payroll.exportState(),
            progression: this.#progression.exportState(),
            fleet: this.#fleet.exportState(),
            restaurantOperational: this.#restaurantOperational.exportState(),
          }),
        ),
      );
    }
    if (this.#settingsStore !== null) {
      writes.push(this.#settingsStore.flush());
    }

    const results = await Promise.allSettled(writes);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          "[AppLifecycle] Final persistence flush failed",
          result.reason,
        );
      }
    }

    this.#allowQuit = true;
    app.quit();
  }

  async #runSmokeTest(windowManager: WindowManager): Promise<void> {
    try {
      const results = await verifyRendererBridges(windowManager);
      const managementWebContents = windowManager.getRendererWebContents().find(
        (webContents) => windowManager.getWindowKindForWebContents(webContents.id) === "management",
      );
      const operationsCapturePath = path.join(app.getPath("userData"), "r12-overview-management.png");
      const warehouseCapturePath = path.join(app.getPath("userData"), "r12-warehouse-management.png");
      const recipeCapturePath = path.join(app.getPath("userData"), "r12-recipe-book-management.png");
      const capturePath = path.join(app.getPath("userData"), "r12-building-management.png");
      const recruitmentCapturePath = path.join(app.getPath("userData"), "r12-staff-management.png");
      const progressionCapturePath = path.join(app.getPath("userData"), "r12-progression-management.png");
      const financeCapturePath = path.join(app.getPath("userData"), "r12-finance-management.png");
      if (managementWebContents !== undefined) {
        const operationsImage = await managementWebContents.capturePage();
        await writeFile(operationsCapturePath, operationsImage.toPNG());
        await managementWebContents.executeJavaScript(`
          (async () => {
            const warehouseTrigger = document.querySelector('[data-management-section="inventory"]');
            if (!(warehouseTrigger instanceof HTMLButtonElement) || warehouseTrigger.disabled) throw new Error("Warehouse shortcut is unavailable.");
            warehouseTrigger.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const dialog = document.querySelector(".warehouse-dialog");
            if (!(dialog instanceof HTMLElement) || !dialog.textContent?.includes("手动运送队列")) throw new Error("Warehouse dialog did not hydrate manual logistics.");
          })();
        `, true);
        await writeFile(warehouseCapturePath, (await managementWebContents.capturePage()).toPNG());
        await managementWebContents.executeJavaScript(`
          (async () => {
            document.querySelector(".warehouse-dialog .technology-tree-close")?.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const recipeTrigger = document.querySelector('[data-management-section="recipes"]');
            if (!(recipeTrigger instanceof HTMLButtonElement) || recipeTrigger.disabled) throw new Error("Recipe shortcut is unavailable.");
            recipeTrigger.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const dialog = document.querySelector(".recipe-book-dialog");
            if (!(dialog instanceof HTMLElement) || !dialog.textContent?.includes("REAL-WORLD RECIPE")) throw new Error("Recipe book did not hydrate detailed recipes.");
            dialog.querySelector(".real-recipe-divider")?.scrollIntoView({ block: "start" });
            await new Promise((resolve) => setTimeout(resolve, 100));
          })();
        `, true);
        await writeFile(recipeCapturePath, (await managementWebContents.capturePage()).toPNG());
        await managementWebContents.executeJavaScript(`
          document.querySelector(".recipe-book-dialog .technology-tree-close")?.click();
        `, true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await managementWebContents.executeJavaScript(`
          (async () => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            const trigger = document.querySelector('[data-management-section="instance-upgrades"]');
            if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) {
              throw new Error("Instance-upgrades shortcut is unavailable during smoke test.");
            }
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const dialog = document.querySelector(".instance-upgrades-dialog");
            if (!(dialog instanceof HTMLElement)) {
              throw new Error("Instance-upgrades dialog did not open during smoke test.");
            }
            if (!dialog.textContent?.includes("场景俯视布置图") || !dialog.textContent.includes("远程采购飞艇") || !dialog.textContent.includes("instance.airship.skylark_01")) {
              throw new Error("Placement canvas and vehicle instances were not projected into the scene-placement dialog.");
            }
            if (!(dialog.querySelector(".scene-placement-canvas") instanceof HTMLElement)) {
              throw new Error("Scene placement canvas is unavailable.");
            }
            const editButton = dialog.querySelector(".instance-edit-mode button");
            if (!(editButton instanceof HTMLButtonElement) || editButton.disabled) {
              throw new Error("Scene edit mode is unavailable.");
            }
            editButton.click();
            await new Promise((resolve) => setTimeout(resolve, 180));
            const placeButton = dialog.querySelector(".building-place-action");
            if (!(placeButton instanceof HTMLButtonElement) || placeButton.disabled) {
              throw new Error("Building cannot be placed from the facility palette.");
            }
            placeButton.click();
            await new Promise((resolve) => setTimeout(resolve, 220));
            if (!(dialog.querySelector(".scene-placement-item--preview") instanceof HTMLButtonElement)) {
              throw new Error("Building preview was not created on the placement canvas.");
            }
            dialog.scrollTop = 0;
            await new Promise((resolve) => setTimeout(resolve, 100));
          })();
        `, true);
        const image = await managementWebContents.capturePage();
        await writeFile(capturePath, image.toPNG());
        await managementWebContents.executeJavaScript(`
          (async () => {
            const instanceClose = document.querySelector(".instance-upgrades-dialog .technology-tree-close");
            if (instanceClose instanceof HTMLButtonElement) instanceClose.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const trigger = document.querySelector('[data-management-section="staff"]');
            if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) {
              throw new Error("Recruitment shortcut is unavailable during smoke test.");
            }
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const dialog = document.querySelector(".recruitment-dialog");
            if (!(dialog instanceof HTMLElement)) {
              throw new Error("Recruitment dialog did not open during smoke test.");
            }
            dialog.scrollTop = 0;
          })();
        `, true);
        const recruitmentImage = await managementWebContents.capturePage();
        await writeFile(recruitmentCapturePath, recruitmentImage.toPNG());
        await managementWebContents.executeJavaScript(`
          (async () => {
            const recruitmentClose = document.querySelector(".recruitment-dialog .technology-tree-close");
            if (recruitmentClose instanceof HTMLButtonElement) recruitmentClose.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const technologyTrigger = document.querySelector('button[data-management-section="technology"]');
            if (!(technologyTrigger instanceof HTMLButtonElement)) throw new Error("Technology entry is unavailable.");
            technologyTrigger.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const trigger = document.querySelector('button[data-technology-view="compendium"]');
            if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) {
              throw new Error("Progression shortcut is unavailable during smoke test.");
            }
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const dialog = document.querySelector(".progression-dialog");
            if (!(dialog instanceof HTMLElement) ||
                dialog.querySelectorAll(".progression-entry").length === 0) {
              throw new Error("Progression dialog did not hydrate during smoke test.");
            }
            dialog.scrollTop = 0;
          })();
        `, true);
        const progressionImage = await managementWebContents.capturePage();
        await writeFile(progressionCapturePath, progressionImage.toPNG());
        await managementWebContents.executeJavaScript(`
          (async () => {
            const progressionClose = document.querySelector(".progression-dialog .technology-tree-close");
            if (progressionClose instanceof HTMLButtonElement) progressionClose.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const financeTrigger = document.querySelector('button[data-management-section="finance"]');
            if (!(financeTrigger instanceof HTMLButtonElement)) throw new Error("Finance entry is unavailable.");
            financeTrigger.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const finance = document.querySelector(".finance-card");
            if (!(finance instanceof HTMLElement)) {
              throw new Error("Daily-finance panel is unavailable during smoke test.");
            }
            finance.scrollIntoView({ block: "start" });
            await new Promise((resolve) => setTimeout(resolve, 100));
          })();
        `, true);
        const financeImage = await managementWebContents.capturePage();
        await writeFile(financeCapturePath, financeImage.toPNG());
      }
      console.log(`[SmokeTest] R12 overview management capture ${operationsCapturePath}`);
      console.log(`[SmokeTest] R12 warehouse management capture ${warehouseCapturePath}`);
      console.log(`[SmokeTest] R12 recipe book management capture ${recipeCapturePath}`);
      console.log(`[SmokeTest] Instance-upgrades management capture ${capturePath}`);
      console.log(`[SmokeTest] Recruitment management capture ${recruitmentCapturePath}`);
      console.log(`[SmokeTest] Progression management capture ${progressionCapturePath}`);
      console.log(`[SmokeTest] Daily-finance management capture ${financeCapturePath}`);
      console.log(
        `[SmokeTest] Renderer bridges ready ${JSON.stringify(
          results.map((result) => ({
            renderer: result.renderer,
            channel: result.workspace.channel,
            phase: result.desktopWorld.phase,
            revision: result.desktopWorld.sourceRevision,
            gameplayRevision:
              result.desktopWorld.gameplayRevision,
          })),
        )}`,
      );
      app.quit();
    } catch (error: unknown) {
      console.error("[SmokeTest] Renderer bridge verification failed", error);
      this.#ipcRouter?.stop();
      windowManager.shutdown();
      app.exit(1);
    }
  }
}
