import {
  IPC_CHANNELS,
  type AppSettingsSnapshot,
  type AppSettingsUpdate,
  type DisplayOption,
  type ManagementBridge,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { contextBridge, ipcRenderer } from "electron";
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
});

contextBridge.exposeInMainWorld(
  "airshipManagement",
  managementBridge,
);
