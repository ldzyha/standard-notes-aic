import { describe, expect, it, vi } from "vitest";
import { AicEditor } from "../src/editor";
import { parseDetailsBlocks, toggleDetailsMarker } from "../src/details-model";

describe("AIC details grammar", () => {
  it("parses exact open/closed markers and linked summary data", () => {
    const source =
      ">>>|open| - [ ] [Source](src/app.ts#L2-L4)\ncomment\n<<<\n\n>>> Closed\nbody\n<<<\n";
    const blocks = parseDetailsBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      open: true,
      summary: {
        checked: false,
        label: "Source",
        href: "src/app.ts#L2-L4",
      },
    });
    expect(blocks[1]).toMatchObject({ open: false, title: "Closed" });
    expect(toggleDetailsMarker(">>>|open| Title")).toBe(">>> Title");
    expect(toggleDetailsMarker(">>> Title")).toBe(">>>|open| Title");
  });

  it("ignores terminators inside fences and keeps invalid nesting visible", () => {
    const fenced = ">>> Title\n```text\n<<<\n```\nbody\n<<<\n";
    expect(parseDetailsBlocks(fenced)[0]).toMatchObject({
      contentTo: fenced.lastIndexOf("<<<"),
    });
    for (const invalid of [
      ">>> Outer\n>>> Inner\nbody\n<<<\n<<<\n",
      ">>> Missing\nbody\n",
      "text >>> Inline\nbody\n<<<\n",
    ]) {
      expect(parseDetailsBlocks(invalid)).toEqual([]);
    }
  });
});

