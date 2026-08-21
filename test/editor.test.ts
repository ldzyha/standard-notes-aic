import { afterEach, describe, expect, it, vi } from "vitest";
import { AicEditor, detectTheme } from "../src/editor";

afterEach(() => document.body.replaceChildren());

describe("AIC editor integration", () => {
  it("preserves exact source and emits only user document changes", () => {
    const source = "# Title\n\nText  \n";
    const changed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: source,
      onChange: changed,
    });
    expect(editor.value).toBe(source);
    expect(editor.element.getAttribute("data-theme")).toBe("default");
    editor.view.dispatch({
      changes: { from: editor.value.length, insert: "more" },
      userEvent: "input",
    });
    expect(changed).toHaveBeenLastCalledWith(`${source}more`);
    changed.mockClear();
    expect(editor.setDocument("remote\n")).toBe(true);
    expect(editor.value).toBe("remote\n");
    expect(changed).not.toHaveBeenCalled();
    expect(editor.setDocument("remote\n")).toBe(false);
    editor.destroy();
  });

  it("preserves the note's CRLF line separator when saving", () => {
    const source = "# Title\r\n\r\nText\r\n";
    const changed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: source,
      onChange: changed,
    });
    expect(editor.value).toBe(source);
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: "next\nline" },
      userEvent: "input",
    });
    expect(editor.view.state.doc.lines).toBe(5);
    expect(changed).toHaveBeenLastCalledWith(`${source}next\r\nline`);
    editor.destroy();
  });

  it("exposes the complete compact command surface", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host);
    const controls = [
      ...editor.toolbar.element.querySelectorAll("button,option"),
    ]
      .map((control) => control.textContent?.trim())
      .filter(Boolean);
    expect(controls).toEqual(
      expect.arrayContaining([
        "Paragraph",
        "Heading 6",
        "Quote",
        "B",
        "I",
        "S",
        "<>",
        "Link",
        "•",
        "1.",
        "☑",
        "Table",
        "Properties",
        "Code block",
        "Mermaid",
        "Horizontal rule",
      ]),
    );
    expect(editor.toolbar.element.getAttribute("aria-label")).toBe(
      "AIC formatting",
    );
    editor.destroy();
  });

  it("derives properties, tables, and accessible task widgets from source", () => {
    const source =
      "---\nstatus: idea\n---\n\n- [ ] work\n\n| A | B |\n| --- | --- |\n| x | y |\n\nend";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(editor.element.querySelector(".cm-md-props")).not.toBeNull();
    expect(editor.element.querySelector(".cm-md-table table")).not.toBeNull();
    const task = editor.element.querySelector<HTMLElement>(
      '[role="checkbox"][aria-checked="false"]',
    );
    expect(task).not.toBeNull();
    task!.click();
    expect(editor.value).toContain("- [x] work");
    editor.destroy();
  });

  it("keeps preview content inert and reveals exact source only from Edit source", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    const table = editor.element.querySelector<HTMLElement>(".cm-md-table");
    expect(table).not.toBeNull();
    const before = editor.view.state.selection.main.head;
    table!.click();
    expect(editor.view.state.selection.main.head).toBe(before);
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    table!.querySelector<HTMLButtonElement>(".cm-md-edit-source")!.click();
    expect(editor.view.state.selection.main.head).toBe(0);
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    expect(editor.value).toBe(source);
    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    editor.destroy();
  });

  it("disables commands and source mutation while locked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: "word", readOnly: true });
    const controls = editor.toolbar.element.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >("button,select");
    expect([...controls].every((control) => control.disabled)).toBe(true);
    editor.toolbar.element.querySelector<HTMLButtonElement>("button")!.click();
    expect(editor.value).toBe("word");
    expect(editor.setReadOnly(false)).toBe(true);
    expect([...controls].every((control) => !control.disabled)).toBe(true);
    editor.destroy();
  });

  it("follows Standard Notes light and dark theme signals", () => {
    document.documentElement.style.setProperty(
      "--sn-stylekit-background-color",
      "#111111",
    );
    expect(detectTheme(document)).toBe("dark");
    document.documentElement.style.setProperty(
      "--sn-stylekit-background-color",
      "#ffffff",
    );
    expect(detectTheme(document)).toBe("default");
  });
});
