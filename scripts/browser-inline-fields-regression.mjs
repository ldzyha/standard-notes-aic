// Synthetic local editor only: no live pages, user profile or OS clipboard.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.AIC_REVIEW_PLAYWRIGHT ||
    "C:/Users/leoni/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const url = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/browser/index.html",
);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
const output = "D:/aic/reviews/browser-extension-20260914";
await mkdir(output, { recursive: true });
const fields = [
  "Samsung*: synthetic-password | account@example.invalid",
  "Anran*: synthetic-other | Longer explanation for this account",
  "*: synthetic-unlabelled | Optional label",
  "Card_: 4242 4242 4242 1234 | 09/28 | 019",
];
const fixtures = {
  security: "```aic\n" + fields.join("\n") + "\n```\n\nEnd",
  properties:
    "---\n# aic-fields: v2\n" +
    fields.filter((line) => !line.startsWith("*:")).join("\n") +
    "\n---\n\nEnd",
};
const results = [];
for (const [name, executablePath] of [
  ["chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
  ["edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
]) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 600]) {
        const context = await browser.newContext({
          viewport: { width, height: 760 },
          colorScheme: theme,
        });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          for (const [kind, text] of Object.entries(fixtures)) {
            await page.goto(url.href);
            await page.evaluate(async (initialText) => {
              const { AicEditor } = await import("/src/editor.ts");
              const host = document.querySelector("#app");
              host.replaceChildren();
              host.style.cssText =
                "display:block;overflow:auto;padding:8px;box-sizing:border-box";
              window.inlineCopies = [];
              Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: {
                  writeText: async (value) => {
                    window.inlineCopies.push(value);
                  },
                },
              });
              window.inlineEditor = new AicEditor(host, {
                initialText,
                compactToolbar: true,
              });
              window.inlineEditor.view.dispatch({
                selection: { anchor: initialText.length },
              });
            }, text);
            const row = page.locator('[data-aic-card-kind="fields"]').first();
            await row.waitFor({ timeout: 10000 }).catch(async (error) => {
              console.error({
                kind,
                text: await page.locator("#app").innerText(),
                errors,
              });
              throw error;
            });
            const geometry = await row.evaluate((node) => {
              const title = node.querySelector(
                ".cm-aic-security-section-title",
              );
              const parts = [
                ...node.querySelectorAll(
                  ".cm-aic-security-card-parts .cm-aic-security-value",
                ),
              ];
              const boxes = [title, ...parts].map((element) => {
                const box = element.getBoundingClientRect();
                return {
                  x: box.x,
                  center: box.y + box.height / 2,
                  height: box.height,
                };
              });
              return {
                boxes,
                text: node.innerText,
                height: node.getBoundingClientRect().height,
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            });
            assert.equal(geometry.boxes.length, 3);
            assert.ok(
              Math.max(...geometry.boxes.map((box) => box.center)) -
                Math.min(...geometry.boxes.map((box) => box.center)) <
                8,
              `Label/value/description must share one row: ${JSON.stringify(geometry)}`,
            );
            assert.ok(
              geometry.height <= 48,
              `Row should be compact: ${geometry.height}`,
            );
            assert.ok(!geometry.overflow, "No page horizontal overflow");
            assert.ok(!/\b(Value|Description)\b/u.test(geometry.text));
            assert.ok(!geometry.text.includes("synthetic-password"));
            await row.locator(".cm-aic-security-value").nth(0).click();
            await page.waitForFunction(
              () => window.inlineCopies.at(-1) === "synthetic-password",
            );
            await row.locator(".cm-aic-security-value").nth(1).click();
            await page.waitForFunction(
              () => window.inlineCopies.at(-1) === "account@example.invalid",
            );
            const cardText = await page
              .locator('[data-aic-card-kind="card"]')
              .innerText();
            assert.ok(cardText.includes("1234") && !cardText.includes("4242"));
            assert.ok(!cardText.includes("019"));
            await page.waitForFunction(
              () =>
                ![
                  ...document.querySelectorAll(".cm-aic-security-field-status"),
                ].some((node) => node.textContent),
            );
            await row
              .locator(".cm-aic-security-card-parts")
              .evaluate((node) => {
                node.scrollLeft = 0;
              });
            await page.screenshot({
              path: path.join(
                output,
                `inline-${kind}-${name}-${theme}-${width}.png`,
              ),
            });
            assert.deepEqual(errors, []);
            results.push({ name, kind, theme, width, height: geometry.height });
            await page.evaluate(() => window.inlineEditor.destroy());
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
