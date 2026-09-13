// Synthetic local-only render benchmark; never points at user notes or a remote host.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5287";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const source = (fieldsPerSection) =>
  [
    "```aic",
    "# Synthetic benchmark",
    ...Array.from({ length: 16 }, (_, section) => [
      ...(section ? ["---"] : []),
      `## Section ${section}`,
      ...Array.from(
        { length: fieldsPerSection },
        (_, field) =>
          `Field ${field}${field % 3 === 0 ? "*" : ""}: synthetic-value-${field}`,
      ),
    ]).flat(),
    "```",
    "",
    "After",
  ].join("\n");
const propertiesSource = (fieldsPerGroup) =>
  [
    "---",
    "file: synthetic.note.md",
    ...Array.from({ length: 16 }, (_, group) => [
      `group${group}:`,
      ...Array.from(
        { length: fieldsPerGroup },
        (_, field) => `  Field ${field}: synthetic-value-${field}`,
      ),
    ]).flat(),
    "---",
    "",
    "After",
  ].join("\n");

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(url);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    const parent = document.body.appendChild(document.createElement("div"));
    parent.id = "perf-qa";
    parent.style = "position:fixed;inset:0;overflow:auto;z-index:100";
    window.perfEditor = new AicEditor(parent);
  });
  const results = [];
  for (const scenario of [
    { kind: "security", fields: 64, text: source(4), minimumRows: 64 },
    { kind: "security", fields: 1024, text: source(64), minimumRows: 1024 },
    {
      kind: "properties",
      fields: 64,
      text: propertiesSource(4),
      minimumRows: 64,
    },
  ]) {
    const samples = [];
    for (let iteration = 0; iteration < 7; iteration += 1) {
      const result = await page.evaluate(
        ({ text, id }) => {
          const start = performance.now();
          window.perfEditor.switchDocument(id, text);
          window.perfEditor.view.dispatch({
            selection: { anchor: text.length },
          });
          const rendered = performance.now();
          const rows = document.querySelectorAll(
            "#perf-qa .cm-aic-security-row",
          ).length;
          const filter = document.querySelector(
            '#perf-qa .cm-aic-security-filter input[type="search"]',
          );
          filter.value = "no-matching-synthetic-field";
          filter.dispatchEvent(new Event("input", { bubbles: true }));
          const filtered = performance.now();
          filter.value = "";
          filter.dispatchEvent(new Event("input", { bubbles: true }));
          const cleared = performance.now();
          return {
            rows,
            renderMs: rendered - start,
            filterMs: filtered - rendered,
            clearMs: cleared - filtered,
          };
        },
        {
          text: scenario.text,
          id: `synthetic-perf-${scenario.kind}-${scenario.fields}-${iteration}`,
        },
      );
      assert.ok(result.rows >= scenario.minimumRows);
      samples.push(result);
    }
    results.push({
      kind: scenario.kind,
      sections: 16,
      fields: scenario.fields,
      medianRenderMs: median(samples.slice(1).map((sample) => sample.renderMs)),
      medianFilterMs: median(samples.slice(1).map((sample) => sample.filterMs)),
      medianClearMs: median(samples.slice(1).map((sample) => sample.clearMs)),
      samples,
    });
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  await browser.close();
}
