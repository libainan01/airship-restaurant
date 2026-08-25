import {
  IPC_CHANNELS,
  type DesktopBridge,
  type DesktopCursorListener,
  type DesktopCursorPoint,
  type DesktopInteractionRequest,
  type ManagementOpenRequest,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { createRuntimeBridge } from "./runtime-bridge";
import { createSettingsReadBridge } from "./settings-bridge";

const workspaceInfo: WorkspaceBridgeInfo = Object.freeze({
  channel: "desktop",
  version: "0.1.0",
});

const desktopBridge: DesktopBridge = Object.freeze({
  ...createRuntimeBridge(workspaceInfo),
  ...createSettingsReadBridge(),
  openManagement: (request: ManagementOpenRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.windowOpenManagement, request),
  setInteraction: (
    request: DesktopInteractionRequest,
  ): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopSetInteraction, request),
  onCursorPosition: (
    listener: DesktopCursorListener,
  ): (() => void) => {
    const ipcListener = (
      _event: IpcRendererEvent,
      point: DesktopCursorPoint,
    ): void => {
      listener(point);
    };
    ipcRenderer.on(IPC_CHANNELS.desktopCursorPosition, ipcListener);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.desktopCursorPosition,
        ipcListener,
      );
    };
  },
});

contextBridge.exposeInMainWorld("airshipDesktop", desktopBridge);
