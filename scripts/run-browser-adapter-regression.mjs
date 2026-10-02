// Compatibility entrypoints for synthetic adapter tests. These suites do not
// launch a browser, inspect a profile, or establish installed-extension behavior.
import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = {
  panel: [
    "test/browser-drafts.test.ts",
    "test/browser-panel.test.ts",
    "test/browser-panel-scan.test.ts",
    "test/browser-panel-reconnect.test.ts",
    "test/browser-folder-flow.test.ts",
    "test/browser-panel-actions.test.ts",
    "test/browser-panel-delete.test.ts",
    "test/browser-panel-ux.test.ts",
    "test/browser-related-links.test.ts",
  ],
  extension: [
    "test/browser-build-config.test.ts",
    "test/browser-package.test.ts",
    "test/browser-platform.test.ts",
    "test/browser-markdown-storage.test.ts",
    "test/browser-source-access.test.ts",
    "test/browser-draft-file-service.test.ts",
    "test/browser-scan.test.ts",
    "test/browser-markdown-concurrency.test.ts",
    "test/browser-service.test.ts",
    "test/browser-recovery-store.test.ts",
  ],
  domain: [
    "test/browser-domain-drafts.test.ts",
    "test/browser-domain-properties.test.ts",
    "test/browser-domain-panel.test.ts",
    "test/browser-global.test.ts",
    "test/browser-navigation.test.ts",
    "test/browser-page-ancestors.test.ts",
    "test/browser-panel-ancestors.test.ts",
  ],
};

export function runBrowserAdapterRegression(mode) {
  const tests = suites[mode];
  if (!tests) throw new Error(`Unknown browser adapter suite: ${mode}`);
  const args = process.argv.slice(2);
  const description = {
    mode,
    kind: "simulated-browser-adapter-and-dom-tests",
    nativeBrowser: false,
    tests,
  };
  if (args.length === 1 && args[0] === "--list") {
    process.stdout.write(`${JSON.stringify(description, null, 2)}\n`);
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      `Run the ${mode} Vitest adapter suite with no arguments.\n` +
        "--list lists the test files without executing them.\n" +
        "These are simulated API/DOM checks, not installed Chrome/Edge proof.\n" +
        "No browser is launched; AIC_REVIEW_* browser settings are not used.\n",
    );
    return;
  }
  if (args.length) throw new Error("Use no arguments, --list, or --help.");
  const runner = resolve(root, "node_modules/vitest/vitest.mjs");
  accessSync(runner);
  for (const file of tests) accessSync(resolve(root, file));
  process.stdout.write(
    `AIC ${mode}: simulated browser API/DOM checks via Vitest.\n` +
      "This does not test a native browser, installed extension, real permission prompt or user profile.\n",
  );
  const result = spawnSync(process.execPath, [runner, "run", ...tests], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal)
    process.stderr.write(`Adapter tests stopped by ${result.signal}.\n`);
  process.exitCode = result.status ?? 1;
}
