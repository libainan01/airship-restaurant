import type { OperationsReadModel } from "@airship-restaurant/contracts";
import {
  getManagementItemName as getItemName,
  getManagementRecipeName as getRecipeName,
  MANAGEMENT_CONTENT as CONTENT,
  MANAGEMENT_RECIPE_JOURNALS as RECIPE_JOURNALS,
} from "../../management-content";
import type { ManagementGameplayActions } from "../../runtime/management-gameplay-actions";
import { STORY_STAGE_TITLES } from "./story-presenter";

function getRelationshipTierLabel(tierId: string): string {
  switch (tierId) {
    case "new": return "初次相识";
    case "familiar": return "渐渐熟悉";
    case "trusted": return "彼此信赖";
    default: return tierId;
  }
}

function getNodeStatusLabel(status: "locked" | "available" | "completed"): string {
  switch (status) {
    case "locked": return "尚未发生";
    case "available": return "等待后续";
    case "completed": return "已经收录";
  }
}

function getRewardName(contentId: string): string {
  return CONTENT.getProgression(contentId)?.name ?? contentId;
}

export interface StoryPanelsProps {
  readonly operations: OperationsReadModel | null;
  readonly pending: boolean;
  readonly actions: Pick<
    ManagementGameplayActions,
    | "replayStoryDialogue"
    | "markNarrativeViewed"
    | "completeNarrativeEvent"
  >;
}

