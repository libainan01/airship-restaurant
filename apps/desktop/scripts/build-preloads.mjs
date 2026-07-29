import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, "..");
const preloadDirectory = path.join(desktopDirectory, "dist", "preload");
const entries = ["desktop", "management"];

for (const [index, name] of entries.entries()) {
  await build({
    root: desktopDirectory,
    configFile: false,
    logLevel: "warn",
    build: {
      emptyOutDir: index === 0,
      outDir: preloadDirectory,
      target: "node22",
      minify: false,
      sourcemap: true,
      lib: {
        entry: path.join(
          desktopDirectory,
          "src",
          "preload",
          `${name}.ts`,
        ),
        formats: ["cjs"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          codeSplitting: false,
          exports: "named",
        },
      },
    },
  });
}
