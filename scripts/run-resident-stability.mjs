import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const electronExecutable = require("electron");
const bundledNpmCliPath = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const npmCliPath = process.env.npm_execpath ?? bundledNpmCliPath;


function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.signal !== null) {
    throw new Error(
      `${path.basename(executable)} terminated by ${result.signal}.`,
    );
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [npmCliPath, "run", "build"]);
run(electronExecutable, [
  "apps/desktop/dist/main/index.js",
  "--stability-test",
  ...process.argv.slice(2),
]);
