// Real Chromium layout against the actual panel, service, and encrypted vault.
// The browser host, pages, credentials, and clipboard are synthetic and in-memory.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const panelUrl = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/browser/index.html",
);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(panelUrl.hostname) &&
    ["http:", "https:"].includes(panelUrl.protocol),
  "Review browser may only connect to loopback",
);
const output = path.resolve(
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/browser-extension-20260914",
);
assert.ok(
  output
    .toLowerCase()
    .startsWith("d:\\aic\\reviews\\browser-extension-20260914"),
  "Review screenshots must stay in the designated directory",
);
await mkdir(output, { recursive: true });

const pages = [
  {
    url: "https://docs.example.invalid/wiki/spaces/EPC/pages/101/api-access",
    title: "API access",
  },
  {
    url: "https://docs.example.invalid/wiki/spaces/EPC/pages/102/release-plan",
    title: "Release plan",
  },
  {
    url: "https://single.example.invalid/wiki/spaces/EPC/pages/9954820132/very-long-url-slug",
    title: "Single account note",
  },
];
const properties = [
  "---",
  "# aic-fields: v2",
  "Username: synthetic@example.test",
  'Password*: "SYNTHETIC-ONLY-DOMAIN-SECRET"',
  "---",
  "",
].join("\n");
const password = "synthetic-domain-review-passphrase-not-a-credential";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.AIC_REVIEW_BROWSER ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
const results = [];

async function mount(page) {
  await page.goto(panelUrl.href);
  await page.evaluate(
    async ({ pages, password }) => {
      const { BrowserPanel } = await import("/src/browser/panel.ts");
      const { createBrowserService } = await import("/src/browser/service.ts");
      const listeners = () => {
        const values = new Set();
        return {
          addListener: (fn) => values.add(fn),
          removeListener: (fn) => values.delete(fn),
          emit: (...args) => [...values].forEach((fn) => fn(...args)),
        };
      };
      const storageChanged = listeners();
      const local = {};
      const session = {};
      const area = (store, name) => ({
        async get(key) {
          return Object.hasOwn(store, key) ? { [key]: store[key] } : {};
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          storageChanged.emit(changes, name);
        },
        async remove(key) {
          const oldValue = store[key];
          delete store[key];
          storageChanged.emit({ [key]: { oldValue } }, name);
        },
        async setAccessLevel({ accessLevel }) {
          if (accessLevel !== "TRUSTED_CONTEXTS") throw Error("unsafe access");
        },
      });
      const activated = listeners();
      const updated = listeners();
      const removed = listeners();
      const tab = {
        id: 11,
        windowId: 7,
        active: true,
        url: pages[0].url,
        title: pages[0].title,
      };
      const api = {
        runtime: {
          id: "synthetic-domain-review",
          getURL: (file) => new URL(file, location.href).href,
          onMessage: listeners(),
          onInstalled: listeners(),
          async sendMessage(message) {
            try {
              return { ok: true, value: await service.handle(message) };
            } catch (error) {
              return {
                ok: false,
                error: error?.message || "Synthetic service error",
                code: error?.code,
              };
            }
          },
        },
        storage: {
          local: area(local, "local"),
          session: area(session, "session"),
          onChanged: storageChanged,
        },
        tabs: {
          query: async ({ active, windowId }) =>
            (!active || tab.active) &&
            (windowId === undefined || windowId === 7)
              ? [{ ...tab }]
              : [],
          get: async () => ({ ...tab }),
          async update(id, changes) {
            if (id !== tab.id) throw Error("No synthetic tab");
            Object.assign(tab, changes);
            updated.emit(id, changes, { ...tab });
            return { ...tab };
          },
          async create({ url }) {
            tab.url = url;
            tab.title = pages.find((item) => item.url === url)?.title || url;
            updated.emit(tab.id, { url, title: tab.title }, { ...tab });
            return { ...tab };
          },
          onActivated: activated,
          onUpdated: updated,
          onRemoved: removed,
        },
        windows: { getCurrent: async () => ({ id: 7, incognito: false }) },
        permissions: { request: async () => true },
        sidePanel: { setPanelBehavior: async () => {} },
        scripting: { executeScript: async () => [] },
      };
      const service = createBrowserService(api);
      await service.handle({ type: "setup", password });
      for (const item of pages) {
        tab.url = item.url;
        tab.title = item.title;
        await service.handle({
          type: "create",
          page: { url: item.url, title: item.title, tabId: 11, windowId: 7 },
          markdown: `# ${item.title}\n\nSynthetic page note.`,
          ifAbsent: true,
        });
        await service.handle({ type: "visit", windowId: 7 });
      }
      tab.url = pages[0].url;
      tab.title = pages[0].title;
      const app = document.querySelector("#app");
      app.replaceChildren();
      const root = document.createElement("div");
      root.className = "qa-panel";
      app.append(root);
      const panel = new BrowserPanel(root, api);
      window.domainQa = {
        panel,
        api,
        clipboard: "",
        async next(item) {
          tab.url = item.url;
          tab.title = item.title;
          updated.emit(
            tab.id,
            { url: item.url, title: item.title },
            { ...tab },
          );
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.domainQa.clipboard = text;
          },
          readText: async () => window.domainQa.clipboard,
        },
      });
      await panel.ready;
    },
    { pages, password },
  );
}

async function noOverflow(panel, width) {
  const size = await panel.evaluate((element) => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    panel: element.scrollWidth,
    visible: element.clientWidth,
  }));
  assert.ok(
    size.document <= width + 1 &&
      size.body <= width + 1 &&
      size.panel <= size.visible + 1,
    `horizontal overflow: ${JSON.stringify(size)}`,
  );
  return size;
}

