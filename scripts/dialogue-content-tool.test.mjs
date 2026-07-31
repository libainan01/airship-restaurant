import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkGeneratedDialogueSource,
  renderGeneratedDialogueSource,
  summarizeDialogueWorkspace,
  validateDialogueWorkspace,
} from "./dialogue-content-tool-lib.mjs";

function createWorkspace() {
  return {
    catalog: {
      $schema: "./schema.json",
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
    },
    chapters: [
      {
        fileName: "test-chapter.json",
        data: {
          $schema: "../schema.json",
          schemaVersion: 1,
          chapterId: "chapter.test.harbor",
          title: "测试章节",
          locationId: "location.test_harbor",
          defaults: {
            lineDurationMs: 5_000,
            ambientWeight: 100,
            ambientCooldownMs: 600_000,
            ambientMaxPlaysPerSession: 1,
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
        },
      },
    ],
  };
}

test("accepts a valid chapter workspace and summarizes it", () => {
  const workspace = createWorkspace();

  assert.deepEqual(validateDialogueWorkspace(workspace), []);
  assert.deepEqual(summarizeDialogueWorkspace(workspace), {
    chapterCount: 1,
    locationCount: 1,
    speakerCount: 1,
    ambientCount: 1,
    storyCount: 1,
    lineCount: 2,
  });
});

test("reports duplicate ids and unknown speakers", () => {
  const workspace = createWorkspace();
  workspace.chapters[0].data.storyDialogues[0].id =
    "dialogue.ambient.test_greeting";
  workspace.chapters[0].data.storyDialogues[0].lines[0].speakerId =
    "speaker.missing";

  const issues = validateDialogueWorkspace(workspace);

  assert.ok(
    issues.some((issue) => issue.includes("未知说话人")),
  );
  assert.ok(issues.some((issue) => issue.includes("重复 ID")));
  assert.ok(
    issues.some((issue) =>
      issue.includes("dialogue.story.x 格式"),
    ),
  );
});

test("renders deterministic TypeScript without editor schema fields", () => {
  const workspace = createWorkspace();
  const first = renderGeneratedDialogueSource(workspace);
  const second = renderGeneratedDialogueSource(workspace);

  assert.equal(first, second);
  assert.match(first, /GENERATED_DIALOGUE_CATALOG/);
  assert.match(first, /GENERATED_DIALOGUE_CHAPTERS/);
  assert.doesNotMatch(first, /\$schema/);
});

test("detects stale generated dialogue source", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "airship-dialogue-tool-"),
  );
  context.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const generatedSourcePath = path.join(
    directory,
    "generated-dialogue-source.ts",
  );
  const workspace = {
    ...createWorkspace(),
    paths: { generatedSourcePath },
  };
  await fs.writeFile(
    generatedSourcePath,
    renderGeneratedDialogueSource(workspace),
    "utf8",
  );

  await assert.doesNotReject(() =>
    checkGeneratedDialogueSource(workspace),
  );
  await fs.writeFile(generatedSourcePath, "stale\n", "utf8");
  await assert.rejects(
    () => checkGeneratedDialogueSource(workspace),
    /未同步/,
  );
});
