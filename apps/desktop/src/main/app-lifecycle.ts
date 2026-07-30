import {
  createM2ContentRegistry,
  M2_INITIAL_INGREDIENTS,
} from "@airship-restaurant/content";
import {
  AmbientDialogueSystem,
  createOfflineEarningsSummary,
  GameRuntime,
  M2Simulation,
  NarrativeSystem,
  SeededRandom,
} from "@airship-restaurant/core";
import { app, type Event } from "electron";
import path from "node:path";
import { DisplayService } from "./display-service";
import { GameSaveService } from "./game-save-service";
import { IpcRouter } from "./ipc-router";
import {
  getRendererBaseUrl,
  parseLaunchOptions,
} from "./launch-options";
import { verifyRendererBridges } from "./renderer-bridge-smoke";
import { ResidentStabilityMonitor } from "./resident-stability-monitor";
import { SettingsStore } from "./settings-store";
import { SystemClock } from "./system-clock";
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
  #simulation: M2Simulation | null = null;
  #narrative: NarrativeSystem | null = null;
  #runtimeTimer: NodeJS.Timeout | null = null;
  #gameSaveTimer: NodeJS.Timeout | null = null;
  #unsubscribeRuntimeSave: (() => void) | null = null;
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

    const clock = new SystemClock();
    const gameSaveService = new GameSaveService(
      app.getPath("userData"),
      () => clock.nowUtcMs(),
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
    const content = createM2ContentRegistry();
    const supply = content.getSupplyBundle("supply.guild_basic");
    if (supply === undefined) {
      throw new Error("The M2 basic supply bundle is missing.");
    }
    const nowUtcMs = clock.nowUtcMs();
    const simulation = new M2Simulation({
      startUtcMs: nowUtcMs,
      randomSeed: 0x0a17_5eed,
      ingredients: content.listIngredients().map((ingredient) => ({
        id: ingredient.id,
        capacity: ingredient.capacity,
      })),
      recipes: content.listRecipes().map((recipe) => ({
        ...recipe,
      })),
      initialIngredients: M2_INITIAL_INGREDIENTS,
      supply: {
        intervalMs: supply.intervalMs,
        items: supply.items,
      },
      defaultRecipeId: "recipe.hearth_flatbread",
      ...(loadedSave.envelope === null
        ? {}
        : { initialState: loadedSave.envelope.payload }),
    });
    const beforeOfflineAdvance = simulation.getSnapshot();
    const offlineAdvance = simulation.advanceTo(nowUtcMs);
    this.#simulation = simulation;
    if (loadedSave.envelope !== null) {
      const elapsedMs =
        offlineAdvance.snapshot.currentUtcMs -
        loadedSave.envelope.payload.currentUtcMs;
      console.log(
        `[GameSaveService] Save restored ${JSON.stringify({
          source: loadedSave.status,
          elapsedMs,
          clockRollbackDetected:
            offlineAdvance.clockRollbackDetected,
          soldQuantity:
            offlineAdvance.snapshot.restaurant.totalSoldQuantity,
          copper:
            offlineAdvance.snapshot.restaurant.copperBalance,
        })}`,
      );
    }
    const offlineEarnings =
      loadedSave.envelope !== null &&
      offlineAdvance.snapshot.currentUtcMs >
        beforeOfflineAdvance.currentUtcMs
        ? createOfflineEarningsSummary(
            beforeOfflineAdvance,
            offlineAdvance.snapshot,
          )
        : null;
    const narrative = new NarrativeSystem(
      content.listStoryEvents(),
      loadedSave.envelope?.payload.narrative,
    );
    this.#narrative = narrative;
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
    const runtime = new GameRuntime(
      clock,
      simulation,
      offlineEarnings,
      narrative,
      dialogue,
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
      runtime,
      settingsStore,
      displayService,
      gameSaveService,
    );

    this.#ipcRouter.start();
    this.#windowManager.start();
    runtime.markReady();
    this.#ipcRouter.syncRuntimeSettings();
    this.#startRuntimeTicker(runtime);

    this.#startGameSaving(
      runtime,
      simulation,
      narrative,
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

  #startRuntimeTicker(runtime: GameRuntime): void {
    this.#stopRuntimeTicker();
    this.#runtimeTimer = setInterval(() => {
      try {
        runtime.tick();
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
    simulation: M2Simulation,
    narrative: NarrativeSystem,
    gameSaveService: GameSaveService,
  ): void {
    this.#stopGameSaving();
    const requestSave = (): void => {
      gameSaveService.requestSave(
        Object.freeze({
          ...simulation.exportState(),
          narrative: narrative.exportState(),
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
      this.#simulation !== null &&
      this.#narrative !== null
    ) {
      writes.push(
        this.#gameSaveService.saveAndFlush(
          Object.freeze({
            ...this.#simulation.exportState(),
            narrative: this.#narrative.exportState(),
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
      console.log(
        `[SmokeTest] Renderer bridges ready ${JSON.stringify(
          results.map((result) => ({
            renderer: result.renderer,
            channel: result.workspace.channel,
            phase: result.snapshot.phase,
            revision: result.snapshot.revision,
            gameplayRevision:
              result.snapshot.gameplay?.revision ?? null,
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
