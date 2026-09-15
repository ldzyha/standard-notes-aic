// Packaged-extension smoke test. Uses only a disposable browser profile and
// local synthetic fixture; never attaches to a user's running browser.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const executable =
  process.env.AIC_REVIEW_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const extensionDir = path.resolve(
  process.env.AIC_EXTENSION_DIR || "dist-browser/chromium",
);
const output = path.resolve(
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/browser-extension-20260914",
);
assert.ok(
  output
    .toLowerCase()
    .startsWith("d:\\aic\\reviews\\browser-extension-20260914"),
  "Packaged screenshots must stay in the review directory.",
);
await mkdir(output, { recursive: true });
const fixture = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/aic-extension-qa/one",
);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(fixture.hostname) &&
    ["http:", "https:"].includes(fixture.protocol),
  "The packaged regression accepts only a loopback fixture URL.",
);
assert.equal(
  (await stat(path.join(extensionDir, "manifest.json"))).isFile(),
  true,
  "Build the unpacked Chromium package before running this test.",
);
const profile = await mkdtemp(path.join(tmpdir(), "aic-extension-regression-"));
const syntheticPassword = "synthetic-packaged-test-passphrase-only";
const syntheticMarkdown = "Synthetic packaged extension note 82751";
const syntheticSharedSecret = "SYNTHETIC-ONLY-SHARED-SECRET-82751";
const syntheticSharedMarkdown = [
  "```aic",
  "# Properties",
  `Password *| "${syntheticSharedSecret}"`,
  "Username | synthetic@example.invalid",
  "```",
  "",
].join("\n");
const childFixture = new URL("./two", fixture);
const results = {
  packagedExtension: true,
  browser: executable,
  passed: [],
  blocked: [],
  probes: [],
  unverified: [
    "sidebar setup, encrypted page and domain saves, restart/unlock, and cross-panel lock require an interactive sidebar target",
  ],
};
let runningContext;
let cdpBrowser;
let diagnosticSidebar;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertNoSharedPlaintextOnDisk() {
  const markers = [
    Buffer.from(syntheticSharedSecret),
    Buffer.from(syntheticSharedSecret, "utf16le"),
  ];
  const stack = [profile];
  let inspected = 0;
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) {
        inspected += 1;
        const bytes = await readFile(target);
        assert.equal(
          markers.some((marker) => bytes.includes(marker)),
          false,
          `Shared Properties plaintext reached disposable profile file: ${target}`,
        );
      }
    }
  }
  assert.ok(
    inspected > 0,
    "Disposable browser profile was unexpectedly empty.",
  );
  return inspected;
}

function fixtureHtml(requestUrl) {
  const child = new URL(requestUrl).pathname === childFixture.pathname;
  const title = child
    ? "Synthetic child fixture"
    : "Synthetic extension fixture";
  return `<!doctype html><title>${title}</title><main><h1>Fixture heading</h1><p>${syntheticMarkdown}</p></main>`;
}

async function launch() {
  runningContext = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: executable,
    ...(path.basename(executable).toLowerCase() === "chrome.exe"
      ? { ignoreDefaultArgs: ["--disable-extensions"] }
      : {}),
    args: [
      "--enable-unsafe-extension-debugging",
      "--remote-debugging-port=0",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const browserPage =
    runningContext.pages()[0] || (await runningContext.newPage());
  let browserConnection = runningContext.browser();
  if (!browserConnection) {
    const portFile = path.join(profile, "DevToolsActivePort");
    let port;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        port = Number((await readFile(portFile, "utf8")).split("\n")[0]);
        if (Number.isInteger(port) && port > 0) break;
      } catch {
        // Only the newly created disposable profile is inspected.
      }
      await delay(100);
    }
    if (port) {
      try {
        cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
          timeout: 7000,
        });
        browserConnection = cdpBrowser;
      } catch (error) {
        results.probes.push({ secondCdpConnection: error.message });
      }
    } else
      results.probes.push({
        secondCdpConnection: "No DevToolsActivePort in isolated profile",
      });
  }
  const cdp = browserConnection
    ? await browserConnection.newBrowserCDPSession()
    : await runningContext.newCDPSession(browserPage);
  const selected = (worker) => worker.url().endsWith("/worker.js");
  let worker = runningContext.serviceWorkers().find(selected);
  let loadedId;
  if (!worker) {
    try {
      loadedId = (
        await cdp.send("Extensions.loadUnpacked", { path: extensionDir })
      ).id;
      results.probes.push({ loadedUnpackedId: loadedId });
    } catch (error) {
      results.probes.push({ loadUnpacked: error.message });
    }
    worker = await runningContext
      .waitForEvent("serviceworker", { predicate: selected, timeout: 10000 })
      .catch(() => null);
  }
  if (!worker && loadedId) {
    const targets = (await cdp.send("Target.getTargets", { filter: [{}] }))
      .targetInfos;
    results.probes.push({
      afterLoadTargets: targets.map((item) => ({
        type: item.type,
        url: item.url,
      })),
    });
    throw new Error(
      "CDP loadUnpacked returned an ID, but Chrome exposed no packaged service-worker target; extension execution is unverified.",
    );
  }
  if (!worker && !loadedId)
    throw new Error(
      "Chrome started, but no packaged extension service worker appeared; the browser may have ignored unpacked-extension flags.",
    );
  const id = new URL(worker.url()).hostname;
  return { cdp, context: runningContext, id };
}

