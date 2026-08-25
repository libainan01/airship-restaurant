import type {
  AppSettingsSnapshot,
  DisplayOption,
  RuntimeReadModelKey,
  RuntimeReadModelSlice,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";

export type ManagementHydrationSource =
  | "settings"
  | "displays"
  | "inventory"
  | "instance-upgrades"
  | "recruitment"
  | "progression"
  | "operations"
  | "procurement"
  | "finance"
  | "save-diagnostics";

export interface ManagementHydrationBridge {
  getSettings(): Promise<AppSettingsSnapshot>;
  listDisplays(): Promise<readonly DisplayOption[]>;
  getReadModel(key: RuntimeReadModelKey): Promise<RuntimeReadModelSlice>;
  getSaveDiagnostics(): Promise<SaveDiagnosticsSnapshot>;
}

export interface ManagementHydrationHandlers {
  readonly onSettings: (settings: AppSettingsSnapshot) => void;
  readonly onDisplays: (displays: readonly DisplayOption[]) => void;
  readonly onReadModel: (slice: RuntimeReadModelSlice) => void;
  readonly onSaveDiagnostics: (
    diagnostics: SaveDiagnosticsSnapshot,
  ) => void;
  readonly onError: (
    source: ManagementHydrationSource,
    error: unknown,
  ) => void;
}

export async function hydrateManagementRuntime(
  bridge: ManagementHydrationBridge,
  handlers: ManagementHydrationHandlers,
): Promise<void> {
  const settle = async <T>(
    source: ManagementHydrationSource,
    request: Promise<T>,
    accept: (value: T) => void,
  ): Promise<void> => {
    try {
      accept(await request);
    } catch (error: unknown) {
      handlers.onError(source, error);
    }
  };

  const readModels = [
    "inventory",
    "instance-upgrades",
    "recruitment",
    "progression",
    "operations",
    "procurement",
    "finance",
  ] as const;
  await Promise.all([
    settle("settings", bridge.getSettings(), handlers.onSettings),
    settle("displays", bridge.listDisplays(), handlers.onDisplays),
    ...readModels.map((key) =>
      settle(key, bridge.getReadModel(key), handlers.onReadModel)
    ),
    settle(
      "save-diagnostics",
      bridge.getSaveDiagnostics(),
      handlers.onSaveDiagnostics,
    ),
  ]);
}