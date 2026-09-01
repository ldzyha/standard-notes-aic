import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { aicMarkdownLanguage } from "../src/language";

describe("AIC Markdown language", () => {
  it("recognizes the mapped GFM structures", () => {
    const state = EditorState.create({
      doc: "- [ ] task\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```ts\nconst x = 1\n```",
      extensions: [aicMarkdownLanguage()],
    });
    const names = new Set<string>();
    const tree = ensureSyntaxTree(state, state.doc.length, 1000);
    expect(tree).not.toBeNull();
    tree!.iterate({
      enter(node) {
        names.add(node.name);
      },
    });
    expect(names).toContain("TaskMarker");
    expect(names).toContain("Table");
    expect(names).toContain("FencedCode");
  });
});
