export type WorkspaceChannel = "desktop" | "management";

export interface WorkspaceBridgeInfo {
  readonly channel: WorkspaceChannel;
  readonly version: string;
}

export const IPC_CHANNELS = {
  runtimeGetSnapshot: "runtime:get-snapshot",
  runtimeDispatchCommand: "runtime:dispatch-command",
  runtimeSnapshotChanged: "runtime:snapshot-changed",
  windowOpenManagement: "window:open-management",
  desktopSetInteraction: "desktop:set-interaction",
  desktopCursorPosition: "desktop:cursor-position",
} as const;

export type RuntimePhase = "booting" | "ready";

export interface RuntimeSettingsSnapshot {
  readonly quietMode: boolean;
}

export interface GameSnapshot {
  readonly revision: number;
  readonly phase: RuntimePhase;
  readonly runtimeStartedAtUtcMs: number;
  readonly settings: RuntimeSettingsSnapshot;
}

export interface SetQuietModeCommand {
  readonly id: string;
  readonly type: "settings.set-quiet-mode";
  readonly payload: {
    readonly enabled: boolean;
  };
}

export type GameCommand = SetQuietModeCommand;

export type CommandRejectionCode =
  | "INVALID_COMMAND"
  | "DUPLICATE_COMMAND"
  | "RUNTIME_NOT_READY";

export interface AcceptedCommandResult {
  readonly accepted: true;
  readonly commandId: string;
  readonly snapshot: GameSnapshot;
}

export interface RejectedCommandResult {
  readonly accepted: false;
  readonly commandId: string | null;
  readonly code: CommandRejectionCode;
  readonly message: string;
  readonly snapshot: GameSnapshot;
}

export type CommandResult =
  | AcceptedCommandResult
  | RejectedCommandResult;

export type SnapshotChangedListener = (snapshot: GameSnapshot) => void;

export interface DesktopInteractionRequest {
  readonly interactive: boolean;
  readonly reason: string;
}

export interface DesktopCursorPoint {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}

export type DesktopCursorListener = (point: DesktopCursorPoint) => void;

export interface RuntimeBridge {
  getWorkspaceInfo(): WorkspaceBridgeInfo;
  getSnapshot(): Promise<GameSnapshot>;
  dispatchCommand(command: GameCommand): Promise<CommandResult>;
  onSnapshotChanged(listener: SnapshotChangedListener): () => void;
}

export interface DesktopBridge extends RuntimeBridge {
  openManagement(): Promise<void>;
  setInteraction(request: DesktopInteractionRequest): Promise<void>;
  onCursorPosition(listener: DesktopCursorListener): () => void;
}

export interface ManagementBridge extends RuntimeBridge {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCommandId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128
  );
}

export function getCommandId(value: unknown): string | null {
  if (!isRecord(value) || !isCommandId(value.id)) {
    return null;
  }

  return value.id;
}

export function isGameCommand(value: unknown): value is GameCommand {
  if (
    !isRecord(value) ||
    !isCommandId(value.id) ||
    value.type !== "settings.set-quiet-mode" ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  return typeof value.payload.enabled === "boolean";
}

export function isDesktopInteractionRequest(
  value: unknown,
): value is DesktopInteractionRequest {
  return (
    isRecord(value) &&
    typeof value.interactive === "boolean" &&
    typeof value.reason === "string" &&
    value.reason.length > 0 &&
    value.reason.length <= 64
  );
}
