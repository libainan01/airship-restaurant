import {
  IPC_CHANNELS,
  type DesktopCursorPoint,
} from "@airship-restaurant/contracts";
import {
  BrowserWindow,
  screen,
  type Rectangle,
  type WebContents,
} from "electron";
import path from "node:path";
import { DisplayService } from "./display-service";

type ManagedWindowKind = "desktop" | "management";
type RendererPage = ManagedWindowKind;

export interface WindowManagerOptions {
  readonly rendererBaseUrl: string | null;
}

function rectanglesAreEqual(
  left: Readonly<Rectangle>,
  right: Readonly<Rectangle>,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export class WindowManager {
  readonly #displayService: DisplayService;
  readonly #options: WindowManagerOptions;
  #desktopWindow: BrowserWindow | null = null;
  #managementWindow: BrowserWindow | null = null;
  #desktopRecoveryTimer: NodeJS.Timeout | null = null;
  #desktopCompositionTimer: NodeJS.Timeout | null = null;
  #desktopMouseIgnored = true;
  #desktopCursorTimer: NodeJS.Timeout | null = null;
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
    this.#startCursorTracking();
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

    if (this.#desktopCompositionTimer !== null) {
      clearTimeout(this.#desktopCompositionTimer);
      this.#desktopCompositionTimer = null;
    }


    if (this.#desktopCursorTimer !== null) {
      clearInterval(this.#desktopCursorTimer);
      this.#desktopCursorTimer = null;
    }
    this.#managementWindow?.destroy();
    this.#desktopWindow?.destroy();
    this.#managementWindow = null;
    this.#desktopWindow = null;
    this.#desktopMouseIgnored = true;
  }

  ensureDesktopWindow(): BrowserWindow | null {
    if (this.#isShuttingDown) {
      return null;
    }

    if (this.#desktopRecoveryTimer !== null) {
      clearTimeout(this.#desktopRecoveryTimer);
      this.#desktopRecoveryTimer = null;
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
    this.#desktopMouseIgnored = true;
    desktopWindow.setMenuBarVisibility(false);
    desktopWindow.setIgnoreMouseEvents(true, { forward: true });

    desktopWindow.once("ready-to-show", () => {
      if (desktopWindow.isDestroyed() || this.#isShuttingDown) {
        return;
      }

      // Do not call setBounds here. Resizing a hardware-accelerated
      // transparent Windows surface after its first paint can make it opaque.
      desktopWindow.showInactive();
      this.#primeTransparentComposition(desktopWindow);
    });

    desktopWindow.on("closed", () => {
      if (this.#desktopWindow !== desktopWindow) {
        return;
      }

      this.#desktopWindow = null;
      this.#desktopMouseIgnored = true;
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

  setDesktopInteractive(interactive: boolean): void {
    const desktopWindow = this.#desktopWindow;

    if (desktopWindow === null || desktopWindow.isDestroyed()) {
      return;
    }

    const shouldIgnoreMouse = !interactive;
    if (shouldIgnoreMouse === this.#desktopMouseIgnored) {
      return;
    }

    desktopWindow.setIgnoreMouseEvents(shouldIgnoreMouse, {
      forward: shouldIgnoreMouse,
    });
    this.#desktopMouseIgnored = shouldIgnoreMouse;
  }

  handleSecondInstance(): void {
    this.ensureDesktopWindow();
    this.openManagementWindow();
  }

  getWindowKindForWebContents(
    webContentsId: number,
  ): ManagedWindowKind | null {
    if (
      this.#desktopWindow !== null &&
      !this.#desktopWindow.isDestroyed() &&
      this.#desktopWindow.webContents.id === webContentsId
    ) {
      return "desktop";
    }

    if (
      this.#managementWindow !== null &&
      !this.#managementWindow.isDestroyed() &&
      this.#managementWindow.webContents.id === webContentsId
    ) {
      return "management";
    }

    return null;
  }

  getRendererWebContents(): readonly WebContents[] {
    const renderers: WebContents[] = [];

    for (const window of [this.#desktopWindow, this.#managementWindow]) {
      if (
        window !== null &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed()
      ) {
        renderers.push(window.webContents);
      }
    }

    return renderers;
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
      this.#desktopWindow === null ||
      this.#desktopWindow.isDestroyed()
    ) {
      this.ensureDesktopWindow();
    } else {
      const targetBounds = this.#displayService.getDesktopBounds();
      const currentBounds = this.#desktopWindow.getBounds();

      if (!rectanglesAreEqual(currentBounds, targetBounds)) {
        this.#recreateDesktopWindow();
      }
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

  #recreateDesktopWindow(): void {
    const previousWindow = this.#desktopWindow;
    this.#desktopWindow = null;
    this.#desktopMouseIgnored = true;

    if (previousWindow !== null && !previousWindow.isDestroyed()) {
      previousWindow.destroy();
    }

    this.ensureDesktopWindow();
  }

  #startCursorTracking(): void {
    if (this.#desktopCursorTimer !== null) {
      return;
    }

    this.#desktopCursorTimer = setInterval(() => {
      this.#publishCursorPosition();
    }, 50);
  }

  #publishCursorPosition(): void {
    const desktopWindow = this.#desktopWindow;

    if (
      desktopWindow === null ||
      desktopWindow.isDestroyed() ||
      desktopWindow.webContents.isDestroyed()
    ) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = desktopWindow.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    const point: DesktopCursorPoint = {
      x,
      y,
      inside:
        x >= 0 && x < bounds.width && y >= 0 && y < bounds.height,
    };

    desktopWindow.webContents.send(
      IPC_CHANNELS.desktopCursorPosition,
      point,
    );
  }

  #primeTransparentComposition(desktopWindow: BrowserWindow): void {
    if (this.#desktopCompositionTimer !== null) {
      clearTimeout(this.#desktopCompositionTimer);
    }

    // On Windows 10/11, a large frameless window can be initially promoted
    // to an opaque DWM surface even when Chromium's captured pixels contain
    // alpha. A brief topmost transition forces DWM to create the correct
    // per-pixel-alpha surface. Removing topmost keeps that surface intact.
    desktopWindow.setAlwaysOnTop(true);
    this.#desktopCompositionTimer = setTimeout(() => {
      this.#desktopCompositionTimer = null;

      if (
        desktopWindow.isDestroyed() ||
        this.#isShuttingDown ||
        this.#desktopWindow !== desktopWindow
      ) {
        return;
      }

      desktopWindow.setAlwaysOnTop(false);
    }, 100);
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
