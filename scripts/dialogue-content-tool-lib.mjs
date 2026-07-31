import { promises as fs } from "node:fs";
import path from "node:path";

export const AMBIENT_CONTEXTS = Object.freeze([
  "arrival",
  "waiting",
  "eating",
  "departing",
  "idle",
]);
export const FAMILIARITY_LEVELS = Object.freeze([
  "new",
  "returning",
  "regular",
]);

const CATALOG_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "locations",
  "speakers",
]);
const CHAPTER_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "chapterId",
  "title",
  "locationId",
  "defaults",
  "ambientDialogues",
  "storyDialogues",
]);
const AMBIENT_KEYS = new Set([
  "id",
  "contexts",
  "minimumFamiliarity",
  "prerequisiteEventIds",
  "weight",
  "cooldownMs",
  "maxPlaysPerSession",
  "lines",
]);
const STORY_KEYS = new Set(["id", "lines"]);
const LINE_KEYS = new Set([
  "speakerId",
  "text",
  "durationMs",
]);

export function resolveDialoguePaths(repositoryRoot) {
  const dataDirectory = path.join(
    repositoryRoot,
    "packages",
    "content",
    "data",
    "dialogues",
  );
  return Object.freeze({
    repositoryRoot,
    dataDirectory,
    catalogPath: path.join(dataDirectory, "catalog.json"),
    chaptersDirectory: path.join(dataDirectory, "chapters"),
    generatedSourcePath: path.join(
      repositoryRoot,
      "packages",
      "content",
      "src",
      "m3-dialogue",
      "generated-dialogue-source.ts",
    ),
  });
}

function isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerAtLeast(value, minimum) {
  return Number.isInteger(value) && value >= minimum;
}

function pushUnknownKeys(issues, value, allowed, label) {
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(`${label} 包含未知字段 "${key}"。`);
    }
  }
}

function pushDuplicateIssues(issues, values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push(`${label}存在重复 ID "${value}"。`);
    }
    seen.add(value);
  }
}

async function readJson(jsonPath) {
  const text = await fs.readFile(jsonPath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `无法解析 JSON：${path.basename(jsonPath)}\n${message}`,
    );
  }
}

export async function readDialogueWorkspace(repositoryRoot) {
  const paths = resolveDialoguePaths(repositoryRoot);
  const catalog = await readJson(paths.catalogPath);
  const entries = await fs.readdir(paths.chaptersDirectory, {
    withFileTypes: true,
  });
  const chapterFileNames = entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  const chapters = [];
  for (const fileName of chapterFileNames) {
    chapters.push({
      fileName,
      filePath: path.join(paths.chaptersDirectory, fileName),
      data: await readJson(
        path.join(paths.chaptersDirectory, fileName),
      ),
    });
  }
  return Object.freeze({ paths, catalog, chapters });
}

function validateLine(
  issues,
  line,
  label,
  knownSpeakerIds,
) {
  if (!isRecord(line)) {
    issues.push(`${label}必须是对象。`);
    return;
  }
  pushUnknownKeys(issues, line, LINE_KEYS, label);
  if (
    !isNonEmptyString(line.speakerId) ||
    !knownSpeakerIds.has(line.speakerId)
  ) {
    issues.push(
      `${label}引用了未知说话人 "${String(line.speakerId)}"。`,
    );
  }
  if (!isNonEmptyString(line.text)) {
    issues.push(`${label}的 text 不能为空。`);
  }
  if (
    line.durationMs !== undefined &&
    !isIntegerAtLeast(line.durationMs, 1)
  ) {
    issues.push(`${label}的 durationMs 必须是正整数。`);
  }
}

function validateLines(
  issues,
  lines,
  label,
  knownSpeakerIds,
) {
  if (!Array.isArray(lines) || lines.length === 0) {
    issues.push(`${label}至少需要一句对白。`);
    return;
  }
  lines.forEach((line, index) =>
    validateLine(
      issues,
      line,
      `${label}第 ${index + 1} 句`,
      knownSpeakerIds,
    ),
  );
}

