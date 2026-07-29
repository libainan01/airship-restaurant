import { contextBridge } from "electron";
import type { WorkspaceBridgeInfo } from "@airship-restaurant/contracts";

const workspaceInfo: WorkspaceBridgeInfo = Object.freeze({
  channel: "desktop",
  version: "0.1.0",
});

contextBridge.exposeInMainWorld("airshipDesktop", {
  getWorkspaceInfo: (): WorkspaceBridgeInfo => workspaceInfo,
});