async function close() {
  await cdpBrowser?.close().catch(() => {});
  cdpBrowser = null;
  await runningContext?.close().catch(() => {});
  runningContext = null;
}

async function panel(context, id) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(`chrome-extension://${id}/browser/index.html`);
  await page.locator("#app.browser-panel").waitFor();
  return page;
}

async function findSetupPage(pages, id) {
  const candidates = pages.filter(
    (page) => page.url() === `chrome-extension://${id}/browser/index.html`,
  );
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const page of candidates) {
      if (
        (await page.evaluate(
          () => document.querySelector("#app")?.dataset.state,
        )) === "setup"
      )
        return page;
    }
    await delay(100);
  }
  return null;
}

async function assertCsp(page) {
  const csp = await page.evaluate(async (origin) => {
    const fetchBlocked = await fetch(`${origin}/forbidden-fetch`).then(
      () => false,
      () => true,
    );
    const websocketBlocked = await new Promise((resolve) => {
      try {
        const socket = new WebSocket(
          origin.replace(/^http/u, "ws") + "/forbidden-ws",
        );
        socket.onopen = () => {
          socket.close();
          resolve(false);
        };
        socket.onerror = () => resolve(true);
        setTimeout(() => resolve(true), 1000);
      } catch {
        resolve(true);
      }
    });
    const imageBlocked = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(false);
      image.onerror = () => resolve(true);
      image.src = `${origin}/forbidden-image.png`;
      setTimeout(() => resolve(true), 1000);
    });
    return { fetchBlocked, websocketBlocked, imageBlocked };
  }, fixture.origin);
  assert.deepEqual(csp, {
    fetchBlocked: true,
    websocketBlocked: true,
    imageBlocked: true,
  });
}

async function loadLibrary(page) {
  const reply = await page.evaluate(() =>
    globalThis.chrome.runtime.sendMessage({ type: "load" }),
  );
  assert.equal(reply?.ok, true, `Packaged worker load failed: ${reply?.error}`);
  return reply.value;
}

async function assertMaskedSharedPreview(page) {
  const shared = page.locator(".browser-domain-properties");
  await shared.waitFor();
  const preview = shared.getByLabel("Shared properties preview");
  await preview.waitFor();
  assert.equal(await shared.getAttribute("data-editing"), "false");
  assert.equal(await shared.locator(".aic-editor").count(), 0);
  assert.equal(
    await shared.getByRole("button", { name: "Copy Password value" }).count(),
    1,
  );
  assert.doesNotMatch(
    await preview.evaluate((element) => element.outerHTML),
    /SYNTHETIC-ONLY-SHARED-SECRET-82751/u,
  );
}

