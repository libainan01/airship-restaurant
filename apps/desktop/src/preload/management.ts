import {
  IPC_CHANNELS,
  type AppSettingsSnapshot,
  type AppSettingsUpdate,
  type DisplayOption,
  type ManagementBridge,
  type ManagementNavigationListener,
  type ManagementSection,
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

const navigationListeners = new Set<ManagementNavigationListener>();
let pendingNavigation: ManagementSection | null = null;

ipcRenderer.on(
  IPC_CHANNELS.managementNavigate,
  (_event: IpcRendererEvent, section: ManagementSection): void => {
    if (navigationListeners.size === 0) {
      pendingNavigation = section;
      return;
    }
    pendingNavigation = null;
    for (const listener of navigationListeners) listener(section);
  },
);

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
  onNavigationRequested: (
    listener: ManagementNavigationListener,
  ): (() => void) => {
    navigationListeners.add(listener);
    if (pendingNavigation !== null) {
      const section = pendingNavigation;
      pendingNavigation = null;
      listener(section);
    }
    return () => {
      navigationListeners.delete(listener);
    };
  },
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