function validateAmbientDialogue(
  issues,
  dialogue,
  label,
  knownSpeakerIds,
) {
  if (!isRecord(dialogue)) {
    issues.push(`${label}必须是对象。`);
    return;
  }
  pushUnknownKeys(issues, dialogue, AMBIENT_KEYS, label);
  if (
    !isNonEmptyString(dialogue.id) ||
    !/^dialogue\.ambient\.[a-z0-9_]+$/.test(dialogue.id)
  ) {
    issues.push(
      `${label}的 id 必须符合 dialogue.ambient.x 格式。`,
    );
  }
  if (
    !Array.isArray(dialogue.contexts) ||
    dialogue.contexts.length === 0 ||
    dialogue.contexts.some(
      (context) => !AMBIENT_CONTEXTS.includes(context),
    ) ||
    new Set(dialogue.contexts).size !== dialogue.contexts.length
  ) {
    issues.push(`${label}必须提供不重复的有效 contexts。`);
  }
  if (
    !FAMILIARITY_LEVELS.includes(
      dialogue.minimumFamiliarity,
    )
  ) {
    issues.push(`${label}的 minimumFamiliarity 无效。`);
  }
  if (
    dialogue.prerequisiteEventIds !== undefined &&
    (!Array.isArray(dialogue.prerequisiteEventIds) ||
      dialogue.prerequisiteEventIds.some(
        (eventId) =>
          !isNonEmptyString(eventId) ||
          !/^story\.[a-z0-9_]+$/.test(eventId),
      ) ||
      new Set(dialogue.prerequisiteEventIds).size !==
        dialogue.prerequisiteEventIds.length)
  ) {
    issues.push(
      `${label}的 prerequisiteEventIds 必须是不重复的故事事件 ID。`,
    );
  }
  for (const [key, minimum] of [
    ["weight", 1],
    ["cooldownMs", 0],
    ["maxPlaysPerSession", 1],
  ]) {
    if (
      dialogue[key] !== undefined &&
      !isIntegerAtLeast(dialogue[key], minimum)
    ) {
      issues.push(`${label}的 ${key} 数值无效。`);
    }
  }
  validateLines(
    issues,
    dialogue.lines,
    label,
    knownSpeakerIds,
  );
}

function validateStoryDialogue(
  issues,
  dialogue,
  label,
  knownSpeakerIds,
) {
  if (!isRecord(dialogue)) {
    issues.push(`${label}必须是对象。`);
    return;
  }
  pushUnknownKeys(issues, dialogue, STORY_KEYS, label);
  if (
    !isNonEmptyString(dialogue.id) ||
    !/^dialogue\.story\.[a-z0-9_]+$/.test(dialogue.id)
  ) {
    issues.push(
      `${label}的 id 必须符合 dialogue.story.x 格式。`,
    );
  }
  validateLines(
    issues,
    dialogue.lines,
    label,
    knownSpeakerIds,
  );
}

