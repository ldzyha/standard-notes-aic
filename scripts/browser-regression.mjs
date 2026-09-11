// Synthetic local documents only. Start Vite first; no account or external data.
/* global regressionEditor */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const url = process.env.AIC_REVIEW_URL || "http://127.0.0.1:5189";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Run this regression only against a local Vite server");
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
const passed = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => {
    const { AicEditor } = await import("/src/editor.ts");
    const parent = document.createElement("div");
    parent.id = "regression";
    parent.style =
      "position:fixed;inset:0;background:var(--aic-bg);z-index:100";
    document.body.append(parent);
    window.regressionEditor = new AicEditor(parent);
  });
  const root = page.locator("#regression");
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const load = async (source, id = source) => {
    await page.evaluate(
      ({ source, id }) => {
        regressionEditor.switchDocument(id, source);
        regressionEditor.view.dispatch({
          selection: { anchor: regressionEditor.view.state.doc.length },
          scrollIntoView: true,
        });
        regressionEditor.focus();
      },
      { source, id },
    );
    await settle();
  };
  const value = () => page.evaluate(() => regressionEditor.value);
  const fixtures = {
    plain: "Start\n\nLast",
    code: "Start\n\n```ts\nconst a = 1\n```\n\nLast",
    table: "Start\n\n| A | B |\n| --- | --- |\n| a | b |\n\nLast",
    properties: "---\nfile: demo\n---\n\nStart\n\nLast",
    mixed:
      "---\nfile: demo.note.md\n---\n\n```ts\nconst a = 1\n```\n\n| A | B |\n| --- | --- |\n| a | b |\n\nLast",
  };
  for (const [name, source] of Object.entries(fixtures)) {
    await load(source);
    await page.keyboard.press("ArrowUp");
    const head = await page.evaluate(
      () => regressionEditor.view.state.selection.main.head,
    );
    assert.equal(
      head,
      source.length - 5,
      `${name}: ArrowUp moves to adjacent blank line`,
    );
  }
  passed.push("ArrowUp adjacent navigation: plain/code/table/properties/mixed");
  await load("Note A old", "A");
  await page.evaluate(() =>
    regressionEditor.view.dispatch({
      changes: {
        from: 0,
        to: regressionEditor.view.state.doc.length,
        insert: "Shared text",
      },
    }),
  );
  await load("Shared text", "B");
  await page.keyboard.press("Control+z");
  assert.equal(await value(), "Shared text");
  passed.push("equal-text UUID switch does not share Undo");

  await load(fixtures.table);
  await root
    .getByRole("button", { name: "Row 1, column 1", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Row 1, column 1", exact: true })
    .fill("Old note edit");
  await load("Other note", "other");
  assert.equal(await page.locator(".cm-aic-cell-popover").count(), 0);
  assert.equal(await value(), "Other note");
  passed.push("stale property/table popup closes on note switch");

  await load(">>> Title\nbody\n<<<\n\nLast");
  await root.locator(".cm-aic-details-summary .cm-md-edit-source").click();
  await page.keyboard.press("Home");
  assert.equal(await root.locator(".cm-aic-details-summary").count(), 0);
  passed.push("details Home retains editable opening marker");

  await load("# Indentation\n\n    alpha", "raw-indentation");
  await page.keyboard.press("Enter");
  assert.equal(await value(), "# Indentation\n\n    alpha\n    ");
  await page.keyboard.press("Tab");
  assert.equal(await value(), "# Indentation\n\n    alpha\n      ");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await value(), "# Indentation\n\n    alpha\n    ");
  await load(
    "# Code\n\n```js\nfunction run() {\n}\n```\n\nLast",
    "code-indentation",
  );
  await page.evaluate(() => {
    const view = regressionEditor.view;
    const anchor = view.state.doc.toString().indexOf("{") + 1;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    regressionEditor.focus();
  });
  await settle();
  await page.keyboard.press("Enter");
  const indentedLine = await page.evaluate(() => {
    const view = regressionEditor.view;
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  });
  assert.match(
    indentedLine,
    /^ {2,}$/u,
    "known code syntax indents inside braces",
  );
  passed.push(
    "CodeMirror indentation: Enter preserves raw prefix / indents JS braces; Tab and Shift+Tab change level",
  );

  const flow =
    '# Diagram\n\n```mermaid\nflowchart LR\n  A["Start"] --> B["Finish"]\n```\n\nLast';
  await load(flow);
  await root
    .getByRole("button", { name: "Edit diagram visually", exact: true })
    .click();
  await page.getByRole("button", { name: "Add state", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Inspect");
  await page
    .getByRole("button", { name: "Connect Finish", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Inspect", exact: true })
    .click();
  await page.locator('.aic-db-viewport [data-node-id="N1"]').waitFor();
  assert.equal(await page.locator("dialog").count(), 0);
  assert.equal(await root.locator(".cm-aic-diagram-inline").count(), 1);
  await page
    .getByRole("button", { name: "Apply diagram changes", exact: true })
    .click();
  const edited = await value();
  assert.match(edited, /N1\["Inspect"\]/u);
  assert.match(edited, /B --> N1/u);
  assert.doesNotMatch(edited, /%% aic-builder-layout/u);
  assert.ok(
    edited.startsWith("# Diagram\n\n```mermaid\n") &&
      edited.endsWith("```\n\nLast"),
  );
  await page.keyboard.press("Control+z");
  assert.equal(await value(), flow);
  passed.push(
    "inline Mermaid add/connect/Apply with one document Undo and no manual layout metadata",
  );

  for (const source of [
    "classDiagram\n  direction LR\n  class A {\n    +name: String\n  }\n  class B\n  A *-- B : contains",
    "sequenceDiagram\n  participant A as Reader\n  participant B as Editor\n  A->>B: Open\n  B-->>A: Ready",
    "flowchart LR\n  subgraph Nested\n    A --> B\n  end",
  ]) {
    const note = `\`\`\`mermaid\n${source}\n\`\`\`\n\nLast`;
    await load(note);
    await root
      .getByRole("button", { name: "Edit diagram visually", exact: true })
      .click();
    const unsupported = source.includes("subgraph");
    assert.equal(await page.locator(".aic-db-source").isVisible(), unsupported);
    await page
      .getByRole("button", { name: "Apply diagram changes", exact: true })
      .click();
    assert.equal(await value(), note);
  }
  passed.push(
    "class/sequence visual open and unsupported syntax lossless source fallback",
  );
  for (const command of [
    "list",
    "list-numbered",
    "checklist",
    "table",
    "flowchart",
    "sequence",
    "class-diagram",
  ]) {
    await load("# Slash blocks\n\n", command);
    await page.keyboard.type(`/${command}`);
    await page.waitForSelector(".cm-tooltip-autocomplete");
    const option = page.getByRole("option").filter({
      has: page.locator(".cm-completionLabel", {
        hasText: new RegExp(`^/${command}$`, "u"),
      }),
    });
    await option.click();
    const inserted = await value();
    assert.ok(!inserted.includes(`\n/${command}`));
    if (command === "list") {
      const beforeTab = await page.evaluate(() =>
        regressionEditor.view.state.selection.main.toJSON(),
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await value(),
        inserted,
        "snippet Tab does not insert indentation",
      );
      assert.notDeepEqual(
        await page.evaluate(() =>
          regressionEditor.view.state.selection.main.toJSON(),
        ),
        beforeTab,
      );
    }
    if (command === "list")
      assert.match(inserted, /\n- What is the first point\?/u);
    if (command === "list-numbered")
      assert.match(inserted, /\n1\. What comes first\?/u);
    if (command === "checklist")
      assert.match(inserted, /\n- \[ \] What needs to be done\?/u);
    if (command === "table") assert.match(inserted, /\| Item \| Detail \|/u);
    if (!["sequence", "class-diagram"].includes(command)) continue;
    const action = root.getByRole("toolbar", {
      name: "Mermaid source actions",
      exact: true,
    });
    assert.equal(
      await action.isVisible(),
      true,
      `${command}: builder available while snippet selection is in source`,
    );
    const selection = await page.evaluate(() =>
      regressionEditor.view.state.selection.main.toJSON(),
    );
    await action
      .getByRole("button", { name: "Edit diagram visually", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cancel diagram changes", exact: true })
      .click();
    assert.equal(await value(), inserted);
    assert.deepEqual(
      await page.evaluate(() =>
        regressionEditor.view.state.selection.main.toJSON(),
      ),
      selection,
    );
    // Real coordinates, not jsdom: the source action row must not disturb ArrowUp.
    await page.evaluate(() => {
      const view = regressionEditor.view;
      const at = view.state.doc.toString().indexOf("```mermaid");
      const opening = view.state.doc.lineAt(at);
      view.dispatch({
        selection: { anchor: view.state.doc.line(opening.number + 2).from },
        scrollIntoView: true,
      });
      regressionEditor.focus();
    });
    await settle();
    const before = await page.evaluate(
      () =>
        regressionEditor.view.state.doc.lineAt(
          regressionEditor.view.state.selection.main.head,
        ).number,
    );
    await page.keyboard.press("ArrowUp");
    const after = await page.evaluate(
      () =>
        regressionEditor.view.state.doc.lineAt(
          regressionEditor.view.state.selection.main.head,
        ).number,
    );
    assert.equal(
      after,
      before - 1,
      `${command}: ArrowUp remains adjacent in source`,
    );
  }
  passed.push(
    "basic slash blocks and immediate class/sequence builder access preserve source selection and ArrowUp",
  );
  await load("Point", "formatting-keys");
  for (const [key, expected] of [
    ["Control+Alt+2", "## Point"],
    ["Control+Alt+2", "Point"],
    ["Control+Shift+8", "- Point"],
    ["Control+Shift+7", "1. Point"],
    ["Control+Shift+9", "- [ ] Point"],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await value(), expected, key);
  }
  await load("- [ ] Task\n\nEnd", "checkbox-click");
  await root.getByRole("checkbox").click();
  assert.match(await value(), /- \[x\] Task/iu);
  for (const query of ["checkbox", "tasklist"]) {
    await load("\n", `checklist-alias-${query}`);
    await page.keyboard.type(`/${query}`);
    await page
      .getByRole("option")
      .filter({
        has: page.locator(".cm-completionLabel", { hasText: /^\/checklist$/u }),
      })
      .click();
    assert.match(await value(), /- \[ \] What needs to be done\?/u);
  }
  const nested = "- Parent\n  - Child\n- Next";
  await load(nested, "nested-list-formatting");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Shift+End");
  await page.keyboard.press("Control+Shift+7");
  assert.equal(await value(), "1. Parent\n   1. Child\n2. Next");
  await page.keyboard.press("Control+z");
  assert.equal(await value(), nested, "nested list conversion has one Undo");
  passed.push(
    "shared heading/list keyboard shortcuts, checklist search aliases and clickable checkbox",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await browser.close();
}
