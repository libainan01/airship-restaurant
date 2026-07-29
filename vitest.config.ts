import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@airship-restaurant/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@airship-restaurant/persistence": fileURLToPath(
        new URL("./packages/persistence/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["spikes/**", "**/node_modules/**", "**/dist/**"],
  },
});
