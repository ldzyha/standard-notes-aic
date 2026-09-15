import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { AicEditor, detectTheme } from "../src/editor";
import { undo } from "@codemirror/commands";

afterEach(() => document.body.replaceChildren());

describe("AIC editor integration", () => {
  it("preserves extra authored table cells when editing a visible cell", () => {
    const source = "| A |\n| --- |\n| visible | extra-authored-cell |\n\nAfter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.element
      .querySelector<HTMLElement>('[aria-label="Row 1, column 1"]')!
      .click();
    document.querySelector<HTMLTextAreaElement>(".cm-aic-cell-editor")!.value =
      "Changed";
    document
      .querySelector<HTMLButtonElement>('[aria-label="Apply change"]')!
      .click();
    expect(editor.value).toContain("| Changed | extra-authored-cell |");
    editor.destroy();
  });
  it("ignores unrelated and malformed drops instead of moving the first row", () => {
    const source = "| A |\n| --- |\n| first |\n| second |\n\nAfter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    const target = editor.element.querySelectorAll(".cm-md-table tbody tr")[1]!;
    for (const [types, value] of [
      [[], ""],
      [["text/plain"], "0"],
      [["application/x-aic-row"], ""],
    ] as const) {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { types, getData: () => value },
      });
      target.dispatchEvent(event);
      expect(editor.value).toBe(source);
      expect(event.defaultPrevented).toBe(false);
    }
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["application/x-aic-row"], getData: () => "0" },
    });
    target.dispatchEvent(event);
    expect(editor.value).toContain("| second |\n| first |");
    expect(event.defaultPrevented).toBe(true);
    editor.destroy();
  });

  it("keeps retired managed YAML opaque and copies original source only explicitly", async () => {
    const source =
      "---\nfile: example.note.md\ncreated: 2026-09-12T10:00:00Z\nupdated: 2026-09-12T11:00:00Z\nstatus: idea\n---\n\nBody";
    const writes: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void writes.push(value) },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    const properties =
      editor.element.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(properties).not.toBeNull();
    expect(properties.querySelector('[aria-label="Paste file"]')).toBeNull();
    expect(
      properties.querySelector('[aria-label="Delete empty file field"]'),
    ).toBeNull();
    properties
      .querySelector<HTMLButtonElement>('[aria-label="Copy properties"]')!
      .click();
    await vi.waitFor(() =>
      expect(writes).toContain(source.split("\n\nBody")[0]),
    );
    expect(editor.value).toBe(source);
    expect(properties.querySelector(".cm-aic-drag-handle")).toBeNull();
    editor.destroy();
  });
  it.each([
    "```aic\n# Properties\nx | y\n```\n\nbody",
    "```aic\n# Properties\n\nx | y\n```\n\nbody",
  ])(
    "refreshes property copy callbacks after source whitespace changes: %s",
    (initial) => {
      const writes: string[] = [];
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value: string) => void writes.push(value) },
      });
      const host = document.createElement("div");
      document.body.append(host);
      const editor = new AicEditor(host, { initialText: initial });
      const old = editor.element.querySelector(".cm-aic-security")!;
      editor.updateDocument("```aic\n# Properties\nx | y\n\n```\n\nbody");
      const current = editor.element.querySelector(".cm-aic-security")!;
      expect(current).not.toBe(old);
      current
        .querySelector<HTMLElement>('[aria-label="Copy x value"]')!
        .click();
      expect(editor.value).toBe("```aic\n# Properties\nx | y\n\n```\n\nbody");
      expect(document.querySelector(".cm-aic-cell-editor")).toBeNull();
      editor.switchDocument("short", "x");
      expect(() =>
        old
          .querySelector<HTMLButtonElement>('[aria-label="Copy x value"]')!
          .click(),
      ).not.toThrow();
      expect(editor.value).toBe("x");
      expect(writes).toContain("y");
      editor.destroy();
    },
  );

  it("does not paste a stale property clipboard read into a replacement note", async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { readText, writeText: async () => {} },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: "```aic\n# Properties\nempty *| \n```\n\nOriginal",
    });
    editor.element
      .querySelector<HTMLButtonElement>('[aria-label="Paste empty"]')!
      .click();
    expect(readText).toHaveBeenCalledTimes(1);
    editor.switchDocument("replacement", "Replacement note");
    resolveRead!("synthetic-only-secret");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.value).toBe("Replacement note");
    expect(editor.element.querySelector(".cm-aic-security")).toBeNull();
    editor.destroy();
  });

  it("isolates Undo by identity even when two notes have equal text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host);
    editor.switchDocument("note-a", "Old A");
    editor.view.dispatch({ changes: { from: 0, to: 5, insert: "Shared" } });
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(editor.switchDocument("note-a", "Shared")).toBe(false);
    expect(editor.view.state.selection.main.head).toBe(3);
    expect(undo(editor.view)).toBe(true);
    expect(editor.value).toBe("Old A");
    editor.view.dispatch({ changes: { from: 0, to: 5, insert: "Shared" } });
    expect(editor.switchDocument("note-b", "Shared")).toBe(true);
    expect(undo(editor.view)).toBe(false);
    expect(editor.value).toBe("Shared");
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.destroy();
  });

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

  it("updates the active document without resetting its selection", () => {
    const changed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: "alpha beta",
      onChange: changed,
    });
    editor.view.dispatch({ selection: { anchor: 6, head: 10 } });
    editor.view.focus();

    expect(editor.updateDocument("prefix alpha beta")).toBe(true);
    expect(editor.value).toBe("prefix alpha beta");
    expect(editor.view.state.selection.main.anchor).toBe(13);
    expect(editor.view.state.selection.main.head).toBe(17);
    expect(editor.view.hasFocus).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    expect(editor.updateDocument("prefix alpha beta")).toBe(false);
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

  it("exposes the compact direct command surface", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host);
    expect(editor.toolbar.element.classList).toContain("aic-toolbar--compact");
    expect(editor.toolbar.element.querySelector("select")).toBeNull();
    const buttons = [
      ...editor.toolbar.element.querySelectorAll<HTMLButtonElement>("button"),
    ];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Show Markdown source",
      "Strikethrough",
      "Insert link (Ctrl/Command+K)",
      "Bullet list",
      "Ordered list",
      "Task list",
      "AIC editor guide",
    ]);
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
      expect(editor.element.querySelector(".cm-aic-properties")).not.toBeNull();
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

  it("keeps property clicks in preview and reveals source only for Ctrl+A or Edit", async () => {
    const source =
      "```aic\n# Properties\nstatus | idea\nowner | team\n```\n\nBody";
    const writes: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void writes.push(value) },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    let properties =
      editor.element.querySelector<HTMLElement>(".cm-aic-security");
    expect(properties).not.toBeNull();
    properties!.click();
    properties!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editor.element.querySelector(".cm-aic-security")).not.toBeNull();

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
    expect(editor.element.querySelector(".cm-aic-security")).toBeNull();

    editor.view.dispatch({ selection: { anchor: source.length } });
    properties = editor.element.querySelector<HTMLElement>(".cm-aic-security");
    expect(properties).not.toBeNull();

    const edit = properties!.querySelector<HTMLButtonElement>(
      '[aria-label="Edit security block"]',
    );
    expect(edit).not.toBeNull();
    expect(edit!.textContent).toBe("");
    expect(edit!.dataset.aicIcon).toBe("edit");
    edit!.click();
    expect(editor.element.querySelector(".cm-aic-security")).toBeNull();
    expect(editor.view.state.selection.main.head).toBe("```aic\n".length);

    editor.view.dispatch({ selection: { anchor: source.length } });
    properties = editor.element.querySelector<HTMLElement>(".cm-aic-security");
    expect(properties).not.toBeNull();
    const status = editor.element.querySelector<HTMLElement>(
      '[aria-label="Copy status value"]',
    );
    expect(status).not.toBeNull();
    expect(status!.tagName).toBe("BUTTON");
    expect(
      properties!.querySelector('input:not([type="search"]), textarea'),
    ).toBeNull();
    expect(properties!.querySelector('input[type="search"]')).not.toBeNull();
    status!.click();
    await vi.waitFor(() => expect(writes).toContain("idea"));
    expect(editor.value).toBe(source);
    expect(document.body.querySelector(".cm-aic-cell-editor")).toBeNull();
    expect(properties!.querySelector(".cm-aic-drag-handle")).toBeNull();
    editor.destroy();
  });

  it("keeps native text selection inside a preview stable", () => {
    const source = "```aic\n# Properties\nstatus | idea\n```\n\nBody";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });
    const preview =
      editor.element.querySelector<HTMLElement>(".cm-aic-security")!;
    const value = preview.querySelector<HTMLElement>(
      '[aria-label="Copy status value"]',
    )!;
    const text = value.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const editorSelection = editor.view.state.selection.main;

    value.dispatchEvent(new Event("pointerup", { bubbles: true }));

    expect(selection.toString()).toBe("idea");
    expect(preview.isConnected).toBe(true);
    expect(editor.view.state.selection.main.eq(editorSelection)).toBe(true);
    editor.destroy();
  });

  it("quarantines nested legacy secrets while preserving source and comments", async () => {
    const source = [
      "---",
      "# Keep this authored comment",
      "document:",
      "  type: index",
      "traceability:",
      "  requirements:",
      "    - type: jira",
      "      token*: synthetic-only-secret",
      "      role: v1-study",
      "---",
      "",
      "Body",
    ].join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const writes: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => void writes.push(value) },
    });
    const editor = new AicEditor(host, { initialText: source });
    const properties =
      editor.element.querySelector<HTMLElement>(".cm-aic-properties");
    expect(properties).not.toBeNull();
    expect(properties!.textContent).not.toContain("synthetic-only-secret");
    expect(properties!.querySelector(".cm-aic-drag-handle")).toBeNull();
    properties!
      .querySelector<HTMLButtonElement>('[aria-label="Copy properties"]')!
      .click();
    await vi.waitFor(() =>
      expect(writes).toContain(source.split("\n\nBody")[0]),
    );
    expect(editor.value).toBe(source);
    expect(document.querySelector(".cm-aic-cell-editor")).toBeNull();
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

  it("edits table values in one popover and reveals source for selections or Edit", () => {
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
    const value = table!.querySelector<HTMLElement>(
      '[aria-label="Row 1, column 1"]',
    );
    expect(value).not.toBeNull();
    expect(value!.tagName).toBe("SPAN");
    expect(table!.querySelector("input, textarea")).toBeNull();
    value!.click();
    const valueEditor = document.body.querySelector<HTMLTextAreaElement>(
      ".cm-aic-cell-editor",
    );
    expect(valueEditor).not.toBeNull();
    valueEditor!.value = "changed";
    document.body
      .querySelector<HTMLButtonElement>('[aria-label="Apply change"]')!
      .click();
    expect(editor.value).toContain("| changed | y |");
    editor.view.dispatch({
      selection: { anchor: 0, head: editor.value.length },
    });
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.view.state.selection.main.to).toBe(editor.value.length);
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    editor.view.dispatch({ selection: { anchor: 0, head: source.length } });
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    const refreshed = editor.element.querySelector<HTMLElement>(".cm-md-table");
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

  it("mirrors the VS Code code-fence preview with permanent Copy and Edit actions", async () => {
    const source = [
      "Before",
      "",
      "```ts",
      "const answer = 42;",
      "console.log(answer);",
      "```",
      "",
      "After",
    ].join("\n");
    const code = "const answer = 42;\nconsole.log(answer);";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editor.view.dispatch({ selection: { anchor: source.length } });

    await vi.waitFor(() => {
      expect(
        editor.element.querySelector(".cm-md-code-preview"),
      ).not.toBeNull();
    });
    const preview = editor.element.querySelector<HTMLElement>(
      ".cm-md-code-preview",
    )!;
    const fenceFrom = source.indexOf("```ts");
    const fenceTo = source.indexOf("```", fenceFrom + 3) + 3;
    const atomicRanges: Array<[number, number]> = [];
    for (const provider of editor.view.state.facet(EditorView.atomicRanges)) {
      provider(editor.view).between(0, source.length, (from, to) => {
        atomicRanges.push([from, to]);
      });
    }
    expect(atomicRanges).toContainEqual([fenceFrom, fenceTo]);
    expect(preview.querySelector("pre")?.textContent).toBe(code);
    expect(
      preview.querySelector(".cm-md-preview-header > span")?.textContent,
    ).toBe("ts");
    const copy = preview.querySelector<HTMLButtonElement>(
      '[aria-label="Copy code"]',
    );
    const edit = preview.querySelector<HTMLButtonElement>(
      '[aria-label="Edit code source"]',
    );
    expect(copy?.dataset.aicIcon).toBe("copy");
    expect(edit?.dataset.aicIcon).toBe("edit");
    expect(copy?.textContent).toBe("");
    expect(edit?.textContent).toBe("");

    copy!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    await vi.waitFor(() => expect(copy!.dataset.aicIcon).toBe("check"));
    editor.view.dispatch({ selection: { anchor: 0, head: source.length } });
    expect(editor.element.querySelector(".cm-md-code-preview")).toBeNull();
    editor.view.dispatch({ selection: { anchor: source.length } });
    const restoredEdit = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Edit code source"]',
    );
    expect(restoredEdit).not.toBeNull();
    restoredEdit!.click();
    expect(editor.element.querySelector(".cm-md-code-preview")).toBeNull();
    expect(editor.view.state.selection.main.head).toBe(
      source.indexOf("const answer"),
    );
    expect(editor.view.state.readOnly).toBe(false);
    expect(editor.view.contentDOM.getAttribute("contenteditable")).toBe("true");

    editor.view.dispatch({
      selection: { anchor: fenceFrom, head: fenceFrom + 3 },
    });
    expect(editor.element.querySelector(".cm-md-code-preview")).toBeNull();
    expect(
      editor.view.state.sliceDoc(
        editor.view.state.selection.main.from,
        editor.view.state.selection.main.to,
      ),
    ).toBe("```");

    const revealedAtomicRanges: Array<[number, number]> = [];
    for (const provider of editor.view.state.facet(EditorView.atomicRanges)) {
      provider(editor.view).between(0, source.length, (from, to) => {
        revealedAtomicRanges.push([from, to]);
      });
    }
    expect(revealedAtomicRanges).not.toContainEqual([fenceFrom, fenceTo]);

    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(editor.element.querySelector(".cm-md-code-preview")).not.toBeNull();

    editor.destroy();
  });

  it("keeps code copy available while locked and labels source inspection clearly", async () => {
    const source = "```\nread only\n```\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source, readOnly: true });
    editor.view.dispatch({ selection: { anchor: source.length } });
    await vi.waitFor(() => {
      expect(
        editor.element.querySelector('[aria-label="View code source"]'),
      ).not.toBeNull();
    });
    const preview = editor.element.querySelector<HTMLElement>(
      ".cm-md-code-preview",
    )!;
    expect(
      preview.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')
        ?.disabled,
    ).toBe(false);
    expect(
      preview.querySelector<HTMLButtonElement>(
        '[aria-label="View code source"]',
      )?.dataset.aicIcon,
    ).toBe("source");
    editor.destroy();
  });

  it("disables commands and source mutation while locked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: "word", readOnly: true });
    const controls = editor.toolbar.element.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >("button,select");
    expect(
      [...controls].every(
        (control) =>
          control.classList.contains("aic-source-mode-toggle") ||
          control.dataset.aicReadonlyAction === "true" ||
          control.disabled,
      ),
    ).toBe(true);
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
    document.documentElement.style.setProperty(
      "--sn-stylekit-editor-background-color",
      "#171b22",
    );
    expect(detectTheme(document)).toBe("dark");
    document.documentElement.style.setProperty(
      "--sn-stylekit-editor-background-color",
      "#ffffff",
    );
    expect(detectTheme(document)).toBe("default");
  });
});
