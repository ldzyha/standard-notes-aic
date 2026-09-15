// Real Chromium rendering with an in-memory, synthetic extension host. No
// installed extension, live sites, OS clipboard, or user browser profile.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = new URL(
  process.env.AIC_REVIEW_URL || "http://127.0.0.1:5289/browser/index.html",
);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol),
  "The panel regression may only connect to a loopback Vite server.",
);
const output = path.resolve(
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/browser-extension-20260914",
);
assert.ok(
  output
    .toLowerCase()
    .startsWith("d:\\aic\\reviews\\browser-extension-20260914"),
  "Screenshots and downloaded fixtures must stay in the review directory.",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.AIC_REVIEW_BROWSER ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
const passed = [];
const measurements = [];
const syntheticPassword =
  "synthetic-panel-regression-passphrase-not-a-credential";
const syntheticUrl = "https://fixture.example.invalid/guide/one";
const otherUrl = "https://fixture.example.invalid/guide/two";
const syntheticHtml = [
  "<article><h1>Fixture heading</h1><p>Plain <strong>bold</strong> and <a href='/safe'>link</a>.</p>",
  "<ul><li>First item</li><li>Second item</li></ul>",
  "<pre><code class='language-js'>const answer = 42;</code></pre>",
  "<script>window.fixtureExecuted = true</script>",
  "<p><a href='javascript:alert(1)'>Unsafe destination</a></p></article>",
].join("");

async function openMenu(panel, name) {
  await panel.getByRole("button", { name, exact: true }).click();
  const dialog = panel.getByRole("dialog", { name, exact: true });
  await dialog.waitFor();
  return dialog;
}

async function assertNoHorizontalOverflow(panel) {
  const widths = await panel.evaluate((element) => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    panel: element.scrollWidth,
    panelVisible: element.clientWidth,
  }));
  assert.ok(
    widths.document <= widths.viewport + 1 &&
      widths.body <= widths.viewport + 1 &&
      widths.panel <= widths.panelVisible + 1,
    `panel must not overflow horizontally: ${JSON.stringify(widths)}`,
  );
  return widths;
}

async function assertPanelInViewport(panel) {
  const bounds = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const feedback = element.querySelector(".browser-feedback");
    const notice = feedback?.textContent?.trim()
      ? feedback.getBoundingClientRect()
      : null;
    return {
      top: box.top,
      bottom: box.bottom,
      viewportHeight: window.innerHeight,
      noticeTop: notice?.top ?? null,
      noticeBottom: notice?.bottom ?? null,
    };
  });
  assert.ok(
    Math.abs(bounds.top) <= 1 && bounds.bottom <= bounds.viewportHeight + 1,
    `panel must fill the visible viewport: ${JSON.stringify(bounds)}`,
  );
  if (bounds.noticeTop !== null)
    assert.ok(
      bounds.noticeTop >= 0 && bounds.noticeBottom <= bounds.viewportHeight,
      `feedback must remain fully visible: ${JSON.stringify(bounds)}`,
    );
}

async function assertCompactEditor(panel) {
  const layout = await panel.evaluate((element) => {
    const editor = element.querySelector(".cm-editor");
    const toolbar = element.querySelector(
      ".browser-note .aic-toolbar--compact",
    );
    if (!editor) throw Error("Editor is missing");
    if (!toolbar) throw Error("Compact toolbar is missing");
    const panelBox = element.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    const toolbarBox = toolbar.getBoundingClientRect();
    const toolbarStyle = getComputedStyle(toolbar);
    return {
      top: editorBox.top - panelBox.top,
      height: editorBox.height,
      panelHeight: panelBox.height,
      toolbarHeight: toolbarBox.height,
      toolbarClass: toolbar.className,
      toolbarMinHeight: toolbarStyle.minHeight,
      toolbarPadding: toolbarStyle.padding,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
    };
  });
  assert.ok(
    layout.top < 120,
    `editor starts too low: ${JSON.stringify(layout)}`,
  );
  assert.ok(
    layout.height > layout.panelHeight * 0.6,
    `editor is too short: ${JSON.stringify(layout)}`,
  );
  assert.ok(
    layout.toolbarHeight >= 32 && layout.toolbarHeight <= 36,
    `compact desktop toolbar should stay 32-36px tall: ${JSON.stringify(layout)}`,
  );
  const explicitTouch = await panel.evaluate(async (element) => {
    const { createUiButton } = await import("/src/core/ui-system.js");
    const toolbar = element.querySelector(
      ".browser-note .aic-toolbar--compact",
    );
    const button = createUiButton(document, {
      label: "Synthetic explicit touch target",
      text: "Touch",
      size: "touch",
    });
    toolbar.append(button);
    const box = button.getBoundingClientRect();
    button.remove();
    return { width: box.width, height: box.height };
  });
  assert.ok(
    explicitTouch.width >= 44 && explicitTouch.height >= 44,
    `an explicit touch button must override a fine compact toolbar: ${JSON.stringify(explicitTouch)}`,
  );
  const widths = await assertNoHorizontalOverflow(panel);
  const formatting = panel.getByRole("button", { name: "Formatting" });
  assert.equal(await formatting.getAttribute("aria-expanded"), "false");
  await formatting.click();
  assert.equal(await formatting.getAttribute("aria-expanded"), "true");
  await panel.locator(".aic-toolbar-tray").waitFor({ state: "visible" });
  await formatting.click();
  assert.equal(await formatting.getAttribute("aria-expanded"), "false");
  await panel.locator(".aic-toolbar-tray").waitFor({ state: "hidden" });
  return { ...layout, explicitTouch, widths };
}

