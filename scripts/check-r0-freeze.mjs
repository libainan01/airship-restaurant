import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const manifestPath = path.join(repositoryRoot, "scripts", "r0-legacy-write-paths.json");

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

async function listTypeScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...await listTypeScriptFiles(entryPath));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function relative(filePath) {
  return normalize(path.relative(repositoryRoot, filePath));
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const legacyRendererFiles = new Set(manifest.legacyRendererBusinessFiles);
const pureRendererDirectors = new Set(manifest.pureRendererDirectors ?? []);
const pureRendererPresentationFiles = new Set(
  manifest.pureRendererPresentationFiles ?? [],
);
const problems = [];

for (const filePath of [
  ...legacyRendererFiles,
  ...pureRendererDirectors,
  ...pureRendererPresentationFiles,
]) {
  try {
    await fs.access(path.join(repositoryRoot, filePath));
  } catch {
    problems.push(`登记文件不存在：${filePath}`);
  }
}

const rendererRoot = path.join(repositoryRoot, "apps", "desktop", "src", "renderer", "desktop");
for (const filePath of await listTypeScriptFiles(rendererRoot)) {
  const source = await fs.readFile(filePath, "utf8");
  const rendererPath = relative(filePath);
  const forbiddenLegacyBusinessReferences = [
    "restaurant-service-task-queue",
    "restaurant-otto-service-coordinator",
    "restaurant-customer-event-coordinator",
    "restaurant-guest-lifecycle-coordinator",
    "restaurant-service-event-projector",
  ];
  for (const reference of forbiddenLegacyBusinessReferences) {
    if (source.includes(reference)) {
      problems.push(`renderer 禁止恢复旧业务子图：${rendererPath} :: ${reference}`);
    }
  }
  if (
    /\bclass\s+\w*(?:Coordinator|Queue|Director)\b/.test(source) &&
    !legacyRendererFiles.has(rendererPath) &&
    !pureRendererDirectors.has(rendererPath)
  ) {
    problems.push(`新增 renderer 业务协调器未登记：${rendererPath}`);
  }
  if (pureRendererPresentationFiles.has(rendererPath)) {
    const forbiddenPresentationPatterns = [
      /\bdispatchCommand\b/,
      /\bGameCommand\b/,
      /\b(?:create|claim|complete|fail|interrupt)Task\b/,
      /restaurant-service-task-queue/,
      /restaurant-guest-lifecycle-coordinator/,
    ];
    for (const pattern of forbiddenPresentationPatterns) {
      if (pattern.test(source)) {
        problems.push(`纯表现 Projector/Model 禁止业务依赖或写入：${rendererPath} :: ${pattern}`);
      }
    }
  }
  if (pureRendererDirectors.has(rendererPath)) {
    const forbiddenPureDirectorPatterns = [
      /restaurant-service-task-queue/,
      /restaurant-otto-service-coordinator/,
      /restaurant-customer-event-coordinator/,
      /restaurant-guest-lifecycle-coordinator/,
      /\bdispatchCommand\b/,
      /\b(?:create|claim|complete|fail|interrupt)Task\b/,
    ];
    for (const pattern of forbiddenPureDirectorPatterns) {
      if (pattern.test(source)) {
        problems.push(`纯表现 Director 禁止业务依赖或写入：${rendererPath} :: ${pattern}`);
      }
    }
  }
}

for (const root of ["apps", "packages"]) {
  for (const filePath of await listTypeScriptFiles(path.join(repositoryRoot, root))) {
    const source = await fs.readFile(filePath, "utf8");
    if (/\bM2Simulation\b/.test(source) || source.includes("m2-simulation")) {
      problems.push(`已废止的 M2Simulation 依赖：${relative(filePath)}`);
    }
    if (
      /\bLegacySimulationFinancePort\b/.test(source) ||
      source.includes("legacy-simulation-finance-port") ||
      /\b(?:create|restore)CopperCheckpoint\b/.test(source) ||
      /\bpostMandatoryCopperExpense\b/.test(source)
    ) {
      problems.push(`已废止的餐厅财务镜像依赖：${relative(filePath)}`);
    }    const sourcePath = relative(filePath);
    if (
      sourcePath.startsWith("apps/desktop/src/") &&
      sourcePath !== "apps/desktop/src/main/game-save-service.ts" &&
      source.includes("module.simulation")
    ) {
      problems.push(`正式应用禁止写回聚合 simulation 存档：${sourcePath}`);
    }
    if (
      /\bexportState\(\):\s*GameplayRuntimeState\b/.test(source) ||
      /\binitialState\?:\s*GameplayRuntimeState\b/.test(source) ||
      /\b(?:simulation|#simulation)\.exportState\(\)/.test(source)
    ) {
      problems.push(`已废止的 GameplayRuntime 聚合存档 API：${sourcePath}`);
    }
  }
}

for (const assertion of manifest.requiredPresentationBaselineAssertions) {
  const source = await fs.readFile(
    path.join(repositoryRoot, assertion.file),
    "utf8",
  );
  for (const requiredText of assertion.includes) {
    if (!source.includes(requiredText)) {
      problems.push(
        `R0 表现特征测试缺失：${assertion.file} :: ${requiredText}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("R0 冻结护栏失败：");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`R0 冻结护栏通过：renderer 遗留写入 ${legacyRendererFiles.size} 个、纯表现 Director ${pureRendererDirectors.size} 个、受保护 Projector/Model ${pureRendererPresentationFiles.size} 个，M2 直接依赖 0 个、餐厅财务镜像依赖 0 个、GameplayRuntime 聚合写入 0 个。`);
}
