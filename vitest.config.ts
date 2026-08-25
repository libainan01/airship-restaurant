import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@airship-restaurant/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@airship-restaurant/content": fileURLToPath(
        new URL("./packages/content/src/index.ts", import.meta.url),
      ),      "@airship-restaurant/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@airship-restaurant/persistence": fileURLToPath(
        new URL("./packages/persistence/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx"],
    exclude: ["spikes/**", "**/node_modules/**", "**/dist/**"],
  },
});
