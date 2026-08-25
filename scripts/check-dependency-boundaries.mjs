import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

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

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

function relative(filePath) {
  return normalize(path.relative(root, filePath));
}

function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}
function runtimeDependencySpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?!type\b)(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']/g,
    /\bexport\s+(?!type\b)(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

async function resolveTypeScriptDependency(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${target}.ts`, path.join(target, "index.ts")]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function findRuntimeDependencyCycles(files) {
  const graph = new Map();
  const fileSet = new Set(files);
  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    const dependencies = [];
    for (const specifier of runtimeDependencySpecifiers(source)) {
      const dependency = await resolveTypeScriptDependency(filePath, specifier);
      if (dependency !== null && fileSet.has(dependency)) dependencies.push(dependency);
    }
    graph.set(filePath, [...new Set(dependencies)]);
  }
  const state = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();
  function visit(filePath) {
    state.set(filePath, 1);
    stack.push(filePath);
    for (const dependency of graph.get(filePath) ?? []) {
      if (state.get(dependency) === 1) {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency].map(relative);
        const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (state.get(dependency) !== 2) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(filePath, 2);
  }
  for (const filePath of files) {
    if (state.get(filePath) === undefined) visit(filePath);
  }
  return cycles;
}

const problems = [];
const corePublicIndexPath = path.join(root, "packages", "core", "src", "index.ts");
const corePublicIndex = await fs.readFile(corePublicIndexPath, "utf8");
for (const internalExport of [
  "./cooking-system",
  "./inventory-system",
  "./logistics-system",
  "./procurement-system",
  "./restaurant-system",
]) {
  if (corePublicIndex.includes(`export * from "${internalExport}"`)) {
    problems.push(`core 根出口禁止重新公开旧经营实现：packages/core/src/index.ts -> ${internalExport}`);
  }
}

if (corePublicIndex.includes('export * from "./compatibility";')) {
  problems.push("core 根出口禁止恢复已删除的 compatibility 门面。");
}
for (const filePath of await listTypeScriptFiles(path.join(root, "packages", "core", "src"))) {
  const source = await fs.readFile(filePath, "utf8");
  if (/\bLegacyGameRuntimeCompatibility\b|\bLegacyGameRuntimePort\b|legacy-game-runtime-compatibility/.test(source)) {
    problems.push(`core 禁止恢复旧 GameRuntime 兼容门面：${relative(filePath)}`);
  }
}

if (corePublicIndex.includes('export * from "./projections";')) {
  problems.push("core 根出口必须使用 projections/public，禁止公开投影内部装配工具。");
}
if (!corePublicIndex.includes('export * from "./projections/public";')) {
  problems.push("core 根出口缺少受控投影入口：./projections/public");
}

const constrainedIndexes = [
  {
    path: path.join(root, "packages", "core", "src", "demo", "index.ts"),
    forbidden: ["./r6-demo-fixture", "./r6-demo-coordinators"],
    label: "demo",
  },
  {
    path: path.join(root, "packages", "core", "src", "runtime", "index.ts"),
    forbidden: ["./runtime-module-registry"],
    label: "runtime",
  },
];
for (const constrained of constrainedIndexes) {
  const source = await fs.readFile(constrained.path, "utf8");
  for (const forbidden of constrained.forbidden) {
    if (source.includes(`export * from "${forbidden}"`)) {
      problems.push(`core ${constrained.label} 公开入口禁止导出内部实现：${forbidden}`);
    }
  }
}

const contractsPublicIndexPath = path.join(root, "packages", "contracts", "src", "index.ts");
const contractsPublicIndex = await fs.readFile(contractsPublicIndexPath, "utf8");
for (const deprecatedSnapshotBridgeToken of [
  "runtimeGetSnapshot",
  "runtimeSnapshotChanged",
  "SnapshotChangedListener",
  "getSnapshot(): Promise<GameSnapshot>",
  "onSnapshotChanged(",
]) {
  if (contractsPublicIndex.includes(deprecatedSnapshotBridgeToken)) {
    problems.push(`contracts 禁止恢复旧总快照桥接：${deprecatedSnapshotBridgeToken}`);
  }
}

for (const retiredDemoProtocolToken of [
  "PresentationDemo",
  "R6Demo",
  "presentation.start-demo",
  "demo.start-business",
]) {
  if (contractsPublicIndex.includes(retiredDemoProtocolToken)) {
    problems.push(`contracts 禁止恢复产品 Demo 协议：${retiredDemoProtocolToken}`);
  }
}

const retiredDemoCorePublicIndex = await fs.readFile(path.join(root, "packages", "core", "src", "index.ts"), "utf8");
for (const retiredDemoExport of ['export * from "./demo"', 'export * from "./presentation-demo-system"']) {
  if (retiredDemoCorePublicIndex.includes(retiredDemoExport)) {
    problems.push(`core 公开入口禁止恢复测试 Demo 导出：${retiredDemoExport}`);
  }
}

for (const contentPath of [
  path.join(root, "packages", "content", "src", "definitions.ts"),
  path.join(root, "packages", "content", "src", "content-registry.ts"),
  path.join(root, "packages", "content", "data", "stories", "catalog.json"),
]) {
  const source = await fs.readFile(contentPath, "utf8");
  if (/presentationDemoDialogues|PresentationDemoDialogue/.test(source)) {
    problems.push(`正式内容禁止恢复表现 Demo 映射：${relative(contentPath)}`);
  }
}
for (const rendererBoundaryRoot of [
  path.join(root, "apps", "desktop", "src", "renderer"),
  path.join(root, "apps", "desktop", "src", "preload"),
]) {
  for (const filePath of await listTypeScriptFiles(rendererBoundaryRoot)) {
    const source = await fs.readFile(filePath, "utf8");
    if (/\bGameSnapshot\b|runtimeGetSnapshot|runtimeSnapshotChanged|onSnapshotChanged/.test(source)) {
      problems.push(`renderer/preload 禁止依赖旧总快照：${relative(filePath)}`);
    }
  }
}

for (const sourceRoot of [path.join(root, "apps"), path.join(root, "packages")]) {
  for (const filePath of await listTypeScriptFiles(sourceRoot)) {
    const source = await fs.readFile(filePath, "utf8");
    const sourcePath = relative(filePath);
    for (const specifier of importSpecifiers(source)) {
      if (
        !sourcePath.startsWith("packages/core/") &&
        (specifier.startsWith("@airship-restaurant/core/") ||
          specifier.includes("packages/core/src") ||
          specifier.includes("core/src"))
      ) {
        problems.push(`跨包只能通过 core 公开根入口导入：${sourcePath} -> ${specifier}`);
      }
      if (
        !sourcePath.startsWith("packages/contracts/") &&
        (specifier.startsWith("@airship-restaurant/contracts/") ||
          specifier.includes("packages/contracts/src") ||
          specifier.includes("contracts/src"))
      ) {
        problems.push(`跨包只能通过 contracts 公开根入口导入：${sourcePath} -> ${specifier}`);
      }
    }
  }
}

const rendererRoot = path.join(root, "apps", "desktop", "src", "renderer");
for (const filePath of await listTypeScriptFiles(rendererRoot)) {
  const source = await fs.readFile(filePath, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (
      specifier === "@airship-restaurant/core" ||
      specifier.startsWith("@airship-restaurant/core/") ||
      specifier.includes("packages/core") ||
      specifier.includes("core/src")
    ) {
      problems.push(`renderer 禁止导入 core：${relative(filePath)} -> ${specifier}`);
    }
  }
}

const desktopMainRoot = path.join(root, "apps", "desktop", "src", "main");
for (const filePath of await listTypeScriptFiles(desktopMainRoot)) {
  const source = await fs.readFile(filePath, "utf8");
  if (/\br6Demo\.fixture\b|\bnew R6DemoApplication\b|\bcreateDesktopPresentationDemo\b/.test(source)) {
    problems.push(`产品主进程禁止读取或实例化 Demo 运行时：${relative(filePath)}`);
  }
  if (/\bnew GameplayRuntime\b/.test(source)) {
    problems.push(`产品主进程禁止重新实例化旧 GameplayRuntime：${relative(filePath)}`);
  }
}

const coreRoot = path.join(root, "packages", "core", "src");
const coreTypeScriptFiles = await listTypeScriptFiles(coreRoot);
for (const cycle of await findRuntimeDependencyCycles(coreTypeScriptFiles)) {
  problems.push(`core 运行时循环依赖：${cycle.join(" -> ")}`);
}
const boundaries = ["kernel", "runtime", "modules", "projections"];
for (const filePath of coreTypeScriptFiles) {
  const source = await fs.readFile(filePath, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(filePath), specifier);
    for (const boundary of boundaries) {
      const boundaryRoot = path.join(coreRoot, boundary);
      const sourceInsideBoundary = filePath.startsWith(`${boundaryRoot}${path.sep}`);
      const targetInsideBoundary =
        resolved === boundaryRoot || resolved.startsWith(`${boundaryRoot}${path.sep}`);
      const isPublicBoundaryEntry =
        filePath === corePublicIndexPath && resolved === path.join(boundaryRoot, "public");
      if (
        targetInsideBoundary &&
        !sourceInsideBoundary &&
        resolved !== boundaryRoot &&
        !isPublicBoundaryEntry
      ) {
        problems.push(
          `core 边界只能通过目录公开出口导入：${relative(filePath)} -> ${specifier}`,
        );
      }
    }

    const sourceRelative = normalize(path.relative(path.join(coreRoot, "modules"), filePath));
    const targetRelative = normalize(path.relative(path.join(coreRoot, "modules"), resolved));
    const sourceModule = sourceRelative.split("/")[0];
    const targetParts = targetRelative.split("/");
    const targetModule = targetParts[0];
    if (
      !sourceRelative.startsWith("../") &&
      !targetRelative.startsWith("../") &&
      sourceModule !== targetModule &&
      targetParts.length > 1
    ) {
      problems.push(
        `领域模块禁止导入另一模块内部文件：${relative(filePath)} -> ${specifier}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("依赖边界检查失败：");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("依赖边界检查通过：renderer 未导入 core 或旧总快照，产品协议/内容/主进程不含 Demo 入口，测试 Demo 未从 core 根导出，跨包无深层导入且无运行时循环依赖。");
}
