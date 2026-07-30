import {
  IPC_CHANNELS,
  type AppSettingsSnapshot,
  type AppSettingsUpdate,
  type DisplayOption,
  type ManagementBridge,
  type SaveDiagnosticsSnapshot,
  type SaveDiagnosticsListener,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { createRuntimeBridge } from "./runtime-bridge";
import { createSettingsReadBridge } from "./settings-bridge";

const workspaceInfo: WorkspaceBridgeInfo = Object.freeze({
  channel: "management",
  version: "0.1.0",
});

const managementBridge: ManagementBridge = Object.freeze({
  ...createRuntimeBridge(workspaceInfo),
  ...createSettingsReadBridge(),
  updateSettings: (
    update: AppSettingsUpdate,
  ): Promise<AppSettingsSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, update),
  listDisplays: (): Promise<readonly DisplayOption[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsListDisplays),
  getSaveDiagnostics: (): Promise<SaveDiagnosticsSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveGetDiagnostics),
  onSaveDiagnosticsChanged: (
    listener: SaveDiagnosticsListener,
  ) => {
    const wrappedListener = (
      _event: IpcRendererEvent,
      snapshot: SaveDiagnosticsSnapshot,
    ): void => {
      listener(snapshot);
    };
    ipcRenderer.on(
      IPC_CHANNELS.saveDiagnosticsChanged,
      wrappedListener,
    );
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.saveDiagnosticsChanged,
        wrappedListener,
      );
    };
  },
});

contextBridge.exposeInMainWorld(
  "airshipManagement",
  managementBridge,
);
