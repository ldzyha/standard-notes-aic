// Synthetic local documents only. Start Vite first; no account or real clipboard.
/* global regressionEditor */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5189";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
  throw new Error("Run this regression only against a local Vite server");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
const passed = [];
const source = [
  "---",
  "# Keep authored comment",
  "file: example.note.md",
  "created: 2026-09-12T10:00:00Z",
  "updated: 2026-09-12T11:00:00Z",
  "owner: team",
  "credentials:",
  "  token*: synthetic-only-secret",
  "empty*: ",
  "---",
  "",
  "# Plain Markdown remains",
  "",
  "```aic-security",
  "## Main",
  "Password*: synthetic-security-only",
  "```",
  "",
  "End",
].join("\n");

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    const parent = document.createElement("div");
    parent.id = "regression";
    parent.style =
      "position:fixed;inset:0;background:var(--aic-bg);z-index:100";
    document.body.append(parent);
    window.__aicClipboard = { read: "synthetic-pasted", writes: [] };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => window.__aicClipboard.read,
        writeText: async (value) => {
          window.__aicClipboard.writes.push(value);
        },
      },
    });
    window.regressionEditor = new AicEditor(parent);
  });

  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        ({ theme, source, width }) => {
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-background-color",
            theme === "dark" ? "#111111" : "#ffffff",
          );
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-foreground-color",
            theme === "dark" ? "#eeeeee" : "#20242b",
          );
          regressionEditor.refreshTheme();
          regressionEditor.switchDocument(
            `properties-${theme}-${width}`,
            source,
          );
          regressionEditor.view.dispatch({
            selection: { anchor: regressionEditor.view.state.doc.length },
          });
          window.__aicClipboard.writes = [];
        },
        { theme, source, width },
      );
      const properties = page.locator("#regression .cm-aic-properties");
      await properties.waitFor();
      assert.equal(
        await page.locator("#regression .cm-aic-properties").count(),
        1,
      );
      assert.equal(
        await page
          .locator("#regression .cm-aic-security:not(.cm-aic-properties)")
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator("#regression .aic-editor")
          .getAttribute("data-theme"),
        theme === "dark" ? "dark" : "default",
      );
      assert.equal(
        (await properties.textContent()).includes("synthetic-only-secret"),
        false,
      );
      assert.equal(
        await properties.getByRole("button", { name: "Paste file" }).count(),
        0,
      );
      assert.equal(
        await properties
          .getByRole("button", { name: "Delete empty file field" })
          .count(),
        0,
      );
      assert.equal(await properties.locator(".cm-aic-drag-handle").count(), 0);
      const bounds = await properties.boundingBox();
      assert.ok(
        bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
      );
      const contrast = await properties.evaluate((card) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        const luminance = (color) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((value) => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const background = luminance(getComputedStyle(card).backgroundColor);
        return [
          ...card.querySelectorAll(
            ".cm-aic-security-label, .cm-aic-security-value, .cm-aic-security-action",
          ),
        ].map((element) => {
          const foreground = luminance(getComputedStyle(element).color);
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        });
      });
      assert.ok(
        contrast.length > 0 && contrast.every((ratio) => ratio >= 4.5),
        `${theme}/${width}: readable field and action contrast`,
      );

      await properties
        .getByRole("button", { name: "Copy created value" })
        .click();
      assert.equal(
        await page.evaluate(() => window.__aicClipboard.writes.at(-1)),
        "2026-09-12T10:00:00Z",
      );
      await properties
        .getByRole("button", { name: "Copy token value" })
        .click();
      assert.equal(
        await page.evaluate(() => window.__aicClipboard.writes.at(-1)),
        "synthetic-only-secret",
      );
      assert.equal(await page.evaluate(() => regressionEditor.value), source);

      await properties.getByRole("button", { name: "Paste empty" }).click();
      await page.waitForFunction(() =>
        regressionEditor.value.includes("synthetic-pasted"),
      );
      const changed = await page.evaluate(() => regressionEditor.value);
      assert.match(changed, /empty\*:.*synthetic-pasted/u);
      assert.ok(changed.includes("# Keep authored comment"));
      assert.ok(
        changed.endsWith(
          "# Plain Markdown remains\n\n```aic-security\n## Main\nPassword*: synthetic-security-only\n```\n\nEnd",
        ),
      );
      assert.equal(
        (
          await page
            .locator("#regression .cm-aic-security:not(.cm-aic-properties)")
            .textContent()
        ).includes("synthetic-security-only"),
        false,
      );
      passed.push(
        `${theme}/${width}: mask, copy, paste, metadata, layout, Markdown and security coexistence`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await browser.close();
}
