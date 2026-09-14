import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createIconPng } from "./scripts/browser-assets.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  if (mode !== "browser-chromium") {
    throw new Error(`Unsupported browser build mode: ${mode}`);
  }

  return {
    root: projectRoot,
    base: "./",
    publicDir: false,
    build: {
      outDir: "dist-browser/chromium",
      emptyOutDir: true,
      sourcemap: false,
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        input: { panel: "browser/index.html", worker: "src/browser/worker.ts" },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === "worker" ? "worker.js" : "assets/[name]-[hash].js",
        },
      },
    },
    plugins: [
      {
        name: "aic-browser-package",
        generateBundle() {
          for (const [fileName, source] of [
            ["manifest.json", "browser/manifest.json"],
            ["PRIVACY.md", "browser/PRIVACY.md"],
            ["README.md", "browser/README.md"],
            ["VERIFICATION.md", "browser/VERIFICATION.md"],
            ["THIRD_PARTY_NOTICES.md", "public/THIRD_PARTY_NOTICES.md"],
          ]) {
            this.emitFile({
              type: "asset",
              fileName,
              source: readFileSync(resolve(projectRoot, source)),
            });
          }
          this.emitFile({
            type: "asset",
            fileName: "icon-128.png",
            source: createIconPng(),
          });
        },
      },
    ],
  };
});
