import {
  IPC_CHANNELS,
  getCommandId,
  isDesktopInteractionRequest,
  isGameCommand,
  type CommandResult,
  type GameSnapshot,
} from "@airship-restaurant/contracts";
import type { GameRuntime } from "@airship-restaurant/core";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { WindowManager } from "./window-manager";

type AllowedWindow = "desktop" | "management";

export class IpcRouter {
  readonly #windowManager: WindowManager;
  readonly #runtime: GameRuntime;
  #unsubscribeRuntime: (() => void) | null = null;
  #isStarted = false;

  constructor(windowManager: WindowManager, runtime: GameRuntime) {
    this.#windowManager = windowManager;
    this.#runtime = runtime;
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
      (event, payload: unknown): CommandResult => {
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

        return this.#runtime.dispatch(payload);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.windowOpenManagement,
      (event): void => {
        this.#assertTrustedSender(event, ["desktop", "management"]);
        this.#windowManager.openManagementWindow();
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

    this.#unsubscribeRuntime = this.#runtime.subscribe((snapshot) => {
      for (const webContents of this.#windowManager.getRendererWebContents()) {
        webContents.send(IPC_CHANNELS.runtimeSnapshotChanged, snapshot);
      }
    });
  }

  stop(): void {
    if (!this.#isStarted) {
      return;
    }

    this.#isStarted = false;
    this.#unsubscribeRuntime?.();
    this.#unsubscribeRuntime = null;

    ipcMain.removeHandler(IPC_CHANNELS.runtimeGetSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.runtimeDispatchCommand);
    ipcMain.removeHandler(IPC_CHANNELS.windowOpenManagement);
    ipcMain.removeHandler(IPC_CHANNELS.desktopSetInteraction);
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
