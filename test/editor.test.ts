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
    const options = [...editor.toolbar.element.querySelectorAll("option")]
      .map((control) => control.textContent?.trim())
      .filter(Boolean);
    expect(options).toEqual(
      expect.arrayContaining([
        "Paragraph",
        "Heading 6",
        "Quote",
        "Table",
        "Properties",
        "Code block",
        "Mermaid",
        "Horizontal rule",
      ]),
    );
    const buttons = [
      ...editor.toolbar.element.querySelectorAll<HTMLButtonElement>("button"),
    ];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining([
        "Bold (Ctrl/Command+B)",
        "Italic (Ctrl/Command+I)",
        "Strikethrough",
        "Inline code",
        "Insert link (Ctrl/Command+K)",
        "Bullet list",
        "Ordered list",
        "Task list",
      ]),
    );
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
    expect(buttons.every((button) => Boolean(button.dataset.aicIcon))).toBe(
      true,
    );
    expect(editor.toolbar.element.getAttribute("aria-label")).toBe(
      "AIC formatting",
    );
    editor.destroy();
  });

  it("derives properties, tables, and accessible task widgets from source", async () => {
    const source =
      "---\nstatus: idea\n---\n\n- [ ] work\n\n| A | B |\n| --- | --- |\n| x | y |\n\nend";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    await vi.waitFor(() => {
      expect(editor.element.querySelector(".cm-md-props")).not.toBeNull();
      expect(editor.element.querySelector(".cm-md-table table")).not.toBeNull();
    });
    const task = editor.element.querySelector<HTMLElement>(
      '[role="checkbox"][aria-checked="false"]',
    );
    expect(task).not.toBeNull();
    task!.click();
    expect(editor.value).toContain("- [x] work");
    editor.destroy();
  });

  it("keeps single clicks in preview and reveals source for Ctrl+A or Edit", () => {
    const source = "---\nstatus: idea\nowner: team\n---\n\nBody";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    let properties = editor.element.querySelector<HTMLElement>(".cm-md-props");
    expect(properties).not.toBeNull();
    properties!.click();
    properties!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editor.element.querySelector(".cm-md-props")).not.toBeNull();

    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.view.state.selection.main.to).toBe(source.length);
    expect(editor.element.querySelector(".cm-md-props")).toBeNull();

    editor.view.dispatch({ selection: { anchor: source.length } });
    properties = editor.element.querySelector<HTMLElement>(".cm-md-props");
    expect(properties).not.toBeNull();

    const edit = properties!.querySelector<HTMLButtonElement>(
      '[aria-label="Edit properties source"]',
    );
    expect(edit).not.toBeNull();
    expect(edit!.textContent).toBe("");
    expect(edit!.dataset.aicIcon).toBe("edit");
    edit!.click();
    expect(editor.element.querySelector(".cm-md-props")).toBeNull();
    expect(editor.view.state.selection.main.head).toBe(4);

    editor.view.dispatch({ selection: { anchor: source.length } });
    properties = editor.element.querySelector<HTMLElement>(".cm-md-props");
    expect(properties).not.toBeNull();
    const status = editor.element.querySelector<HTMLInputElement>(
      '[aria-label="Property status value"]',
    );
    expect(status).not.toBeNull();
    status!.value = "active";
    status!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.value).toContain("status: active");
    const add = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Add property"]',
    );
    expect(add).not.toBeNull();
    expect(add!.textContent).toBe("");
    expect(add!.dataset.aicIcon).toBe("add-property");
    add!.click();
    expect(editor.value).toContain("property: ");
    expect(
      [
        ...editor.element.querySelectorAll<HTMLButtonElement>(
          ".cm-aic-drag-handle",
        ),
      ].every((handle) => handle.draggable),
    ).toBe(true);
    editor.destroy();
  });

  it("renders nested property levels and edits only leaf values", () => {
    const source = [
      "---",
      "document:",
      "  type: index",
      "traceability:",
      "  requirements:",
      "    - type: jira",
      "      id: EPC-32962",
      "      role: v1-study",
      "---",
      "",
      "Body",
    ].join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    const properties =
      editor.element.querySelector<HTMLElement>(".cm-md-props");
    expect(properties).not.toBeNull();
    expect(properties!.querySelectorAll("tr[data-depth='0']")).toHaveLength(2);
    expect(properties!.querySelectorAll("tr[data-depth='3']")).toHaveLength(2);
    expect(properties!.querySelectorAll(".cm-aic-property-level")).toHaveLength(
      7,
    );
    expect(properties!.querySelectorAll(".cm-aic-property-group")).toHaveLength(
      3,
    );

    const ticket = properties!.querySelector<HTMLInputElement>(
      '[aria-label="Property id value"]',
    );
    expect(ticket).not.toBeNull();
    ticket!.value = "EPC-33349";
    ticket!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.value).toContain("      id: EPC-33349");
    expect(editor.value).toContain("    - type: jira");
    editor.destroy();
  });

  it("renders links as direct open, copy, and focused edit controls without a tooltip", () => {
    const source =
      "Before [OpenAI](https://openai.com) and https://example.com\n\nEnd";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    const links = editor.element.querySelectorAll<HTMLElement>(
      ".cm-aic-link-control",
    );
    expect(links).toHaveLength(2);
    expect(editor.element.querySelector(".cm-md-link-tooltip")).toBeNull();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    links[0]!.querySelector<HTMLButtonElement>(".cm-aic-link-open")!.click();
    expect(open).toHaveBeenCalledWith(
      "https://openai.com",
      "_blank",
      "noopener,noreferrer",
    );
    const labels = [...links[0]!.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["OpenAI", "Copy link", "Edit link"]);
    expect(links[0]!.querySelectorAll("button")[1]!.textContent).toBe("");
    expect(links[0]!.querySelectorAll("button")[2]!.textContent).toBe("");
    links[0]!.querySelectorAll<HTMLButtonElement>("button")[2]!.click();
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).toBe("https://openai.com");
    editor.destroy();
  });

  it("edits table values directly and reveals source for selections or Edit", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    const table = editor.element.querySelector<HTMLElement>(".cm-md-table");
    expect(table).not.toBeNull();
    expect(table!.querySelector(".cm-aic-table-scroll > table")).not.toBeNull();
    const before = editor.view.state.selection.main.head;
    table!.click();
    expect(editor.view.state.selection.main.head).toBe(before);
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    const value = table!.querySelector<HTMLTextAreaElement>(
      '[aria-label="Row 1, column 1"]',
    );
    expect(value).not.toBeNull();
    expect(value!.tagName).toBe("TEXTAREA");
    value!.value = "changed";
    value!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.value).toContain("| changed | y |");
    let refreshed = editor.element.querySelector<HTMLElement>(".cm-md-table");
    const selectedCell = refreshed!.querySelector<HTMLTextAreaElement>(
      '[aria-label="Row 1, column 1"]',
    );
    selectedCell!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.view.state.selection.main.to).toBe(editor.value.length);
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    editor.view.dispatch({ selection: { anchor: 0, head: source.length } });
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    refreshed = editor.element.querySelector<HTMLElement>(".cm-md-table");
    const edit = refreshed!.querySelector<HTMLButtonElement>(
      '[aria-label="Edit table source"]',
    );
    expect(edit).not.toBeNull();
    expect(edit!.textContent).toBe("");
    edit!.click();
    expect(editor.view.state.selection.main.head).toBe(0);
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    expect(editor.value).toContain("| changed | y |");
    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    editor.destroy();
  });

  it("copies the exact Markdown table through an always-visible icon action", async () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    const copy = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Copy table"]',
    );
    expect(copy).not.toBeNull();
    expect(copy!.textContent).toBe("");
    expect(copy!.dataset.aicIcon).toBe("copy");
    copy!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    await vi.waitFor(() => expect(copy!.dataset.aicIcon).toBe("check"));
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
