import { BrowserWindow, type Rectangle } from "electron";
import path from "node:path";
import { DisplayService } from "./display-service";

type RendererPage = "desktop" | "management";

export interface WindowManagerOptions {
  readonly rendererBaseUrl: string | null;
}

export class WindowManager {
  readonly #displayService: DisplayService;
  readonly #options: WindowManagerOptions;
  #desktopWindow: BrowserWindow | null = null;
  #managementWindow: BrowserWindow | null = null;
  #desktopRecoveryTimer: NodeJS.Timeout | null = null;
  #isShuttingDown = false;

  constructor(
    displayService: DisplayService,
    options: WindowManagerOptions,
  ) {
    this.#displayService = displayService;
    this.#options = options;
  }

  start(): void {
    this.#displayService.start(() => {
      this.#handleDisplaysChanged();
    });
    this.ensureDesktopWindow();
  }

  shutdown(): void {
    if (this.#isShuttingDown) {
      return;
    }

    this.#isShuttingDown = true;
    this.#displayService.dispose();

    if (this.#desktopRecoveryTimer !== null) {
      clearTimeout(this.#desktopRecoveryTimer);
      this.#desktopRecoveryTimer = null;
    }

    this.#managementWindow?.destroy();
    this.#desktopWindow?.destroy();
    this.#managementWindow = null;
    this.#desktopWindow = null;
  }

  ensureDesktopWindow(): BrowserWindow | null {
    if (this.#isShuttingDown) {
      return null;
    }

    if (
      this.#desktopWindow !== null &&
      !this.#desktopWindow.isDestroyed()
    ) {
      return this.#desktopWindow;
    }

    const bounds = this.#displayService.getDesktopBounds();
    const desktopWindow = new BrowserWindow({
      ...bounds,
      title: "空艇餐厅",
      show: false,
      transparent: true,
      frame: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: this.#getPreloadPath("desktop"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });

    this.#desktopWindow = desktopWindow;
    desktopWindow.setMenuBarVisibility(false);

    // Until SemanticHitMap is migrated, the formal shell must never block
    // the entire desktop.
    desktopWindow.setIgnoreMouseEvents(true, { forward: true });

    desktopWindow.once("ready-to-show", () => {
      if (desktopWindow.isDestroyed() || this.#isShuttingDown) {
        return;
      }

      desktopWindow.setBounds(this.#displayService.getDesktopBounds(), false);
      desktopWindow.showInactive();
    });

    desktopWindow.on("closed", () => {
      if (this.#desktopWindow === desktopWindow) {
        this.#desktopWindow = null;
      }

      this.#scheduleDesktopRecovery();
    });

    this.#attachSharedWindowGuards(desktopWindow, "desktop");
    void this.#loadRenderer(desktopWindow, "desktop");

    return desktopWindow;
  }

  openManagementWindow(): BrowserWindow | null {
    if (this.#isShuttingDown) {
      return null;
    }

    if (
      this.#managementWindow !== null &&
      !this.#managementWindow.isDestroyed()
    ) {
      if (this.#managementWindow.isMinimized()) {
        this.#managementWindow.restore();
      }

      this.#managementWindow.show();
      this.#managementWindow.focus();
      return this.#managementWindow;
    }

    const bounds = this.#displayService.getInitialManagementBounds();
    const managementWindow = new BrowserWindow({
      ...bounds,
      title: "空艇餐厅 · 管理界面",
      show: false,
      backgroundColor: "#eee4cf",
      minWidth: 640,
      minHeight: 480,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.#getPreloadPath("management"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });

    this.#managementWindow = managementWindow;
    managementWindow.setMenuBarVisibility(false);

    managementWindow.once("ready-to-show", () => {
      if (managementWindow.isDestroyed() || this.#isShuttingDown) {
        return;
      }

      managementWindow.show();
      managementWindow.focus();
    });

    managementWindow.on("closed", () => {
      if (this.#managementWindow === managementWindow) {
        this.#managementWindow = null;
      }
    });

    this.#attachSharedWindowGuards(managementWindow, "management");
    void this.#loadRenderer(managementWindow, "management");

    return managementWindow;
  }

  handleSecondInstance(): void {
    this.ensureDesktopWindow();
    this.openManagementWindow();
  }

  #attachSharedWindowGuards(
    window: BrowserWindow,
    page: RendererPage,
  ): void {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(
        `[WindowManager] ${page} renderer exited: ${details.reason}`,
      );

      if (this.#isShuttingDown || window.isDestroyed()) {
        return;
      }

      window.destroy();

      if (page === "desktop") {
        this.#scheduleDesktopRecovery();
      }
    });

    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          return;
        }

        console.error(
          `[WindowManager] Failed to load ${page} renderer`,
          { errorCode, errorDescription, validatedUrl },
        );
      },
    );
  }

  #scheduleDesktopRecovery(): void {
    if (
      this.#isShuttingDown ||
      this.#desktopRecoveryTimer !== null ||
      (this.#desktopWindow !== null && !this.#desktopWindow.isDestroyed())
    ) {
      return;
    }

    this.#desktopRecoveryTimer = setTimeout(() => {
      this.#desktopRecoveryTimer = null;
      this.ensureDesktopWindow();
    }, 250);
  }

  #handleDisplaysChanged(): void {
    if (
      this.#desktopWindow !== null &&
      !this.#desktopWindow.isDestroyed()
    ) {
      this.#desktopWindow.setBounds(
        this.#displayService.getDesktopBounds(),
        false,
      );
    }

    if (
      this.#managementWindow !== null &&
      !this.#managementWindow.isDestroyed()
    ) {
      const currentBounds: Rectangle = this.#managementWindow.getBounds();
      this.#managementWindow.setBounds(
        this.#displayService.fitManagementBounds(currentBounds),
        false,
      );
    }
  }

  #getPreloadPath(page: RendererPage): string {
    return path.join(__dirname, "..", "preload", `${page}.js`);
  }

  async #loadRenderer(
    window: BrowserWindow,
    page: RendererPage,
  ): Promise<void> {
    try {
      if (this.#options.rendererBaseUrl !== null) {
        const pageUrl = new URL(
          `${page}.html`,
          this.#options.rendererBaseUrl,
        );
        await window.loadURL(pageUrl.toString());
        return;
      }

      await window.loadFile(
        path.join(__dirname, "..", "renderer", `${page}.html`),
      );
    } catch (error: unknown) {
      if (!window.isDestroyed()) {
        console.error(`[WindowManager] Unable to load ${page} renderer`, error);
      }
    }
  }
}