export function validateDialogueWorkspace(workspace) {
  const issues = [];
  const catalog = workspace.catalog;
  if (!isRecord(catalog)) {
    return Object.freeze(["catalog.json 必须是对象。"]);
  }
  pushUnknownKeys(issues, catalog, CATALOG_KEYS, "catalog.json");
  if (catalog.schemaVersion !== 1) {
    issues.push("catalog.json 的 schemaVersion 必须是 1。");
  }

  const locations = Array.isArray(catalog.locations)
    ? catalog.locations
    : [];
  const speakers = Array.isArray(catalog.speakers)
    ? catalog.speakers
    : [];
  if (!Array.isArray(catalog.locations)) {
    issues.push("catalog.json 的 locations 必须是数组。");
  }
  if (!Array.isArray(catalog.speakers)) {
    issues.push("catalog.json 的 speakers 必须是数组。");
  }

  const locationIds = [];
  for (const [index, location] of locations.entries()) {
    const label = `catalog.locations[${index}]`;
    if (!isRecord(location)) {
      issues.push(`${label}必须是对象。`);
      continue;
    }
    pushUnknownKeys(
      issues,
      location,
      new Set(["id", "name"]),
      label,
    );
    if (
      !isNonEmptyString(location.id) ||
      !/^location\.[a-z0-9_]+$/.test(location.id)
    ) {
      issues.push(`${label}的 id 格式无效。`);
    } else {
      locationIds.push(location.id);
    }
    if (!isNonEmptyString(location.name)) {
      issues.push(`${label}的 name 不能为空。`);
    }
  }
  pushDuplicateIssues(issues, locationIds, "地点");

  const speakerIds = [];
  for (const [index, speaker] of speakers.entries()) {
    const label = `catalog.speakers[${index}]`;
    if (!isRecord(speaker)) {
      issues.push(`${label}必须是对象。`);
      continue;
    }
    pushUnknownKeys(
      issues,
      speaker,
      new Set(["id", "name", "characterId"]),
      label,
    );
    if (
      !isNonEmptyString(speaker.id) ||
      !/^speaker\.[a-z0-9_]+$/.test(speaker.id)
    ) {
      issues.push(`${label}的 id 格式无效。`);
    } else {
      speakerIds.push(speaker.id);
    }
    if (!isNonEmptyString(speaker.name)) {
      issues.push(`${label}的 name 不能为空。`);
    }
    if (
      speaker.characterId !== null &&
      (!isNonEmptyString(speaker.characterId) ||
        !/^character\.[a-z0-9_]+$/.test(
          speaker.characterId,
        ))
    ) {
      issues.push(`${label}的 characterId 格式无效。`);
    }
  }
  pushDuplicateIssues(issues, speakerIds, "说话人");

  const knownLocationIds = new Set(locationIds);
  const knownSpeakerIds = new Set(speakerIds);
  const chapterIds = [];
  const dialogueIds = [];
  for (const chapterEntry of workspace.chapters) {
    const chapter = chapterEntry.data;
    const fileLabel = chapterEntry.fileName;
    if (!isRecord(chapter)) {
      issues.push(`${fileLabel}必须是对象。`);
      continue;
    }
    pushUnknownKeys(issues, chapter, CHAPTER_KEYS, fileLabel);
    if (chapter.schemaVersion !== 1) {
      issues.push(`${fileLabel}的 schemaVersion 必须是 1。`);
    }
    if (
      !isNonEmptyString(chapter.chapterId) ||
      !/^chapter\.[a-z0-9_.]+$/.test(chapter.chapterId)
    ) {
      issues.push(`${fileLabel}的 chapterId 格式无效。`);
    } else {
      chapterIds.push(chapter.chapterId);
    }
    if (!isNonEmptyString(chapter.title)) {
      issues.push(`${fileLabel}的 title 不能为空。`);
    }
    if (
      !isNonEmptyString(chapter.locationId) ||
      !knownLocationIds.has(chapter.locationId)
    ) {
      issues.push(
        `${fileLabel}引用了未知地点 "${String(chapter.locationId)}"。`,
      );
    }

    const defaults = chapter.defaults;
    if (!isRecord(defaults)) {
      issues.push(`${fileLabel}的 defaults 必须是对象。`);
    } else {
      pushUnknownKeys(
        issues,
        defaults,
        new Set([
          "lineDurationMs",
          "ambientWeight",
          "ambientCooldownMs",
          "ambientMaxPlaysPerSession",
        ]),
        `${fileLabel}.defaults`,
      );
      for (const [key, minimum] of [
        ["lineDurationMs", 1],
        ["ambientWeight", 1],
        ["ambientCooldownMs", 0],
        ["ambientMaxPlaysPerSession", 1],
      ]) {
        if (!isIntegerAtLeast(defaults[key], minimum)) {
          issues.push(
            `${fileLabel}.defaults.${key} 数值无效。`,
          );
        }
      }
    }

    const ambientDialogues = Array.isArray(
      chapter.ambientDialogues,
    )
      ? chapter.ambientDialogues
      : [];
    const storyDialogues = Array.isArray(chapter.storyDialogues)
      ? chapter.storyDialogues
      : [];
    if (!Array.isArray(chapter.ambientDialogues)) {
      issues.push(
        `${fileLabel}的 ambientDialogues 必须是数组。`,
      );
    }
    if (!Array.isArray(chapter.storyDialogues)) {
      issues.push(`${fileLabel}的 storyDialogues 必须是数组。`);
    }
    ambientDialogues.forEach((dialogue, index) => {
      validateAmbientDialogue(
        issues,
        dialogue,
        `${fileLabel}.ambientDialogues[${index}]`,
        knownSpeakerIds,
      );
      if (isRecord(dialogue) && isNonEmptyString(dialogue.id)) {
        dialogueIds.push(dialogue.id);
      }
    });
    storyDialogues.forEach((dialogue, index) => {
      validateStoryDialogue(
        issues,
        dialogue,
        `${fileLabel}.storyDialogues[${index}]`,
        knownSpeakerIds,
      );
      if (isRecord(dialogue) && isNonEmptyString(dialogue.id)) {
        dialogueIds.push(dialogue.id);
      }
    });
  }
  pushDuplicateIssues(issues, chapterIds, "章节");
  pushDuplicateIssues(issues, dialogueIds, "对白");
  return Object.freeze(issues);
}

