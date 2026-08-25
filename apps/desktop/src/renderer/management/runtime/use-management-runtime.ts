import type {
  AppSettingsSnapshot,
  AppSettingsUpdate,
  DisplayOption,
  FinanceReadModel,
  GameCommand,
  InstanceUpgradesReadModel,
  InventoryReadModel,
  OperationsReadModel,
  ProcurementReadModel,
  ProgressionReadModel,
  RecruitmentReadModel,
  RuntimeReadModelSlice,
  SaveDiagnosticsSnapshot,
  WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createManagementGameplayActions,
  type ManagementGameplayActions,
} from "./management-gameplay-actions";
import { selectLatestRevision } from "../../shared/latest-revision";
import {
  ManagementOperationCoordinator,
  resolveManagementPendingState,
} from "./management-operation-coordinator";
import { hydrateManagementRuntime } from "./management-runtime-hydration";

export interface ManagementRuntimeState {
  readonly workspaceInfo: WorkspaceBridgeInfo | null;
  readonly settings: AppSettingsSnapshot | null;
  readonly inventoryReadModel: InventoryReadModel | null;
  readonly instanceUpgradesReadModel: InstanceUpgradesReadModel | null;
  readonly recruitmentReadModel: RecruitmentReadModel | null;
  readonly progressionReadModel: ProgressionReadModel | null;
  readonly operationsReadModel: OperationsReadModel | null;
  readonly procurementReadModel: ProcurementReadModel | null;
  readonly financeReadModel: FinanceReadModel | null;
  readonly displays: readonly DisplayOption[];
  readonly saveDiagnostics: SaveDiagnosticsSnapshot | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly settingsPending: boolean;
  readonly gameplayPending: boolean;
  readonly updateSettings: (update: AppSettingsUpdate) => Promise<void>;
  readonly actions: ManagementGameplayActions;
}

const MANAGEMENT_READ_MODEL_KEYS = [
  "inventory",
  "instance-upgrades",
  "recruitment",
  "progression",
  "operations",
  "procurement",
  "finance",
] as const;

