// Real editor and browser clipboard, with synthetic local values only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5288";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const primary = 'synthetic "literal" | primary';
const description = "public | hint";
const additional = "synthetic | additional";
const pasted = 'synthetic "pasted" | value';
const number = "4242 4242 4242 1234";
const expiry = "09/28";
const cvv = "019";
const propertyValue = 'metadata "literal" | value';
const propertyDescription = "metadata | hint";
const propertySecret = "synthetic | metadata-secret";
const quoted = (...slots) => slots.map(JSON.stringify).join(" | ");
const propertyScalar = `'${quoted(propertyValue, propertyDescription, propertySecret).replaceAll("'", "''")}'`;
const source = [
  "---",
  "# aic-fields: v2",
  `Password*: ${propertyScalar}`,
  "---",
  "",
  "```aic",
  `Password*: ${quoted(primary, description, additional)}`,
  `Card_: ${quoted(number, expiry, cvv)}`,
  `Empty*: ${quoted("", "", "")}`,
  "```",
  "",
  "After",
].join("\n");
const pageErrors = [];
const passed = [];

try {
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 360]) {
      const mobile = width === 360;
      const context = await browser.newContext({
        viewport: { width, height: mobile ? 780 : 900 },
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: theme,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(url);
      await page.evaluate(
        async ({ theme, source }) => {
          const { AicEditor } = await import("/src/editor.ts");
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-background-color",
            theme === "dark" ? "#111111" : "#ffffff",
          );
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-foreground-color",
            theme === "dark" ? "#eeeeee" : "#20242b",
          );
          document.documentElement.style.colorScheme = theme;
          const parent = document.createElement("div");
          parent.id = "quoted-qa";
          parent.style =
            "position:fixed;inset:0;z-index:100;overflow:auto;background:var(--aic-bg)";
          document.body.append(parent);
          const qa = (window.quotedQa = {
            draft: source,
            persisted: source,
            clipboard: "",
            writes: [],
            saves: [],
          });
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              readText: async () => qa.clipboard,
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
            qa.editor.refreshTheme();
            qa.editor.switchDocument(id, text);
            qa.editor.view.dispatch({ selection: { anchor: text.length } });
          };
          qa.open(source, "quoted-initial");
        },
        { theme, source },
      );

      const root = page.locator("#quoted-qa");
      const security = root.locator(".cm-aic-security:not(.cm-aic-properties)");
      const properties = root.locator(".cm-aic-properties");
      const control = (scope, name) =>
        scope.getByRole("button", { name, exact: true });
      await control(security, "Copy Password value").waitFor();
      assert.equal(await security.count(), 1);
      assert.equal(await properties.count(), 1);
      assert.equal(await security.locator(".cm-aic-security-card").count(), 3);
      assert.equal(
        await root.locator(".aic-editor").getAttribute("data-theme"),
        theme === "dark" ? "dark" : "default",
      );
      const html = await root.innerHTML();
      for (const hidden of [
        primary,
        additional,
        number,
        cvv,
        propertyValue,
        propertySecret,
      ])
        assert.ok(!html.includes(hidden), `${theme}/${width}: hidden from DOM`);

      for (const [scope, name, value] of [
        [security, "Copy Password value", primary],
        [security, "Copy Password description value", description],
        [security, "Copy Password additional secret value", additional],
        [security, "Copy Card number value", number],
        [security, "Copy Card expiry value", expiry],
        [security, "Copy Card cvv value", cvv],
        [properties, "Copy Password value", propertyValue],
        [properties, "Copy Password description value", propertyDescription],
        [properties, "Copy Password additional secret value", propertySecret],
      ]) {
        await control(scope, name).click();
        assert.equal(
          await page.evaluate(() => window.quotedQa.writes.at(-1)),
          value,
          `${theme}/${width}: ${name}`,
        );
      }
      assert.equal(await page.evaluate(() => window.quotedQa.draft), source);
      passed.push(
        `${theme}/${width}: dequoted copies, independent card slots, masking`,
      );

      await page.evaluate((value) => {
        window.quotedQa.clipboard = value;
      }, pasted);
      await control(security, "Paste Empty value").click();
      await page.waitForFunction(() =>
        window.quotedQa.saves.includes("action"),
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.quotedQa.saves.filter((reason) => reason === "action")
              .length,
        ),
        1,
      );
      const saved = await page.evaluate(() => window.quotedQa.persisted);
      assert.notEqual(saved, source);
      assert.ok(!(await root.innerHTML()).includes(pasted));
      await control(security, "Copy Empty value").click();
      assert.equal(
        await page.evaluate(() => window.quotedQa.writes.at(-1)),
        pasted,
      );

      await page.evaluate((id) => {
        const qa = window.quotedQa;
        qa.open(qa.persisted, id);
      }, `quoted-reopened-${theme}-${width}`);
      await control(security, "Copy Empty value").waitFor();
      assert.ok(!(await root.innerHTML()).includes(pasted));
      for (const [scope, name, value] of [
        [security, "Copy Empty value", pasted],
        [security, "Copy Password value", primary],
        [security, "Copy Password additional secret value", additional],
        [security, "Copy Card number value", number],
        [security, "Copy Card expiry value", expiry],
        [security, "Copy Card cvv value", cvv],
        [properties, "Copy Password value", propertyValue],
      ]) {
        await control(scope, name).click();
        assert.equal(
          await page.evaluate(() => window.quotedQa.writes.at(-1)),
          value,
          `${theme}/${width}: reopened ${name}`,
        );
      }
      assert.equal(await page.evaluate(() => window.quotedQa.draft), saved);
      passed.push(
        `${theme}/${width}: quoted clipboard paste saved and reopened exactly`,
      );
      await context.close();
    }
  }
  assert.deepEqual(pageErrors, []);
  process.stdout.write(
    JSON.stringify(
      { syntheticOnly: true, browser: browser.version(), passed },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
