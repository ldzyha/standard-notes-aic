import { history, undo, undoDepth } from "@codemirror/commands";
import { completionStatus } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AicEditor } from "../src/editor";
import { aicMarkdownLanguage } from "../src/language";
import { createSourceModeController } from "../src/core/source-mode.js";
import {
  makePropertiesBlockExtension,
  makeSecurityBlockExtension,
} from "../src/core/security-block.js";
import { serializeSecurityBlock } from "../src/core/security-model.js";
import { isSaveAction } from "../src/core/save-boundary.js";
import { makeCodeFenceExtension } from "../src/core/code-fence-extension.js";

const source = [
  "---",
  "file: example.note.md",
  "status: idea",
  "---",
  "",
  "# A note",
  "",
  "| A | B |",
  "| --- | --- |",
  "| x | y |",
  "",
  "```aic",
  "# Synthetic card",
  "## Accounts",
  "Password *| secret-for-test | note",
  "---",
  "## Other",
  "Account | visible-account",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
  "End",
].join("\n");

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function fixture(options: ConstructorParameters<typeof AicEditor>[1] = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  return new AicEditor(host, { initialText: source, ...options });
}

function button(editor: AicEditor) {
  return editor.element.querySelector<HTMLButtonElement>(
    ".aic-source-mode-toggle",
  )!;
}

