import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  AMBIENT_CONTEXTS,
  FAMILIARITY_LEVELS,
  checkGeneratedDialogueSource,
  formatValidationFailure,
  readDialogueWorkspace,
  summarizeDialogueWorkspace,
  validateDialogueWorkspace,
  writeGeneratedDialogueSource,
  writeJsonFile,
} from "./dialogue-content-tool-lib.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function printSummary(summary) {
  process.stdout.write(
    [
      `章节 ${summary.chapterCount}`,
      `地点 ${summary.locationCount}`,
      `说话人 ${summary.speakerCount}`,
      `普通闲聊 ${summary.ambientCount}`,
      `剧情对白 ${summary.storyCount}`,
      `对白行 ${summary.lineCount}`,
    ].join(" · ") + "\n",
  );
}

function printHelp() {
  process.stdout.write(`
空艇餐厅对白工具

  npm run dialogue:new          交互式新增对白
  npm run dialogue:new-chapter  新建章节 JSON
  npm run dialogue:new-speaker  新增说话人
  npm run dialogue:new-location 新增地点
  npm run dialogue:validate     校验目录和全部章节
  npm run dialogue:generate     校验并生成 TypeScript 内容
  npm run dialogue:check        检查 JSON 与生成文件是否同步
`);
}

function createPrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("交互式命令需要在终端中运行。");
  }
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askRequired(prompt, label) {
  while (true) {
    const value = (await prompt.question(label)).trim();
    if (value.length > 0) {
      return value;
    }
    process.stdout.write("该项不能为空。\n");
  }
}

async function choose(prompt, label, choices) {
  process.stdout.write(`${label}\n`);
  choices.forEach((choice, index) => {
    process.stdout.write(
      `  ${index + 1}. ${choice.label}\n`,
    );
  });
  while (true) {
    const answer = (
      await prompt.question(`请输入 1-${choices.length}：`)
    ).trim();
    const index = Number(answer) - 1;
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < choices.length
    ) {
      return choices[index].value;
    }
    process.stdout.write("选择无效，请重新输入。\n");
  }
}

function ensureValid(workspace) {
  const issues = validateDialogueWorkspace(workspace);
  if (issues.length > 0) {
    throw new Error(formatValidationFailure(issues));
  }
}

