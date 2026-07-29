import {
  IPC_CHANNELS,
  type CommandResult,
  type GameCommand,
  type GameSnapshot,
  type RuntimeBridge,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { ipcRenderer, type IpcRendererEvent } from "electron";

export function createRuntimeBridge(
  workspaceInfo: WorkspaceBridgeInfo,
): RuntimeBridge {
  return Object.freeze({
    getWorkspaceInfo: (): WorkspaceBridgeInfo => workspaceInfo,
    getSnapshot: (): Promise<GameSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeGetSnapshot),
    dispatchCommand: (command: GameCommand): Promise<CommandResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.runtimeDispatchCommand, command),
    onSnapshotChanged: (
      listener: (snapshot: GameSnapshot) => void,
    ): (() => void) => {
      const wrappedListener = (
        _event: IpcRendererEvent,
        snapshot: GameSnapshot,
      ): void => {
        listener(snapshot);
      };

      ipcRenderer.on(
        IPC_CHANNELS.runtimeSnapshotChanged,
        wrappedListener,
      );

      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.runtimeSnapshotChanged,
          wrappedListener,
        );
      };
    },
  });
}
