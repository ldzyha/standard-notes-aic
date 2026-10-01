import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildPublicPages } from "./scripts/site-pages.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "pwa"),
  base: "./",
  publicDir: false,
  server: { host: "127.0.0.1", port: 5180, fs: { allow: [projectRoot] } },
  build: {
    outDir: resolve(projectRoot, "dist-pwa"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    {
      name: "aic-notes-offline-shell",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          return html.replace(
            /(<link\s+rel="manifest"\s+href=")[^"]+/u,
            "$1./manifest.webmanifest",
          );
        },
      },
      async generateBundle(_options, bundle) {
        const digest = createHash("sha256");
        const workerTemplate = readFileSync(
          resolve(projectRoot, "src/pwa/sw.js"),
          "utf8",
        );
        digest
          .update(workerTemplate)
          .update(readFileSync(resolve(projectRoot, "pwa/index.html")));
        for (const name of Object.keys(bundle).sort()) {
          const item = bundle[name];
          digest
            .update(name)
            .update(item.type === "chunk" ? item.code : item.source);
        }
        const publicFiles = [];
        for (const [fileName, source] of [
          ["aic-logo.svg", "public/aic-logo.svg"],
          ["icon-192.png", "pwa/icon-192.png"],
          ["icon-512.png", "pwa/icon-512.png"],
          ["manifest.webmanifest", "pwa/manifest.webmanifest"],
          ["README.md", "pwa/README.md"],
          ["README.uk.md", "pwa/README.uk.md"],
          ["EXTENSION_UPDATES.md", "pwa/EXTENSION_UPDATES.md"],
          ["EXTENSION_UPDATES.uk.md", "pwa/EXTENSION_UPDATES.uk.md"],
          ["THIRD_PARTY_NOTICES.md", "public/THIRD_PARTY_NOTICES.md"],
          ["_headers", "pwa/_headers"],
        ]) {
          const bytes = readFileSync(resolve(projectRoot, source));
          digest.update(fileName).update(bytes);
          publicFiles.push(fileName);
          this.emitFile({ type: "asset", fileName, source: bytes });
        }
        for (const [fileName, source] of await buildPublicPages(projectRoot)) {
          digest.update(fileName).update(source);
          publicFiles.push(fileName);
          this.emitFile({ type: "asset", fileName, source });
        }
        const files = [
          ...new Set([
            ...Object.keys(bundle),
            ...publicFiles,
            "index.html",
            "aic-logo.svg",
            "icon-192.png",
            "icon-512.png",
            "manifest.webmanifest",
          ]),
        ];
        const version = digest.digest("hex").slice(0, 16);
        const worker = workerTemplate
          .replace("__AIC_CACHE_VERSION__", version)
          .replaceAll("__AIC_PRECACHE_FILES__", JSON.stringify(files));
        this.emitFile({ type: "asset", fileName: "sw.js", source: worker });
      },
    },
  ],
});
