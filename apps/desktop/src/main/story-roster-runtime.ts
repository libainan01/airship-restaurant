import type { ContentRegistry } from "@airship-restaurant/content";
import {
  StoryRosterCustomerEventAdapter,
  StoryRosterModule,
  type DomainEventBus,
  type StoryRosterCharacterLookupPort,
  type StoryRosterFinishedMealLookupPort,
  type StoryRosterState,
  type StorySequenceSystem,
} from "@airship-restaurant/core";

export function createDesktopStoryRosterRuntime(
  content: ContentRegistry,
  initialState?: StoryRosterState,
): StoryRosterModule {
  const localize = (key: string): string => {
    const value = content.getLocalizedText(key);
    if (value === undefined) throw new Error(`Missing story roster localization "${key}".`);
    return value;
  };
  return new StoryRosterModule({
    characters: content.listStoryCharacters().map((profile) => Object.freeze({
      characterId: profile.characterId,
      identity: localize(profile.identityLocalizationKey),
      relationshipTiers: profile.relationshipTiers,
    })),
    nodes: content.listStoryRosterNodes().map((node) => Object.freeze({
      id: node.id,
      characterId: node.characterId,
      sequence: node.sequence,
      hint: localize(node.hintLocalizationKey),
      summary: localize(node.summaryLocalizationKey),
      prerequisiteNodeIds: node.prerequisiteNodeIds,
      rewardContentIds: node.rewardContentIds,
    })),
    affinityByQuality: Object.freeze(Object.fromEntries(
      content.listMealAffinityQualityTiers().map((tier) => [tier.qualityTier, tier.affinityIncrease]),
    )),
    ...(initialState === undefined ? {} : { initialState }),
  });
}
export function createDesktopStoryRosterCustomerAdapter(dependencies: {
  readonly content: ContentRegistry;
  readonly eventBus: DomainEventBus;
  readonly roster: StoryRosterModule;
  readonly characters: StoryRosterCharacterLookupPort;
  readonly finishedMeals: StoryRosterFinishedMealLookupPort;
  readonly onChanged?: () => void;
}): StoryRosterCustomerEventAdapter {
  return new StoryRosterCustomerEventAdapter({
    eventBus: dependencies.eventBus,
    roster: dependencies.roster,
    characters: dependencies.characters,
    finishedMeals: dependencies.finishedMeals,
    storyCharacterIds: dependencies.content.listStoryCharacters().map((profile) => profile.characterId),
    qualityTiers: dependencies.content.listMealAffinityQualityTiers().map((tier) => ({
      qualityTier: tier.qualityTier,
      minimumQuality: tier.minimumQuality,
    })),
    ...(dependencies.onChanged === undefined ? {} : { onChanged: dependencies.onChanged }),
  });
}
/** Reconciles content-owned roster conditions against the production story sequence snapshot. */
export class DesktopStoryRosterSequenceRuntime {
  constructor(private readonly dependencies: {
    readonly content: ContentRegistry;
    readonly eventBus: DomainEventBus;
    readonly roster: StoryRosterModule;
    readonly story: StorySequenceSystem;
  }) {}

  reconcile(): boolean {
    const completedStages = new Map(
      this.dependencies.story.getSnapshot().stages
        .filter((stage) => stage.status === "completed" && stage.completedAtUtcMs !== null)
        .map((stage) => [stage.stageId, stage.completedAtUtcMs!]),
    );
    let changed = false;
    const publish = (events: readonly { readonly id: string; readonly type: string; readonly occurredAtUtcMs: number; readonly payload: unknown }[]): void => {
      if (events.length > 0) this.dependencies.eventBus.publishAll(events);
    };
    for (const node of this.dependencies.content.listStoryRosterNodes()) {
      const availableAt = completedStages.get(node.availableWhen.stageId);
      if (availableAt === undefined) continue;
      const discovered = this.dependencies.roster.discover(
        `story-roster:sequence:discover:${node.id}:${node.availableWhen.stageId}`,
        node.characterId,
        availableAt,
      );
      if (discovered.accepted) {
        changed ||= discovered.changed;
        publish(discovered.events);
      }
      const available = this.dependencies.roster.makeNodeAvailable(
        `story-roster:sequence:available:${node.id}:${node.availableWhen.stageId}`,
        node.id,
        availableAt,
      );
      if (available.accepted) {
        changed ||= available.changed;
        publish(available.events);
      }
      const completedAt = completedStages.get(node.completeWhen.stageId);
      if (completedAt === undefined) continue;
      const completed = this.dependencies.roster.completeNode(
        `story-roster:sequence:complete:${node.id}:${node.completeWhen.stageId}`,
        node.id,
        completedAt,
      );
      if (completed.accepted) {
        changed ||= completed.changed;
        publish(completed.events);
      }
    }
    return changed;
  }
}