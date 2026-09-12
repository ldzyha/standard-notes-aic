import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { TaskMarkerWidget, toggleTaskMarker } from "../src/core/task-marker.js";
import {
  detailsForDocument,
  parseDetailsBlocks,
} from "../src/core/details-model.js";
import { codeLanguageFor } from "../src/core/code-languages.js";

describe("shared controls and derived source models", () => {
  it("enforces readonly for pointer, keyboard and direct task commands", () => {
    let state = EditorState.create({
      doc: "- [ ] Task",
      extensions: [EditorState.readOnly.of(true)],
    });
    const dom = document.body.appendChild(document.createElement("div"));
    const dispatch = vi.fn();
    const view = {
      dom,
      get state() {
        return state;
      },
      dispatch,
    };
    const control = new TaskMarkerWidget(2, false, true).toDOM(view as never);
    dom.append(control);
    control.click();
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(toggleTaskMarker(view as never, 2)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.tabIndex).toBe(-1);
    state = EditorState.create({ doc: "- [ ] Task" });
    const editable = new TaskMarkerWidget(2, false, false).toDOM(view as never);
    dom.append(editable);
    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    editable.remove();
    editable.click();
    expect(dispatch).toHaveBeenCalledTimes(1);
    dom.remove();
  });

  it("ignores fenced examples, rejects nested blocks and reuses immutable document parsing", () => {
    expect(
      parseDetailsBlocks(
        "```md\n>>> Example\nbody\n<<<\n```\n>>> Real\nbody\n<<<",
      ).map((block) => block.title),
    ).toEqual(["Real"]);
    expect(parseDetailsBlocks(">>> Outer\n>>> Inner\n<<<")).toEqual([]);
    expect(parseDetailsBlocks(">>> Unclosed\n".repeat(20_000))).toEqual([]);
    const state = EditorState.create({ doc: ">>> Title\nbody\n<<<" });
    const parsed = detailsForDocument(state.doc);
    const selected = state.update({ selection: { anchor: 5 } }).state;
    expect(detailsForDocument(selected.doc)).toBe(parsed);
    expect(
      detailsForDocument(
        state.update({ changes: { from: 4, insert: "New " } }).state.doc,
      ),
    ).not.toBe(parsed);
  });

  it("resolves the same fenced-language aliases for both adapters", async () => {
    for (const alias of [
      "mjs",
      "cjs",
      "mts",
      "cts",
      "scss",
      "sass",
      "jsonc",
      "xml",
      "tsx",
    ]) {
      const language = codeLanguageFor(alias);
      expect(language, alias).toBeDefined();
      expect((await language!.load()).language.parser).toBeDefined();
    }
    expect(codeLanguageFor("mermaid")).toBeUndefined();
    expect(codeLanguageFor("constructor")).toBeUndefined();
    expect(codeLanguageFor("JS meta")).toBe(codeLanguageFor("javascript"));
  });
});
