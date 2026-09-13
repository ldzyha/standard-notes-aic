// Local Vite + synthetic fixtures only. Never requests real clipboard permissions.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5288";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Use a task-owned local Vite server",
);
const output =
  process.env.AIC_REVIEW_OUTPUT || "D:/aic/reviews/security-groups-20260913";
const run = new Date().toISOString().replace(/[:.]/gu, "-");
await mkdir(output, { recursive: true });
const source = [
  "```aic",
  "# Synthetic vault",
  "## Identity",
  "Service: Meadow public",
  "Email: synthetic@example.test",
  "URL: https://example.test/path",
  "## Access",
  "Password*: private-password-marker",
  "Recovery codes*: - [ ] private-recovery-marker\\n- [x] private-backup-marker",
  "TOTP*: JBSWY3DPEHPK3PXP",
  "```",
  "",
  "End of synthetic note",
].join("\n");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const passed = [],
  errors = [];

async function counters(page) {
  return page.evaluate(() => ({
    changes: window.groupsQa.changes.length,
    saves: window.groupsQa.saves.length,
    actions: window.groupsQa.saves.filter((reason) => reason === "action")
      .length,
    source: window.groupsQa.editor.value,
  }));
}

async function mount(page, theme, identity) {
  await page.goto(url);
  await page.evaluate(
    async ({ source, theme, identity }) => {
      const { AicEditor } = await import("/src/editor.ts");
      const root = document.createElement("div");
      root.id = "groups-regression";
      root.style =
        "position:fixed;inset:0;z-index:1000;background:var(--aic-bg)";
      document.body.append(root);
      const qa = (window.groupsQa = {
        root,
        changes: [],
        saves: [],
        copies: [],
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => "synthetic paste",
          writeText: async (value) => {
            qa.copies.push(value);
          },
        },
      });
      document.documentElement.style.setProperty(
        "--sn-stylekit-editor-background-color",
        theme === "dark" ? "#111111" : "#ffffff",
      );
      document.documentElement.style.setProperty(
        "--sn-stylekit-editor-foreground-color",
        theme === "dark" ? "#eeeeee" : "#20242b",
      );
      qa.editor = new AicEditor(root, {
        document,
        onChange: (text) => qa.changes.push(text),
        onSave: (reason) => {
          qa.saves.push(reason);
          qa.savedText = qa.editor.value;
          return true;
        },
      });
      qa.editor.switchDocument(identity, source);
      qa.editor.view.dispatch({
        selection: { anchor: qa.editor.value.length },
      });
    },
    { source, theme, identity },
  );
  await page.locator("#groups-regression .cm-aic-security").waitFor();
}

async function drag(page, handle, target, after = true) {
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox(),
    end = await target.boundingBox();
  assert.ok(start && end, "Drag handles and target have visible geometry");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    end.x + Math.min(65, end.width / 2),
    end.y + end.height * (after ? 0.8 : 0.2),
    { steps: 16 },
  );
  const marker = page.locator(
    after ? ".cm-aic-security-drop-after" : ".cm-aic-security-drop-before",
  );
  try {
    await marker.first().waitFor({ state: "visible", timeout: 3000 });
  } finally {
    await page.mouse.up();
  }
  await page.waitForFunction(() => window.groupsQa.saves.includes("action"));
}

