import {
  IPC_CHANNELS,
  type AppSettingsListener,
  type AppSettingsSnapshot,
  type SettingsReadBridge,
} from "@airship-restaurant/contracts";
import { ipcRenderer, type IpcRendererEvent } from "electron";

export function createSettingsReadBridge(): SettingsReadBridge {
  return {
    getSettings: (): Promise<AppSettingsSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsGetSnapshot),
    onSettingsChanged: (
      listener: AppSettingsListener,
    ): (() => void) => {
      const ipcListener = (
        _event: IpcRendererEvent,
        snapshot: AppSettingsSnapshot,
      ): void => {
        listener(snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.settingsChanged, ipcListener);
      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.settingsChanged,
          ipcListener,
        );
      };
    },
  };
}
