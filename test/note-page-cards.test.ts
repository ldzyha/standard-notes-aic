import { afterEach, describe, expect, it, vi } from "vitest";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  PAGE_PLACEHOLDER,
  focusPageTarget,
  focusedPage,
  notePageCards,
  notePageCardsPreview,
  pageExternalChange,
} from "../src/core/note-page-cards.js";
import { notePages } from "../src/core/note-pages.js";

afterEach(() => document.body.replaceChildren());

const NOTE = [
  "---\ntitle: Notebook\n---\nIntro\n",
  "--- src/a.ts\nAlpha\n\n```md\n\n--- inside a fence\n```\n",
  "--- https://example.com/docs\nDocs\n",
  "---\nLoose\n",
  "--- src/z.ts\nOmega",
].join("\n");

function mount(
  doc: string,
  options: { readOnly?: boolean; preview?: boolean } = {},
) {
  const onOpenTarget = vi.fn();
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(options.readOnly ?? false),
        notePageCards({ onOpenTarget }),
        options.preview === false ? [] : notePageCardsPreview(),
      ],
    }),
  });
  const text = () => view.state.doc.toString();
  const cards = () => [
    ...view.dom.querySelectorAll<HTMLElement>(".aic-card--page"),
  ];
  const titles = () =>
    cards().map(
      (card) => card.querySelector(".aic-card__title")?.textContent ?? null,
    );
  const page = () => {
    const focus = focusedPage(view.state)!;
    return view.state.sliceDoc(focus.from, focus.to);
  };
  /** Text of every decoration that hides source in the focused view. */
  const visible = () =>
    [...view.dom.querySelectorAll(".cm-line")]
      .map((line) => line.textContent)
      .join("\n");
  return { view, onOpenTarget, text, cards, titles, page, visible };
}

/** The note without the focused page's editable text. */
function others(view: EditorView) {
  const focus = focusedPage(view.state)!;
  const text = view.state.doc.toString();
  return [text.slice(0, focus.from), text.slice(focus.to)];
}

describe("note page cards", () => {
  it("heads each page with its target and one Open target action", () => {
    const { view, cards, titles, onOpenTarget, text } = mount(NOTE);
    expect(titles()).toEqual([
      "src/a.ts",
      "https://example.com/docs",
      null,
      "src/z.ts",
    ]);
    // Frontmatter, the fenced `---` and page 1 get no header.
    expect(view.dom.textContent).toContain("--- inside a fence");
    expect(view.dom.textContent).not.toContain("--- src/a.ts");
    const unbound = cards()[2]!;
    expect(unbound.querySelector('[role="separator"]')).not.toBeNull();
    expect(unbound.querySelector("button")).toBeNull();
    const buttons = cards()[1]!.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Open target");
    buttons[0]!.click();
    expect(onOpenTarget).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/docs",
    );
    expect(text()).toBe(NOTE);
    view.destroy();
  });

  it("hides credentials in the label and passes the written target on", () => {
    const { view, cards, titles, onOpenTarget } = mount(
      "--- https://user:pw@example.com/x\nText",
    );
    // The caret starts on the separator line, which shows its source.
    expect(titles()).toEqual([]);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(titles()).toEqual(["https://example.com/x"]);
    cards()[0]!.querySelector("button")!.click();
    expect(onOpenTarget).toHaveBeenCalledWith("https://user:pw@example.com/x");
    view.destroy();
  });

  it("shows the separator source while the selection is on its line", () => {
    const { view, titles } = mount(NOTE);
    const at = NOTE.indexOf("--- https://example.com/docs");
    view.dispatch({ selection: { anchor: at + 4 } });
    expect(titles()).toEqual(["src/a.ts", null, "src/z.ts"]);
    expect(view.dom.textContent).toContain("--- https://example.com/docs");
    view.dispatch({ selection: { anchor: NOTE.indexOf("Docs") } });
    expect(titles()).toHaveLength(4);
    // The label is the pointer way back to the source line.
    view.dom
      .querySelectorAll(".aic-card__title")[1]!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.selection.main.head).toBe(
      at + "--- https://example.com/docs".length,
    );
    expect(titles()).toHaveLength(3);
    view.destroy();
  });

  it("omits the action without a host handler and headers outside preview", () => {
    const bare = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: NOTE,
        extensions: [notePageCards(), notePageCardsPreview()],
      }),
    });
    expect(bare.dom.querySelectorAll(".aic-card--page")).toHaveLength(4);
    expect(bare.dom.querySelector(".aic-card--page button")).toBeNull();
    bare.destroy();
    const source = mount(NOTE, { preview: false });
    expect(source.cards()).toHaveLength(0);
    source.view.destroy();
  });
});

