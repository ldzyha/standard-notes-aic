// Synthetic editors in an isolated browser, never the user's Standard Notes account.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5189";
const local = (value) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
if (!local(url)) throw new Error("Use a local test server only");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    if (route.request().url() === new URL(url).href)
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      });
    return local(route.request().url()) ? route.continue() : route.abort();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const sample = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await session.send("HeapProfiler.collectGarbage");
    const metrics = await session.send("Performance.getMetrics");
    return {
      ...(await session.send("Memory.getDOMCounters")),
      heap: metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")
        .value,
    };
  };
  const cycle = (count, showEditorHelp) =>
    page.evaluate(
      async ({ iterations, showEditorHelp }) => {
        const { AicEditor } = await import("/src/editor.ts");
        window.lifecycleWeakRefs = [];
        for (let index = 0; index < iterations; index++) {
          const mount = document.body.appendChild(
            document.createElement("div"),
          );
          const editor = new AicEditor(mount, {
            showEditorHelp,
            initialText:
              "---\nfile: test.note.md\n---\n\n- [ ] Task\n\n| A | B |\n| --- | --- |\n| x | y |\n\n>>>|open| Section\nText\n<<<\n\nEnd",
          });
          window.lifecycleWeakRefs.push(new WeakRef(editor.view.dom));
          editor.switchDocument(`cycle-${index}`, "# Other\n\n- [ ] Next\n");
          const actions = editor.toolbar.element.querySelectorAll(
            ".aic-toolbar-group button",
          );
          if (actions.length !== 5)
            throw new Error("Compact inline actions missing");
          if (editor.toolbar.element.querySelector("select"))
            throw new Error("Compact toolbar has a select");
          if (
            Boolean(
              editor.toolbar.element.querySelector(".aic-editor-help-toggle"),
            ) !== showEditorHelp
          )
            throw new Error("Editor help ownership mismatch");
          actions[0].click();
          editor.destroy();
          mount.remove();
        }
      },
      { iterations: count, showEditorHelp },
    );
  const modes = [];
  for (const { name, showEditorHelp } of [
    { name: "embedded", showEditorHelp: true },
    { name: "host-help", showEditorHelp: false },
  ]) {
    await cycle(20, showEditorHelp);
    const baseline = await sample();
    await cycle(200, showEditorHelp);
    const after = await sample();
    const retainedEditors = await page.evaluate(
      () => window.lifecycleWeakRefs.filter((ref) => ref.deref()).length,
    );
    assert.equal(
      retainedEditors,
      0,
      `${name}: closed editor roots are collectible after lifecycle settlement`,
    );
    assert.ok(
      after.jsEventListeners <= baseline.jsEventListeners + 2,
      `${name}: no per-editor listener accumulation`,
    );
    assert.ok(
      after.nodes <= baseline.nodes + 20,
      `${name}: no per-editor DOM accumulation after GC`,
    );
    modes.push({ name, cycles: 200, retainedEditors, baseline, after });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ modes, errors }, null, 2));
} finally {
  await browser.close();
}
