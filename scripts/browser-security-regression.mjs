// Real shared-editor DOM, synthetic credentials and clipboard only.
/* global securityQa */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
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
const passed = [];
const errors = [];
const measurements = [];
const source = [
  "# Synthetic security",
  "",
  "```aic-security",
  "## Main",
  "Service: Example",
  "Email: dummy@example.invalid",
  "Password*:",
  "URL: https://example.invalid/dummy",
  "TOTP*:",
  "```",
  "",
  "After",
].join("\n");
const secret = "DUMMY-PASTED-NOT-A-CREDENTIAL";
let serial = 0;
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.evaluate(async (theme) => {
      const { AicEditor } = await import("/src/editor.ts");
      const { parseSecurityBlock } =
        await import("/src/core/security-model.js");
      const { securityBlocks } = await import("/src/core/security-block.js");
      const parent = document.createElement("div");
      parent.id = "security-qa";
      parent.style =
        "position:fixed;inset:0;z-index:100;background:var(--aic-bg)";
      document.body.append(parent);
      // Same Stylekit variables supplied by the SN embedding client.
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
      document.documentElement.style.setProperty(
        "--sn-stylekit-info-color",
        colors[4],
      );
      document.documentElement.style.colorScheme = theme;
      const qa = (window.securityQa = {
        writes: [],
        reads: 0,
        changes: [],
        text: "",
        mode: "normal",
        parseSecurityBlock,
        securityBlocks,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            qa.writes.push(value);
          },
          readText: () => {
            qa.reads++;
            if (qa.mode === "denied")
              return Promise.reject(new Error("denied"));
            if (qa.mode === "pending")
              return new Promise((resolve) => {
                qa.resolveRead = resolve;
              });
            return Promise.resolve(qa.text);
          },
        },
      });
      qa.editor = new AicEditor(parent, {
        onChange: (text) => qa.changes.push(text),
      });
    }, theme);
    const root = page.locator("#security-qa");
    const button = (name) => root.getByRole("button", { name, exact: true });
    const load = async (text = source) => {
      await page.evaluate(
        ({ text, id }) => {
          const qa = securityQa;
          qa.editor.switchDocument(id, text);
          qa.editor.view.dispatch({ selection: { anchor: text.length } });
          qa.editor.focus();
          qa.writes = [];
          qa.reads = 0;
          qa.changes = [];
          qa.mode = "normal";
        },
        { text, id: "security-" + ++serial },
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    const value = () => page.evaluate(() => securityQa.editor.value);
    const masked = async (text) => {
      assert.equal(await root.locator(".cm-aic-security").count(), 1);
      assert.ok(
        !(await root.innerHTML()).includes(text),
        "secret absent from rendered DOM including attributes",
      );
    };
    await load();
    await button("Copy Email").tap();
    const row = button("Copy Email").locator("..");
    await row.getByRole("status").filter({ hasText: "Copied" }).waitFor();
    await button("Copy Email value").tap();
    assert.deepEqual(await page.evaluate(() => securityQa.writes), [
      "dummy@example.invalid",
      "dummy@example.invalid",
    ]);
    await button("Copy Email").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => securityQa.writes.length), 2);
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => securityQa.writes.length),
      3,
      "native keyboard activation copies once",
    );
    passed.push(
      theme +
        ": tap label/value copies only value with local feedback; Tab navigates and Enter activates once",
    );

    await load();
    await page.evaluate((text) => {
      securityQa.text = text;
    }, secret);
    await button("Paste Password").tap();
    await page.waitForFunction(
      (text) => securityQa.editor.value.includes(text),
      secret,
    );
    await masked(secret);
    assert.equal(await button("Generate Password").count(), 0);
    assert.equal(await page.evaluate(() => securityQa.changes.length), 1);
    await button("Paste Password").tap();
    assert.equal(
      await page.evaluate(() => securityQa.reads),
      1,
      "filled field requires consent before reading clipboard",
    );
    await root.getByRole("button", { name: "Cancel", exact: true }).tap();
    assert.equal(await page.evaluate(() => securityQa.reads), 1);
    await button("Paste Password").tap();
    await page.evaluate(() => {
      securityQa.text = "";
    });
    await root.getByRole("button", { name: "Replace", exact: true }).tap();
    await root.getByText("Clipboard is empty", { exact: true }).waitFor();
    assert.ok((await value()).includes(secret));
    await masked(secret);
    passed.push(
      theme +
        ": paste stays masked; replacement consent and empty-clipboard protection",
    );

    await load();
    await button("Generate Password").tap();
    assert.equal(
      await root.getByLabel("Password length", { exact: true }).inputValue(),
      "24",
    );
    for (const label of ["Uppercase", "Lowercase", "Numbers", "Symbols"])
      assert.ok(await root.getByLabel(label, { exact: true }).isChecked());
    await root.getByRole("button", { name: "Generate", exact: true }).tap();
    const generated = await page.evaluate(() => {
      const qa = securityQa;
      return qa
        .parseSecurityBlock(qa.securityBlocks(qa.editor.view.state)[0].body)
        .model.sections[0].fields.find((field) => field.label === "Password")
        .value;
    });
    assert.equal(generated.length, 24);
    for (const pattern of [/[A-Z]/u, /[a-z]/u, /\d/u, /[^A-Za-z0-9]/u])
      assert.match(generated, pattern);
    await masked(generated);
    assert.equal(await button("Generate Password").count(), 0);
    assert.equal(await button("Generate TOTP").count(), 0);
    await button("Copy Password value").tap();
    assert.equal(
      await page.evaluate(() => securityQa.writes.at(-1)),
      generated,
    );
    passed.push(
      theme +
        ": default WebCrypto generation includes all four classes, only empty passwords, no source reveal",
    );

    await load();
    await button("Generate Password").tap();
    await root.getByLabel("Password length", { exact: true }).fill("40");
    await root.getByLabel("Symbols", { exact: true }).uncheck();
    await root.getByRole("button", { name: "Generate", exact: true }).tap();
    const plain = await page.evaluate(() => {
      const qa = securityQa;
      return qa
        .parseSecurityBlock(qa.securityBlocks(qa.editor.view.state)[0].body)
        .model.sections[0].fields.find((field) => field.label === "Password")
        .value;
    });
    assert.match(plain, /^[A-Za-z0-9]{40}$/u);
    passed.push(
      theme +
        ": configured length and symbol-free generation round-trip through Markdown",
    );

    await load();
    await page.evaluate(() => {
      securityQa.mode = "denied";
    });
    await button("Paste Password").tap();
    const capture = root.locator(".cm-aic-security-paste-capture");
    await capture.waitFor();
    await capture.press("x");
    assert.equal(await capture.inputValue(), "");
    assert.equal(await value(), source);
    await capture.evaluate((input, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, secret);
    await masked(secret);
    assert.ok((await value()).includes(secret));
    passed.push(
      theme +
        ": denied browser API uses paste-only capture, direct typing blocked, no DOM disclosure",
    );

    await load();
    await page.evaluate(() => {
      securityQa.mode = "pending";
    });
    await button("Paste Password").tap();
    await button("Edit security block").tap();
    await page.evaluate((text) => securityQa.resolveRead(text), secret);
    assert.equal(await value(), source);
    assert.ok(!(await root.innerHTML()).includes(secret));
    passed.push(
      theme + ": pending clipboard cannot write after Edit source transition",
    );

    await load();
    const geometry = await button("Paste Password").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const row = el.closest(".cm-aic-security-row");
      const preview = el.closest(".cm-aic-security");
      const fg = getComputedStyle(el).color;
      const bg = getComputedStyle(preview).backgroundColor;
      const components = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
      const luminance = (color) =>
        components(color)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const a = luminance(fg),
        b = luminance(bg);
      return {
        width: rect.width,
        height: rect.height,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        fg,
        bg,
        overflow: row.scrollWidth - row.clientWidth,
        viewport: innerWidth,
      };
    });
    assert.ok(
      geometry.width >= 44 && geometry.height >= 44,
      "44px coarse-pointer target",
    );
    assert.ok(
      geometry.contrast >= 4.5,
      "high-contrast icon foreground: " + JSON.stringify(geometry),
    );
    assert.ok(geometry.overflow <= 1, "field row fits mobile width");
    measurements.push({ theme, ...geometry });
    if (process.env.AIC_REVIEW_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.AIC_REVIEW_SCREENSHOTS,
          "security-mobile-" + theme + ".png",
        ),
      });
      await button("Generate Password").tap();
      await page.screenshot({
        path: path.join(
          process.env.AIC_REVIEW_SCREENSHOTS,
          "security-generator-" + theme + ".png",
        ),
      });
    }
    passed.push(
      theme + ": mobile target sizes, contrast and field-row geometry",
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    JSON.stringify(
      {
        syntheticOnly: true,
        browser: browser.version(),
        passed,
        measurements,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