try {
  for (const coarse of [false, true])
    for (const theme of ["light", "dark"])
      for (const width of [1280, 320]) {
        const context = await browser.newContext({
          viewport: { width, height: 1100 },
          hasTouch: coarse,
          isMobile: coarse,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(6000);
        page.on("pageerror", (error) => errors.push(error.message));
        const label = `${theme}/${width}/${coarse ? "coarse" : "fine"}`;
        try {
          await mount(page, theme, label);
          const card = page.locator("#groups-regression .cm-aic-security");
          assert.equal(
            await card.locator(".cm-md-preview-header > strong").textContent(),
            "Synthetic vault",
          );
          assert.deepEqual(
            await card
              .locator(".cm-aic-security-section-title")
              .allTextContents(),
            ["Identity", "Access", "Recovery codes"],
          );
          const text = await card.textContent();
          for (const secret of [
            "private-password-marker",
            "private-recovery-marker",
            "private-backup-marker",
            "JBSWY3DPEHPK3PXP",
          ])
            assert.ok(
              !text.includes(secret),
              "Secrets stay masked in the card",
            );
          assert.equal(
            await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
            coarse,
          );
          const input = card.getByRole("searchbox", {
            name: "Filter fields and groups",
          });
          await input.focus();
          await page.evaluate(() => {
            const qa = window.groupsQa;
            qa.card = qa.root.querySelector(".cm-aic-security");
            qa.filter = qa.card.querySelector('input[type="search"]');
            qa.doc = qa.editor.view.state.doc;
          });
          const before = await counters(page);
          const otp = card.locator(".cm-aic-security-code");
          await page.waitForFunction(() =>
            /^\d{6}$/u.test(
              document
                .querySelector("#groups-regression .cm-aic-security-code")
                ?.textContent?.trim() || "",
            ),
          );
          const otpValue = (await otp.textContent()).trim();
          for (const [query, count] of [
            ["Meadow", 1],
            ["Email", 1],
            ["Access", 3],
            ["Synthetic vault", 6],
            ["private-password-marker", 0],
            ["private-recovery-marker", 0],
            ["JBSWY3DPEHPK3PXP", 0],
            [otpValue, 0],
          ]) {
            await input.fill(query);
            assert.equal(
              await card
                .locator(
                  '.cm-aic-security-section:not([hidden]) [data-aic-reorderable="true"]:not([hidden])',
                )
                .count(),
              count,
              `${label}: expected filter count`,
            );
            assert.equal(
              await page.evaluate(() => {
                const qa = window.groupsQa;
                return (
                  qa.card === qa.root.querySelector(".cm-aic-security") &&
                  qa.filter === qa.card.querySelector('input[type="search"]') &&
                  document.activeElement === qa.filter &&
                  qa.editor.view.state.doc === qa.doc
                );
              }),
              true,
              `${label}: query keeps DOM identity, focus and document identity`,
            );
            assert.deepEqual(
              await counters(page),
              before,
              `${label}: query has no source/save side effects`,
            );
          }
          await input.fill("");
          const add = card.getByRole("button", {
            name: "Add field to Identity",
            exact: true,
          });
          await add.click();
          const menu = card.getByRole("group", {
            name: "Add field to Identity",
            exact: true,
          });
          await menu.waitFor({ state: "visible" });
          assert.deepEqual(await menu.getByRole("button").allTextContents(), [
            "Password",
            "Recovery codes",
            "Email",
            "URL",
            "PSP",
          ]);
          const layout = await card.evaluate((element) => {
            const visible = [
              ...element.querySelectorAll(
                'input[type="search"], .cm-aic-security-add-menu:not([hidden]), .cm-aic-security-add-menu:not([hidden]) button',
              ),
            ];
            const bounds = element.getBoundingClientRect();
            return {
              cardLeft: bounds.left,
              cardRight: bounds.right,
              overflow: element.scrollWidth - element.clientWidth,
              controls: visible.map((control) => {
                const rect = control.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(control);
                const text = range.getBoundingClientRect();
                return {
                  left: rect.left,
                  right: rect.right,
                  height: rect.height,
                  textVisible:
                    !control.textContent ||
                    (text.width > 0 &&
                      text.left >= rect.left - 1 &&
                      text.right <= rect.right + 1),
                  overflow: control.scrollWidth - control.clientWidth,
                };
              }),
            };
          });
          assert.ok(
            layout.cardLeft >= -1 &&
              layout.cardRight <= width + 1 &&
              layout.overflow <= 1,
            `${label}: card fits viewport`,
          );
          assert.ok(
            layout.controls.every(
              (control) =>
                control.left >= -1 &&
                control.right <= width + 1 &&
                control.overflow <= 1 &&
                control.textVisible,
            ),
            `${label}: filter and full menu labels fit`,
          );
          if (coarse)
            assert.ok(
              layout.controls
                .filter((control) => control.height < 200)
                .every((control) => control.height >= 43),
              `${label}: coarse controls have touch-height targets`,
            );
          await page.screenshot({
            path: path.join(
              output,
              `${run}-${theme}-${width}-${coarse ? "coarse" : "fine"}-menu.png`,
            ),
          });
          await page.keyboard.press("Escape");
          if (!coarse && theme === "light" && width === 1280) {
            const initial = await counters(page);
            await drag(
              page,
              card.getByRole("button", {
                name: "Reorder Service",
                exact: true,
              }),
              card
                .getByRole("button", { name: "Reorder URL", exact: true })
                .locator(".."),
            );
            await page.waitForFunction(() => {
              const value = window.groupsQa.editor.value;
              return (
                value.indexOf("Email:") < value.indexOf("URL:") &&
                value.indexOf("URL:") < value.indexOf("Service:")
              );
            });
            const fieldMoved = await counters(page);
            assert.equal(fieldMoved.changes, initial.changes + 1);
            assert.equal(fieldMoved.actions, initial.actions + 1);
            assert.equal(
              await page.evaluate(() => window.groupsQa.savedText),
              fieldMoved.source,
            );
            await drag(
              page,
              card.getByRole("button", {
                name: "Reorder group Identity",
                exact: true,
              }),
              card
                .getByRole("button", {
                  name: "Reorder group Access",
                  exact: true,
                })
                .locator("../.."),
            );
            await page.waitForFunction(
              () =>
                window.groupsQa.editor.value.indexOf("## Access") <
                window.groupsQa.editor.value.indexOf("## Identity"),
            );
            const groupMoved = await counters(page);
            assert.equal(groupMoved.changes, initial.changes + 2);
            assert.equal(groupMoved.actions, initial.actions + 2);
            assert.equal(
              await page.evaluate(() => window.groupsQa.savedText),
              groupMoved.source,
            );
            assert.ok(groupMoved.source.includes("# Synthetic vault\n"));
            for (const value of [
              "private-password-marker",
              "private-recovery-marker",
              "private-backup-marker",
              "JBSWY3DPEHPK3PXP",
            ])
              assert.ok(
                groupMoved.source.includes(value),
                "Reordering preserves synthetic secret source",
              );
            assert.equal(
              await page.evaluate(() => window.groupsQa.copies.length),
              0,
              "Dragging never causes an accidental copy",
            );
            await page.evaluate(() => {
              const qa = window.groupsQa;
              qa.editor.switchDocument(
                "temporary-other-note",
                "Other synthetic note",
              );
              qa.editor.switchDocument("restored-synthetic-note", qa.savedText);
              qa.editor.view.dispatch({
                selection: { anchor: qa.savedText.length },
              });
            });
            assert.equal(
              await page.evaluate(() => window.groupsQa.editor.value),
              groupMoved.source,
              "Fake-host saved source survives note exit and reopen",
            );
            const beforeSource = await counters(page);
            await page
              .locator("#groups-regression")
              .getByRole("button", {
                name: "Show Markdown source",
                exact: true,
              })
              .click();
            assert.equal(
              await card.count(),
              0,
              "Source mode removes security previews",
            );
            assert.deepEqual(
              await counters(page),
              beforeSource,
              "Source mode is not a save or document edit",
            );
            await page
              .locator("#groups-regression")
              .getByRole("button", { name: "Show preview", exact: true })
              .click();
            await card.waitFor();
            passed.push(
              "Actual mouse: field and group moves each persist once with save intent; source mode preserves document",
            );
          }
          await page.evaluate(() => window.groupsQa.editor.setReadOnly(true));
          await card.waitFor();
          assert.equal(
            await card
              .locator(".cm-aic-security-drag, .cm-aic-security-add-trigger")
              .count(),
            0,
            "Readonly has no mutation handles or menus",
          );
          assert.equal(
            await card
              .getByRole("button", { name: "Edit security block", exact: true })
              .count(),
            0,
          );
          assert.equal(
            await card.getByRole("searchbox").count(),
            1,
            "Readonly filter remains available",
          );
          assert.equal(
            await card
              .getByRole("button", { name: "Copy Password value", exact: true })
              .count(),
            1,
            "Readonly copy remains available",
          );
          const readonlySource = await page.evaluate(
            () => window.groupsQa.editor.value,
          );
          await card
            .getByRole("button", { name: "Copy Password value", exact: true })
            .click();
          assert.equal(
            await page.evaluate(() => window.groupsQa.copies.at(-1)),
            "private-password-marker",
            "Readonly copy uses only the fake clipboard",
          );
          assert.equal(
            await page.evaluate(() => window.groupsQa.editor.value),
            readonlySource,
          );
          if (coarse && theme === "dark" && width === 320) {
            const beforeToggle = await counters(page);
            await page
              .locator("#groups-regression")
              .getByRole("button", {
                name: "Show Markdown source",
                exact: true,
              })
              .click();
            assert.equal(await card.count(), 0);
            assert.equal(
              await page.evaluate(
                () => window.groupsQa.editor.view.state.readOnly,
              ),
              true,
            );
            assert.equal(
              await page
                .locator("#groups-regression .cm-content")
                .getAttribute("contenteditable"),
              "false",
            );
            assert.deepEqual(
              await counters(page),
              beforeToggle,
              "Readonly source mode remains non-mutating",
            );
          }
          passed.push(
            `${label}: titles, safe filter/focus identity, readable add menu, viewport and readonly`,
          );
        } catch (error) {
          await page
            .screenshot({
              path: path.join(
                output,
                `${run}-failure-${theme}-${width}-${coarse ? "coarse" : "fine"}.png`,
              ),
            })
            .catch(() => {});
          throw error;
        } finally {
          await context.close();
        }
      }
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1100 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(6000);
    try {
      await mount(page, "light", "whole-cards");
      const properties =
        "---\nfile: fixture.note.md\ncreated: 2026-09-13\nupdated: 2026-09-13\n---";
      const alpha =
        "```aic\n# Card Alpha\n## Main\nField: alpha\nPassword*: private-alpha\n```";
      const beta =
        "```aic\n# Card Beta\n## Main\nField: beta\nPassword*: private-beta\n```";
      const cardsSource =
        properties +
        "\n\n# Other preview\n\n" +
        alpha +
        "\n\nMiddle unchanged\n\n" +
        beta +
        "\n\nEnd";
      await page.evaluate((source) => {
        const qa = window.groupsQa;
        qa.editor.switchDocument("whole-cards-second", source);
        qa.editor.view.dispatch({ selection: { anchor: source.length } });
        qa.changes = [];
        qa.saves = [];
      }, cardsSource);
      const cards = page.locator(
        "#groups-regression .cm-aic-security:not(.cm-aic-properties)",
      );
      await cards.nth(1).waitFor();
      assert.equal(await cards.count(), 2);
      await drag(
        page,
        cards
          .nth(0)
          .getByRole("button", { name: "Reorder security block", exact: true }),
        cards.nth(1),
      );
      await page.waitForFunction(
        () =>
          window.groupsQa.editor.value.indexOf("# Card Beta") <
          window.groupsQa.editor.value.indexOf("# Card Alpha"),
      );
      const result = await counters(page);
      assert.equal(result.changes, 1);
      assert.equal(result.actions, 1);
      assert.equal(
        await page.evaluate(() => window.groupsQa.savedText),
        result.source,
      );
      assert.ok(result.source.startsWith(properties));
      assert.ok(
        result.source.includes(alpha) && result.source.includes(beta),
        "Whole-card drag preserves each complete source fence",
      );
      assert.equal(result.source.split("Middle unchanged").length, 2);
      assert.equal(await page.evaluate(() => window.groupsQa.copies.length), 0);
      passed.push(
        "Actual mouse whole-card drag: exact fences, Properties and Markdown preserved with one action save intent",
      );
    } catch (error) {
      await page
        .screenshot({
          path: path.join(output, `${run}-failure-whole-cards.png`),
        })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, [], "No browser page errors");
  console.log(JSON.stringify({ passed, screenshots: output, run }, null, 2));
} finally {
  await browser.close();
}
