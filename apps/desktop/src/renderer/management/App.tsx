import type {
  ManagementSection,
  PresentationMode,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import { useCallback, useEffect, useState } from "react";
import { FocusSessionPanel } from "./features/focus/FocusSessionPanel";
import { OperationsPanel } from "./features/operations/OperationsPanel";
import { RecipeBookDialog } from "./features/library/RecipeBookDialog";
import { WarehouseDialog } from "./features/library/WarehouseDialog";
import { ProgressionDialog } from "./features/progression/ProgressionDialog";
import { ProcurementDialog } from "./features/procurement/ProcurementDialog";
import { RecruitmentDialog } from "./features/recruitment/RecruitmentDialog";
import { StoryPanels } from "./features/story/StoryPanels";
import { InstanceUpgradesDialog } from "./features/upgrades/InstanceUpgradesDialog";
import { TechnologyTreeDialog } from "./features/upgrades/TechnologyTreeDialog";
import { useManagementRuntime } from "./runtime/use-management-runtime";

const PRESENTATION_OPTIONS: readonly {
  readonly value: PresentationMode;
  readonly title: string;
  readonly description: string;
}[] = [
  {
    value: "normal",
    title: "正常",
    description: "完整动画与环境气氛。",
  },
  {
    value: "reduced",
    title: "低动态",
    description: "保留陪伴感，降低运动频率。",
  },
  {
    value: "quiet",
    title: "安静",
    description: "环境层休眠，主体仅低频运转。",
  },
];

function getSaveStatusText(
  diagnostics: SaveDiagnosticsSnapshot | null,
): string {
  switch (diagnostics?.status) {
    case "ready":
      return "存档正常";
    case "saving":
      return "正在写入";
    case "error":
      return "存档异常";
    case "loading":
    case undefined:
      return "正在读取";
  }
}

function getSaveSourceText(
  diagnostics: SaveDiagnosticsSnapshot | null,
): string {
  switch (diagnostics?.loadSource) {
    case "new":
      return "本次建立新存档";
    case "primary":
      return "从主存档恢复";
    case "backup":
      return "主存档异常，已从备份恢复";
    case "reset-corrupt":
      return "存档与备份均异常，已建立新进度";
    case "loading":
    case undefined:
      return "正在确认存档来源";
  }
}

function getSaveMigrationText(
  diagnostics: SaveDiagnosticsSnapshot | null,
): string {
  switch (diagnostics?.migrationStatus) {
    case "not-needed":
      return "当前版本，无需迁移";
    case "migrated-primary":
      return "旧版主存档已安全迁移";
    case "recovered-backup":
      return "已恢复当前版本备份";
    case "recovered-backup-and-migrated":
      return "旧版备份已恢复并迁移";
    case "reset-corrupt":
      return "原档未改写，已建立新进度";
    case "pending":
    case undefined:
      return "正在检查存档版本";
  }
}

function formatSavedAt(utcMs: number | null): string {
  if (utcMs === null) {
    return "尚未完成首次写入";
  }
  return new Date(utcMs).toLocaleString("zh-CN", { hour12: false });
}

type ManagementPage = ManagementSection | "settings";

const MANAGEMENT_NAVIGATION: readonly {
  readonly section: Exclude<ManagementSection, "overview">;
  readonly label: string;
  readonly group: "经营" | "人员与故事" | "发展";
}[] = [
  { section: "inventory", label: "仓库", group: "经营" },
  { section: "recipes", label: "食谱", group: "经营" },
  { section: "procurement", label: "采购", group: "经营" },
  { section: "finance", label: "经营账本", group: "经营" },
  { section: "staff", label: "员工", group: "人员与故事" },
  { section: "roster", label: "花名册", group: "人员与故事" },
  { section: "instance-upgrades", label: "场景布置", group: "发展" },
  { section: "technology", label: "科技树", group: "发展" },
];

const PAGE_LABELS: Readonly<Record<ManagementPage, string>> = {
  overview: "经营总览",
  inventory: "仓库",
  recipes: "食谱",
  procurement: "采购",
  finance: "经营账本",
  staff: "员工",
  roster: "花名册",
  "instance-upgrades": "场景布置",
  technology: "科技树",
  settings: "系统设置",
};

export function App(): React.JSX.Element {
  const {
    workspaceInfo,
    settings,
    operationsReadModel,
    procurementReadModel,
    financeReadModel,
    inventoryReadModel,
    instanceUpgradesReadModel,
    recruitmentReadModel,
    progressionReadModel,
    displays,
    saveDiagnostics,
    error,
    pending,
    settingsPending,
    gameplayPending,
    updateSettings,
    actions,
  } = useManagementRuntime();
  const [activePage, setActivePage] = useState<ManagementPage>("overview");
  const [technologyView, setTechnologyView] = useState<"tree" | "compendium">("tree");

  const handleNavigationRequest = useCallback(
    (section: ManagementSection): void => {
      setActivePage(section);
    },
    [],
  );

  useEffect(() => {
    return window.airshipManagement?.onNavigationRequested(
      handleNavigationRequest,
    );
  }, [handleNavigationRequest]);

  const finishOnboarding = (): void => {
    void updateSettings({
      onboardingCompleted: true,
      needsDisplayConfirmation: false,
    });
  };

  if (settings === null) {
    return (
      <main className="management-shell management-shell--loading">
        {error === null ? <p>正在连接空艇餐厅主进程…</p> : <p role="alert">{error}</p>}
      </main>
    );
  }

  const requiresConfirmation =
    !settings.onboardingCompleted || settings.needsDisplayConfirmation;
  const balance = financeReadModel?.availableCopper ?? 0;

  const renderSettings = (): React.JSX.Element => (
    <div className="management-settings-page">
      <section className="settings-card" aria-label="桌面显示设置">
        <div className="setting-row">
          <div><h2>目标显示器</h2><p>飞艇、餐厅和缆车会共同出现在这一块屏幕。</p></div>
          <select
            aria-label="目标显示器"
            value={settings.targetDisplayId}
            onChange={(event) => {
              void updateSettings({
                targetDisplayId: event.currentTarget.value,
                needsDisplayConfirmation: false,
              });
            }}
          >
            {displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.label}{display.isPrimary ? "（主显示器）" : ""}
                {" · "}{display.workArea.width}×{display.workArea.height}
                {" · "}{Math.round(display.scaleFactor * 100)}%
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row setting-row--stacked">
          <div><h2>桌面表现</h2><p>安静模式会让独立环境场景休眠，随时可以恢复。</p></div>
          <div className="mode-grid">
            {PRESENTATION_OPTIONS.map((option) => (
              <label
                className={settings.presentationMode === option.value ? "mode-option mode-option--selected" : "mode-option"}
                key={option.value}
              >
                <input
                  type="radio"
                  name="presentation-mode"
                  value={option.value}
                  checked={settings.presentationMode === option.value}
                  onChange={() => { void updateSettings({ presentationMode: option.value }); }}
                />
                <strong>{option.title}</strong><span>{option.description}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="toggle-row">
          <span><strong>窗口置顶</strong><small>让桌面世界保持在普通应用窗口上方。</small></span>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(event) => { void updateSettings({ alwaysOnTop: event.currentTarget.checked }); }}
          />
        </label>
        <label className="setting-row">
          <span><strong>管理界面缩放</strong><small>{Math.round(settings.uiScale * 100)}%</small></span>
          <input
            aria-label="管理界面缩放"
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={settings.uiScale}
            onChange={(event) => { void updateSettings({ uiScale: Number(event.currentTarget.value) }); }}
          />
        </label>
      </section>

      <section className="save-card" aria-label="存档状态">
        <div className="save-heading">
          <div><p className="eyebrow">LOCAL SAVE</p><h2>本地存档</h2></div>
          <span className={`save-badge save-badge--${saveDiagnostics?.status ?? "loading"}`}>
            {getSaveStatusText(saveDiagnostics)}
          </span>
        </div>
        <dl>
          <div><dt>恢复情况</dt><dd>{getSaveSourceText(saveDiagnostics)}</dd></div>
          <div><dt>迁移处理</dt><dd>{getSaveMigrationText(saveDiagnostics)}</dd></div>
          <div><dt>最近写入</dt><dd>{formatSavedAt(saveDiagnostics?.lastSavedAtUtcMs ?? null)}</dd></div>
          <div><dt>存档文件</dt><dd>{saveDiagnostics?.fileName ?? "save.json"} · 备份 {saveDiagnostics?.backupFileName ?? "save.json.bak"}</dd></div>
        </dl>
        {saveDiagnostics?.lastError === null || saveDiagnostics?.lastError === undefined ? null : (
          <p className="save-error" role="alert">存档诊断：{saveDiagnostics.lastError}</p>
        )}
      </section>
      {requiresConfirmation ? (
        <button className="management-confirm-button" disabled={settingsPending} type="button" onClick={finishOnboarding}>
          确认并进入桌面
        </button>
      ) : null}
    </div>
  );

  const renderActivePage = (): React.JSX.Element => {
    switch (activePage) {
      case "overview":
        return (
          <>
            <FocusSessionPanel focus={operationsReadModel?.focusSession ?? null} pending={gameplayPending} actions={actions} />
            <OperationsPanel inventory={inventoryReadModel} progression={progressionReadModel} operations={operationsReadModel} finance={financeReadModel} view="overview" />
          </>
        );
      case "finance":
        return <OperationsPanel inventory={inventoryReadModel} progression={progressionReadModel} operations={operationsReadModel} finance={financeReadModel} view="finance" />;
      case "inventory":
        return (
          <WarehouseDialog
            inventory={inventoryReadModel}
            open
            pending={gameplayPending}
            onClose={() => setActivePage("overview")}
            onCreateManualDemand={actions.createManualLogisticsDemand}
            onStopManualDemand={actions.stopManualLogisticsDemand}
          />
        );
      case "recipes":
        return <RecipeBookDialog progression={progressionReadModel} open onClose={() => setActivePage("overview")} />;
      case "procurement":
        return (
          <ProcurementDialog
            procurement={procurementReadModel}
            finance={financeReadModel}
            inventory={inventoryReadModel}
            progression={progressionReadModel}
            open
            pending={gameplayPending}
            onClose={() => setActivePage("overview")}
            onConfigureAutomation={actions.configureProcurementAutomation}
            onPlaceOrder={actions.placeProcurementOrder}
          />
        );
      case "staff":
        return (
          <RecruitmentDialog
            recruitment={recruitmentReadModel}
            finance={financeReadModel}
            open
            pending={gameplayPending}
            onClose={() => setActivePage("overview")}
            onRefresh={actions.refreshRecruitment}
            onHire={actions.hireRecruitmentCandidate}
            onSetPrimaryJob={actions.setEmployeePrimaryJob}
            onSetDailyShift={actions.setEmployeeDailyShift}
            onRequestDismissal={actions.requestEmployeeDismissal}
          />
        );
      case "roster":
        return <StoryPanels actions={actions} pending={gameplayPending} operations={operationsReadModel} />;
      case "instance-upgrades":
        return (
          <InstanceUpgradesDialog
            upgrades={instanceUpgradesReadModel}
            finance={financeReadModel}
            open
            pending={gameplayPending}
            onClose={() => setActivePage("overview")}
            onEnterEditMode={actions.enterSceneEditMode}
            onExitEditMode={actions.exitSceneEditMode}
            onPrepareBuilding={actions.prepareBuildingUpgrade}
            onConfirmBuilding={actions.confirmBuildingUpgrade}
            onCancelBuilding={actions.cancelBuildingUpgrade}
            onUpgradeCart={actions.upgradeProcurementCart}
            onUpgradeAirship={actions.upgradeProcurementAirship}
            onStartBuildingConstruction={actions.startBuildingConstruction}
            onUpdateBuildingConstruction={actions.updateBuildingConstruction}
            onConfirmBuildingConstruction={actions.confirmBuildingConstruction}
            onCancelBuildingConstruction={actions.cancelBuildingConstruction}
            onMoveBuilding={actions.moveBuilding}
            onChangeBuildingStyle={actions.changeBuildingStyle}
          />
        );
      case "technology":
        return (
          <>
            <div className="management-route-tabs" role="tablist" aria-label="科技树子页面">
              <button data-technology-view="tree" aria-selected={technologyView === "tree"} role="tab" type="button" onClick={() => setTechnologyView("tree")}>科技树</button>
              <button data-technology-view="compendium" aria-selected={technologyView === "compendium"} role="tab" type="button" onClick={() => setTechnologyView("compendium")}>解锁图鉴</button>
            </div>
            {technologyView === "tree" ? (
              <TechnologyTreeDialog
                operations={operationsReadModel}
                finance={financeReadModel}
                open
                pending={gameplayPending}
                onClose={() => setActivePage("overview")}
                onUpgradeTechnology={actions.upgradeTechnology}
              />
            ) : (
              <ProgressionDialog progression={progressionReadModel} open onClose={() => setActivePage("overview")} />
            )}
          </>
        );
      case "settings":
        return renderSettings();
    }
  };

  return (
    <main className="management-shell management-shell--unified">
      <header className="management-topbar">
        <button className="management-brand" type="button" onClick={() => setActivePage("overview")}>
          <span className="eyebrow">AIRSHIP RESTAURANT</span>
          <strong>{PAGE_LABELS[activePage]}</strong>
        </button>
        <div className="management-topbar-status" aria-label="经营状态">
          <span>可用资金 <strong>{balance}</strong></span>
          <span>{pending || saveDiagnostics?.status === "saving" ? "正在保存…" : getSaveStatusText(saveDiagnostics)}</span>
        </div>
        <button
          className={activePage === "settings" ? "management-settings-button is-active" : "management-settings-button"}
          type="button"
          onClick={() => setActivePage("settings")}
        >
          设置
        </button>
      </header>

      <div className="management-layout">
        <nav className="management-sidebar" aria-label="经营管理导航">
          <button
            className={activePage === "overview" ? "is-active" : ""}
            data-management-section="overview"
            type="button"
            onClick={() => setActivePage("overview")}
          >
            <strong>经营总览</strong><small>实时状态与专注时钟</small>
          </button>
          {(["经营", "人员与故事", "发展"] as const).map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              {MANAGEMENT_NAVIGATION.filter((entry) => entry.group === group).map((entry) => (
                <button
                  className={activePage === entry.section ? "is-active" : ""}
                  data-management-section={entry.section}
                  key={entry.section}
                  type="button"
                  onClick={() => setActivePage(entry.section)}
                >
                  {entry.label}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className="management-workspace" aria-label={PAGE_LABELS[activePage]}>
          {requiresConfirmation ? (
            <section className="notice-card" role="status">
              <strong>{settings.needsDisplayConfirmation ? "原显示器已不可用" : "首次启动引导"}</strong>
              <span>请先在系统设置中确认桌面和显示方式。</span>
              <button type="button" onClick={() => setActivePage("settings")}>前往设置</button>
            </section>
          ) : null}

          <div className="management-module-host">{renderActivePage()}</div>
          {error === null ? null : <p className="management-error" role="alert">{error}</p>}
        </section>
      </div>

      <footer className="management-statusbar">
        <span>{saveDiagnostics?.status === "error" ? "存档需要注意" : "本地自动保存"}</span>
        <small>preload {workspaceInfo?.channel ?? "browser"} · rev {settings.revision}</small>
      </footer>
    </main>
  );
}