describe("focused note page", () => {
  it("shows exactly the focused card and never changes the note by focusing", () => {
    const { view, cards, titles, page, visible, text, onOpenTarget } =
      mount(NOTE);
    const changes = vi.fn();
    const seen = view.state.doc;
    expect(focusPageTarget(view, "SRC\\a.ts")).toBe(true);
    expect(titles()).toEqual(["SRC\\a.ts"]);
    expect(page()).toBe("Alpha\n\n```md\n\n--- inside a fence\n```");
    expect(visible()).toBe(page());
    expect(view.state.selection.main.head).toBe(NOTE.indexOf("Alpha"));
    cards()[0]!.querySelector("button")!.click();
    expect(onOpenTarget).toHaveBeenCalledWith("SRC\\a.ts");

    for (const target of [
      "https://example.com/docs#top",
      "missing.ts",
      "src/z.ts",
      "src/z.ts",
      null,
    ]) {
      expect(focusPageTarget(view, target)).toBe(true);
      if (view.state.doc !== seen) changes();
    }
    expect(changes).not.toHaveBeenCalled();
    expect(text()).toBe(NOTE);
    expect(focusedPage(view.state)).toBeNull();
    expect(titles()).toHaveLength(4);
    // A target that cannot be written as a page is refused.
    expect(focusPageTarget(view, " / ")).toBe(false);
    expect(focusedPage(view.state)).toBeNull();
    view.destroy();
  });

  it("matches exactly: a folder or URL prefix has no page", () => {
    const { view, page } = mount(NOTE);
    focusPageTarget(view, "https://example.com/docs/api");
    expect(focusedPage(view.state)).toMatchObject({ exists: false });
    focusPageTarget(view, "src");
    expect(focusedPage(view.state)).toMatchObject({ exists: false });
    focusPageTarget(view, "https://example.com/docs/?q=1#x");
    expect(page()).toBe("Docs");
    view.destroy();
  });

  it("keeps select-all, delete, type, paste and cut inside the page", () => {
    const { view, page, text } = mount(NOTE);
    focusPageTarget(view, "https://example.com/docs");
    const [before, after] = others(view) as [string, string];
    const intact = () => {
      expect(others(view)).toEqual([before, after]);
      expect(notePages(text()).map((item) => item.target)).toEqual(
        notePages(NOTE).map((item) => item.target),
      );
    };

    // Select-all selects the page only.
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("Docs");

    // A change reaching beyond the page is dropped whole.
    for (const userEvent of ["delete.selection", "delete.cut", "input.paste"])
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "X" },
        userEvent,
      });
    view.dispatch({ changes: { from: 0, insert: "X" } });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "X" } });
    view.dispatch({
      changes: [
        { from: from + 1, insert: "ok" },
        { from: before.length - 2, to: before.length, insert: "" },
      ],
    });
    view.dispatch({ changes: { from: from - 1, to: from } });
    view.dispatch({ changes: { from: to, to: to + 1 } });
    expect(text()).toBe(NOTE);

    // The same gestures through the confined selection edit the page.
    view.dispatch(view.state.replaceSelection("Pasted\n\n--- typed\nmore"));
    expect(page()).toBe("Pasted\n\n--- typed\nmore");
    expect(others(view)).toEqual([before, after]);
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.dispatch(view.state.replaceSelection("x"));
    expect(page()).toBe("x");
    intact();
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.dispatch(view.state.replaceSelection(""));
    expect(page()).toBe("");
    intact();
    view.dispatch(view.state.replaceSelection("again"));
    expect(page()).toBe("again");
    intact();
    while (undo(view)) expect(others(view)).toEqual([before, after]);
    expect(text()).toBe(NOTE);
    view.destroy();
  });

  it("keeps the caret inside the page and other effects alive", () => {
    const { view } = mount(NOTE);
    focusPageTarget(view, "src/a.ts");
    const focus = focusedPage(view.state)!;
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.state.selection.main.head).toBe(focus.from);
    view.dispatch({ selection: { anchor: NOTE.length } });
    expect(view.state.selection.main.head).toBe(focus.to);
    // Both hidden sides are atomic for keyboard motion.
    const atoms = view.state
      .facet(EditorView.atomicRanges)
      .map((source) => source(view));
    const covered = (position: number) =>
      atoms.some((set) => {
        let hit = false;
        set.between(position, position, (from, to) => {
          if (from < position && to > position) hit = true;
        });
        return hit;
      });
    expect(covered(2)).toBe(true);
    expect(covered(NOTE.length - 2)).toBe(true);
    expect(covered(focus.from + 1)).toBe(false);
    view.destroy();
  });

  it("writes a missing page on first typing, exactly once", () => {
    const { view, text, page, titles, visible } = mount("Intro");
    focusPageTarget(view, "src/new.ts");
    expect(titles()).toEqual(["src/new.ts"]);
    expect(visible()).toBe(PAGE_PLACEHOLDER);
    expect(text()).toBe("Intro");
    expect(focusedPage(view.state)).toEqual({
      target: "src/new.ts",
      from: 5,
      to: 5,
      exists: false,
    });
    view.dispatch(view.state.replaceSelection("H"));
    expect(text()).toBe("Intro\n\n--- src/new.ts\nH");
    expect(view.state.selection.main.head).toBe(text().length);
    view.dispatch(view.state.replaceSelection("i"));
    expect(text()).toBe("Intro\n\n--- src/new.ts\nHi");
    expect(page()).toBe("Hi");
    expect(focusedPage(view.state)!.exists).toBe(true);

    // Undo removes the page with its text; redo writes both back.
    undo(view);
    expect(text()).toBe("Intro");
    expect(focusedPage(view.state)!.exists).toBe(false);
    redo(view);
    expect(text()).toBe("Intro\n\n--- src/new.ts\nHi");
    expect(page()).toBe("Hi");
    view.destroy();
  });

  it.each([
    ["", "--- t\nx"],
    ["One\n", "One\n\n--- t\nx"],
    ["One\n\n", "One\n\n--- t\nx"],
    ["One\n\n```js\nopen", "One\n\n```js\nopen\n```\n\n--- t\nx"],
    // The page exists but has no line of its own yet.
    ["One\n\n--- t", "One\n\n--- t\nx"],
    ["--- t\n\n--- u\nU", "--- t\n\n--- u\nU\n\n--- t\nx"],
  ])("creates the page for %j", (source, written) => {
    const { view, text, page } = mount(source);
    focusPageTarget(view, "t");
    expect(text()).toBe(source);
    view.dispatch(view.state.replaceSelection("x"));
    expect(text()).toBe(written);
    expect(page()).toBe("x");
    view.destroy();
  });

  it("keeps the next separator when an empty middle page is typed in", () => {
    const source = "A\n\n--- t\n\n--- u\nU";
    const { view, text, page } = mount(source);
    focusPageTarget(view, "t");
    expect(focusedPage(view.state)).toMatchObject({ from: 9, to: 9 });
    view.dispatch(view.state.replaceSelection("x"));
    expect(text()).toBe("A\n\n--- t\nx\n\n--- u\nU");
    expect(page()).toBe("x");
    undo(view);
    expect(text()).toBe(source);
    view.dispatch(view.state.replaceSelection("y"));
    expect(text()).toBe("A\n\n--- t\ny\n\n--- u\nU");
    view.destroy();
  });

  it("does not expose hidden pages when the page text breaks the structure", () => {
    const { view, page, visible } = mount(NOTE);
    focusPageTarget(view, "https://example.com/docs");
    const [before, after] = others(view) as [string, string];
    view.dispatch(view.state.replaceSelection("\n```\nopen fence"));
    expect(page()).toBe("\n```\nopen fenceDocs");
    expect(visible()).toBe(page());
    expect(others(view)).toEqual([before, after]);
    view.destroy();
  });

  it("lets host updates through and resolves the page again", () => {
    const { view, text, page } = mount(NOTE);
    focusPageTarget(view, "src/z.ts");
    const external = (insert: string) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert },
        annotations: pageExternalChange.of(true),
      });
    external("--- src/z.ts\nMoved\n\n--- other\nO");
    expect(text()).toBe("--- src/z.ts\nMoved\n\n--- other\nO");
    expect(page()).toBe("Moved");
    external("Gone");
    expect(focusedPage(view.state)).toMatchObject({ exists: false, from: 4 });
    expect(text()).toBe("Gone");
    external("Gone\n\n--- SRC/Z.ts\nBack");
    expect(page()).toBe("Back");
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(
      focusedPage(view.state)!.from,
    );
    view.destroy();
  });

  it("creates nothing while read-only", () => {
    const { view, text, titles, visible } = mount("Intro", { readOnly: true });
    focusPageTarget(view, "src/new.ts");
    expect(titles()).toEqual(["src/new.ts"]);
    expect(visible()).toBe("");
    view.dispatch(view.state.replaceSelection("x"));
    view.dispatch({ changes: { from: 5, insert: "x" }, userEvent: "input" });
    expect(text()).toBe("Intro");
    view.destroy();
  });
});
