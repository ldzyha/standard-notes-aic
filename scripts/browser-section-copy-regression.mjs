// Local Vite and synthetic fixtures only. The OS clipboard is never used.
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
  process.env.AIC_REVIEW_URL ||
    "http://127.0.0.1:5291/browser/index.html?section-copy-review=1",
);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
const output =
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/section-copy-20260915";
await mkdir(output, { recursive: true });

const accounts = [
  "```aic",
  "# Accounts",
  "## Work",
  "Login | work@example.test",
  'Password *| "SYNTHETIC|WORK-SECRET"',
  "---",
  "## Personal",
  "Login | personal@example.test",
  "Password *| SYNTHETIC-PERSONAL-SECRET",
  "---",
  "```",
].join("\n");
const firstNamed = [
  "```aic",
  "## Named first",
  "Account | visible",
  "Password *| SYNTHETIC-NAMED-SECRET",
  "```",
].join("\n");
const source = `${accounts}\n\n${firstNamed}`;
const expectedWork = [
  "```aic",
  "## Work",
  "Login | work@example.test",
  'Password *| "SYNTHETIC|WORK-SECRET"',
  "```",
].join("\n");
const browsers = [
  ["chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
  ["edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
];
const results = [];

async function mount(page, theme) {
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    async ({ source, theme }) => {
      const { AicEditor } = await import("/src/editor.ts");
      const host = document.querySelector("#app");
      host.replaceChildren();
      host.style.cssText =
        "display:block;box-sizing:border-box;width:100%;padding:8px;overflow:auto";
      document.documentElement.style.colorScheme = theme;
      document.documentElement.style.setProperty(
        "--sn-stylekit-editor-background-color",
        theme === "dark" ? "#11151a" : "#ffffff",
      );
      document.documentElement.style.setProperty(
        "--sn-stylekit-editor-foreground-color",
        theme === "dark" ? "#f2f4f7" : "#1d232b",
      );
      const qa = (window.sectionCopyQa = { copies: [], changes: [] });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            qa.copies.push(value);
          },
          readText: async () => "",
        },
      });
      qa.editor = new AicEditor(host, {
        initialText: source,
        readOnly: true,
        showEditorHelp: false,
        onChange: (value) => qa.changes.push(value),
      });
      qa.editor.view.dispatch({ selection: { anchor: source.length } });
      qa.initial = qa.editor.value;
    },
    { source, theme },
  );
  await page.locator(".cm-aic-security").nth(1).waitFor();
}

for (const [browserName, executablePath] of browsers) {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 600]) {
        const coarse = width === 320;
        const context = await browser.newContext({
          viewport: { width, height: 820 },
          colorScheme: theme,
          hasTouch: coarse,
          isMobile: coarse,
        });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await mount(page, theme);
          const cards = page.locator(".cm-aic-security");
          assert.equal(await cards.count(), 2);
          assert.deepEqual(
            await cards
              .nth(0)
              .locator(
                ":scope > .cm-aic-security-body > .cm-aic-security-section > .cm-aic-security-section-header > .cm-aic-security-section-title",
              )
              .allTextContents(),
            ["Work", "Personal"],
          );
          assert.equal(
            await cards
              .nth(1)
              .locator(
                ":scope > .cm-aic-security-body > .cm-aic-security-section > .cm-aic-security-section-header > .cm-aic-security-section-title",
              )
              .textContent(),
            "Named first",
          );
          assert.equal(
            await cards
              .nth(1)
              .locator(":scope > .cm-md-preview-header > strong")
              .textContent(),
            "Security",
          );

          const work = cards
            .nth(0)
            .getByRole("button", { name: "Copy section Work", exact: true });
          await work.focus();
          assert.equal(
            await work.evaluate((button) => document.activeElement === button),
            true,
          );
          await page.keyboard.press("Enter");
          assert.equal(
            await work.evaluate((button) => document.activeElement === button),
            true,
          );
          await page.waitForFunction(() => window.sectionCopyQa.copies.length);
          assert.equal(
            await page.evaluate(() => window.sectionCopyQa.copies.at(-1)),
            expectedWork,
          );
          const geometry = await page.evaluate(() => {
            const cards = [...document.querySelectorAll(".cm-aic-security")];
            const copyButtons = [
              ...document.querySelectorAll(
                '.cm-aic-security button[aria-label^="Copy section "]',
              ),
            ];
            const emptyHeader = cards[0].querySelectorAll(
              ":scope > .cm-aic-security-body > .cm-aic-security-section > .cm-aic-security-section-header",
            )[2];
            const emptyBox = emptyHeader.getBoundingClientRect();
            return {
              coarse: matchMedia("(pointer: coarse)").matches,
              documentOverflow:
                document.documentElement.scrollWidth - innerWidth,
              cardOverflow: cards.map(
                (card) => card.scrollWidth - card.clientWidth,
              ),
              cardBounds: cards.map((card) => {
                const rect = card.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
              }),
              copySizes: copyButtons.map((button) => {
                const rect = button.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
              }),
              empty: {
                empty: emptyHeader.matches(":empty"),
                title: Boolean(
                  emptyHeader.querySelector(".cm-aic-security-section-title"),
                ),
                actions: Boolean(
                  emptyHeader.querySelector(".aic-card__section-actions"),
                ),
                height: emptyBox.height,
              },
              masked: cards.every(
                (card) =>
                  !card.innerHTML.includes("SYNTHETIC|WORK-SECRET") &&
                  !card.innerHTML.includes("SYNTHETIC-PERSONAL-SECRET") &&
                  !card.innerHTML.includes("SYNTHETIC-NAMED-SECRET"),
              ),
              sourceUnchanged:
                window.sectionCopyQa.editor.value ===
                  window.sectionCopyQa.initial &&
                window.sectionCopyQa.changes.length === 0,
            };
          });
          assert.equal(geometry.coarse, coarse);
          assert.ok(geometry.documentOverflow <= 1, JSON.stringify(geometry));
          assert.ok(
            geometry.cardOverflow.every((overflow) => overflow <= 1) &&
              geometry.cardBounds.every(
                ({ left, right }) => left >= -1 && right <= width + 1,
              ),
            JSON.stringify(geometry),
          );
          assert.equal(geometry.masked, true);
          assert.equal(geometry.sourceUnchanged, true);
          assert.deepEqual(
            {
              empty: geometry.empty.empty,
              title: geometry.empty.title,
              actions: geometry.empty.actions,
            },
            { empty: true, title: false, actions: false },
          );
          assert.equal(
            geometry.empty.height,
            0,
            JSON.stringify(geometry.empty),
          );
          if (coarse)
            assert.ok(
              geometry.copySizes.every(
                ({ width, height }) => width >= 43 && height >= 43,
              ),
              JSON.stringify(geometry.copySizes),
            );
          assert.deepEqual(errors, []);
          await page.screenshot({
            path: path.join(
              output,
              `section-copy-${browserName}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });
          results.push({ browserName, theme, width, coarse, ...geometry });
          await page.evaluate(() => window.sectionCopyQa.editor.destroy());
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
