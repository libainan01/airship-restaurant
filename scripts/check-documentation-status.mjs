import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const currentDocuments = [
  "README.md",
  "WORKSPACE.md",
  "Document/飞艇餐厅当前技术架构-v0.1.md",
];

const removedTerms = [
  "M2Simulation",
  "LegacyGameRuntimeCompatibility",
  "runtimeGetSnapshot",
  "runtimeSnapshotChanged",
  "RestaurantNpcDirector",
];

const historicalDocuments = [
  ["Document/飞艇餐厅重构架构设计-v0.1.md", "历史设计记录"],
  ["Document/飞艇餐厅R0重构基线-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R1基础设施实现记录-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R3第一阶段实现记录-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R3第二阶段实现记录-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R3第三阶段实现记录-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R4角色阶段实现记录-v0.1.md", "历史阶段记录"],
  ["Document/飞艇餐厅R6物流服务阶段实现记录-v0.1.md", "历史阶段记录"],
];

const failures = [];

for (const relativePath of currentDocuments) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  for (const term of removedTerms) {
    if (source.includes(term)) {
      failures.push(`${relativePath}: 当前文档仍包含已删除术语 ${term}`);
    }
  }
}

for (const [relativePath, marker] of historicalDocuments) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  const headingArea = source.slice(0, 800);
  if (!headingArea.includes(marker)) {
    failures.push(`${relativePath}: 文档开头缺少“${marker}”状态标记`);
  }
  if (!headingArea.includes("飞艇餐厅当前技术架构")) {
    failures.push(`${relativePath}: 历史状态标记没有指向当前架构文档`);
  }
}

if (failures.length > 0) {
  console.error("Documentation status check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation status check passed: ${currentDocuments.length} current documents, ${historicalDocuments.length} historical records.`);
}
