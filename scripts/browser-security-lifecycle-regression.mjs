// Real mobile viewport eviction/remount; all source and clipboard data are synthetic.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5189";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    const parent = document.createElement("div");
    parent.style = "position:fixed;inset:0;z-index:100;background:white";
    document.body.append(parent);
    const qa = { copies: [], parent };
    globalThis.securityLifecycleQa = qa;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => qa.copies.push(value) },
    });
    qa.editor = new AicEditor(parent, {
      document,
      onChange: () => {},
      onSave: () => true,
    });
    qa.editor.setDocument(
      JSON.stringify(
        Array.from({ length: 35 }, (_, index) => ({
          service: "Fixture " + index,
          account: "fixture-account-" + index,
          secret: "",
        })),
      ),
    );
  });
  await page
    .getByRole("button", {
      name: "Convert and save security blocks",
      exact: true,
    })
    .click();
  await page.waitForTimeout(300);
  const scroll = async (end) => {
    await page.evaluate((end) => {
      const { view } = globalThis.securityLifecycleQa.editor;
      view.scrollDOM.scrollTop = end ? view.scrollDOM.scrollHeight : 0;
      view.requestMeasure();
    }, end);
    await page.waitForTimeout(300);
  };
  await scroll(false);
  await page
    .getByRole("button", { name: "Copy Account", exact: true })
    .first()
    .click();
  assert.equal(
    await page.evaluate(() => globalThis.securityLifecycleQa.copies.length),
    1,
  );
  const initial = await page.evaluate(() => {
    const qa = globalThis.securityLifecycleQa;
    qa.original = qa.parent.querySelector(".cm-aic-security");
    return qa.editor.view.viewport.from;
  });
  await scroll(true);
  assert.equal(
    await page.evaluate(
      () => globalThis.securityLifecycleQa.original.isConnected,
    ),
    false,
  );
  assert.ok(
    (await page.evaluate(
      () => globalThis.securityLifecycleQa.editor.view.viewport.from,
    )) > initial,
  );
  await scroll(false);
  await page
    .getByRole("button", { name: "Copy Account", exact: true })
    .first()
    .click();
  assert.equal(
    await page.evaluate(() => globalThis.securityLifecycleQa.copies.length),
    2,
  );
  assert.deepEqual(
    await page.evaluate(() => globalThis.securityLifecycleQa.copies),
    ["fixture-account-0", "fixture-account-0"],
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: converted security block copies before and after actual mobile viewport eviction/remount",
  );
} finally {
  await browser.close();
}
