import {
  IPC_CHANNELS,
  getCommandId,
  isAppSettingsUpdate,
  isDesktopInteractionRequest,
  isGameCommand,
  type AppSettingsSnapshot,
  type CommandResult,
  type GameSnapshot,
  type SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import type { GameRuntime } from "@airship-restaurant/core";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DisplayService } from "./display-service";
import type { GameSaveService } from "./game-save-service";
import type { SettingsStore } from "./settings-store";
import type { WindowManager } from "./window-manager";

type AllowedWindow = "desktop" | "management";

export class IpcRouter {
  readonly #windowManager: WindowManager;
  readonly #runtime: GameRuntime;
  readonly #settingsStore: SettingsStore;
  readonly #displayService: DisplayService;
  readonly #gameSaveService: GameSaveService;
  #unsubscribeSaveDiagnostics: (() => void) | null = null;
  #unsubscribeRuntime: (() => void) | null = null;
  #unsubscribeSettings: (() => void) | null = null;
  #isStarted = false;

  constructor(
    windowManager: WindowManager,
    runtime: GameRuntime,
    settingsStore: SettingsStore,
    displayService: DisplayService,
    gameSaveService: GameSaveService,
  ) {
    this.#windowManager = windowManager;
    this.#runtime = runtime;
    this.#settingsStore = settingsStore;
    this.#displayService = displayService;
    this.#gameSaveService = gameSaveService;
  }

  start(): void {
    if (this.#isStarted) {
      throw new Error("IpcRouter has already been started.");
    }

    this.#isStarted = true;

    ipcMain.handle(
      IPC_CHANNELS.runtimeGetSnapshot,
      (event): GameSnapshot => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        return this.#runtime.getSnapshot();
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.runtimeDispatchCommand,
      async (event, payload: unknown): Promise<CommandResult> => {
        this.#assertTrustedSender(event, ["desktop", "management"]);

        if (!isGameCommand(payload)) {
          return {
            accepted: false,
            commandId: getCommandId(payload),
            code: "INVALID_COMMAND",
            message: "The command payload failed runtime validation.",
            snapshot: this.#runtime.getSnapshot(),
          };
        }

        const result = this.#runtime.dispatch(payload);
        if (
          result.accepted &&
          payload.type === "settings.set-quiet-mode"
        ) {
          await this.#settingsStore.update({
            presentationMode: payload.payload.enabled
              ? "quiet"
              : "normal",
          });
        }
        return result;
      },
    );

    ipcMain.handle(IPC_CHANNELS.windowOpenManagement, (event): void => {
      this.#assertTrustedSender(event, ["desktop", "management"]);
      this.#windowManager.openManagementWindow();
    });

    ipcMain.handle(
      IPC_CHANNELS.desktopSetInteraction,
      (event, payload: unknown): void => {
        this.#assertTrustedSender(event, ["desktop"]);

        if (!isDesktopInteractionRequest(payload)) {
          throw new Error(
            "Desktop interaction request failed runtime validation.",
          );
        }

        this.#windowManager.setDesktopInteractive(payload.interactive);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.settingsGetSnapshot,
      (event): AppSettingsSnapshot => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        return this.#settingsStore.getSnapshot();
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.settingsUpdate,
      async (event, payload: unknown): Promise<AppSettingsSnapshot> => {
        this.#assertTrustedSender(event, ["management"]);
        if (!isAppSettingsUpdate(payload)) {
          throw new Error("Settings update failed runtime validation.");
        }

        if (
          payload.targetDisplayId !== undefined &&
          !this.#displayService.hasDisplay(payload.targetDisplayId)
        ) {
          throw new Error("Selected display is no longer available.");
        }

        const settings = await this.#settingsStore.update(payload);
        this.#syncRuntimeQuietMode(settings);
        return settings;
      },
    );

    ipcMain.handle(IPC_CHANNELS.settingsListDisplays, (event) => {
      this.#assertTrustedSender(event, ["management"]);
      return this.#displayService.listDisplays();
    });

    ipcMain.handle(
      IPC_CHANNELS.saveGetDiagnostics,
      (event): SaveDiagnosticsSnapshot => {
        this.#assertTrustedSender(event, ["management"]);
        return this.#gameSaveService.getDiagnostics();
      },
    );

    this.#unsubscribeRuntime = this.#runtime.subscribe((snapshot) => {
      for (const webContents of this.#windowManager.getRendererWebContents()) {
        webContents.send(IPC_CHANNELS.runtimeSnapshotChanged, snapshot);
      }
    });

    this.#unsubscribeSettings = this.#settingsStore.subscribe((snapshot) => {
      for (const webContents of this.#windowManager.getRendererWebContents()) {
        webContents.send(IPC_CHANNELS.settingsChanged, snapshot);
      }
    });
    this.#unsubscribeSaveDiagnostics =
      this.#gameSaveService.subscribe((snapshot) => {
        for (const webContents of this.#windowManager.getRendererWebContents()) {
          webContents.send(IPC_CHANNELS.saveDiagnosticsChanged, snapshot);
        }
      });
  }

  syncRuntimeSettings(): void {
    this.#syncRuntimeQuietMode(this.#settingsStore.getSnapshot());
  }

  stop(): void {
    if (!this.#isStarted) {
      return;
    }

    this.#isStarted = false;
    this.#unsubscribeRuntime?.();
    this.#unsubscribeRuntime = null;
    this.#unsubscribeSettings?.();
    this.#unsubscribeSettings = null;
    this.#unsubscribeSaveDiagnostics?.();
    this.#unsubscribeSaveDiagnostics = null;

    ipcMain.removeHandler(IPC_CHANNELS.runtimeGetSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.runtimeDispatchCommand);
    ipcMain.removeHandler(IPC_CHANNELS.windowOpenManagement);
    ipcMain.removeHandler(IPC_CHANNELS.desktopSetInteraction);
    ipcMain.removeHandler(IPC_CHANNELS.settingsGetSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.settingsUpdate);
    ipcMain.removeHandler(IPC_CHANNELS.settingsListDisplays);
    ipcMain.removeHandler(IPC_CHANNELS.saveGetDiagnostics);
  }

  #syncRuntimeQuietMode(settings: AppSettingsSnapshot): void {
    const enabled = settings.presentationMode === "quiet";
    if (this.#runtime.getSnapshot().settings.quietMode === enabled) {
      return;
    }

    this.#runtime.dispatch({
      id: `settings-sync-${settings.revision}`,
      type: "settings.set-quiet-mode",
      payload: { enabled },
    });
  }

  #assertTrustedSender(
    event: IpcMainInvokeEvent,
    allowedWindows: readonly AllowedWindow[],
  ): void {
    const senderKind = this.#windowManager.getWindowKindForWebContents(
      event.sender.id,
    );
    const isMainFrame = event.senderFrame === event.sender.mainFrame;

    if (
      senderKind === null ||
      !allowedWindows.includes(senderKind) ||
      !isMainFrame
    ) {
      throw new Error("IPC request rejected: untrusted sender.");
    }
  }
}
