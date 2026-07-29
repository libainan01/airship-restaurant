import type { WorkspaceBridgeInfo } from "@airship-restaurant/contracts";

interface WorkspaceBridge {
  getWorkspaceInfo(): WorkspaceBridgeInfo;
}

declare global {
  interface Window {
    airshipDesktop?: WorkspaceBridge;
    airshipManagement?: WorkspaceBridge;
  }
}

export {};
