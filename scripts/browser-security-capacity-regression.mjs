// Synthetic-only browser checks against the real shared AicEditor entry point.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5294";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const cases = [
  { width: 320, mobile: true },
  { width: 360, mobile: true },
  { width: 1280, mobile: false },
];
const secret = "JBSWY3DPEHPK3PXP";
const password = "SYNTHETIC-PRIVATE-PASSWORD";
const v3 = [
  "```aic-security v3",
  "Service: public-one.example.invalid",
  `TOTP#: ${secret}`,
  "---",
  "Service: public-two.example.invalid",
  `Password*: ${password}`,
  "```",
  "After",
].join("\n");
const fullSections = [
  "```aic-security v3",
  Array.from(
    { length: 16 },
    (_, index) => `Email: public-${index}@example.invalid`,
  ).join("\n---\n"),
  "```",
].join("\n");
const fullFields = [
  "```aic-security v3",
  Array.from({ length: 64 }, (_, index) => `Field ${index}: public-value`).join(
    "\n",
  ),
  "```",
].join("\n");
const malformed = [
  "Intro",
  "",
  "```aic-security v3",
  "Service: public.example.invalid",
  `Password*: ${password}`,
  "Card_: 4242 4242 4242 4242 | 99/28 | 999",
  "```",
].join("\n");
const duplicateProperties = [
  "---",
  "Password*: SYNTHETIC-FIRST-SECRET",
  "Password*: SYNTHETIC-SECOND-SECRET",
  "---",
  "Body",
].join("\n");
const unclosed = [
  "```aic-security v3",
  "Service: public.example.invalid",
  `Password*: ${password}`,
].join("\n");
const passed = [];
const errors = [];

try {
  for (const theme of ["light", "dark"]) {
    for (const { width, mobile } of cases) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: theme,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) =>
        errors.push(`${theme}/${width}: ${error.message}`),
      );
      await page.goto(url);
      await page.evaluate(
        async ({ theme, v3 }) => {
          const { AicEditor } = await import("/src/editor.ts");
          document.documentElement.style.colorScheme = theme;
          const parent = document.createElement("div");
          parent.id = "capacity-qa";
          parent.style =
            "position:fixed;inset:0;z-index:100;overflow:auto;background:var(--aic-bg)";
          document.body.append(parent);
          const qa = (window.capacityQa = { draft: v3, changes: 0 });
          qa.open = (source) => {
            qa.editor?.destroy();
            qa.draft = source;
            qa.changes = 0;
            qa.editor = new AicEditor(parent, {
              onChange: (next) => {
                qa.draft = next;
                qa.changes += 1;
              },
              onSave: async () => true,
            });
            qa.editor.switchDocument("synthetic-capacity", source);
            qa.editor.view.dispatch({ selection: { anchor: source.length } });
          };
          qa.open(v3);
        },
        { theme, v3 },
      );
      const root = page.locator("#capacity-qa");
      const open = (source) =>
        page.evaluate((text) => window.capacityQa.open(text), source);
      const disabled = (label) =>
        root
          .locator(`button[aria-label="${label}"]`)
          .evaluate((button) => button.disabled);
      const state = () =>
        page.evaluate(() => ({
          text: window.capacityQa.editor.view.state.doc.toString(),
          cursor: window.capacityQa.editor.view.state.selection.main.head,
          changes: window.capacityQa.changes,
        }));

      assert.equal(
        await root.locator(".cm-aic-security:not(.cm-aic-properties)").count(),
        1,
      );
      assert.equal(await root.locator(".cm-aic-security-section").count(), 2);
      assert.match(
        await root.locator(".cm-aic-security-capacity").textContent(),
        /Sections 2\/16/u,
      );
      assert.match(
        await root.locator(".cm-aic-security-capacity").textContent(),
        /65,536/u,
      );
      assert.match(
        await root.locator(".cm-aic-security-capacity-advice").textContent(),
        /services, banks, web, social networks/u,
      );
      assert.doesNotMatch(
        await root.innerHTML(),
        new RegExp(`${secret}|${password}`, "u"),
      );
      assert.ok(
        (await root
          .getByRole("button", { name: "Copy Service", exact: true })
          .count()) >= 2,
      );
      assert.equal(
        await root.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        true,
      );

      await open(fullSections);
      assert.equal(await root.locator(".cm-aic-security-section").count(), 16);
      assert.equal(await disabled("Add security section"), true);
      assert.equal(await disabled("New security block"), false);
      assert.match(
        await root.locator(".cm-aic-security-capacity").textContent(),
        /Sections 16\/16/u,
      );

      await open(fullFields);
      assert.equal(await root.locator(".cm-aic-security-section").count(), 1);
      assert.equal(await disabled("Add field to group"), true);
      assert.equal(await disabled("Add Password"), true);
      assert.equal(await disabled("Add security section"), false);
      assert.match(
        await root.locator(".cm-aic-security-field-count").textContent(),
        /Fields 64\/64/u,
      );

      await open(malformed);
      const error = root.locator(".cm-aic-security-error");
      assert.equal(await error.count(), 1);
      assert.match(await error.textContent(), /Line 6, column/u);
      assert.match(await error.textContent(), /MM\/YY/u);
      assert.doesNotMatch(
        await root.locator(".cm-aic-security").innerHTML(),
        /SYNTHETIC-PRIVATE-PASSWORD|99\/28/u,
      );
      await error.locator("button").click();
      const edited = await state();
      assert.equal(edited.cursor, malformed.indexOf("99/28"));
      assert.equal(edited.text, malformed);
      assert.equal(edited.changes, 0);

      await open(duplicateProperties);
      const propertiesError = root.locator(
        ".cm-aic-properties .cm-aic-security-error",
      );
      assert.equal(await propertiesError.count(), 1);
      assert.match(await propertiesError.textContent(), /Line 3, column 1/u);
      assert.doesNotMatch(
        await root.locator(".cm-aic-properties").innerHTML(),
        /SYNTHETIC-FIRST-SECRET|SYNTHETIC-SECOND-SECRET/u,
      );
      await propertiesError.locator("button").click();
      const propertiesEdited = await state();
      assert.equal(
        propertiesEdited.cursor,
        duplicateProperties.lastIndexOf("Password*:"),
      );
      assert.equal(propertiesEdited.text, duplicateProperties);
      assert.equal(propertiesEdited.changes, 0);

      await open(unclosed);
      assert.equal(await root.locator(".cm-aic-security-error").count(), 0);
      await root
        .getByRole("button", { name: "Add group or block", exact: true })
        .click();
      await root
        .getByRole("button", { name: "New security block", exact: true })
        .click();
      const generated = (await state()).text;
      assert.ok(generated.includes(unclosed + "\n```\n\n"));
      assert.equal(
        await root.locator(".cm-aic-security:not(.cm-aic-properties)").count(),
        2,
      );
      assert.equal(await root.locator(".cm-aic-security-error").count(), 0);
      assert.doesNotMatch(
        await root.innerHTML(),
        /SYNTHETIC-PRIVATE-PASSWORD/u,
      );
      passed.push(
        `${theme}/${width}: v3 sections, capacity gates, Security/Properties diagnostics, EOF New`,
      );
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify({ syntheticOnly: true, passed, errors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