function stripSchema(value) {
  if (!isRecord(value)) {
    return value;
  }
  const { $schema: _schema, ...rest } = value;
  return rest;
}

export function renderGeneratedDialogueSource(workspace) {
  const catalog = stripSchema(workspace.catalog);
  const chapters = workspace.chapters.map((entry) =>
    stripSchema(entry.data),
  );
  return [
    "/* 此文件由 npm run dialogue:generate 自动生成，请勿手动编辑。 */",
    "",
    `export const GENERATED_DIALOGUE_CATALOG = ${JSON.stringify(
      catalog,
      null,
      2,
    )} as const;`,
    "",
    `export const GENERATED_DIALOGUE_CHAPTERS = ${JSON.stringify(
      chapters,
      null,
      2,
    )} as const;`,
    "",
  ].join("\n");
}

export function formatValidationFailure(issues) {
  return [
    `对白数据校验失败，共 ${issues.length} 个问题：`,
    ...issues.map((issue, index) => `${index + 1}. ${issue}`),
  ].join("\n");
}

export function summarizeDialogueWorkspace(workspace) {
  let ambientCount = 0;
  let storyCount = 0;
  let lineCount = 0;
  for (const chapter of workspace.chapters) {
    ambientCount += chapter.data.ambientDialogues.length;
    storyCount += chapter.data.storyDialogues.length;
    lineCount += [
      ...chapter.data.ambientDialogues,
      ...chapter.data.storyDialogues,
    ].reduce((sum, dialogue) => sum + dialogue.lines.length, 0);
  }
  return Object.freeze({
    chapterCount: workspace.chapters.length,
    locationCount: workspace.catalog.locations.length,
    speakerCount: workspace.catalog.speakers.length,
    ambientCount,
    storyCount,
    lineCount,
  });
}

export async function writeGeneratedDialogueSource(workspace) {
  const issues = validateDialogueWorkspace(workspace);
  if (issues.length > 0) {
    throw new Error(formatValidationFailure(issues));
  }
  const output = renderGeneratedDialogueSource(workspace);
  await fs.mkdir(
    path.dirname(workspace.paths.generatedSourcePath),
    { recursive: true },
  );
  const temporaryPath =
    `${workspace.paths.generatedSourcePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, output, "utf8");
  await fs.rename(
    temporaryPath,
    workspace.paths.generatedSourcePath,
  );
  return output;
}

export async function checkGeneratedDialogueSource(workspace) {
  const issues = validateDialogueWorkspace(workspace);
  if (issues.length > 0) {
    throw new Error(formatValidationFailure(issues));
  }
  const expected = renderGeneratedDialogueSource(workspace);
  let actual;
  try {
    actual = await fs.readFile(
      workspace.paths.generatedSourcePath,
      "utf8",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(
        "缺少生成文件，请运行 npm run dialogue:generate。",
      );
    }
    throw error;
  }
  if (actual !== expected) {
    throw new Error(
      "章节 JSON 已变化但生成文件未同步，请运行 npm run dialogue:generate。",
    );
  }
  return summarizeDialogueWorkspace(workspace);
}

export async function writeJsonFile(jsonPath, value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = `${jsonPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, output, "utf8");
  await fs.rename(temporaryPath, jsonPath);
}
