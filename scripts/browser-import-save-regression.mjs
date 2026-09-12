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
const emptySecurityBlock = [
  "```aic-security",
  "## Main",
  "Password*:",
  "```",
].join("\n");
const pastedValue = "DUMMY-PASTED-NOT-A-CREDENTIAL";
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
    const load = async (text, title = "Synthetic import") => {
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
            created_at: "2026-08-20T10:00:00.000Z",
            content_type: "Note",
            content: {
              title,
              text,
              editorIdentifier: "aic",
              appData: { "org.standardnotes.sn": { locked: false } },
            },
          },
        },
      });
    };
    const importBar = page.getByRole("group", { name: "Authenticator import" });
    const status = importBar.getByRole("status");
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
    await importBar
      .getByRole("button", { name: "Retry save", exact: true })
      .waitFor();
    assert.match(await status.textContent(), /not saved/u);
    await importBar
      .getByRole("button", { name: "Retry save", exact: true })
      .tap();
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

    // An explicit security-preview Paste must save its new draft. The host
    // acknowledgement, rather than the clipboard or masked DOM, is durable.
    await load(emptySecurityBlock, "secrets.note.md");
    await page.evaluate((value) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { readText: async () => value },
      });
    }, pastedValue);
    await page
      .getByRole("button", { name: "Paste Password", exact: true })
      .tap();
    await page.waitForFunction(() =>
      window.importHostQa.sent.some((item) => item.action === "save-items"),
    );
    assert.equal((await saves()).length, 1);
    await page.locator(".aic-toolbar").evaluate((toolbar) => {
      toolbar.scrollLeft = toolbar.scrollWidth;
    });
    const visibleStatus = await page.locator(".aic-save-status").boundingBox();
    assert.ok(
      visibleStatus &&
        visibleStatus.x >= 0 &&
        visibleStatus.x + visibleStatus.width <= 390,
      "save feedback remains on screen after horizontal toolbar scrolling",
    );
    assert.equal(
      await page.locator(".aic-editor").getAttribute("data-save-state"),
      "dirty",
      "the pasted draft stays dirty while the host save is pending",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Paste Password", exact: true })
        .count(),
      0,
      "filled fields do not offer Paste again",
    );
    let pastedPost = (await saves()).at(-1);
    const pastedMarkdown = pastedPost.data.items[0].content.text;
    assert.match(
      pastedMarkdown,
      /^---\nfile: secrets\.note\.md\ncreated: 2026-08-20T10:00:00\.000Z\nupdated: .+Z\n---\n/u,
    );
    assert.match(pastedMarkdown, /Password\*: DUMMY-PASTED-NOT-A-CREDENTIAL/u);
    assert.doesNotMatch(
      await page.locator("#app").innerHTML(),
      /DUMMY-PASTED-NOT-A-CREDENTIAL/u,
    );
    assert.doesNotMatch(
      pastedPost.data.items[0].content.preview_plain,
      /DUMMY-PASTED-NOT-A-CREDENTIAL/u,
    );
    assert.match(
      await page
        .getByRole("status")
        .allTextContents()
        .then((items) => items.join(" ")),
      /Saving note/u,
      "preview Paste shows a persistent pending-save status",
    );
    await send({
      action: "reply",
      original: pastedPost,
      data: { error: "synthetic-failure" },
    });
    await page
      .locator(".aic-toolbar")
      .getByRole("button", { name: "Retry save", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".aic-editor").getAttribute("data-save-state"),
      "dirty",
    );
    assert.match(
      await page
        .getByRole("status")
        .allTextContents()
        .then((items) => items.join(" ")),
      /not saved/u,
    );
    await page
      .locator(".aic-toolbar")
      .getByRole("button", { name: "Retry save", exact: true })
      .tap();
    assert.equal((await saves()).length, 2);
    pastedPost = (await saves()).at(-1);
    const withoutUpdated = (text) =>
      text.replace(/^updated: .*$/mu, "updated: <timestamp>");
    assert.equal(
      withoutUpdated(pastedPost.data.items[0].content.text),
      withoutUpdated(pastedMarkdown),
    );
    await send({ action: "reply", original: pastedPost, data: {} });
    await page.waitForFunction(
      () => document.querySelector(".aic-editor").dataset.saveState === "saved",
    );
    assert.match(
      await page
        .getByRole("status")
        .allTextContents()
        .then((items) => items.join(" ")),
      /Note saved/u,
    );
    await load(pastedPost.data.items[0].content.text, "secrets.note.md");
    assert.equal(await page.locator(".cm-aic-security").count(), 1);
    assert.equal(
      await page
        .getByRole("button", { name: "Paste Password", exact: true })
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator("#app").innerHTML(),
      /DUMMY-PASTED-NOT-A-CREDENTIAL/u,
    );
    assert.equal((await saves()).length, 0);
    assert.equal(
      await page.locator(".aic-editor").getAttribute("data-save-state"),
      "saved",
    );
    passed.push(
      `${theme}: touch conversion and preview Paste, mobile transport, failed save/retry, acknowledgement, fresh-page reopen`,
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
