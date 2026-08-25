import type {
  ContentDefinitions,
  MealAffinityQualityTierDefinition,
  StoryCharacterProfileDefinition,
  StoryRosterNodeDefinition,
} from "./definitions";

const ID = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
const validId = (value: string, prefix: string): boolean => ID.test(value) && value.startsWith(prefix + ".");
const nonNegative = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const cloneProfile = (value: StoryCharacterProfileDefinition): StoryCharacterProfileDefinition => Object.freeze({
  ...value,
  relationshipTiers: Object.freeze(value.relationshipTiers.map((tier) => Object.freeze({ ...tier }))),
});
const cloneNode = (value: StoryRosterNodeDefinition): StoryRosterNodeDefinition => Object.freeze({
  ...value,
  prerequisiteNodeIds: Object.freeze([...value.prerequisiteNodeIds]),
  rewardContentIds: Object.freeze([...value.rewardContentIds]),
  availableWhen: Object.freeze({ ...value.availableWhen }),
  completeWhen: Object.freeze({ ...value.completeWhen }),
});

export class StoryRosterContentRegistry {
  readonly #profiles: ReadonlyMap<string, StoryCharacterProfileDefinition>;
  readonly #nodes: ReadonlyMap<string, StoryRosterNodeDefinition>;
  readonly #qualityTiers: readonly MealAffinityQualityTierDefinition[];

  constructor(
    definitions: ContentDefinitions,
    characterIds: ReadonlySet<string>,
    progressionIds: ReadonlySet<string>,
    storyStageIds: ReadonlySet<string>,
    issues: string[],
  ) {
    const profiles = definitions.storyCharacters ?? [];
    const nodes = definitions.storyRosterNodes ?? [];
    const qualityTiers = definitions.mealAffinityQualityTiers ?? [];
    const localizations = definitions.localizations ?? {};
    const profileIds = new Set<string>();
    for (const profile of profiles) {
      if (!characterIds.has(profile.characterId) || profileIds.has(profile.characterId))
        issues.push(`Story profile references unknown or duplicate character "${profile.characterId}".`);
      profileIds.add(profile.characterId);
      if (!(profile.identityLocalizationKey in localizations))
        issues.push(`Story profile "${profile.characterId}" has unknown identity localization.`);
      if (profile.relationshipTiers.length === 0)
        issues.push(`Story profile "${profile.characterId}" requires relationship tiers.`);
      const tierIds = new Set<string>();
      profile.relationshipTiers.forEach((tier, index) => {
        if (!validId(tier.id, "relationship") || tierIds.has(tier.id) || !nonNegative(tier.minimumAffinity) ||
          (index === 0 ? tier.minimumAffinity !== 0 : tier.minimumAffinity <= profile.relationshipTiers[index - 1]!.minimumAffinity))
          issues.push(`Story profile "${profile.characterId}" has invalid relationship tier "${tier.id}".`);
        tierIds.add(tier.id);
      });
    }

    if (qualityTiers.length === 0) issues.push("Story roster requires meal affinity quality tiers.");
    const qualityIds = new Set<number>();
    qualityTiers.forEach((tier, index) => {
      if (!positive(tier.qualityTier) || qualityIds.has(tier.qualityTier) || !nonNegative(tier.minimumQuality) ||
        !positive(tier.affinityIncrease) ||
        (index > 0 && tier.minimumQuality <= qualityTiers[index - 1]!.minimumQuality))
        issues.push(`Invalid meal affinity quality tier "${tier.qualityTier}".`);
      qualityIds.add(tier.qualityTier);
    });

    const nodeIds = new Set<string>();
    const sequences = new Map<string, Set<number>>();
    for (const node of nodes) {
      if (!validId(node.id, "story_node") || nodeIds.has(node.id) || !profileIds.has(node.characterId) ||
        !positive(node.sequence) || !(node.hintLocalizationKey in localizations) ||
        !(node.summaryLocalizationKey in localizations) ||
        node.availableWhen.type !== "story-stage-completed" || !storyStageIds.has(node.availableWhen.stageId) ||
        node.completeWhen.type !== "story-stage-completed" || !storyStageIds.has(node.completeWhen.stageId))
        issues.push(`Invalid story roster node "${node.id}".`);
      nodeIds.add(node.id);
      const used = sequences.get(node.characterId) ?? new Set<number>();
      if (used.has(node.sequence)) issues.push(`Story character "${node.characterId}" repeats node sequence ${node.sequence}.`);
      used.add(node.sequence);
      sequences.set(node.characterId, used);
      if (new Set(node.prerequisiteNodeIds).size !== node.prerequisiteNodeIds.length ||
        new Set(node.rewardContentIds).size !== node.rewardContentIds.length)
        issues.push(`Story roster node "${node.id}" repeats prerequisites or rewards.`);
      for (const rewardId of node.rewardContentIds) {
        if (!progressionIds.has(rewardId)) issues.push(`Story roster node "${node.id}" references unknown progression reward "${rewardId}".`);
      }
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      for (const prerequisiteId of node.prerequisiteNodeIds) {
        const prerequisite = byId.get(prerequisiteId);
        if (prerequisite === undefined || prerequisite.characterId !== node.characterId ||
          prerequisite.sequence >= node.sequence)
          issues.push(`Story roster node "${node.id}" has invalid prerequisite "${prerequisiteId}".`);
      }
    }

    this.#profiles = new Map(profiles.map((profile) => [profile.characterId, cloneProfile(profile)]));
    this.#nodes = new Map(nodes.map((node) => [node.id, cloneNode(node)]));
    this.#qualityTiers = Object.freeze(qualityTiers.map((tier) => Object.freeze({ ...tier })));
  }

  listProfiles(): readonly StoryCharacterProfileDefinition[] { return Object.freeze([...this.#profiles.values()]); }
  listNodes(): readonly StoryRosterNodeDefinition[] { return Object.freeze([...this.#nodes.values()]); }
  listQualityTiers(): readonly MealAffinityQualityTierDefinition[] { return Object.freeze([...this.#qualityTiers]); }
  getProfile(characterId: string): StoryCharacterProfileDefinition | undefined { return this.#profiles.get(characterId); }
  getNode(nodeId: string): StoryRosterNodeDefinition | undefined { return this.#nodes.get(nodeId); }
}
