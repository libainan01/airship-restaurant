import {
  IPC_CHANNELS,
  type CommandResult,
  type GameCommand,
  type RuntimeReadModelChangedListener,
  type RuntimeReadModelKey,
  type RuntimeReadModelSlice,
  type RuntimeBridge,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { ipcRenderer, type IpcRendererEvent } from "electron";

export function createRuntimeBridge(
  workspaceInfo: WorkspaceBridgeInfo,
): RuntimeBridge {
  return Object.freeze({
    getWorkspaceInfo: (): WorkspaceBridgeInfo => workspaceInfo,
    getReadModel: (
      key: RuntimeReadModelKey,
    ): Promise<RuntimeReadModelSlice> =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeGetReadModel, key),
    dispatchCommand: (command: GameCommand): Promise<CommandResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeDispatchCommand, command),
    onReadModelChanged: (
      key: RuntimeReadModelKey,
      listener: RuntimeReadModelChangedListener,
    ): (() => void) => {
      const wrappedListener = (
        _event: IpcRendererEvent,
        slice: RuntimeReadModelSlice,
      ): void => {
        if (slice.key === key) listener(slice);
      };
      let active = true;
      ipcRenderer.on(IPC_CHANNELS.runtimeReadModelChanged, wrappedListener);
      void ipcRenderer
        .invoke(IPC_CHANNELS.runtimeSubscribeReadModel, key)
        .then((slice: RuntimeReadModelSlice) => {
          if (active && slice.key === key) listener(slice);
        })
        .catch(() => undefined);
      return () => {
        active = false;
        ipcRenderer.removeListener(
          IPC_CHANNELS.runtimeReadModelChanged,
          wrappedListener,
        );
        void ipcRenderer
          .invoke(IPC_CHANNELS.runtimeUnsubscribeReadModel, key)
          .catch(() => undefined);
      };
    },
  });
}