function normalizeDialogueId(kind, value) {
  const prefix = `dialogue.${kind}.`;
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

async function collectLines(prompt, speakers) {
  process.stdout.write("\n可用说话人：\n");
  speakers.forEach((speaker, index) => {
    process.stdout.write(
      `  ${index + 1}. ${speaker.name} (${speaker.id})\n`,
    );
  });
  const lines = [];
  while (true) {
    let speaker;
    while (speaker === undefined) {
      const answer = (
        await prompt.question("说话人编号或完整 ID：")
      ).trim();
      const index = Number(answer) - 1;
      speaker = Number.isInteger(index)
        ? speakers[index]
        : speakers.find((candidate) => candidate.id === answer);
      if (speaker === undefined) {
        process.stdout.write("没有找到该说话人。\n");
      }
    }
    const text = await askRequired(prompt, "对白文本：");
    lines.push({ speakerId: speaker.id, text });
    const addMore = (
      await prompt.question("继续添加下一句？(y/N)：")
    )
      .trim()
      .toLowerCase();
    if (addMore !== "y" && addMore !== "yes") {
      return lines;
    }
  }
}

async function createDialogue() {
  const workspace = await readDialogueWorkspace(repositoryRoot);
  ensureValid(workspace);
  if (workspace.chapters.length === 0) {
    throw new Error(
      "还没有章节，请先运行 npm run dialogue:new-chapter。",
    );
  }
  const prompt = createPrompt();
  try {
    const chapterEntry = await choose(
      prompt,
      "选择对白所属章节：",
      workspace.chapters.map((entry) => ({
        label: `${entry.data.title} (${entry.fileName})`,
        value: entry,
      })),
    );
    const kind = await choose(prompt, "选择对白类型：", [
      { label: "普通闲聊 ambient", value: "ambient" },
      { label: "关键剧情 story", value: "story" },
    ]);
    const suffix = await askRequired(
      prompt,
      `对白 ID 或 ${kind} 后缀：`,
    );
    const id = normalizeDialogueId(kind, suffix);
    const allIds = new Set(
      workspace.chapters.flatMap((entry) => [
        ...entry.data.ambientDialogues.map(
          (dialogue) => dialogue.id,
        ),
        ...entry.data.storyDialogues.map(
          (dialogue) => dialogue.id,
        ),
      ]),
    );
    if (allIds.has(id)) {
      throw new Error(`对白 ID "${id}" 已经存在。`);
    }

    let dialogue;
    if (kind === "ambient") {
      const rawContexts = await askRequired(
        prompt,
        `触发场景，可多选并用逗号分隔 (${AMBIENT_CONTEXTS.join(
          ", ",
        )})：`,
      );
      const contexts = [
        ...new Set(
          rawContexts
            .split(/[,，]/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      const minimumFamiliarity = await choose(
        prompt,
        "最低熟悉度：",
        FAMILIARITY_LEVELS.map((level) => ({
          label: level,
          value: level,
        })),
      );
      const prerequisites = (
        await prompt.question(
          "前置故事事件 ID，可留空，多个用逗号分隔：",
        )
      )
        .split(/[,，]/)
        .map((value) => value.trim())
        .filter(Boolean);
      dialogue = {
        id,
        contexts,
        minimumFamiliarity,
        ...(prerequisites.length === 0
          ? {}
          : { prerequisiteEventIds: prerequisites }),
        lines: await collectLines(
          prompt,
          workspace.catalog.speakers,
        ),
      };
      chapterEntry.data.ambientDialogues.push(dialogue);
    } else {
      dialogue = {
        id,
        lines: await collectLines(
          prompt,
          workspace.catalog.speakers,
        ),
      };
      chapterEntry.data.storyDialogues.push(dialogue);
    }

    ensureValid(workspace);
    await writeJsonFile(chapterEntry.filePath, chapterEntry.data);
    const refreshed = await readDialogueWorkspace(repositoryRoot);
    await writeGeneratedDialogueSource(refreshed);
    process.stdout.write(
      `\n已创建 ${id}\n文件：${chapterEntry.filePath}\n`,
    );
    printSummary(summarizeDialogueWorkspace(refreshed));
  } finally {
    prompt.close();
  }
}

async function createChapter() {
  const workspace = await readDialogueWorkspace(repositoryRoot);
  ensureValid(workspace);
  const prompt = createPrompt();
  try {
    const locationId = await choose(
      prompt,
      "选择章节地点：",
      workspace.catalog.locations.map((location) => ({
        label: `${location.name} (${location.id})`,
        value: location.id,
      })),
    );
    const fileSlug = await askRequired(
      prompt,
      "章节文件名（小写英文、数字、短横线，不含 .json）：",
    );
    if (!/^[a-z0-9][a-z0-9-]*$/.test(fileSlug)) {
      throw new Error("章节文件名格式无效。");
    }
    const filePath = path.join(
      workspace.paths.chaptersDirectory,
      `${fileSlug}.json`,
    );
    try {
      await fs.access(filePath);
      throw new Error(`章节文件已经存在：${filePath}`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const chapterId = await askRequired(
      prompt,
      "章节 ID（例如 chapter.m3.new_port）：",
    );
    const title = await askRequired(prompt, "章节显示名称：");
    const chapter = {
      $schema: "../schemas/dialogue-chapter.schema.json",
      schemaVersion: 1,
      chapterId,
      title,
      locationId,
      defaults: {
        lineDurationMs: 5_000,
        ambientWeight: 100,
        ambientCooldownMs: 600_000,
        ambientMaxPlaysPerSession: 1,
      },
      ambientDialogues: [],
      storyDialogues: [],
    };
    const candidate = {
      ...workspace,
      chapters: [
        ...workspace.chapters,
        {
          fileName: path.basename(filePath),
          filePath,
          data: chapter,
        },
      ],
    };
    ensureValid(candidate);
    await writeJsonFile(filePath, chapter);
    const refreshed = await readDialogueWorkspace(repositoryRoot);
    await writeGeneratedDialogueSource(refreshed);
    process.stdout.write(`已创建章节：${filePath}\n`);
  } finally {
    prompt.close();
  }
}

async function createSpeaker() {
  const workspace = await readDialogueWorkspace(repositoryRoot);
  ensureValid(workspace);
  const prompt = createPrompt();
  try {
    const rawId = await askRequired(
      prompt,
      "说话人 ID 或后缀：",
    );
    const id = rawId.startsWith("speaker.")
      ? rawId
      : `speaker.${rawId}`;
    const name = await askRequired(prompt, "显示名称：");
    const rawCharacterId = (
      await prompt.question(
        "关联正式角色 ID，可留空（例如 character.name）：",
      )
    ).trim();
    workspace.catalog.speakers.push({
      id,
      name,
      characterId:
        rawCharacterId.length === 0 ? null : rawCharacterId,
    });
    ensureValid(workspace);
    await writeJsonFile(
      workspace.paths.catalogPath,
      workspace.catalog,
    );
    const refreshed = await readDialogueWorkspace(repositoryRoot);
    await writeGeneratedDialogueSource(refreshed);
    process.stdout.write(`已新增说话人：${name} (${id})\n`);
  } finally {
    prompt.close();
  }
}

async function createLocation() {
  const workspace = await readDialogueWorkspace(repositoryRoot);
  ensureValid(workspace);
  const prompt = createPrompt();
  try {
    const rawId = await askRequired(
      prompt,
      "地点 ID 或后缀：",
    );
    const id = rawId.startsWith("location.")
      ? rawId
      : `location.${rawId}`;
    const name = await askRequired(prompt, "地点显示名称：");
    workspace.catalog.locations.push({ id, name });
    ensureValid(workspace);
    await writeJsonFile(
      workspace.paths.catalogPath,
      workspace.catalog,
    );
    const refreshed = await readDialogueWorkspace(repositoryRoot);
    await writeGeneratedDialogueSource(refreshed);
    process.stdout.write(`已新增地点：${name} (${id})\n`);
  } finally {
    prompt.close();
  }
}

async function main() {
  const command = process.argv[2] ?? "help";
  switch (command) {
    case "create":
      await createDialogue();
      return;
    case "create-chapter":
      await createChapter();
      return;
    case "create-speaker":
      await createSpeaker();
      return;
    case "create-location":
      await createLocation();
      return;
    case "validate": {
      const workspace =
        await readDialogueWorkspace(repositoryRoot);
      ensureValid(workspace);
      process.stdout.write("对白 JSON 校验通过。\n");
      printSummary(summarizeDialogueWorkspace(workspace));
      return;
    }
    case "generate": {
      const workspace =
        await readDialogueWorkspace(repositoryRoot);
      await writeGeneratedDialogueSource(workspace);
      process.stdout.write(
        `已生成：${workspace.paths.generatedSourcePath}\n`,
      );
      printSummary(summarizeDialogueWorkspace(workspace));
      return;
    }
    case "check": {
      const workspace =
        await readDialogueWorkspace(repositoryRoot);
      const summary =
        await checkGeneratedDialogueSource(workspace);
      process.stdout.write("对白 JSON 与生成文件同步。\n");
      printSummary(summary);
      return;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`未知命令 "${command}"。`);
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