async function assertFormattingPopover(page, panel, theme, width, height) {
  const toolbar = panel.locator(".browser-note .aic-toolbar--compact");
  const trigger = toolbar.getByRole("button", { name: "Formatting" });
  assert.equal(await trigger.innerText(), "Format");
  assert.equal(await trigger.getAttribute("title"), "Formatting");
  assert.equal(
    await toolbar.getByRole("button", { name: "Show Markdown source" }).count(),
    1,
  );
  assert.equal(
    await toolbar.locator('button[aria-label="Save note"]').count(),
    1,
  );
  await trigger.click();
  const tray = toolbar.locator(".aic-toolbar-tray");
  await tray.waitFor({ state: "visible" });
  const layout = await tray.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll("button,select")];
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflowY: getComputedStyle(element).overflowY,
      controlsNamed: controls.every(
        (control) =>
          !!control.getAttribute("aria-label") ||
          !!control.getAttribute("title") ||
          !!control.textContent?.trim(),
      ),
    };
  });
  assert.ok(
    layout.left >= 0 &&
      layout.top >= 0 &&
      layout.right <= layout.viewportWidth + 1 &&
      layout.bottom <= layout.viewportHeight + 1,
    `formatting popover must fit the viewport: ${JSON.stringify(layout)}`,
  );
  assert.equal(layout.overflowY, "auto");
  assert.equal(layout.controlsNamed, true);
  await page.screenshot({
    path: path.join(
      output,
      `formatting-popover-${theme}-${width}x${height}.png`,
    ),
  });
  const controls = tray.locator("button,select");
  const controlCount = await controls.count();
  assert.ok(controlCount >= 10, "formatting popover should expose every group");
  for (let index = 0; index < controlCount; index += 1) {
    const control = controls.nth(index);
    await control.evaluate((element) =>
      element.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    const hit = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return {
        reachable: target === element || element.contains(target),
        label:
          element.getAttribute("aria-label") || element.textContent?.trim(),
      };
    });
    assert.ok(
      hit.reachable,
      `formatting control ${index + 1} must be reachable: ${JSON.stringify(hit)}`,
    );
    if ((await control.evaluate((element) => element.tagName)) === "BUTTON")
      await control.click();
    assert.equal(await tray.isVisible(), true);
  }
  await tray.locator("select").first().focus();
  await page.keyboard.press("Escape");
  await tray.waitFor({ state: "hidden" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(
    await trigger.evaluate((element) => element === document.activeElement),
    true,
  );
  return { theme, width, height, ...layout };
}

async function assertCoarseTargets(page, panel, theme) {
  const result = await panel.evaluate((element) => {
    const buttons = [
      ...element.querySelectorAll(
        ".browser-toolbar .aic-button, .browser-note .aic-toolbar .aic-button",
      ),
    ]
      .filter((button) => button.getBoundingClientRect().height > 0)
      .map((button) => {
        const box = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label"),
          width: box.width,
          height: box.height,
        };
      });
    const compactField = document.createElement("input");
    compactField.className = "aic-field__control aic-field__control--compact";
    element.append(compactField);
    const compactFieldBox = compactField.getBoundingClientRect();
    compactField.remove();
    return {
      coarse: matchMedia("(pointer: coarse)").matches,
      buttons,
      compactField: {
        width: compactFieldBox.width,
        height: compactFieldBox.height,
      },
    };
  });
  assert.equal(result.coarse, true);
  assert.ok(result.buttons.length >= 6);
  assert.ok(
    result.buttons.every((button) => button.width >= 44 && button.height >= 44),
    `coarse buttons must retain 44px targets: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.compactField.height >= 44,
    `a compact field must retain a 44px coarse target: ${JSON.stringify(result.compactField)}`,
  );
  await page.screenshot({
    path: path.join(output, `coarse-${theme}-320x480.png`),
  });
  return { theme, ...result };
}

async function assertPageDeletion(page, panel, theme, width) {
  const otherDelete = (await openMenu(panel, "Notes and history")).getByRole(
    "button",
    {
      name: "Delete local note: Fixture page two",
      exact: true,
    },
  );
  await otherDelete.click();
  let confirm = panel.getByRole("dialog", {
    name: "Delete local page",
    exact: true,
  });
  await confirm.waitFor();
  await page.screenshot({
    path: path.join(output, `delete-other-${theme}-${width}.png`),
  });
  await confirm.getByRole("button", { name: "Delete note" }).click();
  await page.waitForFunction(async (removedUrl) => {
    const result = await window.panelQa.api.runtime.sendMessage({
      type: "load",
    });
    return (
      result.ok &&
      !result.value.notes.some((note) => note.url === removedUrl) &&
      !result.value.history.some((visit) => visit.url === removedUrl)
    );
  }, otherUrl);
  assert.equal(
    await panel.locator(".browser-page-origin").getAttribute("title"),
    syntheticUrl,
    "deleting another tree item must keep the current editor",
  );
  assert.match(
    await panel.locator(".browser-note .cm-content").innerText(),
    /Synthetic handwritten edit/u,
  );

  const more = await openMenu(panel, "More options");
  await more
    .getByRole("button", { name: "Delete local note", exact: true })
    .click();
  confirm = panel.getByRole("dialog", {
    name: "Delete local page",
    exact: true,
  });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "Delete note" }).click();
  await page.waitForFunction(async (removedUrl) => {
    const panel = document.querySelector(".qa-panel");
    const result = await window.panelQa.api.runtime.sendMessage({
      type: "load",
    });
    return (
      panel?.querySelector(".aic-editor")?.dataset.saveState ===
        "placeholder" &&
      result.ok &&
      !result.value.notes.some((note) => note.url === removedUrl) &&
      !result.value.history.some((visit) => visit.url === removedUrl)
    );
  }, syntheticUrl);
  await page.waitForTimeout(350);
  const stayedDeleted = await page.evaluate(async (removedUrl) => {
    const result = await window.panelQa.api.runtime.sendMessage({
      type: "load",
    });
    return (
      result.ok && !result.value.notes.some((note) => note.url === removedUrl)
    );
  }, syntheticUrl);
  assert.equal(
    stayedDeleted,
    true,
    "mounting the placeholder must not recreate a deleted note",
  );
  const content = panel.locator(".browser-note .cm-content");
  await content.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nRecreated only after explicit edit");
  await page.waitForFunction(async (url) => {
    const result = await window.panelQa.api.runtime.sendMessage({
      type: "load",
    });
    return (
      result.ok &&
      result.value.notes.some(
        (note) =>
          note.url === url &&
          note.markdown.includes("Recreated only after explicit edit"),
      )
    );
  }, syntheticUrl);
  passed.push(
    `${theme}/${width}: deleting another tree note preserves the editor; deleting current stays a placeholder until an explicit edit`,
  );
}

async function assertFieldMenu(page, panel, selector, theme, kind) {
  const trigger = panel.locator(selector).first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = trigger.locator("..").locator(".cm-aic-security-add-menu");
  await menu.waitFor({ state: "visible" });
  const layout = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const scroller = element.closest(".cm-scroller");
    const editorToolbar = document.querySelector(
      ".browser-editor-host .aic-toolbar",
    );
    if (!scroller || !editorToolbar)
      throw Error("Editor clipping bounds missing");
    const scrollBox = scroller.getBoundingClientRect();
    const toolbarBox = editorToolbar.getBoundingClientRect();
    return {
      menu: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      },
      visible: {
        left: Math.max(0, scrollBox.left),
        top: Math.max(0, scrollBox.top, toolbarBox.bottom),
        right: Math.min(window.innerWidth, scrollBox.right),
        bottom: Math.min(window.innerHeight, scrollBox.bottom),
      },
      position: getComputedStyle(element).position,
      scrollerTop: scroller.scrollTop,
    };
  });
  assert.equal(
    layout.position,
    "fixed",
    `${kind} menu must escape editor clipping`,
  );
  assert.ok(
    layout.menu.left >= layout.visible.left - 1 &&
      layout.menu.right <= layout.visible.right + 1 &&
      layout.menu.top >= layout.visible.top - 1 &&
      layout.menu.bottom <= layout.visible.bottom + 1,
    `${kind} menu must fit below the toolbar and within the editor: ${JSON.stringify(layout)}`,
  );
  const buttons = menu.locator("button:not(:disabled)");
  const count = await buttons.count();
  assert.ok(count >= 2, `${kind} menu should offer enabled choices`);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    await button.evaluate((element) => {
      const menu = element.parentElement;
      menu.scrollTop +=
        element.getBoundingClientRect().bottom -
        menu.getBoundingClientRect().bottom +
        2;
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const hit = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const target = document.elementFromPoint(x, y);
      return {
        reachable: target?.closest("button") === element,
        label: element.getAttribute("aria-label"),
        button: {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
        },
        menu: element.parentElement.getBoundingClientRect().toJSON(),
        scrollTop: element.parentElement.scrollTop,
        scrollHeight: element.parentElement.scrollHeight,
        clientHeight: element.parentElement.clientHeight,
        hit: target?.outerHTML.slice(0, 180),
      };
    });
    assert.ok(
      hit.reachable,
      `${kind} choice ${index + 1} must be reachable: ${JSON.stringify(hit)}`,
    );
  }
  const scrollerTop = await menu.evaluate(
    (element) => element.closest(".cm-scroller")?.scrollTop,
  );
  assert.ok(
    Math.abs(scrollerTop - layout.scrollerTop) <= 1,
    `${kind} choices must scroll inside the menu, not escape the editor`,
  );
  await page.screenshot({
    path: path.join(output, `field-menu-${kind}-${theme}-320x360.png`),
  });
  await page.keyboard.press("Escape");
  assert.equal(await menu.isHidden(), true);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  return { kind, theme, ...layout, choices: count };
}

async function mount(page) {
  await page.goto(url.href);
  await page.evaluate(
    async ({ syntheticUrl, otherUrl, syntheticHtml }) => {
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
      const tabsActivated = listeners();
      const tabsUpdated = listeners();
      const tabsRemoved = listeners();
      let current = {
        id: 11,
        windowId: 7,
        active: true,
        url: syntheticUrl,
        title: "Fixture page one",
      };
      const tabList = [current];
      const api = {
        runtime: {
          id: "synthetic-aic-host",
          getURL: (file) => new URL(file, location.href).href,
          onMessage: listeners(),
          onInstalled: listeners(),
          async sendMessage(message) {
            try {
              const value = await service.handle(message);
              if (qa.heldType === message.type) {
                await new Promise((resolve) => qa.heldReplies.push(resolve));
              }
              return { ok: true, value };
            } catch (error) {
              return {
                ok: false,
                error: error?.message || "Synthetic host failure",
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
          async query(query) {
            return tabList.filter(
              (tab) =>
                (query.windowId === undefined ||
                  tab.windowId === query.windowId) &&
                (query.active === undefined || tab.active === query.active),
            );
          },
          async get(id) {
            const tab = tabList.find((item) => item.id === id);
            if (!tab) throw Error("No synthetic tab");
            return tab;
          },
          async update(id, update) {
            const tab = tabList.find((item) => item.id === id);
            if (!tab) throw Error("No synthetic tab");
            if (update.active) {
              for (const item of tabList) item.active = false;
              tab.active = true;
              current = tab;
              tabsActivated.emit({ tabId: id, windowId: 7 });
            }
            Object.assign(tab, update);
            tabsUpdated.emit(id, update, tab);
            return tab;
          },
          async create(options) {
            const tab = {
              id: 11 + tabList.length,
              windowId: options.windowId,
              url: options.url,
              title:
                options.url === otherUrl
                  ? "Fixture page two"
                  : "Fixture page one",
              active: true,
            };
            for (const item of tabList) item.active = false;
            tabList.push(tab);
            current = tab;
            tabsActivated.emit({ tabId: tab.id, windowId: 7 });
            return tab;
          },
          onActivated: tabsActivated,
          onUpdated: tabsUpdated,
          onRemoved: tabsRemoved,
        },
        windows: {
          getCurrent: async () => ({ id: 7, incognito: qa.privateWindow }),
        },
        permissions: { request: async () => true },
        sidePanel: { setPanelBehavior: async () => {} },
        scripting: {
          async executeScript({ target, args }) {
            if (target.tabId !== current.id) throw Error("Tab changed");
            return [
              {
                result: {
                  html:
                    args[0] === "selection"
                      ? "<h2>Selected fixture</h2><p>Selection content</p>"
                      : syntheticHtml,
                  title: current.title,
                  url: current.url,
                  truncated: false,
                },
              },
            ];
          },
        },
      };
      const service = createBrowserService(api);
      const qa = {
        api,
        local,
        session,
        heldType: null,
        heldReplies: [],
        privateWindow: false,
        clipboard: "",
        panels: [],
        setPrivate(value) {
          this.privateWindow = value;
          current.incognito = value;
        },
        async mount() {
          const root = document.createElement("div");
          root.className = "qa-panel";
          root.style.flex = "1 1 0";
          document.querySelector("#app").append(root);
          const panel = new BrowserPanel(root, api);
          this.panels.push({ panel, root });
          await panel.ready;
          return root;
        },
        async next(url, title) {
          const tab = tabList.find((item) => item.url === url);
          if (tab) {
            tab.title = title;
            await api.tabs.update(tab.id, { active: true });
          } else {
            await api.tabs.create({ url, windowId: 7 });
          }
        },
        freshSession() {
          for (const key of Object.keys(session)) {
            const oldValue = session[key];
            delete session[key];
            storageChanged.emit({ [key]: { oldValue } }, "session");
          }
        },
        hold(type) {
          this.heldType = type;
        },
        release() {
          this.heldType = null;
          this.heldReplies.splice(0).forEach((resolve) => resolve());
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            qa.clipboard = text;
          },
          readText: async () => qa.clipboard,
        },
      });
      const root = document.querySelector("#app");
      if (!root) throw Error("Synthetic panel host is missing");
      root.replaceChildren();
      root.style.display = "flex";
      window.panelQa = qa;
      await qa.mount();
    },
    { syntheticUrl, otherUrl, syntheticHtml },
  );
}

try {
  if (process.env.AIC_REVIEW_MENU_ONLY !== "1")
    for (const theme of ["light", "dark"]) {
      for (const width of [320, 600, 900]) {
        const context = await browser.newContext({
          viewport: { width, height: 800 },
          colorScheme: theme,
          acceptDownloads: true,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await mount(page);
        const panel = page.locator(".qa-panel").first();
        await assertPanelInViewport(panel);
        assert.equal(await panel.getAttribute("data-state"), "setup");
        await page.screenshot({
          path: path.join(output, `setup-${theme}-${width}.png`),
        });
        await panel
          .getByLabel("Master passphrase", { exact: true })
          .fill(syntheticPassword);
        await panel
          .getByLabel("Confirm master passphrase")
          .fill(syntheticPassword);
        await panel
          .getByRole("button", { name: "Create encrypted library" })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector(".qa-panel")?.dataset.state === "unlocked",
        );
        await panel.locator(".browser-note .aic-editor").waitFor();
        const emptyShared = panel.locator(
          '.browser-domain-properties[data-empty="true"]',
        );
        assert.equal(
          await emptyShared.getByRole("button").innerText(),
          "Shared",
        );
        const emptySharedButton = await emptyShared
          .getByRole("button")
          .evaluate((button) => {
            const box = button.getBoundingClientRect();
            return { width: box.width, height: box.height };
          });
        assert.ok(
          emptySharedButton.height >= 28 && emptySharedButton.height <= 32,
          `empty Shared action should use the compact token: ${JSON.stringify(emptySharedButton)}`,
        );
        assert.equal(
          await emptyShared.evaluate((element) =>
            element.parentElement?.matches(
              ".browser-note .aic-toolbar--compact",
            ),
          ),
          true,
          "an empty shared scope belongs inside the editor toolbar",
        );
        assert.equal(
          await panel
            .locator(".browser-shared-host")
            .evaluate(
              (element) =>
                element.childElementCount === 0 &&
                getComputedStyle(element).display === "none",
            ),
          true,
          "an empty shared host must not reserve a header row",
        );
        assert.equal(
          await panel.locator(".aic-editor").getAttribute("data-save-state"),
          "placeholder",
        );
        const identity = panel.locator(".browser-page-identity");
        assert.equal(
          await identity.locator(".browser-page-title").innerText(),
          "Fixture page one",
        );
        assert.equal(
          await identity.locator(".browser-page-origin").innerText(),
          "fixture.example.invalid",
        );
        assert.equal(
          await identity.locator(".browser-page-origin").getAttribute("title"),
          syntheticUrl,
        );
        assert.equal(await panel.locator(".browser-navigation").count(), 0);
        await assertNoHorizontalOverflow(panel);
        await assertPanelInViewport(panel);
        await page.screenshot({
          path: path.join(output, `empty-${theme}-${width}.png`),
        });

        const addMenu = await openMenu(panel, "Add content");
        for (const label of [
          "Import page",
          "Import selection",
          "Paste from clipboard",
          "Import Markdown",
        ])
          assert.equal(
            await addMenu
              .getByRole("button", { name: label, exact: true })
              .count(),
            1,
          );
        await assertNoHorizontalOverflow(panel);
        await page.screenshot({
          path: path.join(output, `add-content-${theme}-${width}.png`),
        });
        await addMenu.getByRole("button", { name: "Import page" }).click();
        await panel.locator(".aic-editor .cm-editor").waitFor();
        assert.match(
          await panel.locator(".cm-content").innerText(),
          /Fixture heading/u,
        );
        assert.match(
          await panel.locator(".cm-content").innerText(),
          /const answer = 42/u,
        );
        assert.doesNotMatch(
          await panel.locator(".cm-content").innerText(),
          /javascript:alert/u,
        );
        assert.equal(
          await page.evaluate(() => window.fixtureExecuted === true),
          false,
        );
        await page.waitForFunction(
          () =>
            document.querySelector(".qa-panel")?.dataset.importing === "false",
        );
        measurements.push({
          theme,
          width,
          ...(await assertCompactEditor(panel)),
        });
        await assertPanelInViewport(panel);
        await page.screenshot({
          path: path.join(output, `editor-closed-${theme}-${width}.png`),
        });
        const content = panel.locator(".cm-content");
        await content.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("\nSynthetic handwritten edit");
        await page.waitForFunction(async () => {
          const library = await window.panelQa.api.runtime.sendMessage({
            type: "load",
          });
          return (
            library.ok &&
            library.value.notes[0]?.markdown.includes(
              "Synthetic handwritten edit",
            )
          );
        });
        const cursor = await page.evaluate(() => {
          const selection = getSelection();
          return {
            node:
              selection?.anchorNode?.parentElement?.closest(".cm-editor") !==
              null,
            offset: selection?.anchorOffset,
          };
        });
        assert.equal(
          cursor.node,
          true,
          "autosave must keep the editor selection",
        );
        await page.evaluate(() => {
          window.panelQa.clipboard = "Synthetic clipboard addition";
        });
        await (
          await openMenu(panel, "Add content")
        )
          .getByRole("button", { name: "Paste from clipboard" })
          .click();
        await page.waitForFunction(async () => {
          const library = await window.panelQa.api.runtime.sendMessage({
            type: "load",
          });
          const text = library.value?.notes[0]?.markdown ?? "";
          return (
            library.ok &&
            text.includes("Fixture heading") &&
            text.includes("Synthetic handwritten edit") &&
            text.endsWith("Synthetic clipboard addition")
          );
        });
        assert.match(
          await panel.locator(".cm-content").innerText(),
          /Synthetic handwritten edit\s+Synthetic clipboard addition/u,
        );
        await page.evaluate(
          (next) => window.panelQa.next(next, "Fixture page two"),
          otherUrl,
        );
        await page.waitForFunction(
          (expected) =>
            document
              .querySelector(".qa-panel .browser-page-origin")
              ?.getAttribute("title") === expected &&
            document.querySelector(".qa-panel .browser-note .aic-editor") !==
              null,
          otherUrl,
        );
        await (
          await openMenu(panel, "Notes and history")
        )
          .getByRole("button", { name: "Fixture page one", exact: true })
          .click();
        await page.waitForFunction(
          (expected) =>
            document
              .querySelector(".qa-panel .browser-page-origin")
              ?.getAttribute("title") === expected &&
            document
              .querySelector(".qa-panel .cm-content")
              ?.textContent?.includes("Synthetic handwritten edit"),
          syntheticUrl,
        );
        await page.evaluate(
          (next) => window.panelQa.next(next, "Fixture page two"),
          otherUrl,
        );
        await panel.locator(".browser-note .cm-editor").waitFor();
        await panel.locator(".browser-note .cm-content").click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("Synthetic page-two draft");
        assert.match(
          await panel.locator(".browser-note .cm-content").innerText(),
          /Synthetic page-two draft/u,
        );
        await (
          await openMenu(panel, "Add content")
        )
          .getByRole("button", { name: "Import selection" })
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector(".qa-panel .cm-content")
            ?.textContent?.includes("Selection content"),
        );
        await panel.locator(".cm-content").click();
        await page.keyboard.press("Control+End");
        await page.keyboard.press("Shift+Home");
        await (
          await openMenu(panel, "More options")
        )
          .getByRole("button", { name: "Copy block or selection" })
          .click();
        assert.equal(
          (await page.evaluate(() => window.panelQa.clipboard)).trim(),
          "Selection content",
        );
        const draftDownloadPromise = page.waitForEvent("download");
        await (
          await openMenu(panel, "More options")
        )
          .getByRole("button", { name: "Export Markdown" })
          .click();
        const draftDownload = await draftDownloadPromise;
        const draftTarget = path.join(
          output,
          `plaintext-draft-${theme}-${width}.md`,
        );
        await draftDownload.saveAs(draftTarget);
        assert.match(await readFile(draftTarget, "utf8"), /Selection content/u);
        await page.evaluate(
          (previous) => window.panelQa.next(previous, "Fixture page one"),
          syntheticUrl,
        );
        await panel
          .locator(".cm-content")
          .getByText("Synthetic handwritten edit")
          .waitFor();

        await (
          await openMenu(panel, "More options")
        )
          .getByRole("button", { name: "Copy note" })
          .click();
        const copied = await page.evaluate(() => window.panelQa.clipboard);
        assert.match(copied, /Synthetic handwritten edit/u);
        assert.doesNotMatch(
          await panel.innerHTML(),
          /synthetic-panel-regression-passphrase/u,
        );
        const downloadPromise = page.waitForEvent("download");
        await (
          await openMenu(panel, "More options")
        )
          .getByRole("button", { name: "Export encrypted backup" })
          .click();
        const download = await downloadPromise;
        const target = path.join(
          output,
          `encrypted-backup-${theme}-${width}.json`,
        );
        await download.saveAs(target);
        const backup = await readFile(target, "utf8");
        assert.doesNotMatch(
          backup,
          /Synthetic handwritten edit|Fixture heading|synthetic-panel-regression-passphrase/u,
        );
        assert.equal(JSON.parse(backup).format, "aic-browser-vault");
        if (theme === "light" && width === 900) {
          await (
            await openMenu(panel, "More options")
          )
            .getByRole("button", { name: "Import encrypted backup" })
            .click();
          await panel.getByLabel("Encrypted backup file").setInputFiles(target);
          await panel.getByLabel("Backup passphrase").fill(syntheticPassword);
          await panel
            .getByRole("button", { name: "Restore or merge backup" })
            .click();
          await page.waitForFunction(() =>
            document
              .querySelector(".qa-panel .browser-feedback")
              ?.textContent?.includes("skipped 2 existing URLs"),
          );
        }
        await panel.getByRole("button", { name: "Lock", exact: true }).click();
        await page.waitForFunction(
          () => document.querySelector(".qa-panel")?.dataset.state === "locked",
        );
        assert.equal(await panel.locator(".cm-editor").count(), 0);
        await page.evaluate(() => window.panelQa.freshSession());
        await panel
          .getByLabel("Master passphrase", { exact: true })
          .fill(syntheticPassword);
        await panel
          .getByRole("button", { name: "Unlock", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelector(".qa-panel")?.dataset.state === "unlocked",
        );
        assert.match(
          await panel.locator(".cm-content").innerText(),
          /Synthetic handwritten edit/u,
        );
        if (theme === "light" && width === 600)
          await assertPageDeletion(page, panel, theme, width);
        if (theme === "light" && width === 900) {
          await page.evaluate(() => {
            window.panelQa.setPrivate(true);
            void window.panelQa.mount();
          });
          const privatePanel = page.locator(".qa-panel").last();
          await privatePanel.waitFor();
          await page.waitForFunction(
            () =>
              document.querySelector(".qa-panel:last-child")?.dataset
                .privateConsent === "required",
          );
          assert.equal(await privatePanel.locator(".cm-editor").count(), 0);
          await privatePanel
            .getByRole("button", { name: "Use AIC in this private window" })
            .click();
          await page.waitForFunction(
            () =>
              document.querySelector(".qa-panel:last-child")?.dataset
                .privateConsent !== "required",
          );
          await privatePanel
            .locator(".cm-content")
            .getByText("Synthetic handwritten edit")
            .waitFor();
          await (
            await openMenu(privatePanel, "Add content")
          )
            .getByRole("button", { name: "Import selection" })
            .click();
          await page.waitForFunction(() =>
            document
              .querySelector(".qa-panel:last-child .cm-content")
              ?.textContent?.includes("Selection content"),
          );
          await page.evaluate(() => {
            window.panelQa.setPrivate(false);
            window.panelQa.hold("visit");
            void window.panelQa.mount();
          });
          await page.waitForFunction(
            () => window.panelQa.heldReplies.length > 0,
          );
          await panel
            .getByRole("button", { name: "Lock", exact: true })
            .click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".qa-panel")].every(
              (item) => item.dataset.state === "locked",
            ),
          );
          await page.evaluate(() => window.panelQa.release());
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          assert.equal(
            await page.locator(".qa-panel .cm-editor").count(),
            0,
            "a late visit reply must not revive plaintext after cross-panel lock",
          );
          await panel
            .getByLabel("Master passphrase", { exact: true })
            .fill(syntheticPassword);
          await panel
            .getByRole("button", { name: "Unlock", exact: true })
            .click();
          await page.waitForFunction(
            () =>
              document.querySelector(".qa-panel")?.dataset.state === "unlocked",
          );
          await page.evaluate(() => {
            window.panelQa.hold("visit");
            void window.panelQa.mount();
          });
          await page.waitForFunction(
            () => window.panelQa.heldReplies.length > 0,
          );
          await page.evaluate(() =>
            window.panelQa.panels.at(-1).panel.destroy(),
          );
          await page.evaluate(() => window.panelQa.release());
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          assert.equal(await page.locator(".qa-panel").last().innerHTML(), "");
          passed.push(
            "private consent enables import; cross-panel lock and destroy reject delayed replies",
          );
        }
        assert.deepEqual(errors, [], "no uncaught page exceptions");
        passed.push(
          `${theme}/${width}: setup, import, edit/save, page binding, clipboard, encrypted download, lock/reopen`,
        );
        await context.close();
      }
    }
  for (const theme of ["light", "dark"]) {
    let context = await browser.newContext({
      viewport: { width: 320, height: 360 },
      colorScheme: theme,
    });
    let page = await context.newPage();
    page.setDefaultTimeout(10000);
    await mount(page);
    let panel = page.locator(".qa-panel").first();
    await panel
      .getByLabel("Master passphrase", { exact: true })
      .fill(syntheticPassword);
    await panel.getByLabel("Confirm master passphrase").fill(syntheticPassword);
    await panel
      .getByRole("button", { name: "Create encrypted library" })
      .click();
    await panel.locator(".browser-note .cm-editor").waitFor();
    const deepUrl = await page.evaluate(
      async ({ syntheticUrl }) => {
        const qa = window.panelQa;
        const origin = new URL(syntheticUrl).origin;
        const paths = [
          "/",
          "/guide",
          "/guide/one",
          "/guide/one/two",
          "/guide/one/two/three",
          "/guide/one/two/three/four",
        ];
        const activePage = async () => {
          const [tab] = await qa.api.tabs.query({
            active: true,
            windowId: 7,
          });
          return {
            url: tab.url,
            title: tab.title,
            tabId: tab.id,
            windowId: tab.windowId,
          };
        };
        for (const [index, pathname] of paths.entries()) {
          await qa.next(`${origin}${pathname}`, `Ancestor ${index + 1}`);
          const result = await qa.api.runtime.sendMessage({
            type: "create",
            page: await activePage(),
            markdown: `# Synthetic ancestor ${index + 1}`,
            ifAbsent: true,
          });
          if (!result.ok) throw Error(result.error);
        }
        const current = `${origin}/guide/one/two/three/four/five`;
        await qa.next(current, "Deep synthetic page");
        const domain = await qa.api.runtime.sendMessage({
          type: "create-domain",
          page: await activePage(),
          markdown:
            "---\n# aic-fields: v2\nUsername: synthetic@example.test\n---\n",
        });
        if (!domain.ok) throw Error(domain.error);
        return current;
      },
      { syntheticUrl },
    );
    await page.waitForFunction((expected) => {
      const panel = document.querySelector(".qa-panel");
      const ancestors = panel?.querySelector(".browser-page-ancestors");
      return (
        panel?.querySelector(".browser-page-origin")?.getAttribute("title") ===
          expected &&
        ancestors &&
        !ancestors.hidden &&
        ancestors.querySelectorAll("li").length >= 7 &&
        panel.querySelector(
          ".browser-shared-host > .browser-domain-properties .cm-aic-properties",
        )
      );
    }, deepUrl);
    measurements.push(
      await assertFormattingPopover(page, panel, theme, 320, 360),
    );
    passed.push(
      `${theme}/320x360: compact formatting popover fits the viewport and restores disclosure focus`,
    );
    await context.close();
    context = await browser.newContext({
      viewport: { width: 320, height: 360 },
      colorScheme: theme,
    });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    await mount(page);
    panel = page.locator(".qa-panel").first();
    await panel
      .getByLabel("Master passphrase", { exact: true })
      .fill(syntheticPassword);
    await panel.getByLabel("Confirm master passphrase").fill(syntheticPassword);
    await panel
      .getByRole("button", { name: "Create encrypted library" })
      .click();
    await panel.locator(".browser-note .cm-editor").waitFor();
    await page.evaluate(() => {
      const view = window.panelQa.panels[0].panel.editor.view;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: [
            "---",
            "# aic-fields: v2",
            "Email: synthetic@example.test",
            "---",
            "",
            "```aic",
            "# Accounts",
            "## Identity",
            "Email: synthetic@example.test",
            "```",
            "",
          ].join("\n"),
        },
      });
    });
    await panel
      .locator(".cm-aic-properties .cm-aic-security-add-trigger")
      .first()
      .waitFor();
    measurements.push(
      await assertFieldMenu(
        page,
        panel,
        ".cm-aic-properties .cm-aic-security-add-trigger",
        theme,
        "properties",
      ),
    );
    measurements.push(
      await assertFieldMenu(
        page,
        panel,
        ".cm-aic-security:not(.cm-aic-properties) .cm-aic-security-add-trigger",
        theme,
        "security",
      ),
    );
    passed.push(
      `${theme}/320x360: Security and Properties field menus stay visible and scroll internally`,
    );
    await context.close();

    context = await browser.newContext({
      viewport: { width: 320, height: 480 },
      colorScheme: theme,
      hasTouch: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    await mount(page);
    panel = page.locator(".qa-panel").first();
    await panel
      .getByLabel("Master passphrase", { exact: true })
      .fill(syntheticPassword);
    await panel.getByLabel("Confirm master passphrase").fill(syntheticPassword);
    await panel
      .getByRole("button", { name: "Create encrypted library" })
      .click();
    await panel.locator(".browser-note .cm-editor").waitFor();
    measurements.push(await assertCoarseTargets(page, panel, theme));
    passed.push(`${theme}/320x480: coarse controls retain 44px targets`);
    await context.close();
  }
  process.stdout.write(
    JSON.stringify({ syntheticHostOnly: true, measurements, passed }, null, 2) +
      "\n",
  );
} finally {
  await browser.close();
}
