// Real Chromium rendering of the default Standard Notes editor surface.
// Uses only a loopback development server and a fresh synthetic browser context.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.AIC_REVIEW_PLAYWRIGHT ||
    "C:/Users/leoni/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
const url = new URL(process.env.AIC_REVIEW_URL || "http://127.0.0.1:5189/");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol),
  "The toolbar regression may only connect to a loopback Vite server.",
);
const output = path.resolve(
  process.env.AIC_REVIEW_OUTPUT ||
    "D:/aic/reviews/standard-notes-toolbar-20260915",
);
assert.ok(
  output
    .toLowerCase()
    .startsWith("d:\\aic\\reviews\\standard-notes-toolbar-20260915"),
  "Screenshots must stay in the toolbar review directory.",
);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const expectedLabels = [
  "Show Markdown source",
  "Strikethrough",
  "Insert link (Ctrl/Command+K)",
  "Bullet list",
  "Ordered list",
  "Task list",
  "AIC editor guide",
];
const removedLabels = [
  "Bold (Ctrl/Command+B)",
  "Italic (Ctrl/Command+I)",
  "Inline code",
];
const measurements = [];

async function assertDirtyToolbar(page, colorScheme, width) {
  const content = page.locator("#app > .aic-editor .cm-content");
  await content.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("x");
  await page.waitForFunction(
    () =>
      document.querySelector("#app > .aic-editor")?.dataset.saveState ===
      "dirty",
  );
  const toolbar = page.locator("#app > .aic-editor > .aic-toolbar--compact");
  await toolbar.waitFor();
  const layout = await toolbar.evaluate((element) => {
    const toolbarBox = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll("button")]
      .filter((button) => !button.hidden)
      .map((button) => {
        const box = button.getBoundingClientRect();
        const target = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          label: button.getAttribute("aria-label"),
          title: button.getAttribute("title"),
          disabled: button.disabled,
          width: box.width,
          height: box.height,
          left: box.left,
          right: box.right,
          reachable: target === button || button.contains(target),
        };
      });
    return {
      toolbar: {
        left: toolbarBox.left,
        right: toolbarBox.right,
        width: toolbarBox.width,
        height: toolbarBox.height,
        scrollWidth: element.scrollWidth,
      },
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      status: element.querySelector(".aic-save-status")?.textContent,
      buttons,
      selectCount: element.querySelectorAll("select").length,
    };
  });
  assert.deepEqual(
    layout.buttons.map(({ label }) => label),
    ["Save note", ...expectedLabels],
  );
  assert.equal(layout.status, "Unsaved changes");
  assert.equal(layout.selectCount, 0);
  assert.ok(
    layout.buttons.every(
      ({ label, title, width: buttonWidth, height, left, right, reachable }) =>
        title === label &&
        Math.abs(buttonWidth - 44) <= 1 &&
        Math.abs(height - 44) <= 1 &&
        left >= -1 &&
        right <= layout.viewportWidth + 1 &&
        reachable,
    ),
    `dirty toolbar actions must stay named, reachable, and 44px: ${JSON.stringify(layout.buttons)}`,
  );
  assert.ok(
    layout.toolbar.left >= -1 &&
      layout.toolbar.right <= layout.viewportWidth + 1 &&
      layout.toolbar.scrollWidth <= layout.toolbar.width + 1 &&
      layout.documentWidth <= layout.viewportWidth + 1 &&
      layout.bodyWidth <= layout.viewportWidth + 1,
    `dirty toolbar must not overflow horizontally: ${JSON.stringify(layout)}`,
  );
  await page.screenshot({
    path: path.join(output, `toolbar-dirty-${colorScheme}-${width}-coarse.png`),
  });

  await page.evaluate(() => {
    window.standardNotesToolbarQa = { setItem: Storage.prototype.setItem };
    Storage.prototype.setItem = () => {
      throw new Error("Synthetic local save failure");
    };
  });
  await toolbar.getByRole("button", { name: "Save note", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#app > .aic-editor")?.dataset.saveFeedback ===
      "failed",
  );
  const retry = toolbar.getByRole("button", {
    name: "Retry save",
    exact: true,
  });
  assert.equal(
    await toolbar.locator(".aic-save-status").textContent(),
    "Note not saved. Retry save.",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.standardNotesToolbarQa.setItem;
  });
  await retry.click();
  await page.waitForFunction(
    () =>
      document.querySelector("#app > .aic-editor")?.dataset.saveFeedback ===
      "saved",
  );
  assert.equal(
    await toolbar.locator(".aic-save-status").textContent(),
    "Note saved",
  );
  assert.equal(await retry.isHidden(), true);
  return { colorScheme, width, coarse: true, dirty: true, ...layout };
}

