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
  settingsGetSnapshot: "settings:get-snapshot",
  settingsUpdate: "settings:update",
  settingsChanged: "settings:changed",
  settingsListDisplays: "settings:list-displays",
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

export type PresentationMode = "normal" | "quiet" | "reduced";

export interface WindowBoundsDto {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayOption {
  readonly id: string;
  readonly label: string;
  readonly bounds: WindowBoundsDto;
  readonly workArea: WindowBoundsDto;
  readonly scaleFactor: number;
  readonly isPrimary: boolean;
}

export interface AppSettingsSnapshot {
  readonly revision: number;
  readonly onboardingCompleted: boolean;
  readonly targetDisplayId: string;
  readonly alwaysOnTop: boolean;
  readonly presentationMode: PresentationMode;
  readonly uiScale: number;
  readonly managementWindowBounds: WindowBoundsDto | null;
  readonly needsDisplayConfirmation: boolean;
}

export interface AppSettingsUpdate {
  readonly onboardingCompleted?: boolean;
  readonly targetDisplayId?: string;
  readonly alwaysOnTop?: boolean;
  readonly presentationMode?: PresentationMode;
  readonly uiScale?: number;
  readonly managementWindowBounds?: WindowBoundsDto | null;
  readonly needsDisplayConfirmation?: boolean;
}

export type AppSettingsListener = (
  snapshot: AppSettingsSnapshot,
) => void;

export interface SettingsReadBridge {
  getSettings(): Promise<AppSettingsSnapshot>;
  onSettingsChanged(listener: AppSettingsListener): () => void;
}

export interface SettingsWriteBridge extends SettingsReadBridge {
  updateSettings(
    update: AppSettingsUpdate,
  ): Promise<AppSettingsSnapshot>;
  listDisplays(): Promise<readonly DisplayOption[]>;
}

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

export interface DesktopBridge extends RuntimeBridge, SettingsReadBridge {
  openManagement(): Promise<void>;
  setInteraction(request: DesktopInteractionRequest): Promise<void>;
  onCursorPosition(listener: DesktopCursorListener): () => void;
}

export interface ManagementBridge extends RuntimeBridge, SettingsWriteBridge {}

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWindowBounds(value: unknown): value is WindowBoundsDto {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isPresentationMode(value: unknown): value is PresentationMode {
  return (
    value === "normal" ||
    value === "quiet" ||
    value === "reduced"
  );
}

export function isAppSettingsSnapshot(
  value: unknown,
): value is AppSettingsSnapshot {
  return (
    isRecord(value) &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    typeof value.onboardingCompleted === "boolean" &&
    typeof value.targetDisplayId === "string" &&
    value.targetDisplayId.length <= 64 &&
    typeof value.alwaysOnTop === "boolean" &&
    isPresentationMode(value.presentationMode) &&
    isFiniteNumber(value.uiScale) &&
    value.uiScale >= 0.75 &&
    value.uiScale <= 1.5 &&
    (value.managementWindowBounds === null ||
      isWindowBounds(value.managementWindowBounds)) &&
    typeof value.needsDisplayConfirmation === "boolean"
  );
}

export function isAppSettingsUpdate(
  value: unknown,
): value is AppSettingsUpdate {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    "onboardingCompleted",
    "targetDisplayId",
    "alwaysOnTop",
    "presentationMode",
    "uiScale",
    "managementWindowBounds",
    "needsDisplayConfirmation",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  return (
    (value.onboardingCompleted === undefined ||
      typeof value.onboardingCompleted === "boolean") &&
    (value.targetDisplayId === undefined ||
      (typeof value.targetDisplayId === "string" &&
        value.targetDisplayId.length > 0 &&
        value.targetDisplayId.length <= 64)) &&
    (value.alwaysOnTop === undefined ||
      typeof value.alwaysOnTop === "boolean") &&
    (value.presentationMode === undefined ||
      isPresentationMode(value.presentationMode)) &&
    (value.uiScale === undefined ||
      (isFiniteNumber(value.uiScale) &&
        value.uiScale >= 0.75 &&
        value.uiScale <= 1.5)) &&
    (value.managementWindowBounds === undefined ||
      value.managementWindowBounds === null ||
      isWindowBounds(value.managementWindowBounds)) &&
    (value.needsDisplayConfirmation === undefined ||
      typeof value.needsDisplayConfirmation === "boolean")
  );
}
