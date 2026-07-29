import type { GameSnapshot } from "@airship-restaurant/contracts";
import { useEffect, useState } from "react";
import "./runtime-controls.css";

const sections = ["科技树", "设置", "角色档案", "故事图鉴"];

export function App(): React.JSX.Element {
  const workspaceInfo = window.airshipManagement?.getWorkspaceInfo();
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const bridge = window.airshipManagement;

    if (bridge === undefined) {
      return;
    }

    let isMounted = true;
    const unsubscribe = bridge.onSnapshotChanged((nextSnapshot) => {
      if (isMounted) {
        setSnapshot(nextSnapshot);
      }
    });

    void bridge
      .getSnapshot()
      .then((nextSnapshot) => {
        if (isMounted) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to read runtime snapshot.", error);

        if (isMounted) {
          setCommandError("无法连接主进程状态。");
        }
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const toggleQuietMode = async (): Promise<void> => {
    const bridge = window.airshipManagement;

    if (bridge === undefined || snapshot === null || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setCommandError(null);

    try {
      const result = await bridge.dispatchCommand({
        id: crypto.randomUUID(),
        type: "settings.set-quiet-mode",
        payload: {
          enabled: !snapshot.settings.quietMode,
        },
      });

      setSnapshot(result.snapshot);

      if (!result.accepted) {
        setCommandError(`${result.code}: ${result.message}`);
      }
    } catch (error: unknown) {
      console.error("Unable to dispatch runtime command.", error);
      setCommandError("主进程拒绝了本次操作。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const quietModeLabel =
    snapshot === null
      ? "连接中"
      : snapshot.settings.quietMode
        ? "已开启"
        : "已关闭";

  return (
    <main className="management-shell">
      <header>
        <p className="eyebrow">AIRSHIP RESTAURANT · MANAGEMENT</p>
        <h1>正式管理界面工作区</h1>
        <p>
          React 管理窗口通过白名单 preload
          向主进程提交命令，不直接修改游戏状态。
        </p>
      </header>

      <section
        className="status-card"
        aria-label="工作区状态"
      >
        <span>Preload 通道</span>
        <strong>{workspaceInfo?.channel ?? "浏览器预览"}</strong>
        <span>骨架版本</span>
        <strong>{workspaceInfo?.version ?? "0.1.0"}</strong>
        <span>Runtime 阶段</span>
        <strong>{snapshot?.phase ?? "连接中"}</strong>
        <span>状态修订</span>
        <strong>{snapshot?.revision ?? "—"}</strong>
      </section>

      <section
        className="runtime-control"
        aria-label="运行时同步验证"
      >
        <div>
          <p className="runtime-control__label">双窗口同步验证</p>
          <h2>安静模式：{quietModeLabel}</h2>
          <p>
            操作会经过类型化IPC交给主进程GameRuntime，并广播给桌面窗口。
          </p>
        </div>
        <button
          type="button"
          disabled={snapshot === null || isSubmitting}
          onClick={() => {
            void toggleQuietMode();
          }}
        >
          {isSubmitting ? "提交中…" : "切换安静模式"}
        </button>
      </section>

      {commandError === null ? null : (
        <p
          className="runtime-error"
          role="alert"
        >
          {commandError}
        </p>
      )}

      <nav aria-label="计划中的管理页面">
        {sections.map((section) => (
          <button
            key={section}
            type="button"
            disabled
          >
            {section}
          </button>
        ))}
      </nav>
    </main>
  );
}
