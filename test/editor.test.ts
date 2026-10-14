import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { AicEditor, detectTheme } from "../src/editor";
import { undo } from "@codemirror/commands";

afterEach(() => document.body.replaceChildren());

describe("AIC editor integration", () => {
  it.each([undefined, "", " \n"])(
    "keeps empty document bytes without inserting a block: %s",
    (initialText) => {
      const host = document.createElement("div");
      document.body.append(host);
      const onChange = vi.fn();
      const editor = new AicEditor(host, { initialText, onChange });
      expect(editor.value).toBe(initialText ?? "");
      expect(host.querySelector(".cm-aic-security-block")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      editor.switchDocument("empty-document", "");
      expect(editor.value).toBe("");
      editor.destroy();
    },
  );

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
      "```aic\n# Properties\nowner | team\nstatus | idea\n```\n\nBody";
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
      '[aria-label="Edit AIC block"]',
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

  it.each([
    {
      name: "code",
      block: "```ts\nconst answer = 42;\n```",
      action: "Cut ts block",
    },
    {
      name: "table",
      block: "| A | B |\n| --- | --- |\n| x | y |",
      action: "Cut table",
    },
    {
      name: "details",
      block: ">>> Detail\nbody\n<<<",
      action: "Cut details block",
    },
    {
      name: "Mermaid",
      block: "```mermaid\nflowchart LR\n  A --> B\n```",
      action: "Cut Mermaid block",
    },
    {
      name: "security",
      block: "```aic\n## Main\nPassword *| synthetic-secret\n```",
      action: "Cut AIC block",
    },
    {
      name: "properties",
      block: "---\nfile: example.note.md\nstatus: idea\n---",
      action: "Cut properties",
    },
  ])(
    "cuts the complete $name Markdown block in one operation",
    async ({ block, action }) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const initial = `${block}\n\nAfter`;
      const host = document.createElement("div");
      document.body.append(host);
      const editor = new AicEditor(host, { initialText: initial });
      editor.view.dispatch({ selection: { anchor: initial.length } });
      const cut = await vi.waitFor(() => {
        const button = editor.element.querySelector<HTMLButtonElement>(
          `button[aria-label="${action}"]`,
        );
        expect(button).not.toBeNull();
        return button!;
      });
      expect(cut.dataset.aicIcon).toBe("cut");
      expect(cut.textContent).toBe("");
      cut.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      expect(String(writeText.mock.calls[0]![0]).trimEnd()).toBe(block);
      await vi.waitFor(() => expect(editor.value.trim()).toBe("After"));
      editor.destroy();
    },
  );

  it("keeps a block when its Markdown cannot be copied", async () => {
    const block = "| A |\n| --- |\n| value |";
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: `${block}\n\nAfter` });
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    editor.element
      .querySelector<HTMLButtonElement>('[aria-label="Cut table"]')!
      .click();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.value).toContain(block);
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

  it("shows note pages as cards in preview and plain text in source mode", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onOpenTarget = vi.fn();
    const editor = new AicEditor(host, { initialText: "One", onOpenTarget });
    const titles = () =>
      [...editor.element.querySelectorAll(".aic-card--page")].map(
        (card) => card.querySelector(".aic-card__title")?.textContent ?? null,
      );
    expect(titles()).toEqual([]);

    const source =
      "---\ntitle: A\n---\nOne\n\n--- https://user:pw@example.com/docs\nTwo\n\n---\nThree\n\n```aic\n# S\n\n---\n```\n";
    editor.updateDocument(source);
    expect(titles()).toEqual(["https://example.com/docs", null]);
    editor.element
      .querySelector<HTMLButtonElement>('[aria-label="Open target"]')!
      .click();
    expect(onOpenTarget).toHaveBeenCalledExactlyOnceWith(
      "https://user:pw@example.com/docs",
    );

    editor.view.dispatch({
      selection: { anchor: source.indexOf("--- https") },
    });
    expect(titles()).toEqual([null]);
    editor.view.dispatch({ selection: { anchor: source.indexOf("Two") } });
    expect(titles()).toHaveLength(2);

    const toggle = editor.element.querySelector<HTMLButtonElement>(
      ".aic-source-mode-toggle",
    )!;
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual([]);
    toggle.click();
    expect(titles()).toHaveLength(2);
    expect(editor.value).toBe(source);
    expect(editor.focusedPage).toBeNull();

    editor.setReadOnly(true);
    expect(titles()).toHaveLength(2);
    editor.switchDocument("other", "Single page");
    expect(titles()).toEqual([]);
    editor.destroy();
  });

  it("focuses one page card and confines edits to it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const editor = new AicEditor(host, { onChange });
    const hidden =
      "| Hidden | table |\n| --- | --- |\n| h1 | h2 |\n\n```aic\n# Hidden block\n\n---\n```\n";
    const page =
      "Shown\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```aic\n# Shown block\n\n---\n```\n\n~~~\n\n---\n~~~";
    const source = `---\ntitle: Notebook\n---\nIntro\n\n--- /home/me/other.ts\n${hidden}\n--- /home/me/src/app.ts\n${page}\n\n--- https://example.com\n${hidden}`;
    editor.switchDocument("aic.md", source);
    const shown = () => editor.view.contentDOM.textContent ?? "";
    const titles = () =>
      [...editor.element.querySelectorAll(".aic-card--page")].map(
        (card) => card.querySelector(".aic-card__title")?.textContent,
      );

    expect(editor.focusTarget("/home/me/src/App.ts")).toBe(true);
    expect(titles()).toEqual(["/home/me/src/App.ts"]);
    expect(editor.focusedPage).toEqual({
      target: "/home/me/src/App.ts",
      from: source.indexOf("Shown"),
      to: source.indexOf("Shown") + page.length,
      exists: true,
      text: page,
    });
    expect(shown()).toContain("Shown");
    expect(shown()).not.toMatch(/Hidden|Intro|Notebook|other\.ts/u);

    // Select-all is the page; deleting or replacing it leaves the rest alone.
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    const selection = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(selection.from, selection.to)).toBe(page);
    const [before, after] = source.split(page) as [string, string];
    editor.view.dispatch({
      changes: { from: 0, to: source.length, insert: "wipe" },
      userEvent: "input.paste",
    });
    expect(editor.value).toBe(source);
    editor.view.dispatch(editor.view.state.replaceSelection("New text"));
    expect(editor.value).toBe(`${before}New text${after}`);
    expect(onChange).toHaveBeenLastCalledWith(`${before}New text${after}`);
    editor.view.dispatch({
      selection: { anchor: 0, head: editor.view.state.doc.length },
    });
    editor.view.dispatch(editor.view.state.replaceSelection(""));
    expect(editor.value).toBe(`${before}${after}`);

    // Source mode keeps the same page and hiding; only previews go.
    const toggle = editor.element.querySelector<HTMLButtonElement>(
      ".aic-source-mode-toggle",
    )!;
    toggle.click();
    expect(titles()).toEqual(["/home/me/src/App.ts"]);
    expect(shown()).not.toMatch(/Hidden|Intro/u);
    editor.view.dispatch(editor.view.state.replaceSelection("raw"));
    expect(editor.value).toBe(`${before}raw${after}`);
    toggle.click();

    // A host update passes and the page is found again where it moved.
    onChange.mockClear();
    expect(
      editor.updateDocument(`--- /home/me/src/app.ts\nMoved\n\n---\n${hidden}`),
    ).toBe(true);
    expect(editor.focusedPage).toMatchObject({ from: 24, text: "Moved" });
    expect(editor.updateDocument("No pages")).toBe(true);
    expect(editor.value).toBe("No pages");
    expect(editor.focusedPage).toMatchObject({ exists: false, text: "" });
    expect(onChange).not.toHaveBeenCalled();
    expect(shown()).not.toContain("No pages");

    // Focus survives a document switch; null shows the whole note again.
    editor.switchDocument("b.md", source);
    expect(editor.focusedPage?.text).toBe(page);
    expect(editor.setDocument(`${source}\n`)).toBe(true);
    expect(editor.focusedPage?.text).toBe(`${page}`);
    expect(editor.focusTarget(null)).toBe(true);
    expect(editor.focusedPage).toBeNull();
    expect(shown()).toContain("Intro");
    expect(editor.value).toBe(`${source}\n`);
    editor.destroy();
  });

  it("keeps undo inside the focused page and out of host updates", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { onChange: vi.fn() });
    editor.switchDocument("pages", "--- a\nA\n\n--- b\nB\n");
    editor.focusTarget("a");
    editor.view.dispatch({
      ...editor.view.state.replaceSelection("x"),
      userEvent: "input.type",
    });
    editor.focusTarget("b");
    expect(undo(editor.view)).toBe(false);
    expect(editor.value).toBe("--- a\nxA\n\n--- b\nB\n");
    expect(editor.focusedPage).toMatchObject({ target: "b", text: "B\n" });

    editor.updateDocument("--- a\nDisk\n\n--- b\nB\n");
    expect(undo(editor.view)).toBe(false);
    expect(editor.value).toBe("--- a\nDisk\n\n--- b\nB\n");
    editor.destroy();
  });

  it("writes a focused page that does not exist only on first typing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const editor = new AicEditor(host, { onChange, readOnly: true });
    editor.switchDocument("crlf", "One\r\nTwo");
    expect(editor.focusTarget("https://example.com/new")).toBe(true);
    expect(
      editor.element.querySelector(".aic-card--page .aic-card__title")
        ?.textContent,
    ).toBe("https://example.com/new");
    expect(editor.focusedPage).toMatchObject({ exists: false, text: "" });
    editor.view.dispatch(editor.view.state.replaceSelection("x"));
    expect(editor.value).toBe("One\r\nTwo");
    expect(editor.view.contentDOM.textContent).not.toContain("One");

    editor.setReadOnly(false);
    editor.focusTarget("https://example.com/new");
    expect(onChange).not.toHaveBeenCalled();
    editor.view.dispatch(editor.view.state.replaceSelection("Hi"));
    const written = "One\r\nTwo\r\n\r\n--- https://example.com/new\r\nHi";
    expect(editor.value).toBe(written);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(written);
    editor.view.dispatch(editor.view.state.replaceSelection("\n!"));
    expect(editor.value).toBe(`${written}\r\n!`);
    expect(editor.focusedPage).toMatchObject({
      exists: true,
      text: "Hi\r\n!",
    });

    editor.switchDocument("empty", "");
    expect(editor.value).toBe("");
    editor.view.dispatch(editor.view.state.replaceSelection("a"));
    expect(editor.value).toBe("--- https://example.com/new\na");
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
