import { afterEach, describe, expect, it, vi } from "vitest";
import { AicEditor } from "../src/editor";

const editors: AicEditor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("Mermaid source and preview", () => {
  it("keeps a flowchart visible while editing, with one Edit action and preview-only zoom", async () => {
    // Windows CI can take longer than Vitest's 1 s default to import Mermaid.
    const renderWait = { timeout: 10_000 };
    const source =
      '# Diagram\n\n```mermaid\nflowchart LR\n A["Start"] --> B["Finish"]\n```\n\nEnd';
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source });
    editors.push(editor);
    editor.switchDocument("flowchart", source);
    await vi.waitFor(
      () =>
        expect(
          editor.element.querySelector(".cm-mermaid-inline svg"),
        ).not.toBeNull(),
      renderWait,
    );
    const preview =
      editor.element.querySelector<HTMLElement>(".cm-mermaid-inline")!;
    expect(preview.querySelectorAll(".cm-mermaid-edit")).toHaveLength(1);
    expect(preview.querySelectorAll(".cm-mermaid-copy")).toHaveLength(1);
    expect(preview.querySelectorAll('[data-aic-icon="zoom-in"]')).toHaveLength(
      1,
    );
    expect(preview.querySelector('[data-aic-icon="rotate"]')).toBeNull();
    expect(editor.element.querySelector(".aic-diagram-builder")).toBeNull();

    preview.querySelector<HTMLButtonElement>(".cm-mermaid-edit")!.click();
    await vi.waitFor(
      () =>
        expect(
          editor.element.querySelector(".cm-mermaid-editing svg"),
        ).not.toBeNull(),
      renderWait,
    );
    expect(
      editor.element.querySelector(".cm-mermaid-editing .cm-mermaid-edit"),
    ).toBeNull();
    const at = editor.value.indexOf("Start");
    editor.view.dispatch({
      changes: { from: at, to: at + 5, insert: "Draft" },
    });
    await vi.waitFor(
      () =>
        expect(
          editor.element.querySelector(".cm-mermaid-editing svg")?.textContent,
        ).toContain("Draft"),
      renderWait,
    );
    expect(editor.value).toContain('A["Draft"]');
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    await vi.waitFor(
      () =>
        expect(
          editor.element.querySelector(
            ".cm-mermaid-inline:not(.cm-mermaid-editing) svg",
          )?.textContent,
        ).toContain("Draft"),
      renderWait,
    );
  }, 45_000);
});
