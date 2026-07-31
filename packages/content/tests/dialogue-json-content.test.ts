import { describe, expect, it } from "vitest";
import {
  buildDialogueContentFromJson,
  type DialogueCatalogSource,
  type DialogueChapterSource,
} from "../src/m3-dialogue/dialogue-json-content";

const catalog: DialogueCatalogSource = {
  schemaVersion: 1,
  locations: [
    {
      id: "location.test_harbor",
      name: "测试港",
    },
  ],
  speakers: [
    {
      id: "speaker.test_guest",
      name: "测试客人",
      characterId: null,
    },
  ],
};

const chapter: DialogueChapterSource = {
  schemaVersion: 1,
  chapterId: "chapter.test.harbor",
  title: "测试章节",
  locationId: "location.test_harbor",
  defaults: {
    lineDurationMs: 4_000,
    ambientWeight: 80,
    ambientCooldownMs: 30_000,
    ambientMaxPlaysPerSession: 2,
  },
  ambientDialogues: [
    {
      id: "dialogue.ambient.test_greeting",
      contexts: ["arrival"],
      minimumFamiliarity: "new",
      lines: [
        {
          speakerId: "speaker.test_guest",
          text: "晚上好。",
          durationMs: 6_000,
        },
      ],
    },
  ],
  storyDialogues: [
    {
      id: "dialogue.story.test_memory",
      lines: [
        {
          speakerId: "speaker.test_guest",
          text: "我以前来过这里。",
        },
      ],
    },
  ],
};

describe("dialogue JSON content loader", () => {
  it("builds typed content with chapter defaults and line overrides", () => {
    const content = buildDialogueContentFromJson(catalog, [
      chapter,
    ]);

    expect(content.locations).toHaveLength(1);
    expect(content.speakers).toHaveLength(1);
    expect(content.ambientDialogues[0]).toMatchObject({
      id: "dialogue.ambient.test_greeting",
      locationId: "location.test_harbor",
      weight: 80,
      cooldownMs: 30_000,
      maxPlaysPerSession: 2,
      lines: [
        {
          speakerId: "speaker.test_guest",
          durationMs: 6_000,
        },
      ],
    });
    expect(content.storyDialogues[0]).toMatchObject({
      id: "dialogue.story.test_memory",
      lines: [
        {
          durationMs: 4_000,
        },
      ],
    });
    expect(
      content.localizations[
        "localization.dialogue.story.test_memory.line_1"
      ],
    ).toBe("我以前来过这里。");
  });

  it("rejects dialogue ids with the wrong runtime prefix", () => {
    const invalidChapter: DialogueChapterSource = {
      ...chapter,
      ambientDialogues: [
        {
          ...chapter.ambientDialogues[0]!,
          id: "dialogue.story.wrong_kind",
        },
      ],
    };

    expect(() =>
      buildDialogueContentFromJson(catalog, [invalidChapter]),
    ).toThrow(/dialogue\.ambient/);
  });
});
