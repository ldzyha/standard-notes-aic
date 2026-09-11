import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GFM, parser } from "@lezer/markdown";
import { afterEach, describe, expect, it } from "vitest";
import {
  formattingChanges,
  formattingShortcut,
  markdownFormatting,
  parseListLine,
  setBlockKind,
  toggleHeading,
  toggleList,
  type ListKind,
} from "../src/core/formatting.js";
import { AicEditor } from "../src/editor";

function listDepths(source: string) {
  const result: Record<string, number> = {};
  parser
    .configure(GFM)
    .parse(source)
    .iterate({
      enter(node) {
        if (node.name !== "ListItem") return;
        let depth = 0;
        for (let parent = node.node.parent; parent; parent = parent.parent)
          if (parent.name === "ListItem") depth++;
        const label = source
          .slice(node.node.getChild("ListMark")?.from ?? node.from, node.to)
          .split("\n")[0]!
          .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, "");
        result[label] = depth;
      },
    });
  return result;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
});

function editor(source: string, readOnly = false) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: source,
      selection: { anchor: 0, head: source.length },
      extensions: [
        markdown(),
        history(),
        markdownFormatting(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  cleanups.push(() => view.destroy());
  return view;
}

function press(
  view: EditorView,
  code: string,
  modifiers: Partial<KeyboardEventInit> = {},
) {
  view.focus();
  const event = new KeyboardEvent("keydown", {
    code,
    key: code.replace("Digit", ""),
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("shared block formatting", () => {
  it.each([
    ["bullet", "- "],
    ["ordered", "1. "],
    ["task", "- [ ] "],
  ] as const)("starts and removes %s on an empty line", (kind, prefix) => {
    const view = editor("");
    expect(toggleList(view, kind)).toBe(true);
    expect(view.state.doc.toString()).toBe(prefix);
    expect(view.state.selection.main.head).toBe(prefix.length);
    expect(toggleList(view, kind)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(view.state.selection.main.head).toBe(0);
  });

  it.each([1, 2, 3, 4, 5, 6] as const)(
    "starts and toggles heading %s without moving the selected content",
    (level) => {
      const view = editor("Title");
      expect(toggleHeading(view, level)).toBe(true);
      expect(view.state.doc.toString()).toBe(`${"#".repeat(level)} Title`);
      expect(
        view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
      ).toBe("Title");
      expect(toggleHeading(view, level)).toBe(true);
      expect(view.state.doc.toString()).toBe("Title");
    },
  );

  it("sets a toolbar block style without toggling an existing identical style", () => {
    const view = editor("## Title");
    setBlockKind(view, 2);
    expect(view.state.doc.toString()).toBe("## Title");
    setBlockKind(view, "quote");
    expect(view.state.doc.toString()).toBe("> Title");
    setBlockKind(view, "paragraph");
    expect(view.state.doc.toString()).toBe("Title");
  });

  it("keeps nested indentation, numbering siblings independently", () => {
    const view = editor("parent\n  child\n  sibling\nnext\n  child again");
    toggleList(view, "ordered");
    expect(view.state.doc.toString()).toBe(
      "1. parent\n  1. child\n  2. sibling\n2. next\n  1. child again",
    );
    toggleList(view, "ordered");
    expect(view.state.doc.toString()).toBe(
      "parent\n  child\n  sibling\nnext\n  child again",
    );
  });

  it.each([
    ["- parent\n  - child\n    - grandchild\n- next", "ordered"],
    ["9. parent\n   7. child\n      1. grandchild\n10. next", "bullet"],
    ["9. parent\n   7. child\n      1. grandchild\n10. next", "task"],
    ["- [x] parent\n  - [ ] child\n    - grandchild\n- next", "ordered"],
  ] as const)(
    "preserves the parsed tree when changing marker widths in %j",
    (source, kind) => {
      const view = editor(source);
      const before = listDepths(source);
      toggleList(view, kind);
      expect(listDepths(view.state.doc.toString())).toEqual(before);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    },
  );

  it.each([
    [
      "- parent\n  - child\n    - grandchild\n- next",
      "ordered",
      "1. parent\n   - child\n     - grandchild\n- next",
    ],
    [
      "12. parent\n    - child\n      - grandchild\n13. next",
      "task",
      "- [ ] parent\n  - child\n    - grandchild\n\n13. next",
    ],
  ] as const)(
    "keeps unselected descendants attached to %j",
    (source, kind, expected) => {
      const view = editor(source);
      view.dispatch({ selection: { anchor: source.indexOf("parent") } });
      toggleList(view, kind);
      expect(view.state.doc.toString()).toBe(expected);
      expect(listDepths(view.state.doc.toString())).toEqual(listDepths(source));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    },
  );

  it("widens descendants beneath multi-digit ordered siblings", () => {
    const source = Array.from(
      { length: 12 },
      (_, index) => `- parent${index + 1}\n  - child${index + 1}`,
    ).join("\n");
    const view = editor(source);
    toggleList(view, "ordered");
    expect(view.state.doc.toString()).toContain("10. parent10\n    1. child10");
    expect(listDepths(view.state.doc.toString())).toEqual(listDepths(source));
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each(["bullet", "task"] as const)(
    "separates an untouched non-1 ordered child under a new %s parent",
    (kind) => {
      const source =
        "3. parent\n   10. child\n       - grandchild\n   10. sibling\n3. next";
      const view = editor(source);
      view.dispatch({ selection: { anchor: source.indexOf("parent") } });
      toggleList(view, kind);
      const marker = kind === "task" ? "- [ ] " : "- ";
      expect(view.state.doc.toString()).toBe(
        marker +
          "parent\n\n  10. child\n      - grandchild\n  10. sibling\n\n3. next",
      );
      expect(listDepths(view.state.doc.toString())).toEqual(listDepths(source));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    },
  );

  it("starts a fresh ordered run after an untouched gap between selections", () => {
    const source = "- first\n- untouched\n- last";
    const view = editor(source);
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(source.indexOf("last")),
      ]),
    });
    toggleList(view, "ordered");
    expect(view.state.doc.toString()).toBe("1. first\n- untouched\n1. last");
    expect(listDepths(view.state.doc.toString())).toEqual(listDepths(source));
  });

  it("does not flatten an inline nested-list container into heading text", () => {
    const source = "- - nested item";
    const view = editor(source);
    expect(toggleHeading(view, 2)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("does not partially convert multiple ordered-list containers on one line", () => {
    const source = "3. 10. child";
    const view = editor(source);
    expect(toggleList(view, "bullet")).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("keeps tab-indented descendants and mixed tabstop numbering levels", () => {
    const source = "- parent\n \t- child\n    - sibling\n- next";
    const view = editor(source);
    toggleList(view, "ordered");
    expect(view.state.doc.toString()).toBe(
      "1. parent\n     1. child\n     2. sibling\n2. next",
    );
    expect(listDepths(view.state.doc.toString())).toEqual(listDepths(source));
  });

  it("adjusts an unselected continuation block but not lazy text or sibling content", () => {
    const source =
      "- parent\nlazy continuation\n\n  ```text\n  code\n  ```\n\n  body\n\n- next";
    const view = editor(source);
    view.dispatch({ selection: { anchor: 2 } });
    toggleList(view, "ordered");
    const result = view.state.doc.toString();
    expect(result).toBe(
      "1. parent\nlazy continuation\n\n   ```text\n   code\n   ```\n\n   body\n\n- next",
    );
    const tree = parser.configure(GFM).parse(result);
    const fences: string[] = [];
    tree.iterate({
      enter(node) {
        if (node.name === "FencedCode") fences.push(node.node.parent!.name);
      },
    });
    expect(fences).toEqual(["ListItem"]);
    expect(listDepths(result)).toEqual(listDepths(source));
  });

  it("preserves a checked task when converting a mixed list to a checklist", () => {
    const view = editor("- [x] done\n- pending\n3. last");
    toggleList(view, "task");
    expect(view.state.doc.toString()).toBe(
      "- [x] done\n- [ ] pending\n- [ ] last",
    );
  });

  it("does not format the next line at an end-exclusive selection boundary", () => {
    const view = editor("alpha\nbeta");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe("- alpha\nbeta");
  });

  it("preserves blank separators and reverse selection direction", () => {
    const view = editor("alpha\n\nbeta");
    view.dispatch({ selection: { anchor: 11, head: 0 } });
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe("- alpha\n\n- beta");
    expect(view.state.selection.main.anchor).toBe(15);
    expect(view.state.selection.main.head).toBe(2);
  });

  it("keeps headings inside their list container and preserves task state", () => {
    const view = editor("- [x] done\n  - child");
    toggleHeading(view, 2);
    expect(view.state.doc.toString()).toBe("- [x] ## done\n  - ## child");
    toggleHeading(view, 2);
    expect(view.state.doc.toString()).toBe("- [x] done\n  - child");
  });

  it("keeps item headings when removing their list container", () => {
    const view = editor("- ## Title ##");
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe("## Title ##");
    toggleHeading(view, 2);
    expect(view.state.doc.toString()).toBe("Title");
  });

  it("removes optional ATX closing markers only when converting a heading", () => {
    const view = editor("## Title ##");
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe("- Title");
    const quote = editor("## Title ##");
    setBlockKind(quote, "quote");
    expect(quote.state.doc.toString()).toBe("> Title");
  });

  it.each(["## ##", "## ###"])(
    "handles an empty closed heading %j without overlapping edits",
    (source) => {
      const view = editor(source);
      toggleHeading(view, 2);
      expect(view.state.doc.toString()).toBe("");
      const list = editor(source);
      toggleList(list, "task");
      expect(list.state.doc.toString()).toBe("- [ ] ");
    },
  );

  it("creates a list at each distinct empty caret", () => {
    const view = editor("\n\n");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(2),
      ]),
    });
    toggleList(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] \n\n- [ ] ");
    expect(view.state.selection.ranges.map((range) => range.head)).toEqual([
      6, 14,
    ]);
  });

  it("handles disjoint selections once and retains the main selection", () => {
    const view = editor("one\ntwo\nthree");
    view.dispatch({
      selection: EditorSelection.create(
        [
          EditorSelection.cursor(1),
          EditorSelection.cursor(2),
          EditorSelection.range(13, 8),
        ],
        2,
      ),
    });
    toggleList(view, "task");
    expect(view.state.doc.toString()).toBe("- [ ] one\ntwo\n- [ ] three");
    expect(view.state.selection.ranges).toHaveLength(3);
    expect(view.state.selection.mainIndex).toBe(2);
    expect(view.state.selection.main.anchor).toBe(25);
    expect(view.state.selection.main.head).toBe(20);
  });

  it("is one Undo distinct from prior typing", () => {
    const view = editor("word");
    view.dispatch({
      changes: { from: 4, insert: "s" },
      userEvent: "input.type",
    });
    toggleList(view, "bullet");
    expect(view.state.doc.toString()).toBe("- words");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("words");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("word");
  });

  it("produces a pure plan and never changes read-only state", () => {
    const view = editor("word", true);
    expect(formattingChanges(view.state, "task")).toBeNull();
    expect(toggleList(view, "task")).toBe(false);
    expect(toggleHeading(view, 1)).toBe(false);
    expect(view.state.doc.toString()).toBe("word");
  });

  it.each([
    "```js\nconst a = 1;\n```",
    "~~~mermaid\nflowchart LR\nA --> B\n~~~",
    "> ```text\n> code\n> ```",
    "    indented code",
    "---\nname: note\n---",
    "\uFEFF---\nname: note\n...",
    "---\nname: unfinished",
    "| key | value |\n| --- | --- |\n| a | b |",
    "<details>\n<summary>Raw tag</summary>\n</details>",
    "[reference]: https://example.com",
    "Title\n=====",
  ])("does not mutate structured source %j", (source) => {
    const view = editor(`before\n\n${source}\n\nafter`);
    // Frontmatter only has metadata meaning at the beginning of the note.
    if (source.replace(/^\uFEFF/u, "").startsWith("---\n")) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: `${source}\n\nafter`,
        },
      });
    }
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    const original = view.state.doc.toString();
    expect(toggleList(view, "task")).toBe(false);
    expect(toggleHeading(view, 2)).toBe(false);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("allows ordinary Markdown after properties, and inline code in a heading", () => {
    const source = "---\nfile: note.note.md\n---\n\nUse `code`";
    const view = editor(source);
    view.dispatch({ selection: { anchor: source.indexOf("Use") } });
    toggleHeading(view, 2);
    expect(view.state.doc.toString()).toBe(source.replace("Use", "## Use"));
  });

  it("protects AIC accordion boundaries while allowing body-only formatting", () => {
    const source = ">>>|open| Summary\n\nDetail\n\n<<<";
    const view = editor(source);
    expect(toggleList(view, "task")).toBe(false);
    expect(toggleHeading(view, 2)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({ selection: { anchor: source.indexOf("Detail") } });
    expect(toggleList(view, "task")).toBe(true);
    expect(view.state.doc.toString()).toBe(
      source.replace("Detail", "- [ ] Detail"),
    );
  });

  it.each([
    "> ## Title ##",
    "> > ## Title ##",
    "> - ## Title ##",
    "- > ## Title ##",
  ])("preserves quoted heading containers for %j", (source) => {
    const view = editor(source);
    expect(toggleHeading(view, 2)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      source.replace("## Title ##", "Title"),
    );
    expect(toggleHeading(view, 3)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      source.replace("## Title ##", "### Title"),
    );
  });

  it("protects quoted lists and lazy quote continuation from partial container changes", () => {
    const source = "> - parent\n>   - child";
    const view = editor(source);
    expect(toggleList(view, "ordered")).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
    const lazy = editor("> text\nlazy continuation");
    lazy.dispatch({ selection: { anchor: 9 } });
    expect(toggleHeading(lazy, 2)).toBe(false);
    expect(lazy.state.doc.toString()).toBe("> text\nlazy continuation");
  });

  it("formats pasted Unicode line-separator characters without throwing", () => {
    const source = "one\u2028two\u2029three";
    const view = editor(source);
    expect(toggleList(view, "task")).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] " + source);
  });

  it.each(["```\n", "```\n\n", "---\nname: unfinished\n"])(
    "protects the empty final line of unclosed source %j",
    (source) => {
      const view = editor(source);
      view.dispatch({ selection: { anchor: source.length } });
      expect(toggleList(view, "bullet")).toBe(false);
      expect(view.state.doc.toString()).toBe(source);
    },
  );

  it.each(["```\ncode\n```\n", "---\nfile: note\n---\n"])(
    "allows a list immediately after closed source %j",
    (source) => {
      const view = editor(source);
      view.dispatch({ selection: { anchor: source.length } });
      expect(toggleList(view, "bullet")).toBe(true);
      expect(view.state.doc.toString()).toBe(source + "- ");
    },
  );

  it("keeps a bare checkbox source as content, not a list marker", () => {
    expect(parseListLine("  [x] text")).toMatchObject({
      indent: "  ",
      marker: null,
      task: null,
      content: "[x] text",
    });
  });
});

describe("mounted formatting shortcuts", () => {
  it.each([
    ["Digit7", "&", "ordered", "1. item"],
    ["Digit8", "*", "bullet", "- item"],
    ["Digit9", "(", "task", "- [ ] item"],
  ] as const)(
    "handles shifted %s in the shared editor keymap",
    (code, key, kind, expected) => {
      const view = editor("item");
      expect(press(view, code, { key, shiftKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(view.state.doc.toString()).toBe(expected);
      expect(toggleList(view, kind as ListKind)).toBe(true);
      expect(view.state.doc.toString()).toBe("item");
    },
  );

  it.each([1, 2, 3, 4, 5, 6] as const)(
    "mounts heading %s in the full Standard Notes editor",
    (level) => {
      const aic = new AicEditor(document.body, { initialText: "Title" });
      cleanups.push(() => aic.destroy());
      aic.view.dispatch({ selection: { anchor: 0, head: 5 } });
      expect(
        press(aic.view, `Digit${level}`, { altKey: true }).defaultPrevented,
      ).toBe(true);
      expect(aic.value).toBe(`${"#".repeat(level)} Title`);
      press(aic.view, "Digit0", { altKey: true });
      expect(aic.value).toBe("Title");
    },
  );

  it.each([
    ["Digit7", "1. "],
    ["Digit8", "- "],
    ["Digit9", "- [ ] "],
  ])(
    "mounts %s in the full Standard Notes editor on an empty note",
    (code, expected) => {
      const aic = new AicEditor(document.body, { initialText: "" });
      cleanups.push(() => aic.destroy());
      press(aic.view, code!, { shiftKey: true });
      expect(aic.value).toBe(expected);
    },
  );

  it("supports physical number keys on non-Latin/alternate layouts", () => {
    const view = editor("item");
    press(view, "Digit8", { key: ";", shiftKey: true });
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("accepts Command on Apple but does not reinterpret AltGr text", () => {
    expect(
      formattingShortcut(
        new KeyboardEvent("keydown", {
          code: "Digit9",
          key: "(",
          metaKey: true,
          shiftKey: true,
        }),
        true,
      ),
    ).toBe("task");
    const altGr = new KeyboardEvent("keydown", {
      code: "Digit2",
      key: "@",
      ctrlKey: true,
      altKey: true,
    });
    Object.defineProperty(altGr, "getModifierState", {
      value: (key: string) => key === "AltGraph",
    });
    expect(formattingShortcut(altGr)).toBeNull();
  });

  it("does not take shortcuts from inline inputs or IME composition", () => {
    const view = editor("item");
    const input = document.createElement("textarea");
    input.value = "diagram label";
    view.contentDOM.append(input);
    input.focus();
    const key = new KeyboardEvent("keydown", {
      code: "Digit1",
      key: "1",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe("item");
    press(view, "Digit8", { shiftKey: true, isComposing: true });
    expect(view.state.doc.toString()).toBe("item");
  });

  it("consumes the recognized read-only shortcut without mutation", () => {
    const view = editor("item", true);
    expect(press(view, "Digit9", { shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(view.state.doc.toString()).toBe("item");
  });
});
