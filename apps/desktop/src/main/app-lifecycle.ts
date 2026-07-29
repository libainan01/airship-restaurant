import { app } from "electron";
import { DisplayService } from "./display-service";
import {
  getRendererBaseUrl,
  parseLaunchOptions,
} from "./launch-options";
import { WindowManager } from "./window-manager";

const WINDOWS_APP_USER_MODEL_ID = "com.airshiprestaurant.desktop";

export class AppLifecycle {
  #windowManager: WindowManager | null = null;
  #isQuitting = false;
  #smokeTestTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on("second-instance", () => {
      this.#windowManager?.handleSecondInstance();
    });

    app.on("before-quit", () => {
      this.#isQuitting = true;

      if (this.#smokeTestTimer !== null) {
        clearTimeout(this.#smokeTestTimer);
        this.#smokeTestTimer = null;
      }

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

    const launchOptions = parseLaunchOptions(process.argv);
    this.#windowManager = new WindowManager(new DisplayService(), {
      rendererBaseUrl: getRendererBaseUrl(process.env),
    });
    this.#windowManager.start();

    if (launchOptions.showManagement) {
      this.#windowManager.openManagementWindow();
    }

    if (launchOptions.smokeTest) {
      this.#smokeTestTimer = setTimeout(() => {
        this.#smokeTestTimer = null;
        app.quit();
      }, 2_000);
    }
  }
}
