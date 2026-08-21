import { describe, expect, it, vi } from "vitest";
import { AicEditor } from "../src/editor";
import { parseDetailsBlocks, toggleDetailsMarker } from "../src/details-model";

describe("AIC details grammar", () => {
  it("parses exact open/closed markers and linked summary data", () => {
    const source =
      ">>>|open| - [ ] [Source](src/app.ts#L2-L4)\ncomment\n<<<\n\n>>> Closed\nbody\n<<<\n";
    const blocks = parseDetailsBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      open: true,
      summary: {
        checked: false,
        label: "Source",
        href: "src/app.ts#L2-L4",
      },
    });
    expect(blocks[1]).toMatchObject({ open: false, title: "Closed" });
    expect(toggleDetailsMarker(">>>|open| Title")).toBe(">>> Title");
    expect(toggleDetailsMarker(">>> Title")).toBe(">>>|open| Title");
  });

  it("ignores terminators inside fences and keeps invalid nesting visible", () => {
    const fenced = ">>> Title\n```text\n<<<\n```\nbody\n<<<\n";
    expect(parseDetailsBlocks(fenced)[0]).toMatchObject({
      contentTo: fenced.lastIndexOf("<<<"),
    });
    for (const invalid of [
      ">>> Outer\n>>> Inner\nbody\n<<<\n<<<\n",
      ">>> Missing\nbody\n",
      "text >>> Inline\nbody\n<<<\n",
    ]) {
      expect(parseDetailsBlocks(invalid)).toEqual([]);
    }
  });
});

describe("AIC details interaction", () => {
  it("toggles from title/SVG, keeps linked controls separate, and edits source explicitly", () => {
    const source =
      ">>> - [ ] [Source](src/app.ts#L2-L4)\ncomment\n<<<\n\nafter";
    const changed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, {
      initialText: source,
      onChange: changed,
    });
    editor.view.dispatch({ selection: { anchor: source.length } });

    let summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    expect(summary.dataset.open).toBe("false");
    expect(summary.querySelector("svg")).not.toBeNull();
    expect(summary.textContent).not.toMatch(/[▸▾]/u);
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-title")!.click();
    expect(editor.value).toContain(">>>|open| - [ ] [Source]");

    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-check")!.click();
    expect(editor.value).toContain(">>>|open| - [x] [Source]");
    expect(editor.element.querySelector(".cm-aic-details-body")).not.toBeNull();

    const beforeEdit = editor.value;
    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-md-edit-source")!.click();
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    expect(editor.value).toBe(beforeEdit);
    editor.view.dispatch({ selection: { anchor: editor.value.length } });
    expect(
      editor.element.querySelector(".cm-aic-details-summary"),
    ).not.toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    editor.destroy();
  });

  it("keeps read-only disclosure ephemeral while allowing source inspection", () => {
    const source = ">>> Locked\nbody\n<<<\n\nafter";
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new AicEditor(host, { initialText: source, readOnly: true });
    editor.view.dispatch({ selection: { anchor: source.length } });
    let summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    summary.querySelector<HTMLButtonElement>(".cm-aic-details-title")!.click();
    expect(editor.value).toBe(source);
    summary = editor.element.querySelector<HTMLElement>(
      ".cm-aic-details-summary",
    )!;
    expect(summary.dataset.open).toBe("true");
    summary.querySelector<HTMLButtonElement>(".cm-md-edit-source")!.click();
    expect(editor.element.querySelector(".cm-aic-details-summary")).toBeNull();
    expect(editor.value).toBe(source);
    editor.destroy();
  });
});
