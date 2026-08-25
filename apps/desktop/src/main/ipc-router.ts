import {
  IPC_CHANNELS,
  getCommandId,
  isAppSettingsUpdate,
  isDesktopInteractionRequest,
  isGameCommand,
  isManagementOpenRequest,
  isRuntimeReadModelKey,
  type AppSettingsSnapshot,
  type CommandResult,
  type GameCommand,
  type SaveDiagnosticsSnapshot,
  type RuntimeReadModelKey,
  type RuntimeReadModelSlice,
} from "@airship-restaurant/contracts";
import type { RuntimeReadModelPort } from "@airship-restaurant/core";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DisplayService } from "./display-service";
import type { GameSaveService } from "./game-save-service";
import type { SettingsStore } from "./settings-store";
import type { WindowManager } from "./window-manager";

type AllowedWindow = "desktop" | "management";

interface RuntimeIpcPort extends RuntimeReadModelPort {
  dispatch(command: GameCommand): CommandResult;
}

export class IpcRouter {
  readonly #windowManager: WindowManager;
  readonly #runtime: RuntimeIpcPort;
  readonly #settingsStore: SettingsStore;
  readonly #displayService: DisplayService;
  readonly #gameSaveService: GameSaveService;
  #unsubscribeSaveDiagnostics: (() => void) | null = null;
  readonly #unsubscribeReadModels: (() => void)[] = [];
  readonly #readModelSubscriptionCounts = new Map<
    number,
    Map<RuntimeReadModelKey, number>
  >();
  #unsubscribeSettings: (() => void) | null = null;
  #isStarted = false;

  constructor(
    windowManager: WindowManager,
    runtime: RuntimeIpcPort,
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
      IPC_CHANNELS.runtimeGetReadModel,
      (event, key: unknown): RuntimeReadModelSlice => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        if (!isRuntimeReadModelKey(key)) {
          throw new Error("Unknown runtime read model key.");
        }
        return this.#runtime.get(key);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.runtimeSubscribeReadModel,
      (event, key: unknown): RuntimeReadModelSlice => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        if (!isRuntimeReadModelKey(key)) {
          throw new Error("Unknown runtime read model key.");
        }
        const counts = this.#readModelSubscriptionCounts.get(event.sender.id) ??
          new Map<RuntimeReadModelKey, number>();
        counts.set(key, (counts.get(key) ?? 0) + 1);
        this.#readModelSubscriptionCounts.set(event.sender.id, counts);
        return this.#runtime.get(key);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.runtimeUnsubscribeReadModel,
      (event, key: unknown): void => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        if (!isRuntimeReadModelKey(key)) {
          throw new Error("Unknown runtime read model key.");
        }
        const counts = this.#readModelSubscriptionCounts.get(event.sender.id);
        const count = counts?.get(key) ?? 0;
        if (counts === undefined || count === 0) return;
        if (count === 1) counts.delete(key);
        else counts.set(key, count - 1);
        if (counts.size === 0) {
          this.#readModelSubscriptionCounts.delete(event.sender.id);
        }
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

    ipcMain.handle(
      IPC_CHANNELS.windowOpenManagement,
      (event, payload: unknown): void => {
        this.#assertTrustedSender(event, ["desktop"]);
        if (!isManagementOpenRequest(payload)) {
          throw new Error("Invalid management navigation request.");
        }
        this.#windowManager.openManagementWindow(payload.section);
      },
    );

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

    const readModelKeys: readonly RuntimeReadModelKey[] = [
      "layout",
      "inventory",
      "characters",
      "instance-upgrades",
      "recruitment",
      "progression",
      "desktop-world",
      "operations",
      "procurement",
      "finance",
    ];
    for (const key of readModelKeys) {
      this.#unsubscribeReadModels.push(
        this.#runtime.subscribe(key, (slice) => {
          this.#broadcastReadModel(slice);
        }),
      );
    }
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
    for (const unsubscribe of this.#unsubscribeReadModels.splice(0)) {
      unsubscribe();
    }
    this.#readModelSubscriptionCounts.clear();
    this.#unsubscribeSettings?.();
    this.#unsubscribeSettings = null;
    this.#unsubscribeSaveDiagnostics?.();
    this.#unsubscribeSaveDiagnostics = null;

    ipcMain.removeHandler(IPC_CHANNELS.runtimeGetReadModel);
    ipcMain.removeHandler(IPC_CHANNELS.runtimeSubscribeReadModel);
    ipcMain.removeHandler(IPC_CHANNELS.runtimeUnsubscribeReadModel);
    ipcMain.removeHandler(IPC_CHANNELS.runtimeDispatchCommand);
    ipcMain.removeHandler(IPC_CHANNELS.windowOpenManagement);
    ipcMain.removeHandler(IPC_CHANNELS.desktopSetInteraction);
    ipcMain.removeHandler(IPC_CHANNELS.settingsGetSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.settingsUpdate);
    ipcMain.removeHandler(IPC_CHANNELS.settingsListDisplays);
    ipcMain.removeHandler(IPC_CHANNELS.saveGetDiagnostics);
  }

  #broadcastReadModel(slice: RuntimeReadModelSlice): void {
    for (const webContents of this.#windowManager.getRendererWebContents()) {
      const count = this.#readModelSubscriptionCounts
        .get(webContents.id)
        ?.get(slice.key) ?? 0;
      if (count > 0) {
        webContents.send(IPC_CHANNELS.runtimeReadModelChanged, slice);
      }
    }
  }
  #syncRuntimeQuietMode(settings: AppSettingsSnapshot): void {
    this.#runtime.dispatch({
      id: `settings-sync-${settings.revision}`,
      type: "settings.set-quiet-mode",
      payload: { enabled: settings.presentationMode === "quiet" },
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
