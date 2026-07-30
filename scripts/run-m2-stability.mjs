import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitestCli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const configPath = fileURLToPath(
  new URL("../vitest.config.ts", import.meta.url),
);
const testPath = fileURLToPath(
  new URL(
    "../packages/core/tests/m2-stability.test.ts",
    import.meta.url,
  ),
);

const result = spawnSync(
  process.execPath,
  [
    vitestCli,
    "run",
    "--config",
    configPath,
    "--reporter=verbose",
    testPath,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      AIRSHIP_STABILITY_REPORT: "1",
    },
  },
);

if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
