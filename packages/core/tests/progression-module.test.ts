import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  ProgressionModule,
  isProgressionState,
  type ProgressionContentDefinition,
} from "../src";

const DEFINITIONS = Object.freeze([
  {
    id: "region.greyfeather", kind: "region", name: "灰羽港", spoilerSensitive: false,
    initiallyRevealed: true, initiallyUnlocked: true, revealSources: [], unlockSources: [],
  },
  {
    id: "region.windroot", kind: "region", name: "风根谷", spoilerSensitive: false,
    initiallyRevealed: true, initiallyUnlocked: false, revealSources: [],
    unlockSources: [
      { id: "source.story.windroot", requirements: [{ kind: "fact", factId: "story.windroot.completed" }] },
      { id: "source.friendship.guide", requirements: [{ kind: "fact", factId: "relationship.guide.level", minimumValue: 3 }] },
    ],
  },
  {
    id: "route.greyfeather-windroot", kind: "route", name: "灰羽—风根航线", spoilerSensitive: true,
    initiallyRevealed: false, initiallyUnlocked: false,
    revealSources: [{ id: "source.chart", requirements: [{ kind: "fact", factId: "map.windroot.chart-found" }] }],
    unlockSources: [{ id: "source.port", requirements: [
      { kind: "content-unlocked", contentId: "region.windroot" },
      { kind: "fact", factId: "port.windroot.repaired" },
    ] }],
  },
  {
    id: "recipe.homecoming_stew", kind: "recipe", name: "贝尔家的炉火炖菜", spoilerSensitive: true,
    initiallyRevealed: false, initiallyUnlocked: false,
    revealSources: [{ id: "source.recipe-clue", requirements: [{ kind: "fact", factId: "story.bell.recipe-clue" }] }],
    unlockSources: [{ id: "source.recipe-journal", requirements: [{ kind: "fact", factId: "story.bell.journal-completed" }] }],
  },
  {
    id: "building.prep_station", kind: "building", name: "备菜台", spoilerSensitive: false,
    initiallyRevealed: true, initiallyUnlocked: true, revealSources: [], unlockSources: [],
  },
  {
    id: "style.prep_station.brass", kind: "building-style", name: "黄铜备菜台", spoilerSensitive: true,
    initiallyRevealed: false, initiallyUnlocked: false, revealSources: [], unlockSources: [],
  },
] as const satisfies readonly ProgressionContentDefinition[]);

function fixture(initialState?: ConstructorParameters<typeof ProgressionModule>[0]["initialState"]) {
  const values = new Map<string, boolean | number>();
  const eventBus = new DomainEventBus();
  const progression = new ProgressionModule({
    definitions: DEFINITIONS,
    facts: { getFactValue: (factId) => values.get(factId) ?? null },
    eventBus,
    ...(initialState === undefined ? {} : { initialState }),
  });
  return { values, eventBus, progression };
}

function content(module: ProgressionModule, id: string) {
  return module.createReadModel().contents.find((entry) => entry.id === id);
}

