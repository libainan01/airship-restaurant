import type { FocusSessionReadModel } from "@airship-restaurant/contracts";
import { useEffect, useState } from "react";
import type { ManagementGameplayActions } from "../../runtime/management-gameplay-actions";

export interface FocusSessionPanelProps {
  readonly focus: FocusSessionReadModel | null;
  readonly pending: boolean;
  readonly actions: Pick<
    ManagementGameplayActions,
    "startFocusSession" | "cancelFocusSession" | "skipFocusBreak"
  >;
}

function formatDuration(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRemainingMs(focus: FocusSessionReadModel, nowUtcMs: number): number | null {
  return focus.phaseEndsAtUtcMs === null ? null : Math.max(0, focus.phaseEndsAtUtcMs - nowUtcMs);
}

export function FocusSessionPanel({ focus, pending, actions }: FocusSessionPanelProps): React.JSX.Element {
  const [nowUtcMs, setNowUtcMs] = useState(() => Date.now());
  useEffect(() => {
    setNowUtcMs(Date.now());
    if (focus?.phase !== "focusing" && focus?.phase !== "break") return;
    const timer = window.setInterval(() => setNowUtcMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [focus?.phase, focus?.phaseEndsAtUtcMs]);

  if (focus === null) {
    return <section className="focus-session-card focus-session-card--loading">正在读取专注时钟…</section>;
  }

  const remaining = getRemainingMs(focus, nowUtcMs);
  const phaseLabel = focus.phase === "focusing"
    ? "专注中"
    : focus.phase === "break"
      ? "休息时间"
      : focus.phase === "waiting-for-dialogue"
        ? "等待剧情对白结束"
        : "准备专注";
  return (
    <section className={`focus-session-card focus-session-card--${focus.phase}`} aria-label="专注时钟">
      <div className="focus-session-card__copy">
        <p className="eyebrow">FOCUS TIMER</p>
        <div className="focus-session-card__title">
          <h2>{phaseLabel}</h2>
          {remaining === null ? null : <time>{formatDuration(remaining)}</time>}
        </div>
        <p>
          {focus.phase === "waiting-for-dialogue"
            ? "当前剧情会完整播放；结束后才开始计算 25 分钟，不会占用专注时间。"
            : focus.phase === "focusing"
              ? "剧情与闲聊暂停，到店间隔缩短 25%，专注期间确认的订单收入增加 20%。"
              : focus.phase === "break"
                ? "本轮专注已经完成，餐厅恢复普通经营。"
                : "开启 25 分钟专注。若剧情正在播放，计时会自动延后到对白结束。"}
        </p>
        <small>已完成 {focus.completedFocusCount} 轮</small>
      </div>
      <div className="focus-session-card__actions">
        {focus.phase === "idle" ? (
          <button disabled={pending} type="button" onClick={() => { void actions.startFocusSession(); }}>开始专注</button>
        ) : focus.phase === "break" ? (
          <button disabled={pending} type="button" onClick={() => { void actions.skipFocusBreak(); }}>跳过休息</button>
        ) : (
          <button disabled={pending} type="button" onClick={() => { void actions.cancelFocusSession(); }}>
            {focus.phase === "waiting-for-dialogue" ? "取消等待" : "结束专注"}
          </button>
        )}
      </div>
    </section>
  );
}