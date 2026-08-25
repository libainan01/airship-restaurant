import type {
  FinanceReadModel,
  OperationsReadModel,
  TechnologyNodeSnapshot,
} from "@airship-restaurant/contracts";
import "../shared/management-dialog.css";
import "./technology-tree.css";

const EFFECT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "freight-elevator.travel-duration-multiplier": "后续货梯行程耗时",
  "freight-elevator.available-count": "可启用小型货梯",
  "employment.employee-limit": "餐厅员工上限",
  "tray.capacity": "每批托盘携带量",
  "recruitment.quality-tier": "招募候选质量等级",
});

function formatEffect(key: string, value: number): string {
  const label = EFFECT_LABELS[key] ?? key;
  if (key.endsWith("multiplier")) return `${label} ${Math.round(value * 100)}%`;
  if (key === "freight-elevator.available-count") return `${label} ${value} 台`;
  if (key === "employment.employee-limit") return `${label} ${value} 人`;
  if (key === "tray.capacity") return `${label} ${value} 份`;
  return `${label} ${value}`;
}

function describeEffects(node: TechnologyNodeSnapshot): string {
  return Object.entries(node.effects)
    .map(([key, value]) => formatEffect(key, value))
    .join(" · ");
}

export interface TechnologyTreeDialogProps {
  readonly open: boolean;
  readonly operations: OperationsReadModel | null;
  readonly finance: FinanceReadModel | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onUpgradeTechnology: (nodeId: string) => Promise<boolean>;
}

export function TechnologyTreeDialog({
  open,
  operations,
  finance,
  pending,
  onClose,
  onUpgradeTechnology,
}: TechnologyTreeDialogProps): React.JSX.Element | null {
  if (!open) return null;
  const technology = operations?.technology ?? null;

  return (
    <div
      className="technology-tree-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label="经营科技树"
        aria-modal="true"
        className="technology-tree-dialog"
        role="dialog"
      >
        <div className="technology-tree-heading">
          <div>
            <p className="eyebrow">BUSINESS TECHNOLOGY</p>
            <h2>经营科技树</h2>
            <p>全局科技只改善跨实例的经营能力；设备与建筑在各自实例上升级。</p>
          </div>
          <button
            aria-label="关闭经营科技树"
            className="technology-tree-close"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="technology-tree-balance">
          当前可用 <strong>{finance?.availableCopper ?? 0}</strong> 铜币
        </div>
        {technology === null ? (
          <p role="status">正在读取科技数据…</p>
        ) : (
          <div className="upgrade-grid">
            {technology.nodes.map((node) => {
              const maximum = node.level >= node.maxLevel;
              const affordable = node.nextCostCopper !== null &&
                (finance?.availableCopper ?? 0) >= node.nextCostCopper;
              const missingPrerequisites = node.prerequisites.flatMap((prerequisite) => {
                const target = technology.nodes.find((candidate) => candidate.id === prerequisite.nodeId);
                return (target?.level ?? 0) >= prerequisite.requiredLevel
                  ? []
                  : [`${target?.name ?? prerequisite.nodeId} Lv.${prerequisite.requiredLevel}`];
              });
              return (
                <article className="upgrade-option" key={node.id}>
                  <div>
                    <span>等级 {node.level}/{node.maxLevel}</span>
                    <strong>{node.name}</strong>
                    <p>{describeEffects(node)}</p>
                    {missingPrerequisites.length > 0 ? (
                      <small>前置：{missingPrerequisites.join("、")}</small>
                    ) : null}
                  </div>
                  <button
                    disabled={pending || maximum || !affordable || !node.prerequisitesMet}
                    type="button"
                    onClick={() => { void onUpgradeTechnology(node.id); }}
                  >
                    {maximum
                      ? "已满级"
                      : !node.prerequisitesMet
                        ? "前置未满足"
                        : "升级 · " + (node.nextCostCopper ?? 0) + " 铜币"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}