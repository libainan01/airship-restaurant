import type {
  FinanceReadModel,
  RecruitmentReadModel,
  RecruitmentSkillLevelsReadModel,
} from "@airship-restaurant/contracts";
import { useEffect, useRef, useState } from "react";
import "../shared/management-dialog.css";
import "./recruitment.css";

const JOB_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "job.chef": "厨师",
  "job.waiter": "服务员",
  "job.local_procurer": "本地采购员",
  "job.repairer": "维修员",
  "job.restaurant_manager": "餐厅管理员",
  "job.captain": "船长",
});

const SHIFT_OPTIONS = [
  { label: "早班 · 08:00–17:00", start: 480, end: 1_020 },
  { label: "午后班 · 12:00–21:00", start: 720, end: 1_260 },
  { label: "夜班 · 18:00–02:00", start: 1_080, end: 120 },
] as const;

function jobLabel(jobId: string): string {
  return JOB_LABELS[jobId] ?? jobId;
}

function skillSummary(skills: RecruitmentSkillLevelsReadModel): string {
  return `烹饪 ${skills.cooking} · 魅力 ${skills.charm} · 移动 ${skills.movement} · 修理 ${skills.repair} · 驾驶 ${skills.piloting}`;
}

function shiftValue(start: number, end: number): string {
  return `${start}-${end}`;
}

function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60).toString().padStart(2, "0");
  const rest = (minute % 60).toString().padStart(2, "0");
  return `${hour}:${rest}`;
}

function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "现在可免费刷新";
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

export interface RecruitmentDialogProps {
  readonly open: boolean;
  readonly recruitment: RecruitmentReadModel | null;
  readonly finance: FinanceReadModel | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onRefresh: (kind: "free" | "manual") => Promise<boolean>;
  readonly onHire: (
    candidateId: string,
    shiftStartMinuteInclusive: number,
    shiftEndMinuteExclusive: number,
  ) => Promise<boolean>;
  readonly onSetPrimaryJob: (characterId: string, jobId: string) => Promise<boolean>;
  readonly onSetDailyShift: (
    characterId: string,
    startMinuteInclusive: number,
    endMinuteExclusive: number,
  ) => Promise<boolean>;
  readonly onRequestDismissal: (characterId: string) => Promise<boolean>;
}

