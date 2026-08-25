import type {
  ProgressionContentKindReadModel,
  ProgressionContentReadModel,
  ProgressionReadModel,
} from "@airship-restaurant/contracts";
import "../shared/management-dialog.css";
import "./progression.css";

export interface ProgressionDialogProps {
  readonly open: boolean;
  readonly progression: ProgressionReadModel | null;
  readonly onClose: () => void;
}

const GROUPS: readonly {
  readonly kind: ProgressionContentKindReadModel;
  readonly title: string;
}[] = [
  { kind: "region", title: "地区" },
  { kind: "route", title: "航线" },
  { kind: "recipe", title: "菜品" },
  { kind: "building", title: "建筑" },
  { kind: "building-style", title: "建筑外观" },
];

function getStatusLabel(content: ProgressionContentReadModel): string {
  if (content.status === "unlocked") {
    return content.currentlyUsable ? "已解锁 · 当前可用" : "已解锁 · 暂不可用";
  }
  return content.status === "unlockable" ? "解锁条件已满足" : "尚未解锁";
}

export function ProgressionDialog({
  open,
  progression,
  onClose,
}: ProgressionDialogProps): React.JSX.Element | null {
  if (!open || progression === null) return null;

  return (
    <div
      className="technology-tree-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label="成长与内容图鉴"
        aria-modal="true"
        className="technology-tree-dialog progression-dialog"
        role="dialog"
      >
        <div className="technology-tree-heading">
          <div>
            <p className="eyebrow">PROGRESSION COMPENDIUM</p>
            <h2>成长与内容图鉴</h2>
            <p>这里只显示已经得知的内容；永久解锁与当前是否可用分别记录。</p>
          </div>
          <button
            aria-label="关闭成长与内容图鉴"
            className="technology-tree-close"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="progression-summary" role="status">
          <strong>{progression.unlockedCount}</strong>
          <span>项已解锁</span>
          <small>已知内容 {progression.revealedCount} 项</small>
        </div>

        <div className="progression-groups">
          {GROUPS.map((group) => {
            const entries = progression.contents.filter(
              (content) => content.kind === group.kind,
            );
            if (entries.length === 0) return null;
            return (
              <section className="progression-group" key={group.kind}>
                <header>
                  <h3>{group.title}</h3>
                  <span>{entries.length} 项</span>
                </header>
                <div className="progression-entry-grid">
                  {entries.map((content) => (
                    <article
                      className={[
                        "progression-entry",
                        "is-" + content.status,
                        content.currentlyUsable ? "is-usable" : "",
                      ].filter(Boolean).join(" ")}
                      key={content.id}
                    >
                      <div>
                        <strong>{content.name}</strong>
                        <span>{getStatusLabel(content)}</span>
                      </div>
                      {content.unavailableReasons.length > 0 ? (
                        <p>
                          {content.unavailableReasons
                            .map((reason) => reason.message)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}