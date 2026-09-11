import { snippet } from "@codemirror/autocomplete";
import { afterEach, describe, expect, it } from "vitest";
import { AicEditor } from "../src/editor";
import { DOCUMENTATION_SNIPPETS } from "../src/core/slash-snippets.js";

const editors: AicEditor[] = [];
const diagram = "sequenceDiagram\n  participant A as Actor\n  A->>A: Think\n";
const source = `before\n\n\`\`\`mermaid\n${diagram}\`\`\`\n\nafter`;

function fixture(text = source) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new AicEditor(host, { initialText: text });
  editors.push(editor);
  return editor;
}

function sourceButton(editor: AicEditor) {
  return editor.element.querySelector<HTMLButtonElement>(
    '.cm-aic-diagram-source-actions [aria-label="Edit diagram visually"]',
  );
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("diagram actions while editing Mermaid source", () => {
  it("shows a shared non-replacing action row without changing caret or source", () => {
    const editor = fixture();
    const anchor = source.indexOf("Actor") + 2;
    editor.view.dispatch({ selection: { anchor } });
    expect(sourceButton(editor)).not.toBeNull();
    expect(editor.element.querySelector(".cm-mermaid-inline")).toBeNull();
    expect(editor.view.contentDOM.textContent).toContain("```mermaid");
    expect(editor.view.contentDOM.textContent).toContain("Sequence · source");
    expect(editor.view.state.selection.main.anchor).toBe(anchor);
    expect(editor.value).toBe(source);
    sourceButton(editor)!.click();
    expect(
      document.querySelector('[aria-label="Diagram editor"]'),
    ).not.toBeNull();
    expect(editor.view.state.selection.main.anchor).toBe(anchor);
    expect(editor.value).toBe(source);
  });

  it.each(["sequence", "class-diagram"])(
    "keeps visual editing available immediately after the /%s snippet",
    (command) => {
      const entry = DOCUMENTATION_SNIPPETS.find(
        (item) => item.command === command,
      )!;
      const editor = fixture("");
      snippet(entry.template)(editor.view, null, 0, 0);
      const selected = editor.view.state.selection.main;
      expect(selected.empty).toBe(false);
      expect(sourceButton(editor)).not.toBeNull();
      const selection = editor.view.state.selection;
      sourceButton(editor)!.click();
      expect(
        document.querySelector('[aria-label="Diagram editor"]'),
      ).not.toBeNull();
      expect(editor.view.state.selection).toBe(selection);
    },
  );

  it("leaves the opening fence selectable while source actions are visible", () => {
    const editor = fixture();
    const anchor = source.indexOf("```mermaid");
    const head = anchor + "```mermaid".length;
    editor.view.dispatch({ selection: { anchor, head } });
    expect(sourceButton(editor)).not.toBeNull();
    expect(editor.view.state.sliceDoc(anchor, head)).toBe("```mermaid");
    editor.view.dispatch({ changes: { from: head, insert: " " } });
    expect(editor.value).toContain("```mermaid \n");
  });

  it("closes a source-opened builder when the document identity changes", () => {
    const editor = fixture();
    editor.switchDocument("A", source);
    editor.view.dispatch({ selection: { anchor: source.indexOf("Actor") } });
    const detachedButton = sourceButton(editor)!;
    detachedButton.click();
    expect(
      document.querySelector('[aria-label="Diagram editor"]'),
    ).not.toBeNull();
    editor.switchDocument("B", source);
    expect(document.querySelector('[aria-label="Diagram editor"]')).toBeNull();
    detachedButton.click();
    expect(document.querySelector('[aria-label="Diagram editor"]')).toBeNull();
    expect(editor.value).toBe(source);
  });

  it("rebuilds disabled source controls when locking and restores them when unlocked", () => {
    const editor = fixture();
    editor.view.dispatch({ selection: { anchor: source.indexOf("Actor") } });
    expect(sourceButton(editor)?.disabled).toBe(false);
    editor.setReadOnly(true);
    expect(sourceButton(editor)?.disabled).toBe(true);
    sourceButton(editor)!.click();
    expect(document.querySelector('[aria-label="Diagram editor"]')).toBeNull();
    editor.setReadOnly(false);
    expect(sourceButton(editor)?.disabled).toBe(false);
    sourceButton(editor)!.click();
    expect(
      document.querySelector('[aria-label="Diagram editor"]'),
    ).not.toBeNull();
  });
});