try {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 600]) {
      const context = await browser.newContext({
        viewport: { width, height: 700 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page);
      const panel = page.locator(".qa-panel");
      await panel.locator(".browser-note .aic-editor").waitFor();
      assert.equal(
        await panel.locator(".browser-domain-properties").count(),
        1,
      );
      assert.equal(
        await panel.locator(".browser-domain-properties .cm-editor").count(),
        0,
      );
      await noOverflow(panel, width);
      await page.screenshot({
        path: path.join(output, `domain-empty-${theme}-${width}.png`),
      });

      await panel
        .getByRole("button", { name: "Edit shared properties" })
        .click();
      assert.equal(await panel.locator(".browser-note").count(), 1);
      assert.equal(await panel.locator(".browser-note").isVisible(), false);
      assert.equal(
        await panel.locator(".browser-domain-properties .aic-editor").count(),
        1,
      );
      await page.evaluate(() => {
        window.domainQa.originalEditor = window.domainQa.panel.editor.view;
      });
      await panel
        .locator(".browser-domain-properties")
        .getByRole("button", { name: "Show Markdown source" })
        .click();
      await page.evaluate((text) => {
        const view = window.domainQa.panel.shared.editor.view;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: text.length },
        });
      }, properties);
      assert.equal(
        await panel
          .locator(".browser-domain-properties")
          .getAttribute("data-editing"),
        "true",
      );
      await noOverflow(panel, width);
      await page.screenshot({
        path: path.join(output, `domain-edit-${theme}-${width}.png`),
      });
      await panel.getByRole("button", { name: "Done", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector(".browser-domain-properties")?.dataset
            .editing === "false",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.domainQa.panel.editor.view ===
            window.domainQa.originalEditor,
        ),
        true,
      );
      const card = panel.locator(
        ".browser-domain-properties .cm-aic-properties",
      );
      await card.waitFor();
      assert.doesNotMatch(
        await card.evaluate((element) => element.outerHTML),
        /SYNTHETIC-ONLY-DOMAIN-SECRET/u,
      );
      await noOverflow(panel, width);
      await page.screenshot({
        path: path.join(output, `domain-preview-${theme}-${width}.png`),
      });
      await panel.locator(".browser-domain-properties .cm-content").click();
      await page.keyboard.press("Control+A");
      assert.equal(
        await card.count(),
        1,
        "select-all must not expose raw Properties source",
      );
      assert.doesNotMatch(
        await panel.locator(".browser-domain-properties").innerHTML(),
        /SYNTHETIC-ONLY-DOMAIN-SECRET/u,
      );
      await card.getByRole("button", { name: "Copy Password value" }).click();
      assert.equal(
        await page.evaluate(() => window.domainQa.clipboard),
        "SYNTHETIC-ONLY-DOMAIN-SECRET",
      );
      const stored = await page.evaluate(async () => {
        const reply = await window.domainQa.api.runtime.sendMessage({
          type: "load",
        });
        return reply.value;
      });
      assert.equal(stored.domains.length, 1);
      assert.ok(
        stored.domains[0].markdown.includes("SYNTHETIC-ONLY-DOMAIN-SECRET"),
      );
      assert.ok(
        stored.notes.every(
          (note) => !note.markdown.includes("SYNTHETIC-ONLY-DOMAIN-SECRET"),
        ),
      );

      await panel.getByRole("button", { name: "Notes and history" }).click();
      const nav = panel.locator(".browser-navigation");
      await nav.waitFor();
      const domains = nav.locator(".browser-domain");
      assert.equal(await domains.count(), 2);
      const active = domains.filter({
        has: page.locator("summary:text-is('docs.example.invalid')"),
      });
      assert.equal(await active.getAttribute("open"), "");
      const sharedLabels = await active
        .locator(".browser-path-label")
        .allTextContents();
      assert.deepEqual(sharedLabels, ["wiki/spaces/EPC/pages"]);
      const singleton = domains.filter({
        has: page.locator("summary:text-is('single.example.invalid')"),
      });
      assert.equal(await singleton.locator(".browser-path-label").count(), 0);
      assert.equal(
        await singleton
          .locator("button")
          .allTextContents()
          .then((items) => items.includes("Single account note")),
        true,
      );
      assert.equal(
        await singleton.locator("button[title]").first().getAttribute("title"),
        pages[2].url,
      );
      await singleton.locator("summary").click();
      assert.equal(await singleton.getAttribute("open"), "");
      await noOverflow(panel, width);
      await page.screenshot({
        path: path.join(output, `domain-nav-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");

      await page.evaluate((item) => window.domainQa.next(item), pages[1]);
      await page.waitForFunction(
        (url) =>
          document
            .querySelector(".qa-panel .browser-page-origin")
            ?.getAttribute("title") === url,
        pages[1].url,
      );
      await panel
        .locator(".browser-domain-properties .cm-aic-properties")
        .waitFor();
      assert.doesNotMatch(
        await panel.locator(".browser-domain-properties").innerHTML(),
        /SYNTHETIC-ONLY-DOMAIN-SECRET/u,
      );
      const after = await page.evaluate(async () => {
        const reply = await window.domainQa.api.runtime.sendMessage({
          type: "load",
        });
        return {
          domains: reply.value.domains.length,
          notes: reply.value.notes.length,
        };
      });
      assert.deepEqual(after, { domains: 1, notes: 3 });
      assert.deepEqual(errors, []);
      results.push({
        theme,
        width,
        overflow: await noOverflow(panel, width),
        domainRecords: after.domains,
      });
      await context.close();
    }
  }
  process.stdout.write(
    JSON.stringify({ syntheticHostOnly: true, results }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
