import { afterEach, describe, expect, it, vi } from "vitest";
// Session tests exercise document transactions and widget ownership, not layout.
// Real Mermaid rendering remains covered by mermaid.test and production browser tests.
vi.mock("../src/core/mermaid-runtime.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/mermaid-runtime.js")>();
  const { renderDiagramFixture } = await import("./diagram-svg-fixture");
  return {
    ...actual,
    renderMermaidSvg: (_document: Document, options: { source: string }) =>
      renderDiagramFixture(options.source),
  };
});
import { AicEditor } from "../src/editor";
import { undo, undoDepth } from "@codemirror/commands";
import {
  closeDiagramEditor,
  openDiagramEditor,
} from "../src/core/diagram-session.js";

const editors: AicEditor[] = [];
const diagram = 'flowchart LR\n  A["Start"] --> B["Finish"]\n';
const source = `before\n\n\`\`\`mermaid\n${diagram}\`\`\`\n\nafter`;
function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new AicEditor(host, { initialText: source });
  editors.push(editor);
  const from = source.indexOf(diagram);
  return { editor, range: { from, to: from + diagram.length } };
}
function open(editor: AicEditor, range: { from: number; to: number }) {
  let container =
    editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline");
  if (!container) {
    container = document.createElement("div");
    editor.view.dom.append(container);
  }
  return openDiagramEditor(editor.view, range, { container });
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("shared diagram session", () => {
  it("applies only the source range, preserves surrounding Markdown, and closes", () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    session.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
      .click();
    const input = session.element.querySelector<HTMLTextAreaElement>(
      '[aria-label="Mermaid diagram source"]',
    )!;
    input.value = diagram.replace("Start", "Changed");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(session.apply()).toBe(true);
    expect(editor.value).toBe(source.replace("Start", "Changed"));
    expect(session.element.isConnected).toBe(false);
    expect(undoDepth(editor.view.state)).toBe(1);
    undo(editor.view);
    expect(editor.value).toBe(source);
  });

  it("does not dirty an unchanged Apply or a cancelled edit", () => {
    const { editor, range } = fixture();
    const original = editor.view.state.doc;
    const session = open(editor, range)!;
    expect(session.apply()).toBe(true);
    expect(editor.view.state.doc).toBe(original);
    open(editor, range)!.close();
    expect(editor.view.state.doc).toBe(original);
  });

  it("maps outside changes without dropping or replacing the inline draft", async () => {
    const { editor, range } = fixture();
    const old = open(editor, range)!;
    editor.view.dispatch({ changes: { from: 0, insert: "new " } });
    await vi.waitFor(() => expect(old.element.isConnected).toBe(true));
    expect(old.apply()).toBe(true);
    expect(editor.value).toBe("new " + source);
  });

  it("retires an old session on document identity switch, even with equal text", () => {
    const { editor, range } = fixture();
    editor.switchDocument("A", source);
    const sameText = open(editor, range)!;
    editor.switchDocument("B", source);
    expect(sameText.element.isConnected).toBe(false);
    expect(sameText.apply()).toBe(false);
    expect(sameText.getSource()).toBe(diagram);
  });

  it("retains a readonly draft for copying without allowing Apply", async () => {
    const { editor, range } = fixture();
    const locked = open(editor, range)!;
    editor.setReadOnly(true);
    await vi.waitFor(() => expect(locked.element.isConnected).toBe(true));
    expect(locked.apply()).toBe(false);
    expect(locked.getSource()).toBe(diagram);
    expect(
      locked.element.querySelector(".cm-aic-diagram-stale-notice")?.textContent,
    ).toContain("read-only");
    expect(open(editor, range)).toBeNull();
  });

  it("keeps a changed target draft recoverable instead of overwriting external text", async () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    const changedAt = source.indexOf("Start");
    editor.view.dispatch({
      changes: { from: changedAt, to: changedAt + 5, insert: "External" },
    });
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    expect(session.apply()).toBe(false);
    expect(session.getSource()).toBe(diagram);
    expect(
      session.element.querySelector<HTMLButtonElement>(".aic-db-apply")
        ?.disabled,
    ).toBe(true);
    expect(
      session.element.querySelector(
        '[aria-label="Copy retained diagram draft"]',
      ),
    ).not.toBeNull();
    expect(editor.value).toBe(source.replace("Start", "External"));
  });

  it("reattaches the same builder when selection reveals the source widget", async () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    const builder = session.element.querySelector(".aic-diagram-builder");
    editor.view.dispatch({ selection: { anchor: range.from } });
    await vi.waitFor(() =>
      expect(
        session.element.parentElement?.classList.contains(
          "cm-aic-diagram-source-actions",
        ),
      ).toBe(true),
    );
    expect(session.element.querySelector(".aic-diagram-builder")).toBe(builder);
    expect(session.getSource()).toBe(diagram);
  });

  it("retains a removed block's draft in a non-modal recovery region", async () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    editor.view.dispatch({
      changes: {
        from: 0,
        to: editor.value.length,
        insert: "Replacement prose",
      },
    });
    await vi.waitFor(() =>
      expect(
        session.element.parentElement?.classList.contains(
          "cm-aic-diagram-recovery",
        ),
      ).toBe(true),
    );
    expect(session.apply()).toBe(false);
    expect(session.getSource()).toBe(diagram);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("routes Ctrl+S through Apply before forwarding the host save key", () => {
    const { editor, range } = fixture();
    const save = vi.fn();
    editor.view.contentDOM.addEventListener("keydown", save);
    const session = open(editor, range)!;
    session.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(session.element.isConnected).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retains an invalid inspector draft on Ctrl+S without saving old source", async () => {
    const { editor } = fixture();
    const text = "classDiagram\n class A {\n +name: string\n }";
    editor.switchDocument("class", text);
    const save = vi.fn();
    editor.view.contentDOM.addEventListener("keydown", save);
    const session = open(editor, {
      from: 0,
      to: text.length,
    })!;
    await vi.waitFor(() =>
      expect(
        session.element.querySelector<HTMLElement>('[data-node-id="A"]'),
      ).not.toBeNull(),
    );
    session.element
      .querySelector<HTMLElement>('[data-node-id="A"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = session.element.querySelector<HTMLTextAreaElement>(
      ".aic-db-inspector textarea",
    )!;
    input.value = "+make(): {x: string}";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(session.element.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("+make(): {x: string}");
    expect(editor.value).toBe(text);
    expect(save).not.toHaveBeenCalled();
  });

  it("edits inside the existing preview, with no dialog or body portal", () => {
    const { editor, range } = fixture();
    const container =
      editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline")!;
    const previousChildren = [...container.children];
    const selection = editor.view.state.selection;
    const session = openDiagramEditor(editor.view, range, { container })!;
    expect(session.element.parentElement).toBe(container);
    expect(container.classList.contains("cm-aic-diagram-inline-active")).toBe(
      true,
    );
    expect(document.querySelector("dialog")).toBeNull();
    expect(editor.view.state.selection.eq(selection)).toBe(true);
    session.close();
    expect([...container.children]).toEqual(previousChildren);
    expect(container.classList.contains("cm-aic-diagram-inline-active")).toBe(
      false,
    );
  });

  it("requires an existing in-editor host and never falls back to a dialog", () => {
    const { editor, range } = fixture();
    expect(
      openDiagramEditor(editor.view, range, { container: document.body }),
    ).toBeNull();
    expect(
      openDiagramEditor(editor.view, range, {
        container: document.createElement("div"),
      }),
    ).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("temporarily hides a matching raw live preview and restores its prior state", () => {
    const { editor, range } = fixture();
    const container =
      editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline")!;
    const live = document.createElement("div");
    editor.view.dom.append(live);
    const session = openDiagramEditor(editor.view, range, {
      container,
      hideElements: [live],
    })!;
    expect(live.hidden).toBe(true);
    session.close();
    expect(live.hidden).toBe(false);
    live.hidden = true;
    openDiagramEditor(editor.view, range, {
      container,
      hideElements: [live],
    })!.close();
    expect(live.hidden).toBe(true);
  });

  it("ends the draft when the owner widget is destroyed", () => {
    const { editor, range } = fixture();
    const container =
      editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline")!;
    const session = openDiagramEditor(editor.view, range, { container })!;
    closeDiagramEditor(editor.view, container);
    expect(session.element.isConnected).toBe(false);
    expect(session.apply()).toBe(false);
  });

  it("cancels inline with Escape and does not write", () => {
    const { editor, range } = fixture();
    const original = editor.view.state.doc;
    const session = open(editor, range)!;
    session.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(session.element.isConnected).toBe(false);
    expect(editor.view.state.doc).toBe(original);
  });

  it("lets the source textarea consume Escape then Tab without closing the session", () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    session.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
      .click();
    const input = session.element.querySelector<HTMLTextAreaElement>(
      '[aria-label="Mermaid diagram source"]',
    )!;
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(session.element.isConnected).toBe(true);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(session.element.isConnected).toBe(true);
  });

  it("lets Escape cancel a connection before the inline session", async () => {
    const { editor, range } = fixture();
    const session = open(editor, range)!;
    await vi.waitFor(() =>
      expect(
        session.element.querySelector('[data-port-id="A"]'),
      ).not.toBeNull(),
    );
    const port = session.element.querySelector('[data-port-id="A"]')!;
    port.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    port.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(session.element.isConnected).toBe(true);
    expect(session.getSource()).toBe(diagram);
  });

  it("routes copying the current and retained draft through the host clipboard", async () => {
    const { editor, range } = fixture();
    const container =
      editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline")!;
    const onCopy = vi.fn(() => true);
    const session = openDiagramEditor(editor.view, range, {
      container,
      onCopy,
    })!;
    session.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
      .click();
    const input = session.element.querySelector<HTMLTextAreaElement>(
      '[aria-label="Mermaid diagram source"]',
    )!;
    const draft = diagram.replace("Start", "Draft");
    input.value = draft;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    session.element
      .querySelector<HTMLButtonElement>('[aria-label="Copy Mermaid source"]')!
      .click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenLastCalledWith(draft));
    expect(editor.value).toBe(source);
    const changedAt = source.indexOf("Start");
    editor.view.dispatch({
      changes: { from: changedAt, to: changedAt + 5, insert: "External" },
    });
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    session.element
      .querySelector<HTMLButtonElement>(
        '[aria-label="Copy retained diagram draft"]',
      )!
      .click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledTimes(2));
    expect(onCopy).toHaveBeenLastCalledWith(draft);
    expect(editor.value).toBe(source.replace("Start", "External"));
  });
});
