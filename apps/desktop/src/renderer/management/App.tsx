import type {
  AppSettingsSnapshot,
  AppSettingsUpdate,
  DisplayOption,
  PresentationMode,
} from "@airship-restaurant/contracts";
import { useEffect, useState } from "react";

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

export function App(): React.JSX.Element {
  const workspaceInfo = window.airshipManagement?.getWorkspaceInfo();
  const [settings, setSettings] =
    useState<AppSettingsSnapshot | null>(null);
  const [displays, setDisplays] =
    useState<readonly DisplayOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      return;
    }

    let mounted = true;
    const unsubscribe = bridge.onSettingsChanged((nextSettings) => {
      if (mounted) {
        setSettings(nextSettings);
      }
    });

    void Promise.all([bridge.getSettings(), bridge.listDisplays()])
      .then(([nextSettings, nextDisplays]) => {
        if (!mounted) {
          return;
        }
        setSettings(nextSettings);
        setDisplays(nextDisplays);
      })
      .catch((cause: unknown) => {
        console.error("Unable to load application settings.", cause);
        if (mounted) {
          setError("无法读取设置，请重新打开管理窗口。");
        }
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const updateSettings = async (
    update: AppSettingsUpdate,
  ): Promise<void> => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      setError("浏览器预览模式不能保存原生窗口设置。");
      return;
    }

    setPendingCount((count) => count + 1);
    setError(null);
    try {
      setSettings(await bridge.updateSettings(update));
    } catch (cause: unknown) {
      console.error("Unable to update application settings.", cause);
      setError("设置未能保存；显示器可能已断开，请重试。");
      try {
        setDisplays(await bridge.listDisplays());
        setSettings(await bridge.getSettings());
      } catch {
        // Keep the first, more useful error message.
      }
    } finally {
      setPendingCount((count) => Math.max(0, count - 1));
    }
  };

  const finishOnboarding = (): void => {
    void updateSettings({
      onboardingCompleted: true,
      needsDisplayConfirmation: false,
    });
  };

  if (settings === null) {
    return (
      <main className="management-shell management-shell--loading">
        <p>正在连接空艇餐厅主进程…</p>
      </main>
    );
  }

  const requiresConfirmation =
    !settings.onboardingCompleted ||
    settings.needsDisplayConfirmation;

  return (
    <main className="management-shell">
      <header>
        <p className="eyebrow">AIRSHIP RESTAURANT · SETTINGS</p>
        <h1>
          {requiresConfirmation ? "先安置好你的空艇餐厅" : "桌面设置"}
        </h1>
        <p>
          这些选项会立即应用并自动保存。以后点击飞艇或餐厅，
          也可以重新打开这个窗口。
        </p>
      </header>

      {requiresConfirmation ? (
        <section className="notice-card" role="status">
          <strong>
            {settings.needsDisplayConfirmation
              ? "原显示器已不可用"
              : "首次启动引导"}
          </strong>
          <span>
            请选择桌面和显示方式，确认后桌面世界会记住它们。
          </span>
        </section>
      ) : null}

      <section className="settings-card" aria-label="桌面显示设置">
        <div className="setting-row">
          <div>
            <h2>目标显示器</h2>
            <p>飞艇、餐厅和缆车会共同出现在这一块屏幕。</p>
          </div>
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
                {display.label}
                {display.isPrimary ? "（主显示器）" : ""}
                {" · "}
                {display.workArea.width}×{display.workArea.height}
                {" · "}
                {Math.round(display.scaleFactor * 100)}%
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row setting-row--stacked">
          <div>
            <h2>桌面表现</h2>
            <p>安静模式会让独立环境场景休眠，随时可以恢复。</p>
          </div>
          <div className="mode-grid">
            {PRESENTATION_OPTIONS.map((option) => (
              <label
                className={
                  settings.presentationMode === option.value
                    ? "mode-option mode-option--selected"
                    : "mode-option"
                }
                key={option.value}
              >
                <input
                  type="radio"
                  name="presentation-mode"
                  value={option.value}
                  checked={settings.presentationMode === option.value}
                  onChange={() => {
                    void updateSettings({
                      presentationMode: option.value,
                    });
                  }}
                />
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="toggle-row">
          <span>
            <strong>窗口置顶</strong>
            <small>让桌面世界保持在普通应用窗口上方。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(event) => {
              void updateSettings({
                alwaysOnTop: event.currentTarget.checked,
              });
            }}
          />
        </label>

        <label className="setting-row">
          <span>
            <strong>管理界面缩放</strong>
            <small>{Math.round(settings.uiScale * 100)}%</small>
          </span>
          <input
            aria-label="管理界面缩放"
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={settings.uiScale}
            onChange={(event) => {
              void updateSettings({
                uiScale: Number(event.currentTarget.value),
              });
            }}
          />
        </label>
      </section>

      <footer>
        <div>
          <span>
            {pendingCount > 0 ? "正在保存…" : "已自动保存"}
          </span>
          <small>
            preload {workspaceInfo?.channel ?? "browser"} · rev{" "}
            {settings.revision}
          </small>
        </div>
        {requiresConfirmation ? (
          <button type="button" onClick={finishOnboarding}>
            确认并进入桌面
          </button>
        ) : null}
      </footer>

      {error === null ? null : (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
