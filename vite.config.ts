import { defineConfig } from "vitest/config";
import { buildGitHubLegacyRedirects } from "./scripts/site-pages.mjs";

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5178,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    {
      name: "aic-github-pages-legacy-document-redirects",
      generateBundle() {
        for (const [fileName, source] of buildGitHubLegacyRedirects())
          this.emitFile({ type: "asset", fileName, source });
      },
    },
  ],
  test: {
    environment: "jsdom",
    // Each Mermaid/jsdom worker loads a substantial DOM and parser runtime.
    // Bound concurrency so complete suites remain reliable on desktop and CI.
    maxWorkers: 1,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
