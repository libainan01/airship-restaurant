export type WorkspaceChannel = "desktop" | "management";

export interface WorkspaceBridgeInfo {
  readonly channel: WorkspaceChannel;
  readonly version: string;
}
