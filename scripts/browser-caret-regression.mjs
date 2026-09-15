// Real Chromium rendering against a synthetic local editor host. Never opens a
// user profile, installed extension, live page, or external service.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.AIC_REVIEW_PLAYWRIGHT ||
    "C:/Users/leoni/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const url = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/browser/index.html",
);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol),
  "Caret regression may only connect to a loopback Vite server.",
);
const output = path.resolve(
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/browser-extension-20260914",
);
assert.ok(
  output
    .toLowerCase()
    .startsWith("d:\\aic\\reviews\\browser-extension-20260914"),
  "Screenshots must stay in the review directory.",
);
await mkdir(output, { recursive: true });

const browserPaths = process.env.AIC_REVIEW_BROWSER
  ? [{ name: "selected", executablePath: process.env.AIC_REVIEW_BROWSER }]
  : [
      {
        name: "chrome",
        executablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      },
      {
        name: "edge",
        executablePath:
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      },
    ];
const seed = "---\n# aic-fields: v2\n---\n\n";
const results = [];

function channel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]) {
  return (
    0.2126 * channel(red / 255) +
    0.7152 * channel(green / 255) +
    0.0722 * channel(blue / 255)
  );
}

function parseColor(value) {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/u);
  if (match) return match.slice(1, 4).map(Number);
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/u);
  if (srgb) return srgb.slice(1, 4).map((part) => Number(part) * 255);
  throw Error(`Unsupported computed color: ${value}`);
}

async function readCaret(page, stage) {
  await page.waitForFunction(
    () =>
      document.activeElement?.classList.contains("cm-content") &&
      document.querySelector(".cm-editor.cm-focused .cm-cursor-primary"),
  );
  const actual = await page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    const cursor = editor?.querySelector(".cm-cursor-primary");
    const content = editor?.querySelector(".cm-content");
    if (!editor || !cursor || !content) throw Error("Editor cursor is missing");
    const border = getComputedStyle(cursor);
    const surface = getComputedStyle(editor);
    const rect = cursor.getBoundingClientRect();
    const outer = editor.getBoundingClientRect();
    return {
      focused: editor.classList.contains("cm-focused"),
      active: document.activeElement === content,
      display: border.display,
      borderColor: border.borderLeftColor,
      borderWidth: Number.parseFloat(border.borderLeftWidth),
      background: surface.backgroundColor,
      rect: rect.toJSON(),
      editor: outer.toJSON(),
      selection: window.caretQa.view.state.selection.main.head,
      markdown: window.caretQa.view.state.doc.toString(),
    };
  });
  const first = luminance(parseColor(actual.borderColor));
  const second = luminance(parseColor(actual.background));
  const contrast =
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  assert.equal(
    actual.focused && actual.active,
    true,
    `${stage}: editor must retain focus`,
  );
  assert.notEqual(
    actual.display,
    "none",
    `${stage}: drawn cursor must be displayed`,
  );
  assert.ok(
    actual.borderWidth >= 1,
    `${stage}: drawn cursor must have a border`,
  );
  assert.ok(
    actual.rect.height >= 10 &&
      actual.rect.left >= actual.editor.left &&
      actual.rect.left <= actual.editor.right &&
      actual.rect.top >= actual.editor.top &&
      actual.rect.bottom <= actual.editor.bottom,
    `${stage}: drawn cursor must lie inside editor: ${JSON.stringify(actual)}`,
  );
  assert.ok(
    contrast >= 3,
    `${stage}: cursor contrast ${contrast.toFixed(2)} < 3:1`,
  );
  return {
    stage,
    contrast: Number(contrast.toFixed(2)),
    borderColor: actual.borderColor,
    borderWidth: actual.borderWidth,
    selection: actual.selection,
  };
}

for (const browserSpec of browserPaths) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserSpec.executablePath,
  });
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 600]) {
        const context = await browser.newContext({
          viewport: { width, height: 560 },
          colorScheme: theme,
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(url.href);
          await page.evaluate(async (initialText) => {
            const { AicEditor } = await import("/src/editor.ts");
            const root = document.querySelector("#app");
            if (!root) throw Error("Synthetic editor root is missing");
            root.replaceChildren();
            root.style.display = "flex";
            const note = document.createElement("section");
            note.className = "browser-note";
            const host = document.createElement("div");
            host.className = "browser-editor-host";
            note.append(host);
            root.append(note);
            const editor = new AicEditor(host, {
              initialText,
              showEditorHelp: false,
            });
            editor.setSaveState("placeholder");
            editor.view.dispatch({ selection: { anchor: initialText.length } });
            window.caretQa = editor;
            editor.focus();
          }, seed);
          const editor = page.locator(".aic-editor");
          await editor.locator(".cm-aic-properties").waitFor();
          assert.equal(
            await editor.getAttribute("data-save-state"),
            "placeholder",
          );
          const prefix = `${browserSpec.name}-${theme}-${width}`;
          const record = async (stage) => {
            const result = {
              browser: browserSpec.name,
              theme,
              width,
              ...(await readCaret(page, stage)),
            };
            results.push(result);
            return result;
          };
          const blank = await record("blank Properties body");
          await page.addStyleTag({
            content:
              ".cm-cursorLayer { animation: none !important; opacity: 1 !important; }",
          });
          await editor.screenshot({
            path: path.join(output, `caret-blank-${prefix}.png`),
          });

          await editor.locator(".cm-line").last().click();
          await record("body click");
          await page.keyboard.type("Visible caret body");
          const typed = await page.evaluate(() =>
            window.caretQa.view.state.doc.toString(),
          );
          assert.ok(
            typed.endsWith("Visible caret body"),
            `Click and keyboard input must edit blank body: ${typed}`,
          );
          await record("keyboard input");

          const source = editor.getByRole("button", {
            name: "Show Markdown source",
          });
          await source.click();
          await editor.getByRole("button", { name: "Show preview" }).waitFor();
          assert.equal(await editor.locator(".cm-aic-properties").count(), 0);
          await record("source mode");
          await editor.screenshot({
            path: path.join(output, `caret-source-${prefix}.png`),
          });
          await page.keyboard.press("Escape");
          await editor.locator(".cm-aic-properties").waitFor();
          await record("source exit");

          const formatting = editor.getByRole("button", { name: "Formatting" });
          await formatting.click();
          assert.equal(await formatting.getAttribute("aria-expanded"), "true");
          await record("formatting open");
          await formatting.click();
          assert.equal(await formatting.getAttribute("aria-expanded"), "false");
          await record("formatting close");
          await page.emulateMedia({
            colorScheme: theme === "light" ? "dark" : "light",
          });
          const switched = await record("live theme switch");
          assert.notEqual(
            switched.borderColor,
            blank.borderColor,
            `${prefix}: drawn cursor must react to a live theme switch`,
          );
          assert.deepEqual(errors, [], `${prefix}: no page errors`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

process.stdout.write(
  JSON.stringify({ syntheticHostOnly: true, results }, null, 2) + "\n",
);
