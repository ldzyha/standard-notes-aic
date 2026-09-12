// Exercise the real entry point and pinned mobile message transport, not a
// separately mounted editor. All note and host data are synthetic and local.
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
const passed = [];
const source = JSON.stringify([
  {
    service: "Synthetic mobile import",
    account: "fixture@example.invalid",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    password: "DUMMY-IMPORT-SECRET",
  },
]);
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.ReactNativeWebView = {};
      window.importHostQa = { sent: [], allStrings: true };
      window.postMessage = (data) => {
        window.importHostQa.allStrings &&= typeof data === "string";
        window.importHostQa.sent.push(
          typeof data === "string" ? JSON.parse(data) : data,
        );
      };
    });
    const send = async (message) => {
      await page.evaluate((data) => {
        // Android/iOS wrappers may deliver JSON strings through document.
        document.dispatchEvent(
          new MessageEvent("message", { data: JSON.stringify(data) }),
        );
      }, message);
    };
    const saves = () =>
      page.evaluate(() =>
        window.importHostQa.sent.filter((item) => item.action === "save-items"),
      );
    const load = async (text) => {
      await page.goto(url);
      await page.locator(".aic-editor").waitFor();
      await send({
        action: "component-registered",
        sessionKey: "synthetic-session",
        data: {
          environment: "mobile",
          platform: "android",
          uuid: "synthetic-component",
          activeThemeUrls: [],
        },
      });
      const stream = await page.evaluate(() =>
        window.importHostQa.sent.find(
          (item) => item.action === "stream-context-item",
        ),
      );
      assert.ok(stream);
      await send({
        action: "reply",
        original: stream,
        data: {
          item: {
            uuid: "synthetic-note",
            content_type: "Note",
            content: {
              title: "Synthetic import",
              text,
              editorIdentifier: "aic",
              appData: { "org.standardnotes.sn": { locked: false } },
            },
          },
        },
      });
    };
    const status = page.locator('.cm-aic-security-import-bar [role="status"]');
    await load(source);
    assert.equal((await saves()).length, 0);
    await page
      .getByRole("button", {
        name: "Convert and save security blocks",
        exact: true,
      })
      .tap();
    await page.waitForFunction(() =>
      window.importHostQa.sent.some((item) => item.action === "save-items"),
    );
    assert.equal(await status.textContent(), "Saving note…");
    assert.equal(
      await page.locator(".aic-editor").getAttribute("data-save-state"),
      "dirty",
    );
    let posted = (await saves()).at(-1);
    const converted = posted.data.items[0].content.text;
    assert.match(converted, /^```aic-security\n/u);
    assert.notEqual(converted, source);
    assert.doesNotMatch(
      posted.data.items[0].content.preview_plain,
      /DUMMY-IMPORT-SECRET|GEZDGNBV/u,
    );
    assert.equal(posted.data.items[0].content.preview_html, "");
    assert.equal(await page.locator(".cm-aic-security").count(), 1);
    assert.doesNotMatch(
      await page.locator("#app").innerHTML(),
      /DUMMY-IMPORT-SECRET|GEZDGNBV/u,
    );
    await send({
      action: "reply",
      original: posted,
      data: { error: "synthetic-failure" },
    });
    await page
      .getByRole("button", { name: "Retry save", exact: true })
      .waitFor();
    assert.match(await status.textContent(), /not saved/u);
    await page.getByRole("button", { name: "Retry save", exact: true }).tap();
    assert.equal((await saves()).length, 2);
    posted = (await saves()).at(-1);
    assert.equal(posted.data.items[0].content.text, converted);
    await send({ action: "reply", original: posted, data: {} });
    await page.waitForFunction(
      () => document.querySelector(".aic-editor").dataset.saveState === "saved",
    );
    assert.equal(await status.textContent(), "Note saved");
    assert.equal(
      await page.evaluate(() => window.importHostQa.allStrings),
      true,
    );
    // A new page has no old editor/draft registry. Only the host's saved body
    // survives, reproducing leaving and reopening a mobile note.
    await load(converted);
    assert.equal(await page.locator(".cm-aic-security").count(), 1);
    assert.equal(
      await page
        .getByRole("button", { name: /Convert.*security blocks/u })
        .count(),
      0,
    );
    assert.equal((await saves()).length, 0);
    assert.equal(
      await page.locator(".aic-editor").getAttribute("data-save-state"),
      "saved",
    );
    assert.doesNotMatch(
      await page.locator("#app").innerHTML(),
      /DUMMY-IMPORT-SECRET|GEZDGNBV/u,
    );
    passed.push(
      `${theme}: touch conversion, mobile transport, failed save/retry, acknowledgement, fresh-page reopen`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify({ syntheticOnly: true, passed, errors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
