import type {
  ProgressionContentKindReadModel,
  ProgressionReadModel,
  ProgressionUnavailableReasonReadModel,
} from "@airship-restaurant/contracts";
import type {
  ProgressionContentKind,
  ProgressionReadModel as ProgressionDomainReadModel,
} from "../modules";

export const PROGRESSION_READ_MODEL_KEY = "progression";

export interface ProgressionAvailabilityPort {
  getUnavailableReasons(
    kind: ProgressionContentKind,
    contentId: string,
  ): readonly ProgressionUnavailableReasonReadModel[];
}

export const EMPTY_PROGRESSION_READ_MODEL: ProgressionReadModel = Object.freeze({
  sourceRevision: 0,
  revealedCount: 0,
  unlockedCount: 0,
  contents: Object.freeze([]),
});

export function projectProgressionReadModel(
  source: ProgressionDomainReadModel,
  availability?: ProgressionAvailabilityPort,
): ProgressionReadModel {
  const contents = source.contents.flatMap((content) => {
    if (content.status === "hidden" || content.name === null) return [];
    const unavailableReasons = content.status === "unlocked"
      ? availability?.getUnavailableReasons(content.kind, content.id) ?? []
      : [{
          code: content.status === "unlockable" ? "UNLOCK_PENDING" : "CONTENT_LOCKED",
          message: content.status === "unlockable" ? "解锁条件已经满足，正在确认资格。" : "内容尚未解锁。",
        }];
    return [Object.freeze({
      id: content.id,
      kind: content.kind as ProgressionContentKindReadModel,
      name: content.name,
      status: content.status,
      currentlyUsable: content.status === "unlocked" && unavailableReasons.length === 0,
      unavailableReasons: Object.freeze(unavailableReasons.map((reason) => Object.freeze({ ...reason }))),
      unlockSourceIds: Object.freeze([...content.unlockSourceIds]),
    })];
  });
  return Object.freeze({
    sourceRevision: source.revision,
    revealedCount: source.revealedCount,
    unlockedCount: source.unlockedCount,
    contents: Object.freeze(contents),
  });
}