async function assertReadonlyToolbar(page, colorScheme, width) {
  const hostUrl = new URL(
    `/__aic-toolbar-readonly-${colorScheme}-${width}.html`,
    url,
  );
  await page.route(hostUrl.href, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><iframe title="Synthetic Standard Notes host" src="${url.href}" style="display:block;width:100vw;height:100vh;border:0"></iframe></body></html>`,
    }),
  );
  await page.goto(hostUrl.href);
  const frame = page.frameLocator("iframe");
  const editor = frame.locator("#app > .aic-editor");
  await editor.waitFor();
  await frame.locator("html").evaluate((element, scheme) => {
    const dark = scheme === "dark";
    element.style.setProperty(
      "--sn-stylekit-editor-background-color",
      dark ? "#17191c" : "#ffffff",
    );
    element.style.setProperty(
      "--sn-stylekit-editor-foreground-color",
      dark ? "#f3f5f7" : "#20242b",
    );
    element.style.setProperty(
      "--sn-stylekit-border-color",
      dark ? "#454a52" : "#d8dde5",
    );
  }, colorScheme);
  const toolbar = editor.locator(":scope > .aic-toolbar--compact");
  assert.equal(await editor.getAttribute("data-read-only"), "true");
  assert.equal(
    await toolbar.locator(".aic-toolbar__group button:disabled").count(),
    5,
  );
  const source = toolbar.locator(".aic-source-mode-toggle");
  const help = toolbar.getByRole("button", {
    name: "AIC editor guide",
    exact: true,
  });
  assert.equal(await source.getAttribute("aria-label"), "Show Markdown source");
  assert.equal(await source.isDisabled(), false);
  assert.equal(await help.isDisabled(), false);
  await source.click();
  assert.equal(await source.getAttribute("aria-pressed"), "true");
  await help.click();
  assert.equal(await help.getAttribute("aria-expanded"), "true");
  assert.equal(
    await frame.locator("body").evaluate(() => document.activeElement?.tagName),
    "H2",
  );
  const overflow = await toolbar.evaluate((element) => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    toolbarWidth: element.getBoundingClientRect().width,
    toolbarScrollWidth: element.scrollWidth,
  }));
  assert.ok(
    overflow.documentWidth <= overflow.viewportWidth + 1 &&
      overflow.bodyWidth <= overflow.viewportWidth + 1 &&
      overflow.toolbarScrollWidth <= overflow.toolbarWidth + 1,
    `read-only toolbar must not overflow: ${JSON.stringify(overflow)}`,
  );
  await page.screenshot({
    path: path.join(
      output,
      `toolbar-readonly-${colorScheme}-${width}-coarse.png`,
    ),
  });
  return { colorScheme, width, coarse: true, readOnly: true, overflow };
}

try {
  for (const colorScheme of ["light", "dark"])
    for (const width of [320, 600])
      for (const coarse of [false, true]) {
        const context = await browser.newContext({
          viewport: { width, height: 720 },
          colorScheme,
          hasTouch: coarse,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url.href);
        await page.evaluate((scheme) => {
          const dark = scheme === "dark";
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-background-color",
            dark ? "#17191c" : "#ffffff",
          );
          document.documentElement.style.setProperty(
            "--sn-stylekit-editor-foreground-color",
            dark ? "#f3f5f7" : "#20242b",
          );
          document.documentElement.style.setProperty(
            "--sn-stylekit-border-color",
            dark ? "#454a52" : "#d8dde5",
          );
        }, colorScheme);
        const editor = page.locator("#app > .aic-editor");
        await editor.waitFor();
        await page.waitForFunction(
          (expected) =>
            document.querySelector("#app > .aic-editor")?.dataset.theme ===
            expected,
          colorScheme === "dark" ? "dark" : "default",
        );
        const toolbar = editor.locator(":scope > .aic-toolbar--compact");
        await toolbar.waitFor();

        const layout = await toolbar.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const buttons = [...element.querySelectorAll("button")]
            .filter((button) => !button.hidden)
            .map((button) => {
              const bounds = button.getBoundingClientRect();
              return {
                label: button.getAttribute("aria-label"),
                title: button.getAttribute("title"),
                width: bounds.width,
                height: bounds.height,
                top: bounds.top,
              };
            });
          return {
            className: element.className,
            coarse: matchMedia("(pointer: coarse)").matches,
            theme: element.closest(".aic-editor")?.dataset.theme,
            toolbar: {
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
              scrollWidth: element.scrollWidth,
            },
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            buttons,
            selectCount: element.querySelectorAll("select").length,
            disclosureCount: element.querySelectorAll(
              ".aic-formatting-toggle,.aic-toolbar-tray",
            ).length,
          };
        });

        assert.equal(layout.coarse, coarse);
        assert.equal(layout.theme, colorScheme === "dark" ? "dark" : "default");
        assert.deepEqual(
          layout.buttons.map(({ label }) => label),
          expectedLabels,
        );
        assert.ok(
          layout.buttons.every(({ label, title }) => title === label),
          `every compact action needs a matching title: ${JSON.stringify(layout.buttons)}`,
        );
        assert.equal(layout.selectCount, 0);
        assert.equal(layout.disclosureCount, 0);
        for (const label of removedLabels)
          assert.ok(
            !layout.buttons.some((button) => button.label === label),
            `${label} must not return as a toolbar button`,
          );
        assert.ok(
          layout.toolbar.left >= -1 &&
            layout.toolbar.right <= layout.viewportWidth + 1 &&
            layout.toolbar.scrollWidth <= layout.toolbar.width + 1 &&
            layout.documentWidth <= layout.viewportWidth + 1 &&
            layout.bodyWidth <= layout.viewportWidth + 1,
          `toolbar must not overflow horizontally: ${JSON.stringify(layout)}`,
        );
        const minimum = coarse ? 44 : 24;
        assert.ok(
          layout.buttons.every(
            ({ width: buttonWidth, height }) =>
              buttonWidth >= minimum && height >= minimum,
          ),
          `${coarse ? "coarse" : "fine"} toolbar targets must be at least ${minimum}px: ${JSON.stringify(layout.buttons)}`,
        );
        if (!coarse)
          assert.ok(
            Math.abs(layout.toolbar.height - 32) <= 1,
            `fine-pointer toolbar must remain 32px high: ${JSON.stringify(layout.toolbar)}`,
          );
        if (coarse)
          assert.ok(
            Math.abs(layout.toolbar.height - 49) <= 1 &&
              new Set(layout.buttons.map(({ top }) => Math.round(top))).size ===
                1,
            `clean coarse toolbar must remain one 49px row: ${JSON.stringify(layout)}`,
          );
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: path.join(
            output,
            `toolbar-${colorScheme}-${width}-${coarse ? "coarse" : "fine"}.png`,
          ),
        });
        measurements.push({ colorScheme, width, coarse, ...layout });
        if (coarse)
          measurements.push(await assertDirtyToolbar(page, colorScheme, width));
        if (coarse)
          measurements.push(
            await assertReadonlyToolbar(page, colorScheme, width),
          );
        await context.close();
      }
  process.stdout.write(JSON.stringify({ measurements }, null, 2) + "\n");
} finally {
  await browser.close();
}
