// Real shared editor, opt-in v2 pipes, and synthetic-only clipboard values.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

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
const number = "4242 4242 4242 4242";
const cvv = "019";
const password = "SYNTHETIC-ONLY-PASSWORD";
const extra = "SYNTHETIC-ONLY-EXTRA";
const totp = "JBSWY3DPEHPK3PXP";
const source = [
  "# Synthetic security parts",
  "",
  "```aic-security v2",
  "##",
  `Business_: ${number} | 09/28 | ${cvv}`,
  `Corporate#: ${totp} | Work`,
  `Pass*: ${password} | WebDAV`,
  `Contact: public@example.invalid | Work | ${extra}`,
  "Empty_:  |  |",
  "```",
  "",
  "After",
].join("\n");
const cases = [
  { width: 320, coarse: true },
  { width: 360, coarse: true },
  { width: 1280, coarse: false },
];
const passed = [];
const geometry = [];
const pageErrors = [];
let serial = 0;

try {
  for (const theme of ["light", "dark"]) {
    for (const { width, coarse } of cases) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: coarse,
        hasTouch: coarse,
        colorScheme: theme,
      });
      const page = await context.newPage();
      const navigations = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(url);
      await page.evaluate(
        async ({ theme, source }) => {
          const { AicEditor } = await import("/src/editor.ts");
          const colors =
            theme === "dark"
              ? ["#191a1b", "#f2f3f4", "#27292b", "#4a4c4f", "#71bbff"]
              : ["#ffffff", "#20242b", "#f5f6f7", "#c3c8cf", "#0862b2"];
          for (const [index, name] of [
            "background",
            "foreground",
            "contrast-background",
            "border",
            "info-color",
          ].entries())
            document.documentElement.style.setProperty(
              "--sn-stylekit-" + name + "-color",
              colors[index],
            );
          document.documentElement.style.setProperty(
            "--sn-stylekit-contrast-foreground-color",
            colors[1],
          );
          document.documentElement.style.colorScheme = theme;
          const parent = document.createElement("div");
          parent.id = "parts-qa";
          parent.style =
            "position:fixed;inset:0;z-index:100;overflow:auto;background:var(--aic-bg)";
          document.body.append(parent);
          const qa = (window.partsQa = {
            AicEditor,
            parent,
            draft: source,
            persisted: source,
            clipboard: "",
            writes: [],
            reads: 0,
            saves: [],
          });
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              readText: async () => {
                qa.reads += 1;
                return qa.clipboard;
              },
              writeText: async (value) => {
                qa.writes.push(value);
              },
            },
          });
          qa.open = (text, id) => {
            qa.editor?.destroy();
            qa.editor = new AicEditor(parent, {
              onChange: (next) => {
                qa.draft = next;
              },
              onSave: async (reason) => {
                qa.saves.push(reason);
                qa.persisted = qa.draft;
                return true;
              },
            });
            qa.editor.switchDocument(id, text);
            qa.editor.view.dispatch({ selection: { anchor: text.length } });
          };
          qa.open(source, "synthetic-v2-0");
        },
        { theme, source },
      );
      const root = page.locator("#parts-qa");
      const button = (name) => root.getByRole("button", { name, exact: true });
      await button("Copy Business number value").waitFor();
      assert.equal(await root.locator(".cm-aic-security-card").count(), 5);
      let html = await root.innerHTML();
      for (const hidden of [cvv, password, extra, totp])
        assert.ok(!html.includes(hidden), "secret stays out of preview DOM");
      assert.ok(html.includes(number), "public PAN is displayed in preview");

      const measured = await page.evaluate(() => {
        const card = document.querySelector(".cm-aic-security-card");
        const parts = card.querySelector(".cm-aic-security-card-parts");
        const rows = [...parts.querySelectorAll(".cm-aic-security-row")];
        const size = (element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        };
        return {
          card: size(card),
          cardOverflow: card.scrollWidth - card.clientWidth,
          partsOverflow: parts.scrollWidth - parts.clientWidth,
          rowOverflow: rows.map((row) => row.scrollWidth - row.clientWidth),
          valueButtons: rows.map((row) =>
            size(row.querySelector(".cm-aic-security-value")),
          ),
          viewportOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      assert.ok(measured.cardOverflow <= 1);
      assert.ok(measured.partsOverflow <= 1);
      assert.ok(measured.rowOverflow.every((overflow) => overflow <= 1));
      assert.ok(measured.viewportOverflow <= 1);
      if (coarse)
        assert.ok(
          measured.valueButtons.every((size) => size.height >= 44),
          "coarse value copy targets are 44px tall",
        );
      geometry.push({ theme, width, coarse, ...measured });
      if (width === 320 && process.env.AIC_REVIEW_SCREENSHOTS) {
        await page.screenshot({
          path: path.join(
            process.env.AIC_REVIEW_SCREENSHOTS,
            `security-parts-${theme}-320.png`,
          ),
        });
        await button(
          "Copy Contact additional secret value",
        ).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(
            process.env.AIC_REVIEW_SCREENSHOTS,
            `security-parts-${theme}-320-generic.png`,
          ),
        });
      }

      await button("Copy Business number value").click();
      await button("Copy Business expiry value").click();
      await button("Copy Business cvv value").click();
      assert.deepEqual(await page.evaluate(() => window.partsQa.writes), [
        number,
        "09/28",
        cvv,
      ]);
      const search = root.locator('input[type="search"]');
      await search.fill(cvv);
      assert.equal(
        await root.locator(".cm-aic-security-card").first().isVisible(),
        false,
        "search cannot match the hidden CVV",
      );
      await search.fill("");
      passed.push(`${theme}/${width}: separated copy, hidden secrets, layout`);

      for (const [name, value, count] of [
        ["Paste Empty number", number, 1],
        ["Paste Empty expiry", "09/28", 2],
        ["Paste Empty cvv", cvv, 3],
      ]) {
        await page.evaluate((next) => {
          window.partsQa.clipboard = next;
        }, value);
        await button(name).click();
        try {
          await page.waitForFunction(
            (expected) =>
              window.partsQa?.saves.filter((reason) => reason === "action")
                .length >= expected,
            count,
          );
        } catch (error) {
          const state = await page.evaluate(() => ({
            qaExists: Boolean(window.partsQa),
            saves: window.partsQa?.saves,
            reads: window.partsQa?.reads,
            draftChanged: window.partsQa?.draft !== window.partsQa?.persisted,
            pasteButtonCount: document.querySelectorAll(
              '[aria-label="Paste Empty number"]',
            ).length,
            status: [...document.querySelectorAll("#parts-qa [role='status']")]
              .map((node) => node.textContent)
              .filter(Boolean),
            editorCount: document.querySelectorAll("#parts-qa .aic-editor")
              .length,
            url: location.href,
            readyState: document.readyState,
          }));
          process.stderr.write(
            JSON.stringify({ theme, width, name, state, navigations }) + "\n",
          );
          throw error;
        }
        assert.equal(await button(name).count(), 0, "filled Paste disappears");
      }
      assert.equal(
        await page.evaluate(
          () =>
            window.partsQa.saves.filter((reason) => reason === "action").length,
        ),
        3,
        "each preview Paste emits one action save; focus boundary saves may coexist",
      );
      await page.evaluate((id) => {
        const qa = window.partsQa;
        qa.open(qa.persisted, id);
      }, `synthetic-v2-${++serial}`);
      await button("Copy Empty cvv value").waitFor();
      html = await root.innerHTML();
      assert.ok(!html.includes(cvv), "reopened CVV stays masked");
      await button("Copy Empty number value").click();
      await button("Copy Empty expiry value").click();
      await button("Copy Empty cvv value").click();
      assert.deepEqual(
        (await page.evaluate(() => window.partsQa.writes)).slice(-3),
        [number, "09/28", cvv],
      );
      passed.push(`${theme}/${width}: part Paste persists after reopen`);

      await page.evaluate(() => window.partsQa.editor.setReadOnly(true));
      assert.equal(await button("Paste Empty cvv").count(), 0);
      await button("Show Markdown source").click();
      assert.equal(await root.locator(".cm-aic-security-card").count(), 0);
      await button("Show preview").click();
      assert.ok((await root.locator(".cm-aic-security-card").count()) > 0);
      assert.ok(!(await root.innerHTML()).includes(extra));
      passed.push(`${theme}/${width}: read-only source toggle`);
      await context.close();
    }
  }
  assert.deepEqual(pageErrors, []);
  process.stdout.write(
    JSON.stringify(
      { syntheticOnly: true, browser: browser.version(), passed, geometry },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
