// Bounded synthetic Edge editing workload; never opens a user PWA/profile.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.AIC_REVIEW_PLAYWRIGHT ||
    "C:/Users/leoni/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const url = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/browser/index.html",
);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.href);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    window.memoryEditorType = AicEditor;
    document.querySelector("#app").replaceChildren();
    // Warm one-time renderer/sanitizer caches before measuring retained growth.
    const warm = new AicEditor(document.querySelector("#app"), {
      initialText: "```aic\nAccount*: synthetic | example.invalid\n```\n\nEnd",
    });
    warm.destroy();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const sample = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    return {
      ...(await cdp.send("Memory.getDOMCounters")),
      heap: metrics.metrics.find((item) => item.name === "JSHeapUsedSize")
        .value,
    };
  };
  const initial = await sample();
  const workloads = [];
  for (const mode of ["many-blocks", "large-block"]) {
    await page.evaluate(async (mode) => {
      const { parseSecurityBlock } =
        await import("/src/core/security-model.js");
      const sections = Array.from(
        { length: 8 },
        (_, section) =>
          `## Service ${section}\n` +
          Array.from(
            { length: 48 },
            (_, field) =>
              `Account ${field}*: synthetic-${section}-${field} | account${field}@example.invalid`,
          ).join("\n"),
      );
      const text =
        mode === "large-block"
          ? "```aic\n" + sections.join("\n---\n") + "\n```"
          : Array.from(
              { length: 48 },
              (_, block) =>
                "```aic\n# Service " +
                block +
                "\n" +
                Array.from(
                  { length: 8 },
                  (_, field) =>
                    `Account ${field}*: synthetic-${block}-${field} | account@example.invalid`,
                ).join("\n") +
                "\n```",
            ).join("\n\n");
      const host = document.querySelector("#app");
      for (const match of text.matchAll(/```aic\n([\s\S]*?)\n```/gu)) {
        const parsed = parseSecurityBlock(match[1]);
        if (!parsed.ok)
          throw new Error("Stress fixture must be valid: " + mode);
      }
      host.style.cssText = "height:100vh;display:flex";
      const editor = new window.memoryEditorType(host, {
        initialText: text + "\n\nEditing here",
        compactToolbar: false,
      });
      window.memoryQa = editor;
      editor.view.dispatch({ selection: { anchor: editor.value.length } });
    }, mode);
    const edit = (count) =>
      page.evaluate(async (count) => {
        const editor = window.memoryQa;
        const timings = [];
        for (let index = 0; index < count; index++) {
          if (index % 20 === 0)
            editor.toolbar.element
              .querySelector('[aria-label="Show Markdown source"]')
              ?.click();
          const at = editor.value.length;
          const started = performance.now();
          editor.view.dispatch({
            changes: { from: at, insert: "x" },
            selection: { anchor: at + 1 },
          });
          timings.push(performance.now() - started);
          if (index % 20 === 10)
            editor.toolbar.element
              .querySelector('[aria-label="Show preview"]')
              ?.click();
          if (index % 10 === 0) await new Promise(requestAnimationFrame);
        }
        editor.toolbar.element
          .querySelector('[aria-label="Show preview"]')
          ?.click();
        return {
          maximumMs: Math.max(...timings),
          meanMs: timings.reduce((a, b) => a + b, 0) / timings.length,
        };
      }, count);
    await edit(40);
    const baseline = await sample();
    const batches = [];
    for (let index = 0; index < 3; index++)
      batches.push({ ...(await edit(100)), ...(await sample()) });
    const after = batches.at(-1);
    assert.ok(
      after.nodes <= baseline.nodes + 200,
      `${mode}: retained DOM grows without bound`,
    );
    assert.ok(
      after.jsEventListeners <= baseline.jsEventListeners + 32,
      `${mode}: retained listeners grow`,
    );
    assert.ok(
      after.heap <= baseline.heap + 20 * 1024 * 1024,
      `${mode}: retained heap grows excessively`,
    );
    await page.evaluate(() => {
      window.memoryClosedRoot = new WeakRef(window.memoryQa.view.dom);
      window.memoryQa.destroy();
      delete window.memoryQa;
    });
    const disposed = await sample();
    assert.equal(
      await page.evaluate(() => Boolean(window.memoryClosedRoot.deref())),
      false,
    );
    workloads.push({ mode, edits: 340, baseline, batches, disposed });
  }
  const final = await sample();
  console.log(JSON.stringify({ initial, workloads, final, errors }, null, 2));
  assert.ok(final.nodes <= initial.nodes + 30);
  assert.ok(final.jsEventListeners <= initial.jsEventListeners + 4);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
