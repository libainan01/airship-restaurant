import {
  type ManagementBridge,
  type WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { contextBridge } from "electron";
import { createRuntimeBridge } from "./runtime-bridge";

const workspaceInfo: WorkspaceBridgeInfo = Object.freeze({
  channel: "management",
  version: "0.1.0",
});

const managementBridge: ManagementBridge = Object.freeze({
  ...createRuntimeBridge(workspaceInfo),
});

contextBridge.exposeInMainWorld(
  "airshipManagement",
  managementBridge,
);
