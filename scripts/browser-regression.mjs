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
  const propertiesSource =
    "---\nfile: example.note.md\ncreated: 2026-09-12T10:00:00Z\ncustom*: synthetic-only-secret\n---\n\nBody";
  await load(propertiesSource, "properties-preview");
  const properties = root.locator(".cm-aic-properties");
  await properties.waitFor();
  assert.match(
    await properties.textContent(),
    /YAML Properties are no longer supported/u,
  );
  assert.equal(
    (await properties.textContent()).includes("synthetic-only-secret"),
    false,
  );
  assert.equal(
    await properties.getByRole("button", { name: "Paste file" }).count(),
    0,
  );
  assert.equal(await properties.locator(".cm-aic-drag-handle").count(), 0);
  assert.equal(await properties.locator(".cm-aic-security-row").count(), 0);
  assert.equal(
    await properties.locator(".cm-aic-properties-metadata").count(),
    0,
  );
  assert.equal(await properties.locator('input[type="search"]').count(), 0);
  assert.equal(
    (await properties.innerHTML()).includes("example.note.md"),
    false,
  );
  assert.equal(await value(), propertiesSource);
  await properties.getByRole("button", { name: "Edit properties" }).click();
  assert.equal(await root.locator(".cm-aic-properties").count(), 0);
  assert.equal(await value(), propertiesSource);
  assert.equal(
    (await root.locator(".cm-content").textContent()).includes(
      "synthetic-only-secret",
    ),
    true,
  );
  await load("Other note", "properties-switch");
  assert.equal(await root.locator(".cm-aic-security-panel").count(), 0);
  passed.push(
    "retired YAML remains opaque without managed fields or metadata, with exact source preserved for explicit repair",
  );
  const typedSource =
    "```aic\n# Properties\nAccount | synthetic-public\nPassword *| synthetic-typed-secret\nCard _| 4242 4242 4242 1234 | 12/30 *| 019\nCodes 1| synthetic-active 0| synthetic-used\n```\n\nBody";
  await load(typedSource, "typed-properties-preview");
  const typed = root.locator(".cm-aic-security");
  await typed.waitFor();
  assert.equal(await typed.locator(".cm-aic-security-error").count(), 0);
  assert.equal(await typed.locator("[data-aic-field-part]").count(), 7);
  for (const secret of [
    "synthetic-typed-secret",
    "4242 4242 4242 1234",
    "synthetic-active",
    "synthetic-used",
  ])
    assert.equal((await typed.innerHTML()).includes(secret), false);
  assert.equal((await typed.textContent()).includes("synthetic-public"), true);
  assert.equal((await typed.textContent()).includes("•••• 1234"), true);
  const filter = typed.getByRole("searchbox", {
    name: "Filter fields and groups",
  });
  for (const query of [
    "synthetic-typed-secret",
    "1234",
    "019",
    "synthetic-active",
    "synthetic-used",
  ]) {
    await filter.fill(query);
    assert.equal(
      await typed.locator(".cm-aic-security-section:not([hidden])").count(),
      0,
    );
  }
  await filter.fill("synthetic-public");
  assert.equal(
    await typed.locator(".cm-aic-security-section:not([hidden])").count(),
    1,
  );
  await filter.fill("");
  assert.equal(await value(), typedSource);
  await typed
    .getByRole("button", { name: "Edit security block", exact: true })
    .click();
  assert.equal(await root.locator(".cm-aic-security").count(), 0);
  assert.equal(await value(), typedSource);
  passed.push(
    "typed AIC parts mask secrets/card numbers and exclude confidential values from filtering without changing source",
  );
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
  passed.push("stale table popup closes on note switch");

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
  await root.locator(".cm-mermaid-inline svg").waitFor();
  assert.equal(await root.locator(".aic-diagram-builder").count(), 0);
  assert.equal(
    await root.locator(".cm-mermaid-inline .cm-mermaid-edit").count(),
    1,
  );
  await root
    .getByRole("button", { name: "Edit Mermaid source", exact: true })
    .click();
  await root.locator(".cm-mermaid-editing svg").waitFor();
  assert.equal(await value(), flow);
  passed.push(
    "Mermaid source and live preview stay available without a visual builder",
  );

  for (const source of [
    "classDiagram\n  direction LR\n  class A {\n    +name: String\n  }\n  class B\n  A *-- B : contains",
    "sequenceDiagram\n  participant A as Reader\n  participant B as Editor\n  A->>B: Open\n  B-->>A: Ready",
    "flowchart LR\n  subgraph Nested\n    A --> B\n  end",
  ]) {
    const note = `\`\`\`mermaid\n${source}\n\`\`\`\n\nLast`;
    await load(note);
    await root.locator(".cm-mermaid-inline svg").waitFor();
    assert.equal(await value(), note);
  }
  passed.push(
    "class, sequence and nested flowchart previews keep source intact",
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
    await root.locator(".cm-mermaid-editing svg").waitFor();
    const selection = await page.evaluate(() =>
      regressionEditor.view.state.selection.main.toJSON(),
    );
    assert.equal(await value(), inserted);
    assert.deepEqual(
      await page.evaluate(() =>
        regressionEditor.view.state.selection.main.toJSON(),
      ),
      selection,
    );
    // Real coordinates, not jsdom: the live preview must not disturb ArrowUp.
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
    "basic slash blocks and live class/sequence previews preserve source selection and ArrowUp",
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
