import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  aicKeymap,
  continueList,
  insertMermaid,
  insertProperties,
  setBlockKind,
  toggleBold,
  toggleList,
} from "../src/commands";

function editor(
  source: string,
  selection: { anchor: number; head?: number } = { anchor: 0 },
  readOnly = false,
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      selection,
      extensions: [EditorState.readOnly.of(readOnly)],
    }),
  });
}

afterEach(() => document.body.replaceChildren());

describe("AIC Markdown commands", () => {
  it("wraps and unwraps the selected source", () => {
    const view = editor("word", { anchor: 0, head: 4 });
    expect(toggleBold(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("**word**");
    expect(toggleBold(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("word");
    view.destroy();
  });

  it("formats the word under an empty selection", () => {
    const view = editor("one two three", { anchor: 5 });
    toggleBold(view);
    expect(view.state.doc.toString()).toBe("one **two** three");
    view.destroy();
  });

  it("changes headings and quotes without duplicating markers", () => {
    const view = editor("## title", { anchor: 4 });
    setBlockKind(view, 3);
    expect(view.state.doc.toString()).toBe("### title");
    setBlockKind(view, "quote");
    expect(view.state.doc.toString()).toBe("> title");
    setBlockKind(view, "paragraph");
    expect(view.state.doc.toString()).toBe("title");
    view.destroy();
  });

  it("toggles task lists across selected lines", () => {
    const source = "alpha\nbeta";
    const view = editor(source, { anchor: 0, head: source.length });
    toggleList(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] alpha\n- [ ] beta");
    toggleList(view, "task");
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it("continues and renumbers ordered lists", () => {
    const view = editor("1. one\n9. two", { anchor: 6 });
    expect(continueList(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. one\n2. \n3. two");
    view.destroy();
  });

  it("exits an empty list item", () => {
    const view = editor("- ", { anchor: 2 });
    expect(continueList(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("leaves raw Space unbound so it can complete task syntax", () => {
    expect(aicKeymap.some(({ key }) => key === " ")).toBe(false);
  });

  it("inserts one leading properties block and then reveals it", () => {
    const view = editor("Body", { anchor: 4 });
    expect(insertProperties(view)).toBe(true);
    const inserted = view.state.doc.toString();
    expect(inserted).toBe("---\nstatus: idea\ntags: \n---\n\nBody");
    expect(insertProperties(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(inserted);
    expect(view.state.selection.main.head).toBe(4);
    view.destroy();
  });

  it("preserves selected text when inserting a robust Mermaid fence", () => {
    const source = "flowchart LR\n  A --> B\n  ```";
    const view = editor(source, { anchor: 0, head: source.length });
    expect(insertMermaid(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "````mermaid\nflowchart LR\n  A --> B\n  ```\n````",
    );
    view.destroy();
  });

  it("does not mutate a read-only note", () => {
    const view = editor("word", { anchor: 0, head: 4 }, true);
    expect(toggleBold(view)).toBe(false);
    expect(insertProperties(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("word");
    view.destroy();
  });
});