export function useManagementRuntime(): ManagementRuntimeState {
  const workspaceInfo =
    window.airshipManagement?.getWorkspaceInfo() ?? null;
  const [settings, setSettings] =
    useState<AppSettingsSnapshot | null>(null);
  const [inventorySlice, setInventorySlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [instanceUpgradesSlice, setInstanceUpgradesSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [recruitmentSlice, setRecruitmentSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [progressionSlice, setProgressionSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [operationsSlice, setOperationsSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [procurementSlice, setProcurementSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [financeSlice, setFinanceSlice] =
    useState<RuntimeReadModelSlice | null>(null);
  const [displays, setDisplays] =
    useState<readonly DisplayOption[]>([]);
  const [saveDiagnostics, setSaveDiagnostics] =
    useState<SaveDiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsPendingCount, setSettingsPendingCount] = useState(0);
  const [gameplayPendingCount, setGameplayPendingCount] = useState(0);
  const operationCoordinator = useRef(
    new ManagementOperationCoordinator(),
  );

  const acceptReadModel = useCallback((slice: RuntimeReadModelSlice): void => {
    switch (slice.key) {
      case "inventory":
        setInventorySlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "instance-upgrades":
        setInstanceUpgradesSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "recruitment":
        setRecruitmentSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "progression":
        setProgressionSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "operations":
        setOperationsSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "procurement":
        setProcurementSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      case "finance":
        setFinanceSlice((current) =>
          selectLatestRevision(current, slice));
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) return;

    let mounted = true;
    const hydrationOperationId =
      operationCoordinator.current.latestOperationId;
    const unsubscribeSettings = bridge.onSettingsChanged((nextSettings) => {
      if (mounted) {
        setSettings((current) =>
          selectLatestRevision(current, nextSettings));
      }
    });
    const unsubscribeReadModels = MANAGEMENT_READ_MODEL_KEYS.map((key) =>
      bridge.onReadModelChanged(key, (slice) => {
        if (mounted) acceptReadModel(slice);
      })
    );
    const unsubscribeSaveDiagnostics =
      bridge.onSaveDiagnosticsChanged((diagnostics) => {
        if (mounted) {
          setSaveDiagnostics((current) =>
            selectLatestRevision(current, diagnostics));
        }
      });

    void hydrateManagementRuntime(bridge, {
      onSettings(nextSettings) {
        if (!mounted) return;
        setSettings((current) =>
          selectLatestRevision(current, nextSettings));
      },
      onDisplays(nextDisplays) {
        if (mounted) setDisplays(nextDisplays);
      },
      onReadModel(slice) {
        if (mounted) acceptReadModel(slice);
      },
      onSaveDiagnostics(nextSaveDiagnostics) {
        if (!mounted) return;
        setSaveDiagnostics((current) =>
          selectLatestRevision(current, nextSaveDiagnostics));
      },
      onError(source, cause) {
        console.error("Unable to load management " + source + ".", cause);
        if (
          mounted &&
          operationCoordinator.current.isLatest(hydrationOperationId)
        ) {
          setError("部分经营数据读取失败，请稍后重试或重新打开管理窗口。");
        }
      },
    });

    return () => {
      mounted = false;
      unsubscribeSettings();
      for (const unsubscribe of unsubscribeReadModels) unsubscribe();
      unsubscribeSaveDiagnostics();
    };
  }, [acceptReadModel]);

  const updateSettings = useCallback(async (
    update: AppSettingsUpdate,
  ): Promise<void> => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      setError("浏览器预览模式不能保存原生窗口设置。");
      return;
    }

    const operationId = operationCoordinator.current.begin();
    setSettingsPendingCount((count) => count + 1);
    setError(null);
    try {
      const nextSettings = await bridge.updateSettings(update);
      setSettings((current) =>
        selectLatestRevision(current, nextSettings));
    } catch (cause: unknown) {
      console.error("Unable to update application settings.", cause);
      if (operationCoordinator.current.isLatest(operationId)) {
        setError("设置未能保存；显示器可能已断开，请重试。");
      }
      try {
        setDisplays(await bridge.listDisplays());
        const nextSettings = await bridge.getSettings();
        setSettings((current) =>
          selectLatestRevision(current, nextSettings));
      } catch {
        // Keep the first, more useful error message.
      }
    } finally {
      setSettingsPendingCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const dispatchCommand = useCallback(async (
    command: GameCommand,
  ): Promise<boolean> => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      setError("浏览器预览模式不能更改经营设置。");
      return false;
    }

    const operationId = operationCoordinator.current.begin();
    setGameplayPendingCount((count) => count + 1);
    setError(null);
    try {
      const result = await bridge.dispatchCommand(command);
      if (!result.accepted) {
        if (operationCoordinator.current.isLatest(operationId)) {
          setError("操作未能完成：" + result.message);
        }
      }
      return result.accepted;
    } catch (cause: unknown) {
      console.error("Unable to dispatch runtime command.", cause);
      if (operationCoordinator.current.isLatest(operationId)) {
        setError("操作未能完成，请重试。");
      }
      try {
        const slices = await Promise.all(
          MANAGEMENT_READ_MODEL_KEYS.map((key) => bridge.getReadModel(key)),
        );
        for (const slice of slices) acceptReadModel(slice);
      } catch {
        // Preserve the operation error when refresh also fails.
      }
      return false;
    } finally {
      setGameplayPendingCount((count) => Math.max(0, count - 1));
    }
  }, [acceptReadModel]);

  const actions = useMemo(
    () => createManagementGameplayActions(dispatchCommand),
    [dispatchCommand],
  );

  const pendingState = resolveManagementPendingState(
    settingsPendingCount,
    gameplayPendingCount,
  );
  return {
    workspaceInfo,
    settings,
    inventoryReadModel:
      inventorySlice?.key === "inventory"
        ? inventorySlice.value
        : null,
    instanceUpgradesReadModel:
      instanceUpgradesSlice?.key === "instance-upgrades"
        ? instanceUpgradesSlice.value
        : null,
    recruitmentReadModel:
      recruitmentSlice?.key === "recruitment"
        ? recruitmentSlice.value
        : null,
    progressionReadModel:
      progressionSlice?.key === "progression"
        ? progressionSlice.value
        : null,
    operationsReadModel:
      operationsSlice?.key === "operations"
        ? operationsSlice.value
        : null,
    procurementReadModel:
      procurementSlice?.key === "procurement"
        ? procurementSlice.value
        : null,
    financeReadModel:
      financeSlice?.key === "finance"
        ? financeSlice.value
        : null,
    displays,
    saveDiagnostics,
    error,
    ...pendingState,
    updateSettings,
    actions,
  };
}