export function StoryPanels({
  operations,
  pending,
  actions,
}: StoryPanelsProps): React.JSX.Element {
  const roster = operations?.storyRoster ?? null;
  return (
    <>
      {roster === null ? null : (
        <section
          className="story-roster-card"
          id="management-story-roster"
          aria-label="故事顾客花名册"
        >
          <div className="business-heading">
            <div>
              <p className="eyebrow">GUEST ROSTER</p>
              <h2>故事顾客花名册</h2>
            </div>
            <span className="live-badge">已记录 {roster.characters.length} 位</span>
          </div>
          {roster.characters.length === 0 ? (
            <p className="story-roster-empty">
              还没有遇见值得记录的故事顾客。角色真正到店后，才会出现在这里。
            </p>
          ) : (
            <div className="story-roster-grid">
              {roster.characters.map((character) => (
                <article className="story-roster-character" key={character.characterId}>
                  <header>
                    <div>
                      <span>{getRelationshipTierLabel(character.relationshipTierId)}</span>
                      <h3>{character.identity}</h3>
                    </div>
                    <strong>好感 {character.affinity}</strong>
                  </header>
                  <div className="story-roster-progress">
                    <span>故事收集</span>
                    <strong>{character.completedNodeCount}/{character.totalNodeCount}</strong>
                  </div>
                  <progress
                    aria-label={`${character.identity}故事收集进度`}
                    max={Math.max(1, character.totalNodeCount)}
                    value={character.completedNodeCount}
                  />
                  <ol className="story-roster-node-list">
                    {character.nodes.map((node, index) => (
                      <li className={`story-roster-node story-roster-node--${node.status}`} key={node.id}>
                        <div>
                          <strong>记录 {index + 1}</strong>
                          <span>{getNodeStatusLabel(node.status)}</span>
                        </div>
                        <p>{node.summary ?? node.hint ?? "还有一些往事尚未浮现。"}</p>
                        {node.rewardContentIds.length === 0 ? null : (
                          <small>
                            解锁：{node.rewardContentIds.map(getRewardName).join("、")}
                          </small>
                        )}
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {operations?.story === null || operations === null ? null : (
        <section className="story-progress-card" aria-label="来客手记">
          <div className="business-heading">
            <div>
              <p className="eyebrow">GUEST JOURNAL</p>
              <h2>来客手记 · 贝尔夫妇</h2>
            </div>
            <span className="live-badge">
              {operations.story.stages.every((stage) => stage.status === "completed")
                ? "本章完成"
                : "在线推进"}
            </span>
          </div>
          <div className="story-progress-grid">
            <article>
              <span>当前片段</span>
              <strong>
                {operations.story.currentStageId === null
                  ? "本章已经结束"
                  : STORY_STAGE_TITLES[operations.story.currentStageId] ??
                    operations.story.currentStageId}
              </strong>
              <p>
                {operations.story.active === null
                  ? "等待对应的在线经营行为。"
                  : "角色正在餐厅里交谈。"}
              </p>
            </article>
            <article className={operations.story.storyOrder.status === "active" ? "story-order--active" : ""}>
              <span>故事订单</span>
              <strong>
                {operations.story.storyOrder.status === "locked"
                  ? "尚未出现"
                  : `${getRecipeName(operations.story.storyOrder.recipeId)} ${operations.story.storyOrder.fulfilledQuantity}/${operations.story.storyOrder.requestedQuantity}`}
              </strong>
              <p>
                {operations.story.storyOrder.status === "fulfilled"
                  ? "两份炖菜已经亲手送到贝尔夫妇桌上。"
                  : operations.story.storyOrder.status === "active"
                    ? "只统计在线营业期间实际卖出的炖菜。"
                    : "听完玛莎的旧愿望后开放。"}
              </p>
            </article>
            <article>
              <span>食谱日志</span>
              <strong>
                {operations.story.recipeJournal.phase === "completed"
                  ? "贝尔家的炉火炖菜"
                  : operations.story.recipeJournal.phase === "discovered"
                    ? "玛莎的战时愿望"
                    : "尚未发现"}
              </strong>
              <p>
                {operations.story.recipeJournal.phase === "completed"
                  ? "玛莎想要的原本只是一顿安稳的热饭。后来，托马斯把这顿饭做了很多年。"
                  : operations.story.recipeJournal.phase === "discovered"
                    ? "玛莎与托马斯正在等两份记忆里的炖菜。"
                    : "旧笔记里还有一页没有重新读懂。"}
              </p>
            </article>
          </div>
          <details className="story-replay-list">
            <summary>查看与重放已经完成的对白</summary>
            <div>
              {operations.story.stages.map((stage) => (
                <button
                  disabled={pending || stage.status !== "completed"}
                  key={stage.stageId}
                  type="button"
                  onClick={() => {
                    void actions.replayStoryDialogue(stage.stageId);
                  }}
                >
                  {STORY_STAGE_TITLES[stage.stageId] ?? stage.stageId}
                </button>
              ))}
            </div>
          </details>
        </section>
      )}

      {operations?.narrative === null ||
      operations === null ? null : (
        <details className="narrative-card">
          <summary>
            <span>
              <small>RECIPE STORIES · JOURNAL</small>
              <strong>食谱故事</strong>
            </span>
            <span className="narrative-summary-status">
              {operations.narrative.unreadEventIds.length > 0
                ? `${operations.narrative.unreadEventIds.length} 条待阅读`
                : "暂无新故事"}
            </span>
          </summary>
          <p className="narrative-note">
            食谱会随着在线经营与人物关系逐步改变含义；离线期间只结算资源，
            不会替你跳过对白或完成故事订单。
          </p>
          <div className="narrative-list">
            {operations.narrative.events.map((event) => {
              const definition = CONTENT.getStoryEvent(event.eventId);
              const journal = RECIPE_JOURNALS.find((candidate) =>
                candidate.storyEventIds.includes(event.eventId),
              );
              const statusText =
                event.status === "locked"
                  ? "尚未解锁"
                  : event.status === "completed"
                    ? "已收录"
                    : event.unread
                      ? "待阅读"
                      : "阅读中";
              const body =
                definition === undefined
                  ? event.eventId
                  : CONTENT.getLocalizedText(
                      definition.localizationKey,
                    ) ?? definition.title;
              return (
                <article
                  className={`narrative-entry narrative-entry--${event.status}`}
                  key={event.eventId}
                >
                  <div className="narrative-entry-heading">
                    <div>
                      <span>
                        {journal === undefined
                          ? "故事记录"
                          : getRecipeName(journal.recipeId)}
                      </span>
                      <h3>{definition?.title ?? event.eventId}</h3>
                    </div>
                    <strong>{statusText}</strong>
                  </div>
                  {event.status === "locked" ? (
                    <ul>
                      {event.conditions.map((condition, index) => (
                        <li key={`${event.eventId}-${index}`}>
                          在线售出{" "}
                          {definition?.conditions[index]?.dishItemId ===
                          undefined
                            ? "指定菜品"
                            : getItemName(
                                definition.conditions[index].dishItemId,
                              )}
                          ：{condition.current}/{condition.required}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{body}</p>
                  )}
                  {event.status !== "available" ? null : (
                    <div className="narrative-actions">
                      {event.unread ? (
                        <button
                          disabled={pending}
                          type="button"
                          onClick={() => {
                            void actions.markNarrativeViewed(event.eventId);
                          }}
                        >
                          标记已读
                        </button>
                      ) : null}
                      <button
                        disabled={pending}
                        type="button"
                        onClick={() => {
                          void actions.completeNarrativeEvent(event.eventId);
                        }}
                      >
                        收录到食谱日志
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}

    </>
  );
}
