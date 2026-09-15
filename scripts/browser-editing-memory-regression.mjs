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
const report = {
  browserVersion: browser.version(),
  initial: null,
  workloads: [],
  final: null,
  errors: [],
  crashes: 0,
  unexpectedDisconnects: 0,
};
let closing = false;
browser.on("disconnected", () => {
  if (!closing) report.unexpectedDisconnects++;
});
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 850 } });
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("crash", () => report.crashes++);
  await page.goto(url.href);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    window.memoryEditorType = AicEditor;
    document.querySelector("#app").replaceChildren();
    // Warm one-time renderer/sanitizer caches before measuring retained growth.
    const warm = new AicEditor(document.querySelector("#app"), {
      initialText:
        "```aic\nAccount *| synthetic | example.invalid\n```\n\n" +
        '```javascript\nconst value = "synthetic";\n```\n\nEnd',
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
  report.initial = initial;
  for (const mode of ["many-blocks", "large-block", "source-code"]) {
    const fixture = await page.evaluate(async (mode) => {
      const { parseSecurityBlock } =
        await import("/src/core/security-model.js");
      const sections = Array.from(
        { length: 8 },
        (_, section) =>
          `## Service ${section}\n` +
          Array.from(
            { length: 48 },
            (_, field) =>
              `Account ${field} *| synthetic-${section}-${field} | account${field}@example.invalid`,
          ).join("\n"),
      );
      const text =
        mode === "source-code"
          ? "```javascript\n" +
            Array.from(
              { length: 10_000 },
              (_, line) =>
                `const data${line} = {key: "synthetic", value: ${line}};`,
            ).join("\n") +
            "\n```"
          : mode === "large-block"
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
                      `Account ${field} *| synthetic-${block}-${field} | account@example.invalid`,
                  ).join("\n") +
                  "\n```",
              ).join("\n\n");
      const host = document.querySelector("#app");
      let fieldCount = 0;
      for (const match of text.matchAll(/```aic\n([\s\S]*?)\n```/gu)) {
        const parsed = parseSecurityBlock(match[1]);
        if (!parsed.ok)
          throw new Error("Stress fixture must be valid: " + mode);
        for (const section of parsed.model.sections) {
          for (const field of section.fields) {
            if (
              field.parts.length !== 2 ||
              field.parts[0].kind !== "secret" ||
              field.parts[1].kind !== "text"
            )
              throw new Error("Stress fixture must exercise typed parts");
            fieldCount++;
          }
        }
      }
      if (mode !== "source-code" && fieldCount !== 384)
        throw new Error("Stress fixture must contain 384 typed rows");
      host.style.cssText = "height:100vh;display:flex";
      const editor = new window.memoryEditorType(host, {
        initialText: text + "\n\nEditing here",
      });
      window.memoryQa = editor;
      // Code edits stay inside a quoted JS value, with nested language support
      // active in both whole-note Source and local source inside preview mode.
      window.memoryEditAt =
        mode === "source-code"
          ? editor.value.indexOf("synthetic") + "synthetic".length
          : editor.value.length;
      editor.view.dispatch({ selection: { anchor: window.memoryEditAt } });
      return { characters: editor.value.length, fieldCount };
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
          const at = window.memoryEditAt;
          const started = performance.now();
          editor.view.dispatch({
            changes: { from: at, insert: "x" },
            selection: { anchor: at + 1 },
          });
          window.memoryEditAt++;
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
    report.workloads.push({
      mode,
      ...fixture,
      edits: 340,
      baseline,
      batches,
      disposed,
    });
  }
  const final = await sample();
  report.final = final;
  assert.ok(final.nodes <= initial.nodes + 30);
  assert.ok(final.jsEventListeners <= initial.jsEventListeners + 4);
  assert.deepEqual(report.errors, []);
  assert.equal(report.crashes, 0);
  assert.equal(report.unexpectedDisconnects, 0);
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  closing = true;
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