async function attachTarget(cdp, targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: false,
  });
  let nextId = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = async (method, params = {}) => {
    const id = ++nextId;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Nested CDP ${method} timed out.`));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
    });
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return reply;
  };
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw new Error(
        reply.exceptionDetails.exception?.description ||
          reply.exceptionDetails.text,
      );
    return reply.result?.value;
  };
  await send("Runtime.enable");
  return { send, evaluate };
}

try {
  const session = await launch();
  const { cdp, context, id } = session;
  assert.ok(/^[a-p]{32}$/u.test(id), "Chrome did not return an extension ID.");
  results.passed.push(
    "packaged MV3 service worker started in isolated profile",
  );
  await context.route(`${fixture.origin}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: fixtureHtml(route.request().url()),
    }),
  );
  const source = await context.newPage();
  await source.goto(fixture.href);
  assert.match(await source.title(), /Synthetic extension fixture/u);
  const targetInfos = (await cdp.send("Target.getTargets", { filter: [{}] }))
    .targetInfos;
  results.probes.push(
    ...targetInfos.map((item) => ({ type: item.type, url: item.url })),
  );
  const target = targetInfos.find(
    (item) => item.type === "tab" && item.url === fixture.href,
  );
  assert.ok(target, "CDP could not identify the synthetic source tab target.");
  let sideTarget;
  try {
    await cdp.send("Extensions.triggerAction", {
      id,
      targetId: target.targetId,
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      sideTarget = (
        await cdp.send("Target.getTargets", { filter: [{}] })
      ).targetInfos.find(
        (item) => item.url === `chrome-extension://${id}/browser/index.html`,
      );
      if (sideTarget) break;
      await delay(100);
    }
    if (sideTarget)
      results.passed.push(
        `toolbar action opened extension target (${sideTarget.type})`,
      );
    else
      results.blocked.push(
        "toolbar action returned but headless CDP exposed no side-panel target",
      );
  } catch (error) {
    results.blocked.push(
      `toolbar action unavailable through CDP: ${error.message}`,
    );
  }

  const helper = await panel(context, id);
  await source.bringToFront();
  await helper.waitForFunction(
    () => !!document.querySelector(".browser-feedback")?.textContent,
  );
  results.probes.push({
    directTabFeedback: await helper.locator(".browser-feedback").textContent(),
  });
  assert.equal(
    await helper.locator("#app").getAttribute("data-state"),
    "locked",
  );
  results.passed.push(
    "direct extension tab fails closed under worker sender isolation",
  );
  await assertCsp(helper);
  results.passed.push(
    "packaged extension CSP blocks external fetch, WebSocket, and image",
  );
  const exposedPages = () =>
    (context.browser()?.contexts() || [context]).flatMap((item) =>
      item.pages(),
    );
  let sidePage = await findSetupPage(exposedPages(), id);
  if (!sidePage && !cdpBrowser) {
    try {
      const port = Number(
        (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
      cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 7000,
      });
      sidePage = await findSetupPage(
        cdpBrowser.contexts().flatMap((item) => item.pages()),
        id,
      );
      results.probes.push({ secondConnectionSawSidebar: !!sidePage });
    } catch (error) {
      results.probes.push({ secondConnectionSidebar: error.message });
    }
  }
  if (sidePage && sideTarget) {
    diagnosticSidebar = sidePage;
    await sidePage.locator("#app.browser-panel").waitFor();
    results.passed.push(
      `side-panel target rendered packaged UI (${sideTarget.type})`,
    );
    await sidePage.waitForFunction(
      () => document.querySelector("#app")?.dataset.state === "setup",
    );
    await sidePage
      .getByLabel("Master passphrase", { exact: true })
      .fill(syntheticPassword);
    await sidePage
      .getByLabel("Confirm master passphrase")
      .fill(syntheticPassword);
    await sidePage
      .getByRole("button", { name: "Create encrypted library" })
      .click();
    await sidePage.waitForFunction(
      () => document.querySelector("#app")?.dataset.state === "unlocked",
    );
    const editor = sidePage.locator(".aic-editor .cm-content");
    await editor.waitFor();
    assert.equal(
      await sidePage.locator(".aic-editor").getAttribute("data-save-state"),
      "placeholder",
    );
    assert.equal(
      await sidePage
        .getByRole("button", { name: "Create note", exact: true })
        .count(),
      0,
    );
    // Enter through the visible writing line, as a user does. Focusing the
    // raw contenteditable skips CodeMirror's selection placement around widgets.
    await editor.locator(".cm-line").last().click();
    assert.equal(
      await sidePage.evaluate(() => {
        const anchor = document.getSelection()?.anchorNode;
        return (
          !!anchor && !!document.querySelector(".cm-content")?.contains(anchor)
        );
      }),
      true,
      "Click must place the caret inside the Markdown writing line.",
    );
    await sidePage.keyboard.type(syntheticMarkdown);
    assert.ok(
      (await editor.textContent()).includes(syntheticMarkdown),
      "The complete synthetic input must arrive before testing persistence.",
    );
    results.probes.push({
      afterTyping: await sidePage.evaluate(() => ({
        state: document.querySelector("#app")?.dataset.state,
        save: document.querySelector(".aic-editor")?.dataset.saveState,
        feedback: document.querySelector(".browser-feedback")?.textContent,
        content: document.querySelector(".cm-content")?.textContent,
        focused: document.activeElement?.className,
        visibility: document.visibilityState,
      })),
    });
    await sidePage.waitForFunction(
      (expected) =>
        document.querySelector(".aic-editor")?.dataset.saveState === "saved" &&
        document.querySelector(".cm-content")?.textContent?.includes(expected),
      syntheticMarkdown,
    );
    const shared = sidePage.locator(".browser-domain-properties");
    await shared
      .getByRole("button", { name: "Edit shared properties" })
      .click();
    await shared.waitFor({ state: "visible" });
    assert.equal(await shared.getAttribute("data-editing"), "true");
    await shared.getByRole("button", { name: "Show Markdown source" }).click();
    const sharedContent = shared.locator(".aic-editor .cm-content");
    await sharedContent.click();
    await sidePage.keyboard.press("Control+A");
    await sidePage.keyboard.insertText(syntheticSharedMarkdown);
    results.probes.push({
      sharedBeforeDone: await shared.evaluate((element) => ({
        save: element
          .querySelector(".aic-editor")
          ?.getAttribute("data-save-state"),
        busy: element
          .querySelector(".browser-domain-properties-action")
          ?.getAttribute("aria-busy"),
      })),
    });
    await shared.getByRole("button", { name: "Done", exact: true }).click();
    await sidePage
      .waitForFunction(
        () => {
          const shared = document.querySelector(".browser-domain-properties");
          return (
            shared?.getAttribute("data-editing") === "false" ||
            !!shared
              ?.querySelector(".browser-domain-properties-feedback")
              ?.textContent?.trim()
          );
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => null);
    const sharedAfterDone = await shared.evaluate((element) => ({
      editing: element.getAttribute("data-editing"),
      feedback: element.querySelector(".browser-domain-properties-feedback")
        ?.textContent,
      save: element
        .querySelector(".aic-editor")
        ?.getAttribute("data-save-state"),
      lines: [...element.querySelectorAll(".aic-editor .cm-line")].map(
        (line) => line.textContent,
      ),
    }));
    results.probes.push({ sharedAfterDone });
    assert.equal(
      sharedAfterDone.editing,
      "false",
      `Shared Properties Done did not complete: ${JSON.stringify(sharedAfterDone)}`,
    );
    await assertMaskedSharedPreview(sidePage);
    const storedLibrary = await loadLibrary(sidePage);
    assert.equal(storedLibrary.version, 2);
    assert.equal(storedLibrary.notes.length, 1);
    assert.equal(storedLibrary.domains.length, 1);
    assert.equal(storedLibrary.domains[0].origin, fixture.origin);
    assert.equal(storedLibrary.domains[0].markdown, syntheticSharedMarkdown);
    results.passed.push(
      "genuine sidebar saved exactly one shared domain Properties record",
    );
    await source.goto(childFixture.href);
    await sidePage.waitForFunction(() =>
      document
        .querySelector(".browser-page-title")
        ?.textContent?.includes("Synthetic child fixture"),
    );
    await assertMaskedSharedPreview(sidePage);
    assert.equal((await loadLibrary(sidePage)).domains.length, 1);
    await sidePage.screenshot({
      path: path.join(output, "package-domain-child-before-edge.png"),
    });
    results.passed.push(
      "same-origin child inherits masked shared Properties preview",
    );
    await source.goto(fixture.href);
    await sidePage.waitForFunction(
      (expected) =>
        document
          .querySelector(".browser-page-title")
          ?.textContent?.includes("Synthetic extension fixture") &&
        document
          .querySelector(".browser-note .cm-content")
          ?.textContent?.includes(expected),
      syntheticMarkdown,
    );
    const local = await sidePage.evaluate(() =>
      globalThis.chrome.storage.local.get(null),
    );
    const envelope = local["aic-browser-library"];
    assert.equal(envelope?.format, "aic-browser-vault");
    assert.ok(envelope?.cipher?.data);
    const localJson = JSON.stringify(local);
    assert.doesNotMatch(
      localJson,
      /Synthetic packaged extension note 82751|synthetic-packaged-test-passphrase-only/u,
    );
    assert.equal(localJson.includes(syntheticSharedSecret), false);
    results.passed.push(
      "genuine sidebar saved note to encrypted chrome.storage.local",
    );
    await sidePage.getByRole("button", { name: "Lock", exact: true }).click();
    await sidePage.waitForFunction(
      () =>
        document.querySelector("#app")?.dataset.state === "locked" &&
        !document.querySelector(".cm-editor"),
    );
    results.passed.push("genuine sidebar lock removed plaintext editor");
    await close();
    const filesInspected = await assertNoSharedPlaintextOnDisk();
    results.passed.push(
      `disposable Edge profile contains no shared Properties plaintext (${filesInspected} files scanned)`,
    );
    const restarted = await launch();
    assert.equal(
      restarted.id,
      id,
      "Extension ID changed across the isolated browser restart.",
    );
    await restarted.context.route(`${fixture.origin}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: fixtureHtml(route.request().url()),
      }),
    );
    const reopenedSource = await restarted.context.newPage();
    await reopenedSource.goto(fixture.href);
    const reopenedTabs = (
      await restarted.cdp.send("Target.getTargets", { filter: [{}] })
    ).targetInfos;
    const reopenedTab = reopenedTabs.find(
      (item) => item.type === "tab" && item.url === fixture.href,
    );
    assert.ok(reopenedTab, "Restarted browser has no synthetic tab target.");
    await restarted.cdp.send("Extensions.triggerAction", {
      id,
      targetId: reopenedTab.targetId,
    });
    const port = Number(
      (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split(
        "\n",
      )[0],
    );
    cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 7000,
    });
    const reopenedPanel = cdpBrowser
      .contexts()
      .flatMap((item) => item.pages())
      .find(
        (page) => page.url() === `chrome-extension://${id}/browser/index.html`,
      );
    assert.ok(
      reopenedPanel,
      "Restarted sidebar was not exposed as a Playwright page.",
    );
    await reopenedPanel.waitForFunction(
      () => document.querySelector("#app")?.dataset.state === "locked",
    );
    assert.equal(await reopenedPanel.locator(".cm-editor").count(), 0);
    await reopenedPanel
      .getByLabel("Master passphrase", { exact: true })
      .fill(syntheticPassword);
    await reopenedPanel
      .getByRole("button", { name: "Unlock", exact: true })
      .click();
    await reopenedPanel.waitForFunction(
      () => document.querySelector("#app")?.dataset.state === "unlocked",
    );
    await reopenedSource.bringToFront();
    results.probes.push({
      afterRestartUnlock: await reopenedPanel.evaluate(() => ({
        state: document.querySelector("#app")?.dataset.state,
        page: document.querySelector(".browser-page-title")?.textContent,
        origin: document
          .querySelector(".browser-page-origin")
          ?.getAttribute("title"),
        note: document.querySelector(".browser-note .cm-content")?.textContent,
        feedback: document.querySelector(".browser-feedback")?.textContent,
      })),
    });
    await reopenedPanel.waitForFunction(
      (expected) =>
        document
          .querySelector(".browser-note .cm-content")
          ?.textContent?.includes(expected),
      syntheticMarkdown,
    );
    const reopenedLibrary = await loadLibrary(reopenedPanel);
    assert.equal(reopenedLibrary.notes.length, 1);
    assert.equal(reopenedLibrary.domains.length, 1);
    assert.equal(reopenedLibrary.domains[0].origin, fixture.origin);
    assert.equal(reopenedLibrary.domains[0].markdown, syntheticSharedMarkdown);
    await assertMaskedSharedPreview(reopenedPanel);
    await reopenedSource.goto(childFixture.href);
    await reopenedPanel.waitForFunction(() =>
      document
        .querySelector(".browser-page-title")
        ?.textContent?.includes("Synthetic child fixture"),
    );
    await assertMaskedSharedPreview(reopenedPanel);
    assert.equal((await loadLibrary(reopenedPanel)).domains.length, 1);
    await reopenedPanel.screenshot({
      path: path.join(output, "package-domain-child-after-edge.png"),
    });
    results.passed.push(
      "browser restart requires unlock and restores encrypted note",
    );
    results.passed.push(
      "browser restart restores one shared domain and a masked child preview",
    );
    results.unverified = [
      "cross-panel lock was not exercised by this isolated run",
    ];
  } else if (sideTarget) {
    const actor = await attachTarget(cdp, sideTarget.targetId);
    const waitFor = async (expression) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await actor.evaluate(expression)) return;
        await delay(100);
      }
      throw new Error(
        `Genuine sidebar did not reach expected state: ${expression}`,
      );
    };
    await waitFor("document.querySelector('#app')?.dataset.state === 'setup'");
    results.passed.push("genuine sidebar target initialized in setup state");
    await actor.evaluate(`(() => {
      document.querySelector('input[aria-label="Master passphrase"]').value = ${JSON.stringify(syntheticPassword)};
      document.querySelector('input[aria-label="Confirm master passphrase"]').value = ${JSON.stringify(syntheticPassword)};
      document.querySelector('form').requestSubmit();
      return true;
    })()`);
    await waitFor(
      "document.querySelector('#app')?.dataset.state === 'unlocked'",
    );
    await waitFor("!!document.querySelector('.aic-editor .cm-content')");
    assert.equal(
      await actor.evaluate(
        "document.querySelector('.aic-editor').dataset.saveState",
      ),
      "placeholder",
    );
    await actor.evaluate(
      "document.querySelector('.aic-editor .cm-content').focus()",
    );
    await actor.send("Input.insertText", { text: syntheticMarkdown });
    await waitFor(
      "document.querySelector('.aic-editor')?.dataset.saveState === 'saved' && document.querySelector('.cm-content')?.textContent?.includes('Synthetic packaged extension note 82751')",
    );
    const local = await actor.evaluate("chrome.storage.local.get(null)");
    const envelope = local["aic-browser-library"];
    assert.equal(envelope?.format, "aic-browser-vault");
    assert.ok(envelope?.cipher?.data);
    assert.doesNotMatch(
      JSON.stringify(local),
      /Synthetic packaged extension note 82751|synthetic-packaged-test-passphrase-only/u,
    );
    results.passed.push(
      "genuine sidebar saved note to encrypted chrome.storage.local",
    );
    await actor.evaluate(
      "[...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Lock').click()",
    );
    await waitFor(
      "document.querySelector('#app')?.dataset.state === 'locked' && !document.querySelector('.cm-editor')",
    );
    results.passed.push("genuine sidebar lock removed plaintext editor");
    results.unverified = [
      "browser restart/unlock, shared domain Properties, and cross-panel lock were not exercised by this isolated run",
    ];
  } else {
    results.blocked.push(
      `The packaged sidebar ${sideTarget ? `exists as ${sideTarget.type}` : "was not exposed"}, and Playwright supplied no interactive sidebar page; direct extension tabs cannot substitute for it.`,
    );
  }
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  if (results.blocked.length) process.exitCode = 2;
} catch (error) {
  results.blocked.push(error.message);
  results.probes.push({ failureLocation: error.stack });
  if (diagnosticSidebar && !diagnosticSidebar.isClosed()) {
    results.probes.push({
      failedSidebar: await diagnosticSidebar
        .evaluate(() => ({
          state: document.querySelector("#app")?.dataset.state,
          save: document.querySelector(".aic-editor")?.dataset.saveState,
          feedback: document.querySelector(".browser-feedback")?.textContent,
          warnings: document.querySelector(".browser-draft-warnings")
            ?.textContent,
          content: document.querySelector(".cm-content")?.textContent,
          focused: document.activeElement?.className,
          visibility: document.visibilityState,
        }))
        .catch(() => null),
    });
  }
  process.stderr.write(JSON.stringify(results, null, 2) + "\n");
  process.exitCode = 2;
} finally {
  await close();
  // Keep the disposable profile for forensic review if this test fails. It
  // contains only the synthetic fixture and has never used a real profile.
  if (process.exitCode || results.blocked.length)
    process.stderr.write(`Isolated test profile retained: ${profile}\n`);
}
