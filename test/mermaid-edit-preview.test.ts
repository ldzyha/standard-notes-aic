import { afterEach, describe, expect, it, vi } from "vitest";
import { AicEditor } from "../src/editor";
import { renderMermaidSvg } from "../src/core/mermaid-runtime.js";

const editors: AicEditor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("Mermaid source and preview", () => {
  it.each([
    [
      "plain",
      'A["This label has many words and must wrap into readable lines instead of widening the diagram"]',
    ],
    [
      "Markdown",
      'A["`This **important label** has many words and must wrap into readable lines`"]',
    ],
    [
      "Ukrainian",
      'A["Це довгий український підпис вузла який повинен переноситися на декілька рядків"]',
    ],
    [
      "unbroken identifier",
      'A["a_very_long_identifier_without_spaces_that_should_still_fit_in_the_node"]',
    ],
  ])(
    "wraps a long %s label with the actual pinned renderer",
    async (_kind, nodeSource) => {
      const markup = await renderMermaidSvg(document, {
        source: `flowchart TB\n ${nodeSource} --> B["End"]`,
      });
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      const label = holder.querySelector("g.node .label");
      expect(label).not.toBeNull();
      expect(
        label!.querySelectorAll("tspan.text-outer-tspan").length,
      ).toBeGreaterThan(1);
      expect(holder.querySelector("foreignObject")).toBeNull();
    },
    15_000,
  );

  it("keeps a flowchart visible while editing, with one Edit action and automatic sizing", async () => {
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
    expect(preview.querySelector('[data-aic-icon="zoom-in"]')).toBeNull();
    expect(preview.querySelector('[data-aic-icon="zoom-out"]')).toBeNull();
    expect(preview.querySelector('[data-aic-icon="reset"]')).toBeNull();
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
    expect(
      editor.element.querySelector(
        ".cm-mermaid-editing .cm-aic-mermaid-controls",
      ),
    ).toBeNull();
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