describe("ProgressionModule", () => {
  it("separates initial permanent qualifications from hidden spoiler content", () => {
    const { progression } = fixture();
    expect(progression.createReadModel()).toMatchObject({ revision: 0, revealedCount: 3, unlockedCount: 2 });
    expect(content(progression, "region.greyfeather")).toMatchObject({ status: "unlocked", name: "灰羽港" });
    expect(content(progression, "region.windroot")).toMatchObject({ status: "locked", name: "风根谷" });
    expect(content(progression, "route.greyfeather-windroot")).toMatchObject({ status: "hidden", name: null });
    expect(progression.isBuildingUnlocked("building.prep_station")).toBe(true);
    expect(progression.isBuildingUnlocked("building.unknown")).toBe(false);
  });

  it("evaluates alternative sources and cascades content prerequisites in one operation", () => {
    const { values, eventBus, progression } = fixture();
    const types: string[] = [];
    eventBus.subscribe("*", (event) => {
      const contentId = (event.payload as { contentId?: string }).contentId;
      types.push(contentId === undefined ? event.type : `${event.type}:${contentId}`);
    });
    values.set("story.windroot.completed", true);
    values.set("map.windroot.chart-found", true);
    values.set("port.windroot.repaired", true);

    expect(progression.evaluate("progression:windroot", 10)).toMatchObject({
      accepted: true,
      changed: true,
      revealedContentIds: ["route.greyfeather-windroot"],
      unlockedContentIds: ["region.windroot", "route.greyfeather-windroot"],
    });
    expect(types).toEqual([
      "progression.content-revealed:route.greyfeather-windroot",
      "progression.content-unlocked:region.windroot",
      "progression.content-unlocked:route.greyfeather-windroot",
      "progression.unlock-batch-completed",
    ]);
    expect(progression.isContentUnlocked("region", "region.windroot")).toBe(true);
    expect(progression.isContentUnlocked("route", "route.greyfeather-windroot")).toBe(true);
  });

  it("can reveal without granting and exposes the unlockable transition", () => {
    const { values, progression } = fixture();
    values.set("story.bell.journal-completed", true);
    expect(progression.reveal("progression:reveal-recipe", ["recipe.homecoming_stew"], "story.bell.clue", 20))
      .toMatchObject({ accepted: true, changed: true, revealedContentIds: ["recipe.homecoming_stew"], unlockedContentIds: [] });
    expect(content(progression, "recipe.homecoming_stew")).toMatchObject({ status: "unlockable", name: "贝尔家的炉火炖菜" });
    expect(progression.evaluate("progression:unlock-recipe", 21)).toMatchObject({ accepted: true, unlockedContentIds: ["recipe.homecoming_stew"] });
  });

  it("supports numeric facts and multiple alternative unlock sources", () => {
    const { values, progression } = fixture();
    values.set("relationship.guide.level", 2);
    const beforePolling = progression.exportState();
    expect(progression.evaluate("progression:relationship-low", 30)).toMatchObject({ accepted: true, changed: false });
    expect(progression.exportState()).toEqual(beforePolling);
    values.set("relationship.guide.level", 3);
    expect(progression.evaluate("progression:relationship-ready", 31)).toMatchObject({ accepted: true, unlockedContentIds: ["region.windroot"] });
  });

  it("grants a batch once, accepts later no-op rewards, and rejects duplicate operations", () => {
    const { eventBus, progression } = fixture();
    const events: string[] = [];
    const summaries: unknown[] = [];
    eventBus.subscribe("progression.content-unlocked", (event) => events.push(event.id));
    eventBus.subscribe("progression.unlock-batch-completed", (event) => summaries.push(event.payload));
    const ids = ["recipe.homecoming_stew", "style.prep_station.brass"];
    expect(progression.grantUnlocks("reward:bell", ids, "story.node.bell", 40)).toMatchObject({ accepted: true, changed: true, unlockedContentIds: ids });
    expect(progression.grantUnlocks("reward:bell-replay", ids, "story.node.bell", 41)).toMatchObject({ accepted: true, changed: false, events: [] });
    expect(progression.grantUnlocks("reward:bell", ids, "story.node.bell", 42)).toMatchObject({ accepted: false, code: "DUPLICATE_OPERATION" });
    expect(events).toHaveLength(2);
    expect(summaries).toEqual([{
      sourceId: "story.node.bell",
      unlockedContentIds: ids,
      groups: [
        { kind: "recipe", count: 1, contentIds: ["recipe.homecoming_stew"] },
        { kind: "building-style", count: 1, contentIds: ["style.prep_station.brass"] },
      ],
    }]);
  });

  it("restores silently, preserves retired ids, and merges new default content", () => {
    const state = {
      schemaVersion: 1 as const,
      revision: 4,
      revealedContentIds: ["region.greyfeather", "mod.retired"],
      unlockedContentIds: ["region.greyfeather", "mod.retired"],
      processedOperationIds: ["old:operation"],
    };
    expect(isProgressionState(state)).toBe(true);
    const { eventBus, progression } = fixture(state);
    const events: string[] = [];
    eventBus.subscribe("*", (event) => events.push(event.type));
    expect(progression.exportState()).toMatchObject({
      revision: 4,
      revealedContentIds: expect.arrayContaining(["region.greyfeather", "building.prep_station", "mod.retired"]),
      unlockedContentIds: expect.arrayContaining(["region.greyfeather", "building.prep_station", "mod.retired"]),
    });
    expect(events).toEqual([]);
  });

  it("rejects invalid saved subsets and cyclic content dependencies", () => {
    expect(isProgressionState({ schemaVersion: 1, revision: 0, revealedContentIds: [], unlockedContentIds: ["recipe.hidden"], processedOperationIds: [] })).toBe(false);
    const common = { kind: "recipe" as const, name: "测试", spoilerSensitive: false, initiallyRevealed: true, initiallyUnlocked: false, revealSources: [] };
    expect(() => new ProgressionModule({
      facts: { getFactValue: () => null },
      definitions: [
        { ...common, id: "recipe.a", unlockSources: [{ id: "source.a", requirements: [{ kind: "content-unlocked", contentId: "recipe.b" }] }] },
        { ...common, id: "recipe.b", unlockSources: [{ id: "source.b", requirements: [{ kind: "content-unlocked", contentId: "recipe.a" }] }] },
      ],
    })).toThrow(/cycle/i);
  });
});