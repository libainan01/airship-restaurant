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
  saveGetDiagnostics: "save:get-diagnostics",
  saveDiagnosticsChanged: "save:diagnostics-changed",
} as const;

export type RuntimePhase = "booting" | "ready";

export interface RuntimeSettingsSnapshot {
  readonly quietMode: boolean;
}

export interface GameplayInventoryEntrySnapshot {
  readonly itemId: string;
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}

export interface GameplayInventoryContainerSnapshot {
  readonly id: string;
  readonly capacity: number;
  readonly totalQuantity: number;
  readonly availableCapacity: number;
  readonly entries: readonly GameplayInventoryEntrySnapshot[];
}

export interface GameplayCookingJobSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly status: "cooking" | "waiting-output";
  readonly startedAtUtcMs: number;
  readonly finishAtUtcMs: number;
}

export interface GameplayCookingSnapshot {
  readonly selectedRecipeId: string | null;
  readonly autoRepeat: boolean;
  readonly activeJob: GameplayCookingJobSnapshot | null;
  readonly blockedReason:
    | "insufficient-ingredients"
    | "output-capacity"
    | null;
  readonly completedBatches: number;
  readonly nextTransitionUtcMs: number | null;
}

export interface GameplayLogisticsSnapshot {
  readonly phase:
    | "idle"
    | "outbound"
    | "waiting-unload"
    | "returning";
  readonly shipmentId: string | null;
  readonly departedAtUtcMs: number | null;
  readonly arriveAtUtcMs: number | null;
  readonly returnStartedAtUtcMs: number | null;
  readonly returnAtUtcMs: number | null;
  readonly kitchenWaitingSinceUtcMs: number | null;
  readonly kitchenWaitingQuantity: number;
  readonly cargoQuantity: number;
  readonly totalDeliveredQuantity: number;
  readonly nextTransitionUtcMs: number | null;
}

export interface GameplayRestaurantCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly arrivedAtUtcMs: number;
  readonly leaveAtUtcMs: number;
}

export interface GameplayRestaurantSaleSnapshot {
  readonly customerId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly quantity: 1;
  readonly copperEarned: number;
  readonly soldAtUtcMs: number;
}

export interface GameplayRestaurantSnapshot {
  readonly selectedRecipeId: string | null;
  readonly activeCustomer: GameplayRestaurantCustomerSnapshot | null;
  readonly nextCustomerAtUtcMs: number | null;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
  readonly soldByDish: readonly {
    readonly dishItemId: string;
    readonly quantity: number;
  }[];
  readonly recentSales: readonly GameplayRestaurantSaleSnapshot[];
  readonly nextTransitionUtcMs: number | null;
}

export interface GameplaySnapshot {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly inventory: {
    readonly kitchenIngredients: GameplayInventoryContainerSnapshot;
    readonly kitchenOutput: GameplayInventoryContainerSnapshot;
    readonly cableCargo: GameplayInventoryContainerSnapshot;
    readonly restaurantStorage: GameplayInventoryContainerSnapshot;
  };
  readonly cooking: GameplayCookingSnapshot;
  readonly logistics: GameplayLogisticsSnapshot;
  readonly restaurant: GameplayRestaurantSnapshot;
}

export interface OfflineEarningsSummary {
  readonly elapsedMs: number;
  readonly supplyBoxesReceived: number;
  readonly cookingBatchesCompleted: number;
  readonly deliveredQuantity: number;
  readonly soldQuantity: number;
  readonly customersLeft: number;
  readonly copperEarned: number;
}

export interface NarrativeConditionProgressSnapshot {
  readonly type: "online-dish-sales";
  readonly current: number;
  readonly required: number;
}

export interface NarrativeEventSnapshot {
  readonly eventId: string;
  readonly status: "locked" | "available" | "completed";
  readonly unread: boolean;
  readonly unlockedAtUtcMs: number | null;
  readonly viewedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
  readonly conditions: readonly NarrativeConditionProgressSnapshot[];
}

export interface NarrativeSnapshot {
  readonly revision: number;
  readonly availableEventIds: readonly string[];
  readonly unreadEventIds: readonly string[];
  readonly events: readonly NarrativeEventSnapshot[];
}

export interface GameSnapshot {
  readonly revision: number;
  readonly phase: RuntimePhase;
  readonly runtimeStartedAtUtcMs: number;
  readonly settings: RuntimeSettingsSnapshot;
  readonly gameplay: GameplaySnapshot | null;
  readonly narrative: NarrativeSnapshot | null;
  readonly offlineEarnings: OfflineEarningsSummary | null;
}

export interface SetQuietModeCommand {
  readonly id: string;
  readonly type: "settings.set-quiet-mode";
  readonly payload: {
    readonly enabled: boolean;
  };
}

export interface SelectGameplayRecipeCommand {
  readonly id: string;
  readonly type: "gameplay.select-recipe";
  readonly payload: {
    readonly recipeId: string;
  };
}

export interface SetGameplayAutoRepeatCommand {
  readonly id: string;
  readonly type: "gameplay.set-auto-repeat";
  readonly payload: {
    readonly enabled: boolean;
  };
}

export interface MarkNarrativeViewedCommand {
  readonly id: string;
  readonly type: "narrative.mark-viewed";
  readonly payload: {
    readonly eventId: string;
  };
}

export interface CompleteNarrativeEventCommand {
  readonly id: string;
  readonly type: "narrative.complete";
  readonly payload: {
    readonly eventId: string;
  };
}

export type GameCommand =
  | SetQuietModeCommand
  | SelectGameplayRecipeCommand
  | SetGameplayAutoRepeatCommand
  | MarkNarrativeViewedCommand
  | CompleteNarrativeEventCommand;

export type CommandRejectionCode =
  | "INVALID_COMMAND"
  | "DUPLICATE_COMMAND"
  | "RUNTIME_NOT_READY"
  | "GAMEPLAY_REJECTED"
  | "NARRATIVE_REJECTED";

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


export type SaveLoadSource =
  | "loading"
  | "new"
  | "primary"
  | "backup"
  | "reset-corrupt";

export interface SaveDiagnosticsSnapshot {
  readonly revision: number;
  readonly status: "loading" | "ready" | "saving" | "error";
  readonly loadSource: SaveLoadSource;
  readonly lastSavedAtUtcMs: number | null;
  readonly lastError: string | null;
  readonly fileName: "save.json";
  readonly backupFileName: "save.json.bak";
}

export type SaveDiagnosticsListener = (
  snapshot: SaveDiagnosticsSnapshot,
) => void;

export interface SaveDiagnosticsBridge {
  getSaveDiagnostics(): Promise<SaveDiagnosticsSnapshot>;
  onSaveDiagnosticsChanged(
    listener: SaveDiagnosticsListener,
  ): () => void;
}

export interface ManagementBridge
  extends RuntimeBridge,
    SettingsWriteBridge,
    SaveDiagnosticsBridge {}

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
    !isRecord(value.payload)
  ) {
    return false;
  }

  switch (value.type) {
    case "settings.set-quiet-mode":
    case "gameplay.set-auto-repeat":
      return typeof value.payload.enabled === "boolean";
    case "gameplay.select-recipe":
      return (
        typeof value.payload.recipeId === "string" &&
        value.payload.recipeId.length > 0 &&
        value.payload.recipeId.length <= 128
      );
    case "narrative.mark-viewed":
    case "narrative.complete":
      return isCommandId(value.payload.eventId);
    default:
      return false;
  }
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
