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
  'Empty_: "" | "" | ""',
  'Partial_: "" | "09/28" | ""',
  "Corporate travel card for conference expenses_: 4242 4242 4242 1234 | 09/28 | 019",
];
const fixtures = {
  security:
    "```aic\n" + [...fields, '_: "" | "" | ""'].join("\n") + "\n```\n\nEnd",
  properties:
    "---\n# aic-fields: v2\n" +
    [
      ...fields.filter(
        (line) =>
          !line.startsWith("*:") &&
          !line.startsWith("Empty_:") &&
          !line.startsWith("Partial_:"),
      ),
      "Empty_: ' | | '",
      "Partial_: ' | 09/28 | '",
    ].join("\n") +
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
                  readText: async () => window.inlinePaste || "",
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
              const titleStyle = getComputedStyle(title);
              const rowStyle = getComputedStyle(node);
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
                fonts: {
                  token: titleStyle.getPropertyValue("--aic-font-ui").trim(),
                  label: titleStyle.fontFamily,
                  parent: rowStyle.fontFamily,
                },
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
            assert.match(geometry.fonts.token, /system-ui/u);
            assert.match(geometry.fonts.label, /system-ui/u);
            assert.match(geometry.fonts.parent, /system-ui/u);
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
            const cards = page.locator('[data-aic-card-kind="card"]');
            assert.equal(await cards.count(), kind === "security" ? 5 : 4);
            const cardByLabel = (label) =>
              cards.filter({
                has: page.locator(`button[aria-label="Copy ${label} label"]`),
              });
            const emptyCard = cardByLabel("Empty");
            const partialCard = cardByLabel("Partial");
            for (const [entry, expectedTitle] of [
              [cardByLabel("Card"), "Card:"],
              [emptyCard, "Empty:"],
              [partialCard, "Partial:"],
              [
                cardByLabel("Corporate travel card for conference expenses"),
                "Corporate travel card for conference expenses:",
              ],
              ...(kind === "security"
                ? [
                    [
                      cards.filter({
                        has: page.locator(
                          'button[aria-label="Paste Field number"]',
                        ),
                      }),
                      null,
                    ],
                  ]
                : []),
            ]) {
              const geometry = await entry.evaluate((node) => {
                const title = node.querySelector(
                  ".cm-aic-security-section-title",
                );
                const parts = node.querySelector(".cm-aic-security-card-parts");
                const targets = [
                  ...(title ? [title] : []),
                  ...node.querySelectorAll(
                    '.cm-aic-security-card-parts .cm-aic-security-value, .cm-aic-security-card-parts [aria-label^="Paste "]',
                  ),
                ];
                const boxes = targets.map((target) => {
                  const rect = target.getBoundingClientRect();
                  return {
                    x: rect.x,
                    center: rect.y + rect.height / 2,
                    width: rect.width,
                  };
                });
                const cardRect = node.getBoundingClientRect();
                return {
                  title: title?.textContent ?? null,
                  boxes,
                  height: cardRect.height,
                  cardWidth: cardRect.width,
                  partsClientWidth: parts.clientWidth,
                  partsScrollWidth: parts.scrollWidth,
                  partsOverflowX: getComputedStyle(parts).overflowX,
                  pageOverflow:
                    document.documentElement.scrollWidth > innerWidth,
                  html: node.innerHTML,
                  text: node.innerText,
                };
              });
              assert.equal(geometry.title, expectedTitle);
              assert.equal(geometry.boxes.length, expectedTitle ? 4 : 3);
              assert.ok(
                Math.max(...geometry.boxes.map((box) => box.center)) -
                  Math.min(...geometry.boxes.map((box) => box.center)) <
                  8,
                `Card label/parts must share one row: ${JSON.stringify({ kind, name, theme, width, expectedTitle, geometry })}`,
              );
              assert.ok(
                geometry.height <= 48,
                `Card row should be compact: ${JSON.stringify({ kind, name, theme, width, expectedTitle, geometry })}`,
              );
              assert.ok(!geometry.pageOverflow, "No page horizontal overflow");
              if (geometry.partsScrollWidth > geometry.partsClientWidth)
                assert.equal(geometry.partsOverflowX, "auto");
              assert.ok(!geometry.html.includes("4242 4242 4242 1234"));
              assert.ok(!geometry.html.includes("019"));
              if (expectedTitle === "Card:") {
                assert.ok(geometry.text.includes("1234"));
                assert.ok(geometry.text.includes("09/28"));
                assert.ok(geometry.text.includes("•••"));
              }
            }
            const copied = [
              ["Copy Card label", "Card"],
              ["Copy Card number value", "4242 4242 4242 1234"],
              ["Copy Card expiry value", "09/28"],
              ["Copy Card cvv value", "019"],
            ];
            for (const [aria, expected] of copied) {
              const target = cardByLabel("Card").locator(
                `button[aria-label="${aria}"]`,
              );
              await target.click();
              await page.waitForFunction(
                (value) => window.inlineCopies.at(-1) === value,
                expected,
              );
              await page.waitForFunction((label) => {
                const control = [...document.querySelectorAll("button")].find(
                  (button) => button.getAttribute("aria-label") === label,
                );
                return [
                  ...(control?.parentElement?.querySelectorAll(
                    ".cm-aic-security-field-status",
                  ) ?? []),
                ].some((status) => status.textContent === "Copied");
              }, aria);
              const feedback = await target.evaluate((control) => {
                const buttonRect = control.getBoundingClientRect();
                const status = [
                  ...control.parentElement.querySelectorAll(
                    ".cm-aic-security-field-status",
                  ),
                ].find((element) => element.textContent === "Copied");
                const statusRect = status.getBoundingClientRect();
                return {
                  intersects:
                    statusRect.right > buttonRect.left &&
                    statusRect.left < buttonRect.right &&
                    statusRect.bottom > buttonRect.top &&
                    statusRect.top < buttonRect.bottom,
                  pointerEvents: getComputedStyle(status).pointerEvents,
                };
              });
              assert.ok(feedback.intersects, `Copy feedback overlays ${aria}`);
              assert.equal(feedback.pointerEvents, "none");
            }
            for (const [label, expected] of [
              ["number", "4242 4242 4242 1234"],
              ["expiry", "09/28"],
              ["cvv", "019"],
            ]) {
              await page.evaluate((value) => {
                window.inlinePaste = value;
              }, expected);
              await emptyCard
                .locator(`button[aria-label="Paste Empty ${label}"]`)
                .click();
              await page.waitForFunction(
                (part) =>
                  !document.querySelector(
                    `button[aria-label="Paste Empty ${part}"]`,
                  ),
                label,
              );
            }
            assert.ok(
              !(await emptyCard.innerHTML()).includes("4242 4242 4242 1234"),
            );
            assert.ok(!(await emptyCard.innerHTML()).includes("019"));
            assert.ok(
              await partialCard
                .locator('button[aria-label="Paste Partial number"]')
                .count(),
            );
            assert.ok(
              await partialCard
                .locator('button[aria-label="Paste Partial cvv"]')
                .count(),
            );
            if (kind === "security") {
              const unlabelled = cards.filter({
                has: page.locator('button[aria-label="Paste Field number"]'),
              });
              for (const part of ["number", "expiry", "cvv"])
                assert.ok(
                  await unlabelled
                    .locator(`button[aria-label="Paste Field ${part}"]`)
                    .count(),
                );
            }
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
            results.push({
              name,
              kind,
              theme,
              width,
              height: geometry.height,
              fonts: geometry.fonts,
            });
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
