import type { OperationsReadModel } from "@airship-restaurant/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoryPanels } from "../src/renderer/management/features/story/StoryPanels";

const actions = {
  replayStoryDialogue: vi.fn(async () => true),
  markNarrativeViewed: vi.fn(async () => true),
  completeNarrativeEvent: vi.fn(async () => true),
};

function operationsWithRoster(
  storyRoster: OperationsReadModel["storyRoster"],
): OperationsReadModel {
  return {
    sourceRevision: 1,
    storyRoster,
    story: null,
    narrative: null,
  } as OperationsReadModel;
}

describe("StoryPanels story roster", () => {
  it("shows only projected discovered characters and keeps unfinished story details hidden", () => {
    const html = renderToStaticMarkup(
      <StoryPanels
        actions={actions}
        pending={false}
        operations={operationsWithRoster({
          revision: 4,
          characters: [
            {
              characterId: "character.martha_bell",
              identity: "玛莎·贝尔",
              affinity: 7,
              relationshipTierId: "familiar",
              completedNodeCount: 1,
              totalNodeCount: 2,
              nodes: [
                {
                  id: "story_node.martha_bell.first_service",
                  status: "completed",
                  hint: null,
                  summary: "一顿热饭让她重新想起了旧日约定。",
                  rewardContentIds: ["region.windroot"],
                },
                {
                  id: "story_node.martha_bell.second_service",
                  status: "locked",
                  hint: "她似乎还在等一道熟悉的菜。",
                  summary: null,
                  rewardContentIds: [],
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(html).toContain("故事顾客花名册");
    expect(html).toContain("玛莎·贝尔");
    expect(html).toContain("渐渐熟悉");
    expect(html).toContain("好感 7");
    expect(html).toContain("一顿热饭让她重新想起了旧日约定。");
    expect(html).toContain("她似乎还在等一道熟悉的菜。");
    expect(html).toContain("解锁：风根谷");
    expect(html).not.toContain("story_node.martha_bell");
  });

  it("renders an empty-state instead of undiscovered profiles", () => {
    const html = renderToStaticMarkup(
      <StoryPanels
        actions={actions}
        pending={false}
        operations={operationsWithRoster({ revision: 0, characters: [] })}
      />,
    );

    expect(html).toContain("还没有遇见值得记录的故事顾客");
    expect(html).not.toContain("玛莎·贝尔");
  });
});