function escape(view: EditorView, target: HTMLElement = view.contentDOM) {
  target.focus();
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("whole-note source mode", () => {
  it("restores preview from inside a source fence without edits or a jump to file start", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const editor = fixture({ onChange, onSave });
    const toggle = button(editor);
    toggle.click();
    const inside = source.indexOf("secret-for-test") + 4;
    editor.view.dispatch({ selection: { anchor: inside } });
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(editor.value).toBe(source);
    expect(editor.view.state.selection.main.head).toBeGreaterThan(inside);
    expect(editor.element.querySelector(".cm-aic-security")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("collapses Ctrl+A on Escape and restores all previews", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const editor = fixture({ onChange, onSave });
    button(editor).click();
    editor.view.dispatch({ selection: { anchor: 0, head: source.length } });
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(source.length);
    const ranges: Array<[number, number]> = [];
    for (const provider of editor.view.state.facet(EditorView.atomicRanges))
      provider(editor.view).between(0, source.length, (from, to) => {
        ranges.push([from, to]);
      });
    expect(ranges.some(([from]) => from === source.indexOf("| A | B |"))).toBe(
      true,
    );
    expect(ranges.some(([from]) => from === source.indexOf("```aic"))).toBe(
      true,
    );
    expect(editor.value).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(undoDepth(editor.view.state)).toBe(0);
    editor.destroy();
  });

  it("restores a fenced preview when a partial selection ends inside its source", () => {
    const text = "Before\n\n```ts\nconst answer = 42;\n```\n\nAfter";
    const editor = fixture({ initialText: text });
    button(editor).click();
    const inside = text.indexOf("answer");
    editor.view.dispatch({ selection: { anchor: 0, head: inside } });
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.head).toBeGreaterThan(inside);
    expect(editor.element.querySelector(".cm-md-code-preview")).not.toBeNull();
    editor.destroy();
  });

  it("restores previews after a reversed whole-note selection", () => {
    const editor = fixture();
    button(editor).click();
    editor.view.dispatch({ selection: { anchor: source.length, head: 0 } });
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.head).toBeGreaterThan(0);
    expect(editor.element.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(editor.element.querySelector(".cm-aic-security")).not.toBeNull();
    editor.destroy();
  });

  it("restores a GFM table without outer pipes from whole-note source", () => {
    const text = "Before\n\nA | B\n--- | ---\nx | y\n\nAfter";
    const editor = fixture({ initialText: text });
    button(editor).click();
    const inside = text.indexOf("x | y");
    editor.view.dispatch({ selection: { anchor: inside } });
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(editor.view.state.selection.main.head).toBeGreaterThan(inside);
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    editor.destroy();
  });

  it("lets completion consume its first Escape before leaving whole-note source", async () => {
    const editor = fixture({ initialText: "" });
    const toggle = button(editor);
    toggle.click();
    editor.view.dispatch({
      changes: { from: 0, insert: "/" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    await vi.waitFor(() =>
      expect(completionStatus(editor.view.state)).toBe("active"),
    );
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(completionStatus(editor.view.state)).toBeNull();
    expect(escape(editor.view).defaultPrevented).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(editor.value).toBe("/");
    editor.destroy();
  });

  it("removes previews and atomic ranges without changing text, selection, history, or save", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const editor = fixture({ onChange, onSave });
    editor.switchDocument("note-a", source);
    editor.view.dispatch({ selection: { anchor: source.length } });
    expect(editor.element.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(editor.element.querySelector(".cm-md-table")).not.toBeNull();
    expect(editor.element.querySelector(".cm-aic-security")).not.toBeNull();
    expect(editor.element.querySelector(".cm-mermaid-inline")).not.toBeNull();
    const toggle = button(editor);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.dataset.aicIcon).toBe("source");
    Object.defineProperty(editor.view.scrollDOM, "scrollHeight", {
      configurable: true,
      get: () =>
        editor.element.querySelector(".cm-aic-security") ? 600 : 1200,
    });
    Object.defineProperty(editor.view.scrollDOM, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    editor.view.scrollDOM.scrollTop = 200;

    toggle.click();
    expect(toggle.getAttribute("aria-label")).toBe("Show preview");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.dataset.aicIcon).toBe("diagram");
    expect(editor.value).toBe(source);
    expect(editor.view.state.selection.main.head).toBe(source.length);
    expect(editor.view.scrollDOM.scrollTop).toBe(500);
    expect(editor.element.querySelector(".cm-aic-properties")).toBeNull();
    expect(editor.element.querySelector(".cm-md-table")).toBeNull();
    expect(editor.element.querySelector(".cm-aic-security")).toBeNull();
    expect(editor.element.querySelector(".cm-mermaid-inline")).toBeNull();
    expect(editor.view.state.facet(EditorView.atomicRanges)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    editor.view.dispatch({ changes: { from: source.length, insert: "!" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    toggle.click();
    expect(toggle.getAttribute("aria-label")).toBe("Show Markdown source");
    expect(editor.value).toBe(source + "!");
    expect(editor.view.scrollDOM.scrollTop).toBe(200);
    expect(undo(editor.view)).toBe(true);
    expect(editor.value).toBe(source);
    expect(onSave).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("retains mode on same-note updates and resets on a different identity", () => {
    const editor = fixture();
    editor.switchDocument("note-a", source);
    const toggle = button(editor);
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(editor.switchDocument("note-a", source)).toBe(false);
    expect(editor.updateDocument(source + "\nRemote")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(editor.element.querySelector(".cm-aic-properties")).toBeNull();
    expect(editor.switchDocument("note-b", source)).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(editor.element.querySelector(".cm-aic-properties")).not.toBeNull();
    editor.destroy();
  });

  it("lets a read-only reader inspect source without enabling edit controls", () => {
    const editor = fixture({ readOnly: true });
    const toggle = button(editor);
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(editor.view.state.readOnly).toBe(true);
    expect(editor.view.contentDOM.getAttribute("contenteditable")).toBe(
      "false",
    );
    expect(editor.setReadOnly(false)).toBe(true);
    expect(editor.setReadOnly(true)).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(editor.view.state.readOnly).toBe(true);
    editor.destroy();
  });
});

describe("per-block source Escape", () => {
  const cases = [
    {
      name: "code",
      text: "Before\n\n```ts\nconst answer = 42;\n```\n\nAfter",
      edit: '[aria-label="Edit code source"]',
      preview: ".cm-md-code-preview",
    },
    {
      name: "table",
      text: "Before\n\n| A | B |\n| --- | --- |\n| x | y |\n\nAfter",
      edit: '[aria-label="Edit table source"]',
      preview: ".cm-md-table",
    },
    {
      name: "details",
      text: "Before\n\n>>> Detail\nbody\n<<<\n\nAfter",
      edit: '[aria-label="Edit details source"]',
      preview: ".cm-aic-details-summary",
    },
    {
      name: "Mermaid",
      text: "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter",
      edit: '[aria-label="Edit Mermaid source"]',
      preview: ".cm-mermaid-inline",
    },
    {
      name: "security",
      text: "Before\n\n```aic\n# Synthetic card\n## Accounts\nPassword *| synthetic-hidden-secret | note\n---\n## Other\nAccount | visible-account\n```\n\nAfter",
      edit: '[aria-label="Edit security block"]',
      preview: ".cm-aic-security",
    },
    {
      name: "properties",
      text: "---\nfile: example.note.md\nstatus: idea\n---\n\nAfter",
      edit: '[aria-label="Edit properties"]',
      preview: ".cm-aic-properties",
    },
  ];

  for (const { name, text, edit, preview } of cases) {
    it(`restores ${name} preview with an unchanged document`, () => {
      const onChange = vi.fn();
      const onSave = vi.fn();
      const editor = fixture({ initialText: text, onChange, onSave });
      editor.view.dispatch({ selection: { anchor: text.length } });
      const editButton = editor.element.querySelector<HTMLButtonElement>(edit);
      expect(editButton).not.toBeNull();
      editButton!.click();
      expect(editor.element.querySelector(preview)).toBeNull();
      expect(escape(editor.view).defaultPrevented).toBe(true);
      expect(editor.element.querySelector(preview)).not.toBeNull();
      expect(editor.view.state.selection.main.head).toBeGreaterThan(0);
      expect(editor.value).toBe(text);
      expect(onChange).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect(undoDepth(editor.view.state)).toBe(0);
      editor.destroy();
    });
  }

  it("leaves Escape to an active child control", () => {
    const text = "Before\n\n```ts\nconst answer = 42;\n```\n\nAfter";
    const editor = fixture({ initialText: text });
    editor.view.dispatch({ selection: { anchor: text.length } });
    editor.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit code source"]')!
      .click();
    const input = document.createElement("input");
    editor.view.dom.append(input);
    expect(escape(editor.view, input).defaultPrevented).toBe(false);
    expect(editor.element.querySelector(".cm-md-code-preview")).toBeNull();
    expect(editor.value).toBe(text);
    editor.destroy();
  });
});

function securityFixture() {
  let resolveRead: (value: string) => void = () => {};
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
  );
  const copy = vi.fn(() => true);
  const change = vi.fn();
  const save = vi.fn();
  const mode = createSourceModeController();
  const host = document.createElement("div");
  document.body.append(host);
  const body = serializeSecurityBlock({
    title: "Synthetic card",
    sections: [
      {
        label: "Accounts",
        fields: [
          { label: "Password", parts: [{ value: "", kind: "secret" }] },
          {
            label: "Secret",
            parts: [{ value: "synthetic-hidden-secret", kind: "secret" }],
          },
          {
            label: "Account",
            parts: [{ value: "visible-account", kind: "text" }],
          },
        ],
      },
    ],
  });
  const text = `\`\`\`aic\n${body}\n\`\`\`\n\n${"prose\n"}`;
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        mode.extension([
          makeSecurityBlockExtension({
            document,
            onReadClipboard: read,
            onCopy: copy,
          }),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change();
          if (isSaveAction(update)) save();
        }),
      ],
    }),
  });
  views.push(view);
  return {
    view,
    mode,
    text,
    read,
    copy,
    change,
    save,
    resolveRead: (value: string) => resolveRead(value),
  };
}

describe("source mode stale preview boundaries", () => {
  it("does not copy or refocus through an ordinary code preview removed by source mode", async () => {
    const onCopy = vi.fn(() => true);
    const mode = createSourceModeController();
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```javascript\nconst synthetic = 1;\n```\n\nEnd",
        extensions: [
          aicMarkdownLanguage(),
          mode.extension(makeCodeFenceExtension({ document, onCopy })),
        ],
      }),
    });
    views.push(view);
    const copy = view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Copy code"]',
    )!;
    const edit = view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Edit code source"]',
    )!;
    mode.toggle(view);
    const selection = view.state.selection;
    const focus = vi.spyOn(view, "focus");
    copy.click();
    edit.click();
    await Promise.resolve();
    expect({
      copies: onCopy.mock.calls.length,
      focus: focus.mock.calls.length,
    }).toEqual({ copies: 0, focus: 0 });
    expect(view.state.selection.eq(selection)).toBe(true);
    mode.toggle(view);
    view.dom
      .querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!
      .click();
    expect(onCopy).toHaveBeenCalledOnce();
    // Remounts do not revive the previous callback even if old DOM is reinserted.
    view.dom.append(copy.closest(".cm-md-code-preview")!);
    copy.click();
    edit.click();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });

  it("ignores a late copy acknowledgement for a removed ordinary code preview", async () => {
    let acknowledge: (value: boolean) => void = () => {};
    const onCopy = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const mode = createSourceModeController();
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```javascript\nconst synthetic = 1;\n```",
        extensions: [
          aicMarkdownLanguage(),
          mode.extension(makeCodeFenceExtension({ document, onCopy })),
        ],
      }),
    });
    views.push(view);
    const copy = view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Copy code"]',
    )!;
    copy.click();
    expect(onCopy).toHaveBeenCalledOnce();
    mode.toggle(view);
    acknowledge(true);
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(copy.getAttribute("aria-label")).toBe("Copy code");
  });

  it("does not navigate through retired Properties relationship controls", () => {
    const onOpen = vi.fn();
    const mode = createSourceModeController();
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "---\nfile: synthetic.note.md\n---\nBody",
        extensions: [
          aicMarkdownLanguage(),
          mode.extension(
            makePropertiesBlockExtension({
              document,
              onRelationshipOpen: onOpen,
              initialRelationships: () => [
                { relation: "parent", label: "Parent", path: "parent.note.md" },
              ],
            }),
          ),
        ],
      }),
    });
    views.push(view);
    const old = view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Open parent note Parent"]',
    )!;
    expect(old).not.toBeNull();
    mode.toggle(view);
    old.click();
    mode.toggle(view);
    old.click();
    expect(onOpen).not.toHaveBeenCalled();
    view.dom
      .querySelector<HTMLButtonElement>(
        '[aria-label="Open parent note Parent"]',
      )!
      .click();
    expect(onOpen).toHaveBeenCalledWith("parent.note.md");
  });

  it("cancels pending secret paste and detached copy/actions across both toggles", async () => {
    const { view, mode, text, read, copy, change, save, resolveRead } =
      securityFixture();
    const original = view.state.doc;
    const oldCard = view.dom.querySelector<HTMLElement>(".cm-aic-security")!;
    const paste = oldCard.querySelector<HTMLButtonElement>(
      '[aria-label="Paste Password"]',
    )!;
    const secret = oldCard.querySelector<HTMLButtonElement>(
      '[aria-label="Copy Secret value"]',
    )!;
    expect(oldCard.outerHTML).not.toContain("synthetic-hidden-secret");
    paste.click();
    expect(read).toHaveBeenCalledOnce();
    mode.toggle(view);
    expect(oldCard.isConnected).toBe(false);
    expect(view.dom.querySelector(".cm-aic-security-panel")).toBeNull();
    // The plaintext is permitted only because raw mode was explicitly chosen.
    expect(view.contentDOM.textContent).toContain("synthetic-hidden-secret");
    secret.click();
    paste.click();
    expect(copy).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    mode.toggle(view);
    resolveRead("late-synthetic-secret");
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(view.dom.querySelector(".cm-aic-security")!.outerHTML).not.toContain(
      "synthetic-hidden-secret",
    );
    expect(view.contentDOM.textContent).not.toContain(
      "synthetic-hidden-secret",
    );
    expect(view.state.doc).toBe(original);
    expect(view.state.doc.toString()).toBe(text);
    expect(change).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(undoDepth(view.state)).toBe(0);
    // The disposed lifetime is never revived by an identical preview remount.
    secret.click();
    expect(copy).not.toHaveBeenCalled();
    view.dom
      .querySelector<HTMLButtonElement>('[aria-label="Copy Secret value"]')!
      .click();
    expect(copy).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith("synthetic-hidden-secret", "Secret");
  });

  it("cancels an active reorder and detached keyboard movement when previews disappear", async () => {
    const { view, mode, text, change, save } = securityFixture();
    const handle = view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Reorder Password"]',
    )!;
    expect(handle).not.toBeNull();
    const pointer = (type: string, target: EventTarget, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 7 });
      target.dispatchEvent(event);
    };
    pointer("pointerdown", handle, 10);
    mode.toggle(view);
    pointer("pointermove", document, 80);
    pointer("pointerup", document, 80);
    handle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    mode.toggle(view);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(text);
    expect(change).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(
      view.dom.querySelector(
        ".cm-aic-security-drop-before, .cm-aic-security-drop-after",
      ),
    ).toBeNull();
    expect(undoDepth(view.state)).toBe(0);
  });
});
