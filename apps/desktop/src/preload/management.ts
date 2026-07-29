import { contextBridge } from "electron";
import type { WorkspaceBridgeInfo } from "@airship-restaurant/contracts";

const workspaceInfo: WorkspaceBridgeInfo = Object.freeze({
  channel: "management",
  version: "0.1.0",
});

contextBridge.exposeInMainWorld("airshipManagement", {
  getWorkspaceInfo: (): WorkspaceBridgeInfo => workspaceInfo,
});