describe("AIC details interaction", () => {
  it("groups linked actions and insets only previews belonging to an open details body", () => {
    const source = [
      ">>>|open| - [ ] [src/components/long-file-name.ts · L10–L18](src/components/long-file-name.ts#L10-L18)",
      "```typescript",
      "const example = true;",
      "```",
      "",
      "**Comment**",
      "This text remains in the note editor.",
      "<<<",
      "",
      "```text",
      "Outside the accordion",
      "```",
      "",
      "after",
    ].join("\n");
    const host = document.body.appendChild(document.createElement("div"));
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    const summary = host.querySelector(".cm-aic-details-summary")!;
    const heading = summary.querySelector(".aic-card__section--details")!;
    expect(heading.querySelector(".cm-aic-details-title")?.textContent).toBe(
      "src/components/long-file-name.ts · L10–L18",
    );
    expect(heading.querySelector('[role="checkbox"]')).not.toBeNull();
    const actions = summary.querySelector(".aic-card__actions--details")!;
    expect(actions.querySelectorAll(".aic-button--icon-only")).toHaveLength(3);

    const cards = host.querySelectorAll<HTMLElement>(".cm-md-code-preview");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.classList.contains("aic-card__body--embedded")).toBe(true);
    expect(cards[1]!.classList.contains("aic-card__body--embedded")).toBe(
      false,
    );
    expect(host.querySelectorAll(".aic-card__footer--details")).toHaveLength(1);
    expect(host.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(editor.value).toBe(source);

    actions.querySelector<HTMLButtonElement>(".cm-aic-details-edit")!.click();
    expect(host.querySelector(".cm-aic-details-summary")).toBeNull();
    expect(host.querySelector(".aic-card__footer--details")).toBeNull();
    expect(host.querySelector(".aic-card__body--embedded")).toBeNull();
    expect(editor.value).toBe(source);
    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(host.querySelectorAll(".aic-card__body--embedded")).toHaveLength(1);
    editor.destroy();
    host.remove();
  });

  it("keeps a code-only body bounded across read-only disclosure without changing source", () => {
    const source =
      ">>> Read-only example\n```js\nconst value = 1;\n```\n<<<\n\nafter";
    const host = document.body.appendChild(document.createElement("div"));
    const editor = new AicEditor(host, { initialText: source, readOnly: true });
    editor.view.dispatch({ selection: { anchor: source.length } });
    const toggle = () =>
      host
        .querySelector<HTMLButtonElement>(".cm-aic-details-disclosure")!
        .click();
    expect(host.querySelector(".cm-md-code-preview")).toBeNull();
    toggle();
    expect(
      host.querySelector(".cm-md-code-preview.aic-card__body--embedded"),
    ).not.toBeNull();
    expect(host.querySelector(".aic-card__footer--details")).not.toBeNull();
    expect(host.querySelector(".cm-aic-details-cut")).toBeNull();
    expect(editor.value).toBe(source);
    toggle();
    expect(host.querySelector(".cm-md-code-preview")).toBeNull();
    expect(host.querySelector(".aic-card__footer--details")).toBeNull();
    expect(editor.value).toBe(source);
    editor.destroy();
    host.remove();
  });

  it("rebuilds body membership after source-mode remount and clears it when a card moves outside", async () => {
    const source =
      ">>>|open| Example\n```js\nconst value = 1;\n```\n<<<\n\nafter";
    const host = document.body.appendChild(document.createElement("div"));
    const editor = new AicEditor(host, { initialText: source });
    const embedded = () =>
      host.querySelector(".cm-md-code-preview.aic-card__body--embedded");
    // Initial paint has no selection/update transaction to trigger the listener.
    await vi.waitFor(() => expect(embedded()).not.toBeNull());
    const toggle = host.querySelector<HTMLButtonElement>(
      ".aic-source-mode-toggle",
    )!;
    toggle.click();
    expect(host.querySelector(".aic-card__body--embedded")).toBeNull();
    toggle.click();
    editor.view.dispatch({ selection: { anchor: source.length } });
    await vi.waitFor(() => expect(embedded()).not.toBeNull());
    expect(editor.value).toBe(source);
    editor.updateDocument("```js\nconst value = 1;\n```\n\nafter");
    expect(host.querySelector(".cm-md-code-preview")).not.toBeNull();
    expect(embedded()).toBeNull();
    expect(host.querySelector(".aic-card__footer--details")).toBeNull();
    // Removing the plugin before its pending measure must not access removed fields.
    toggle.click();
    toggle.click();
    toggle.click();
    editor.destroy();
    host.remove();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it("refreshes captured task offsets after header whitespace changes and rejects detached controls", () => {
    const initial = ">>>|open| - [ ] [Task](x)\nbody\n<<<\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: initial });
    editor.view.dispatch({ selection: { anchor: initial.length } });
    const old = editor.element.querySelector(".cm-aic-details-summary")!;
    const changed = initial.replace("|open| ", "|open|  ");
    editor.updateDocument(changed);
    const current = editor.element.querySelector(".cm-aic-details-summary")!;
    expect(current).not.toBe(old);
    old.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
    expect(editor.value).toBe(changed);
    current.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
    expect(editor.value).toBe(changed.replace("[ ]", "[x]"));
    editor.switchDocument("short", "x");
    expect(() =>
      old
        .querySelector<HTMLButtonElement>(".cm-aic-details-disclosure")!
        .click(),
    ).not.toThrow();
    expect(editor.value).toBe("x");
    editor.destroy();
    host.remove();
  });

  it("toggles from title/CSS icon, keeps linked controls separate, and edits source explicitly", () => {
    const source =
      ">>> - [ ] [Source](src/app.ts#L2-L4)\ncomment\n<<<\n\nafter";
    const changed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: source,
      onChange: changed,
    });
    editor.view.dispatch({ selection: { anchor: source.length } });

    let summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    expect(summary.dataset.open).toBe("false");
    expect(summary.querySelector("svg")).toBeNull();
    expect(
      summary.querySelector<HTMLButtonElement>(".cm-aic-details-disclosure")!
        .dataset.aicIcon,
    ).toBe("chevron");
    expect(summary.textContent).not.toMatch(/[▸▾]/u);
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-title")!.click();
    expect(editor.value).toContain(">>>|open| - [ ] [Source]");

    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-check")!.click();
    expect(editor.value).toContain(">>>|open| - [x] [Source]");
    const body = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-body",
    )!;
    expect(body).not.toBeNull();

    const comment = editor.value.indexOf("comment") + "comment".length;
    editor.view.dispatch({
      selection: { anchor: comment },
      changes: { from: comment, insert: " kept" },
      userEvent: "input",
    });
    expect(editor.value).toContain("comment kept");

    const beforeEdit = editor.value;
    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-md-edit-source")!.click();
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    expect(editor.value).toBe(beforeEdit);
    // Home and selection of the opening marker must not immediately restore
    // the atomic preview while the user is explicitly editing this block.
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(
      editor.element.querySelector(".cm-aic-details-summary"),
    ).not.toBeNull();
    expect(changed).toHaveBeenCalledTimes(3);
    editor.destroy();
  });

  it("keeps read-only disclosure ephemeral while allowing source inspection", () => {
    const source = ">>> Locked\nbody\n<<<\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source, readOnly: true });
    editor.view.dispatch({ selection: { anchor: source.length } });
    let summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-title")!.click();
    expect(editor.value).toBe(source);
    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    expect(summary.dataset.open).toBe("true");
    summary.querySelector<HTMLButtonElement>(".cm-md-edit-source")!.click();
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    expect(editor.value).toBe(source);
    editor.destroy();
  });
});
