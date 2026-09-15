// Synthetic local editor only: no live pages, user profile or persisted clipboard.
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
const output =
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/browser-extension-20260914";
await mkdir(output, { recursive: true });

const empty = "```aic\n# Properties\n\n```\n";
const mixed = [
  "```aic",
  "# Typed values",
  "PersonalKey *| synthetic-personal-key",
  "Card _| 4242 4242 4242 1234 | 09/28 *| 019",
  "Phone | +1 202 555 0142",
  "Codes 1| active-fixture-code 0| used-fixture-code",
  "```",
  "",
  "End",
].join("\n");
const browsers = [
  ["chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
  ["edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
];
const results = [];

async function mount(page, initialText, readOnly = false) {
  await page.goto(url.href);
  await page.evaluate(
    async ({ initialText, readOnly }) => {
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
        readOnly,
      });
      window.inlineEditor.view.dispatch({
        selection: { anchor: initialText.length },
      });
    },
    { initialText, readOnly },
  );
  await page.locator(".cm-aic-security").waitFor({ timeout: 10000 });
}

function spread(values) {
  return Math.max(...values) - Math.min(...values);
}

for (const [browserName, executablePath] of browsers) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 600]) {
        const context = await browser.newContext({
          viewport: { width, height: 720 },
          colorScheme: theme,
        });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));

          await mount(page, empty);
          const emptyGeometry = await page.evaluate(() => {
            const preview = document.querySelector(".cm-aic-security");
            const actions = preview.querySelector(
              ".cm-aic-security-inline-actions",
            );
            const controls = [
              ...actions.querySelectorAll(":scope button"),
            ].filter(
              (control) => !control.closest(".cm-aic-security-add-menu"),
            );
            const boxes = controls.map((control) => {
              const rect = control.getBoundingClientRect();
              return {
                label: control.getAttribute("aria-label"),
                icon: control.getAttribute("data-aic-icon"),
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              };
            });
            const rect = preview.getBoundingClientRect();
            return {
              boxes,
              height: rect.height,
              overflow: document.documentElement.scrollWidth > innerWidth,
              footer: Boolean(preview.querySelector(".aic-card__footer")),
              inlineRows: preview.querySelectorAll(
                ".cm-aic-security-inline-actions",
              ).length,
            };
          });
          assert.equal(emptyGeometry.footer, false);
          assert.equal(emptyGeometry.inlineRows, 1);
          assert.deepEqual(
            emptyGeometry.boxes.map(({ icon }) => icon),
            ["add-row", "add-section"],
          );
          assert.ok(
            spread(emptyGeometry.boxes.map(({ top }) => top)) <= 1,
            JSON.stringify(emptyGeometry),
          );
          assert.ok(
            Math.max(...emptyGeometry.boxes.map(({ height }) => height)) <= 32,
            JSON.stringify(emptyGeometry),
          );
          assert.ok(emptyGeometry.height <= 125, JSON.stringify(emptyGeometry));
          assert.equal(emptyGeometry.overflow, false);
          await page.screenshot({
            path: path.join(
              output,
              `typed-empty-${browserName}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });

          await mount(page, mixed);
          const geometry = await page.evaluate(() => {
            const preview = document.querySelector(".cm-aic-security");
            const contentStart = (element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return (
                rect.left +
                Number.parseFloat(style.borderLeftWidth || "0") +
                Number.parseFloat(style.paddingLeft || "0")
              );
            };
            const rows = [
              ...preview.querySelectorAll('[data-aic-card-kind="fields"]'),
            ];
            const labels = rows.map((row) =>
              contentStart(row.querySelector(".cm-aic-security-section-title")),
            );
            const labelClipped = rows.map((row) => {
              const label = row.querySelector(".cm-aic-security-section-title");
              return label.scrollWidth > label.clientWidth + 1;
            });
            const values = rows.map((row) =>
              contentStart(row.querySelector(".cm-aic-security-value")),
            );
            const iconControls = [
              ...preview.querySelectorAll(
                ".cm-aic-security-row-controls > .cm-aic-security-add > button, " +
                  '.cm-aic-security-row-controls > button[data-aic-icon="add-section"]',
              ),
            ].map((control) => ({
              label: control.getAttribute("aria-label"),
              icon: control.getAttribute("data-aic-icon"),
              height: control.getBoundingClientRect().height,
              width: control.getBoundingClientRect().width,
            }));
            return {
              labels,
              labelClipped,
              values,
              iconControls,
              rowHeights: rows.map((row) => row.getBoundingClientRect().height),
              overflow: document.documentElement.scrollWidth > innerWidth,
              raw:
                preview.innerHTML.includes("synthetic-personal-key") ||
                preview.innerHTML.includes("4242 4242 4242 1234") ||
                preview.innerHTML.includes("active-fixture-code") ||
                preview.innerHTML.includes("used-fixture-code"),
              recovery: Boolean(
                preview.querySelector(
                  ".cm-aic-security-recovery,input[type=checkbox]",
                ),
              ),
            };
          });
          assert.ok(spread(geometry.labels) <= 1, JSON.stringify(geometry));
          assert.ok(spread(geometry.values) <= 1, JSON.stringify(geometry));
          if (width === 600)
            assert.equal(
              geometry.labelClipped.some(Boolean),
              false,
              JSON.stringify(geometry),
            );
          assert.equal(geometry.raw, false);
          assert.equal(geometry.recovery, false);
          assert.equal(geometry.overflow, false);
          assert.deepEqual(
            geometry.iconControls.slice(0, 3).map(({ icon }) => icon),
            ["add-property", "add-row", "add-section"],
          );
          assert.ok(
            geometry.iconControls.every(
              ({ height, width }) => height <= 32 && width <= 32,
            ),
            JSON.stringify(geometry.iconControls),
          );

          const active = page.getByRole("button", {
            name: "Copy Codes one-time 1 and mark it used",
          });
          await active.click();
          await page.waitForFunction(() =>
            window.inlineEditor.value.includes(
              "Codes 0| active-fixture-code 0| used-fixture-code",
            ),
          );
          assert.deepEqual(await page.evaluate(() => window.inlineCopies), [
            "active-fixture-code",
          ]);
          await page
            .getByRole("button", {
              name: "Reactivate Codes used 1 without copying",
            })
            .click();
          await page.waitForFunction(() =>
            window.inlineEditor.value.includes(
              "Codes 1| active-fixture-code 0| used-fixture-code",
            ),
          );
          assert.deepEqual(await page.evaluate(() => window.inlineCopies), [
            "active-fixture-code",
          ]);

          if (theme === "light" && width === 600) {
            await page
              .getByRole("button", { name: "Edit security block" })
              .click();
            const native = await page.evaluate(() => {
              const text = window.inlineEditor.value;
              const start = text.indexOf("public-native-fixture");
              return { text, start };
            });
            // Insert a public source token, select it, and exercise the browser's
            // native copy command without any renderer clipboard shortcut.
            await page.evaluate(() => {
              const view = window.inlineEditor.view;
              const at = view.state.doc.toString().indexOf("End");
              view.dispatch({
                changes: { from: at, insert: "public-native-fixture\n" },
                selection: {
                  anchor: at,
                  head: at + "public-native-fixture".length,
                },
              });
              view.focus();
            });
            await page.keyboard.press("Control+C");
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("Control+V");
            assert.ok(
              await page.evaluate(() =>
                window.inlineEditor.value.includes(
                  "public-native-fixturepublic-native-fixture",
                ),
              ),
              JSON.stringify(native),
            );
          }

          await page.screenshot({
            path: path.join(
              output,
              `typed-mixed-${browserName}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });
          assert.deepEqual(errors, []);
          results.push({
            browserName,
            theme,
            width,
            emptyHeight: emptyGeometry.height,
            labelSpread: spread(geometry.labels),
            valueSpread: spread(geometry.values),
            maxRowHeight: Math.max(...geometry.rowHeights),
          });
          await page.evaluate(() => window.inlineEditor.destroy());
        } finally {
          await context.close();
        }
      }
    }

    const coarse = await browser.newContext({
      viewport: { width: 320, height: 720 },
      colorScheme: "light",
      hasTouch: true,
      isMobile: true,
    });
    try {
      const page = await coarse.newPage();
      await mount(page, mixed);
      const sizes = await page
        .locator(
          ".cm-aic-security-row-controls > .cm-aic-security-add > button, " +
            '.cm-aic-security-row-controls > button[data-aic-icon="add-section"]',
        )
        .evaluateAll((controls) =>
          controls.map((control) => {
            const rect = control.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
        );
      assert.ok(
        sizes.length >= 3 &&
          sizes.every(({ width, height }) => width >= 44 && height >= 44),
        JSON.stringify(sizes),
      );
      const valueWidths = await page
        .locator(".cm-aic-security-card-parts .cm-aic-security-value")
        .evaluateAll((values) =>
          values.map((value) => value.getBoundingClientRect().width),
        );
      assert.ok(
        valueWidths.length >= 4 && valueWidths.every((width) => width >= 40),
        JSON.stringify(valueWidths),
      );
      await page.screenshot({
        path: path.join(output, `typed-coarse-${browserName}-320.png`),
        fullPage: true,
      });
    } finally {
      await coarse.close();
    }
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify({ passed: results.length, results }, null, 2));
