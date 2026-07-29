import { GameRuntime } from "@airship-restaurant/core";
import { app } from "electron";
import path from "node:path";
import { DisplayService } from "./display-service";
import { IpcRouter } from "./ipc-router";
import {
  getRendererBaseUrl,
  parseLaunchOptions,
} from "./launch-options";
import { verifyRendererBridges } from "./renderer-bridge-smoke";
import { SystemClock } from "./system-clock";
import { WindowManager } from "./window-manager";

const APPLICATION_NAME = "Airship Restaurant";
const WINDOWS_APP_USER_MODEL_ID = "com.airshiprestaurant.desktop";
const USER_DATA_DIRECTORY = "airship-restaurant-desktop";
const SMOKE_USER_DATA_DIRECTORY = "airship-restaurant-smoke";

export class AppLifecycle {
  #windowManager: WindowManager | null = null;
  #ipcRouter: IpcRouter | null = null;
  #isQuitting = false;

  async start(): Promise<void> {
    const launchOptions = parseLaunchOptions(process.argv);
    this.#configureApplicationProfile(launchOptions.smokeTest);

    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on("second-instance", () => {
      this.#windowManager?.handleSecondInstance();
    });

    app.on("before-quit", () => {
      this.#isQuitting = true;
      this.#ipcRouter?.stop();
      this.#windowManager?.shutdown();
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

    const runtime = new GameRuntime(new SystemClock());
    this.#windowManager = new WindowManager(new DisplayService(), {
      rendererBaseUrl: getRendererBaseUrl(process.env),
    });
    this.#ipcRouter = new IpcRouter(this.#windowManager, runtime);

    this.#ipcRouter.start();
    this.#windowManager.start();
    runtime.markReady();

    if (launchOptions.showManagement) {
      this.#windowManager.openManagementWindow();
    }

    if (launchOptions.smokeTest) {
      await this.#runSmokeTest(this.#windowManager);
    }
  }

  #configureApplicationProfile(smokeTest: boolean): void {
    app.setName(APPLICATION_NAME);

    const configuredUserData = app.commandLine
      .getSwitchValue("user-data-dir")
      .trim();
    const userDataPath =
      configuredUserData.length > 0
        ? path.resolve(configuredUserData)
        : path.join(
            app.getPath(smokeTest ? "temp" : "appData"),
            smokeTest
              ? SMOKE_USER_DATA_DIRECTORY
              : USER_DATA_DIRECTORY,
          );

    if (configuredUserData.length === 0) {
      app.commandLine.appendSwitch("user-data-dir", userDataPath);
    }

    app.setPath("userData", userDataPath);
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