export function RecruitmentDialog({
  open,
  recruitment,
  finance,
  pending,
  onClose,
  onRefresh,
  onHire,
  onSetPrimaryJob,
  onSetDailyShift,
  onRequestDismissal,
}: RecruitmentDialogProps): React.JSX.Element | null {
  const [shiftIndex, setShiftIndex] = useState(0);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const receivedAtUtcMs = useRef(Date.now());
  useEffect(() => {
    receivedAtUtcMs.current = Date.now();
    setClockTick(Date.now());
  }, [recruitment?.sourceRevision]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setInterval(() => setClockTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);
  if (!open) return null;

  const balance = finance?.availableCopper ?? 0;
  const selectedShift = SHIFT_OPTIONS[shiftIndex]!;
  const estimatedGameUtcMs = recruitment === null
    ? 0
    : recruitment.currentUtcMs + Math.max(0, clockTick - receivedAtUtcMs.current);
  const freeRemainingMs = recruitment === null
    ? 0
    : recruitment.nextFreeRefreshAtUtcMs - estimatedGameUtcMs;
  const capacityFull = recruitment !== null &&
    recruitment.recruitedEmployeeCount >= recruitment.employeeLimit;

  return (
    <div className="technology-tree-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-label="员工服务中心" aria-modal="true" className="technology-tree-dialog recruitment-dialog" role="dialog">
        <div className="technology-tree-heading">
          <div>
            <p className="eyebrow">STAFF SERVICE CENTER</p>
            <h2>员工服务中心</h2>
            <p>候选属性在刷新时固定；核心成员不占普通员工容量。录用后可在日程管理中继续调整班次。</p>
          </div>
          <button aria-label="关闭员工服务中心" className="technology-tree-close" type="button" onClick={onClose}>关闭</button>
        </div>

        {recruitment === null ? <p role="status">正在读取候选与员工名册…</p> : (
          <>
            <div className="recruitment-summary">
              <span>普通员工 <strong>{recruitment.recruitedEmployeeCount}/{recruitment.employeeLimit}</strong></span>
              <span>可用资金 <strong>{balance}</strong> 铜币</span>
              <span>免费刷新 <strong>{formatRemaining(freeRemainingMs)}</strong></span>
            </div>
            <div className="recruitment-toolbar">
              <label>
                新员工默认班次
                <select value={shiftIndex} onChange={(event) => setShiftIndex(Number(event.currentTarget.value))}>
                  {SHIFT_OPTIONS.map((shift, index) => <option key={shift.label} value={index}>{shift.label}</option>)}
                </select>
              </label>
              <div>
                <button disabled={pending || !recruitment.commandsAvailable || freeRemainingMs > 0} type="button" onClick={() => { void onRefresh("free"); }}>
                  {freeRemainingMs > 0 ? "免费刷新未到时间" : "免费刷新"}
                </button>
                <button disabled={pending || !recruitment.commandsAvailable || balance < recruitment.manualRefreshCostCopper} type="button" onClick={() => { void onRefresh("manual"); }}>
                  主动刷新 · {recruitment.manualRefreshCostCopper} 铜币
                </button>
              </div>
            </div>

            <section className="recruitment-section">
              <h3>本期候选</h3>
              {recruitment.candidates.length === 0 ? <p className="recruitment-empty">候选池为空，可以等待免费刷新或主动刷新。</p> : (
                <div className="recruitment-grid">
                  {recruitment.candidates.map((candidate) => {
                    const affordable = balance >= candidate.hireCostCopper;
                    return (
                      <article className="recruitment-card" key={candidate.id}>
                        <div className="recruitment-card-heading">
                          <div><strong>{candidate.name}</strong><small>品质档 {candidate.qualityTier + 1}</small></div>
                          <span>{jobLabel(candidate.primaryJobId)}</span>
                        </div>
                        <p>{skillSummary(candidate.skillLevels)}</p>
                        <small>可任职：{candidate.learnedJobIds.map(jobLabel).join(" / ")}</small>
                        <small>天赋：{candidate.talents.length === 0 ? "暂无" : candidate.talents.map((talent) => talent.name).join(" / ")}</small>
                        <button disabled={pending || capacityFull || !affordable || !recruitment.commandsAvailable} type="button" onClick={() => {
                          void onHire(candidate.id, selectedShift.start, selectedShift.end);
                        }}>
                          {capacityFull ? "员工容量已满" : !affordable ? "资金不足" : `录用 · ${candidate.hireCostCopper} 铜币`}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="recruitment-section">
              <h3>当前员工</h3>
              <div className="recruitment-roster">
                {recruitment.employees.map((employee) => {
                  const captain = employee.primaryJobId === "job.captain";
                  const currentShiftValue = employee.dailyShift === null
                    ? ""
                    : shiftValue(
                        employee.dailyShift.startMinuteInclusive,
                        employee.dailyShift.endMinuteExclusive,
                      );
                  const knownShift = SHIFT_OPTIONS.some((shift) =>
                    shiftValue(shift.start, shift.end) === currentShiftValue
                  );
                  const status = employee.dismissalPending
                    ? "待离职 · 正在完成手头任务"
                    : employee.voyageActive
                      ? "正在出航"
                      : employee.currentTaskId !== null
                        ? `执行中 · ${employee.currentTaskId}`
                        : employee.onShift
                          ? "在班 · 等待任务"
                          : "非工作时间";
                  return (
                    <article key={employee.characterId}>
                      <div className="recruitment-employee-heading">
                        <strong>{employee.name}</strong>
                        <span>{employee.coreMember ? "核心成员" : "普通员工"}</span>
                      </div>
                      <small>{skillSummary(employee.skillLevels)}</small>
                      <small>{status}</small>
                      <div className="recruitment-employee-controls">
                        <label>
                          主要职位
                          <select
                            aria-label={`${employee.name}主要职位`}
                            disabled={pending || employee.dismissalPending || !recruitment.commandsAvailable}
                            value={employee.primaryJobId}
                            onChange={(event) => {
                              void onSetPrimaryJob(employee.characterId, event.currentTarget.value);
                            }}
                          >
                            {employee.learnedJobIds.map((jobId) => (
                              <option key={jobId} value={jobId}>{jobLabel(jobId)}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          每日班次
                          <select
                            aria-label={`${employee.name}每日班次`}
                            disabled={pending || captain || employee.dismissalPending || !recruitment.commandsAvailable}
                            value={currentShiftValue}
                            onChange={(event) => {
                              const [start, end] = event.currentTarget.value.split("-").map(Number);
                              if (Number.isSafeInteger(start) && Number.isSafeInteger(end)) {
                                void onSetDailyShift(employee.characterId, start!, end!);
                              }
                            }}
                          >
                            {captain ? <option value="">船长按出航安排</option> : null}
                            {!captain && currentShiftValue === "" ? <option value="">请选择班次</option> : null}
                            {!captain && !knownShift && employee.dailyShift !== null ? (
                              <option value={currentShiftValue}>
                                当前 · {formatMinute(employee.dailyShift.startMinuteInclusive)}–{formatMinute(employee.dailyShift.endMinuteExclusive)}
                              </option>
                            ) : null}
                            {!captain ? SHIFT_OPTIONS.map((shift) => (
                              <option key={shift.label} value={shiftValue(shift.start, shift.end)}>{shift.label}</option>
                            )) : null}
                          </select>
                        </label>
                        <button
                          className="recruitment-dismiss"
                          disabled={pending || employee.coreMember || employee.dismissalPending || employee.voyageActive || !recruitment.commandsAvailable}
                          type="button"
                          onClick={() => { void onRequestDismissal(employee.characterId); }}
                        >
                          {employee.coreMember
                            ? "核心成员不可解雇"
                            : employee.dismissalPending
                              ? "等待任务完成"
                              : employee.voyageActive
                                ? "返航后可解雇"
                                : "解雇"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}