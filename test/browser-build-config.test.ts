// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function inspectMode(mode: string) {
  const probe = String.raw`
    import { resolve } from "node:path";
    import { pathToFileURL } from "node:url";
    const { default: browserConfig } = await import(pathToFileURL(resolve("vite.browser.config.mjs")));
    const mode = process.argv[1];
    try {
      const config = browserConfig({ mode, command: "build" });
      const emitted = [];
      config.plugins[0].generateBundle.call({ emitFile: asset => emitted.push(asset.fileName) });
      console.log(JSON.stringify({ outDir: config.build.outDir, emitted }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  `;
  return JSON.parse(
    execFileSync(
      (globalThis as unknown as { process: { execPath: string } }).process
        .execPath,
      ["--input-type=module", "-e", probe, mode],
      {
        encoding: "utf8",
      },
    ),
  );
}

describe("browser build targets", () => {
  it("accepts Chromium only and emits its manifest", () => {
    const config = inspectMode("browser-chromium");
    expect(config.outDir).toBe("dist-browser/chromium");
    expect(config.emitted).toContain("manifest.json");
    expect(config.emitted).not.toContain("manifest.firefox.json");
    expect(config.emitted).toContain("icon-128.png");
  });

  it.each(["browser-firefox", "production", "development"])(
    "rejects unsupported mode %s",
    (mode) => {
      expect(inspectMode(mode).error).toBe(
        `Unsupported browser build mode: ${mode}`,
      );
    },
  );
});
