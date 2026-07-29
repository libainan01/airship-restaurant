import type {
  DesktopBridge,
  ManagementBridge,
} from "@airship-restaurant/contracts";

declare global {
  interface Window {
    airshipDesktop?: DesktopBridge;
    airshipManagement?: ManagementBridge;
  }
}

export {};
