import type { ProgressionReadModel } from "@airship-restaurant/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProgressionDialog } from "../src/renderer/management/features/progression/ProgressionDialog";

const progression: ProgressionReadModel = {
  sourceRevision: 3,
  revealedCount: 3,
  unlockedCount: 2,
  contents: [
    {
      id: "region.greyfeather",
      kind: "region",
      name: "灰羽港",
      status: "unlocked",
      currentlyUsable: true,
      unavailableReasons: [],
      unlockSourceIds: [],
    },
    {
      id: "recipe.windroot_soup",
      kind: "recipe",
      name: "风根浓汤",
      status: "locked",
      currentlyUsable: false,
      unavailableReasons: [{ code: "CONTENT_LOCKED", message: "内容尚未解锁。" }],
      unlockSourceIds: ["source.windroot_region"],
    },
    {
      id: "building.airship_exchange_station",
      kind: "building",
      name: "飞艇交换站",
      status: "unlocked",
      currentlyUsable: false,
      unavailableReasons: [{ code: "MISSING_SPACE", message: "当前场景没有可用空间。" }],
      unlockSourceIds: [],
    },
  ],
};

describe("ProgressionDialog", () => {
  it("groups revealed content and distinguishes unlock from current usability", () => {
    const html = renderToStaticMarkup(
      <ProgressionDialog
        open
        progression={progression}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("成长与内容图鉴");
    expect(html).toContain("2</strong><span>项已解锁");
    expect(html).toContain("灰羽港");
    expect(html).toContain("已解锁 · 当前可用");
    expect(html).toContain("风根浓汤");
    expect(html).toContain("尚未解锁");
    expect(html).toContain("飞艇交换站");
    expect(html).toContain("已解锁 · 暂不可用");
    expect(html).toContain("当前场景没有可用空间。");
    expect(html).not.toContain("source.windroot_region");
  });

  it("renders nothing while closed", () => {
    expect(renderToStaticMarkup(
      <ProgressionDialog
        open={false}
        progression={progression}
        onClose={vi.fn()}
      />,
    )).toBe("");
  });
});