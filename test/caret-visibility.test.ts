import { afterEach, describe, expect, it } from "vitest";
import { AicEditor } from "../src/editor";

const SEED = "---\n# aic-fields: v2\n---\n\n";

afterEach(() => document.body.replaceChildren());

describe("focused editor caret lifecycle", () => {
  it("keeps a drawn cursor and editable blank body for a Properties seed", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: SEED,
      compactToolbar: true,
    });
    editor.setSaveState("placeholder");
    editor.view.dispatch({ selection: { anchor: SEED.length } });
    editor.focus();

    expect(editor.view.state.doc.toString()).toBe(SEED);
    expect(editor.element.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(editor.element.querySelector(".cm-cursorLayer")).not.toBeNull();
    expect(editor.view.state.selection.main.head).toBe(SEED.length);
    expect(editor.view.contentDOM.getAttribute("contenteditable")).toBe("true");

    editor.view.dispatch({ changes: { from: SEED.length, insert: "Body" } });
    expect(editor.view.state.doc.toString()).toBe(`${SEED}Body`);
    expect(editor.view.state.selection.main.head).toBe(SEED.length);
    editor.destroy();
  });

  it("retains the same editable view and selection across source and compact toolbar toggles", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: `${SEED}Body`,
      compactToolbar: true,
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    editor.focus();

    const source = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Show Markdown source"]',
    );
    expect(source).not.toBeNull();
    source!.click();
    expect(source!.getAttribute("aria-label")).toBe("Show preview");
    expect(editor.view).toBe(view);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");

    source!.click();
    expect(source!.getAttribute("aria-label")).toBe("Show Markdown source");
    const formatting = editor.element.querySelector<HTMLButtonElement>(
      ".aic-formatting-toggle",
    );
    expect(formatting).not.toBeNull();
    formatting!.click();
    expect(formatting!.getAttribute("aria-expanded")).toBe("true");
    formatting!.click();
    expect(formatting!.getAttribute("aria-expanded")).toBe("false");
    expect(editor.view).toBe(view);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    editor.destroy();
  });
});
