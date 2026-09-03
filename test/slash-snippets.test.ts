import {
  CompletionContext,
  hasNextSnippetField,
  nextSnippetField,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  DOCUMENTATION_SNIPPETS,
  SLASH_SNIPPETS_CORE_VERSION,
  slashSnippetCompletions,
  slashSnippetExtension,
  slashSnippetQuery,
} from "../src/core/slash-snippets.js";

afterEach(() => document.body.replaceChildren());

function state(doc: string, readOnly = false) {
  return EditorState.create({
    doc,
    extensions: [aicMarkdownLanguage(), EditorState.readOnly.of(readOnly)],
  });
}

describe("shared documentation slash snippets", () => {
  it("offers unique page, section, and formatting-block perspectives", () => {
    expect(SLASH_SNIPPETS_CORE_VERSION).toBe("1.1.0");
    expect(
      new Set(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).size,
    ).toBe(DOCUMENTATION_SNIPPETS.length);
    expect(new Set(DOCUMENTATION_SNIPPETS.map(({ kind }) => kind))).toEqual(
      new Set(["page", "section", "block"]),
    );
    expect(new Set(DOCUMENTATION_SNIPPETS.map(({ group }) => group))).toEqual(
      new Set([
        "pages",
        "structure",
        "assurance",
        "references",
        "data",
        "diagrams",
        "content",
      ]),
    );
    expect(
      DOCUMENTATION_SNIPPETS.every(
        ({ question, template }) =>
          question.endsWith("?") && template.includes("${"),
      ),
    ).toBe(true);
    expect(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        "page",
        "page-architecture",
        "page-capability",
        "page-decision",
        "purpose",
        "verification",
        "flowchart",
        "sequence",
        "class-diagram",
        "timeline",
        "code",
        "details",
      ]),
    );
  });

  it("activates only for a slash command on an otherwise empty Markdown line", () => {
    expect(slashSnippetQuery(state("/"), 1)).toMatchObject({
      from: 0,
      to: 1,
      text: "/",
      hasPageContent: false,
    });
    expect(slashSnippetQuery(state("# Existing\n\n  /ver"), 18)).toMatchObject({
      from: 14,
      text: "/ver",
      hasPageContent: true,
    });
    expect(slashSnippetQuery(state("Text /page"), 10)).toBeNull();
    const fenced = "~~~text\n/page\n~~~";
    expect(
      slashSnippetQuery(state(fenced), fenced.indexOf("/page") + 5),
    ).toBeNull();
    expect(slashSnippetQuery(state("/page", true), 5)).toBeNull();
  });

  it("prioritizes whole pages in an empty note and sections inside a page", () => {
    const emptyState = state("/");
    const empty = slashSnippetCompletions(
      new CompletionContext(emptyState, 1, false),
    )!;
    const page = empty.options.find(({ label }) => label === "/page")!;
    const purpose = empty.options.find(({ label }) => label === "/purpose")!;
    expect(page.section).toMatchObject({ name: "Page templates", rank: 0 });
    expect(purpose.section).toMatchObject({ name: "Page structure", rank: 1 });

    const pageState = state("# Existing\n\n/");
    const inPage = slashSnippetCompletions(
      new CompletionContext(pageState, pageState.doc.length, false),
    )!;
    expect(
      inPage.options.find(({ label }) => label === "/purpose")?.section,
    ).toMatchObject({ name: "Page structure", rank: 0 });
    expect(
      inPage.options.find(({ label }) => label === "/errors")?.section,
    ).toMatchObject({ name: "Risks & verification", rank: 1 });
    expect(
      inPage.options.find(({ label }) => label === "/glossary")?.section,
    ).toMatchObject({ name: "References", rank: 2 });
    expect(
      inPage.options.find(({ label }) => label === "/flowchart")?.section,
    ).toMatchObject({ name: "Diagrams", rank: 4 });
    expect(inPage.options.every(({ info }) => info === undefined)).toBe(true);
    expect(
      inPage.options.find(({ label }) => label === "/page")?.section,
    ).toMatchObject({ name: "Page templates", rank: 6 });
  });

  it("replaces the slash token and exposes guiding questions as Tab stops", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "/page",
        extensions: [aicMarkdownLanguage(), slashSnippetExtension()],
      }),
    });
    const context = new CompletionContext(
      view.state,
      view.state.doc.length,
      true,
      view,
    );
    const result = slashSnippetCompletions(context)!;
    const page = result.options.find(({ label }) => label === "/page")!;
    expect(typeof page.apply).toBe("function");
    if (typeof page.apply !== "function")
      throw new Error("snippet apply is missing");
    page.apply(view, page, result.from, context.pos);

    expect(view.state.doc.toString()).toContain("# Page title");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("Page title");
    expect(hasNextSnippetField(view.state)).toBe(true);
    expect(nextSnippetField(view)).toBe(true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toContain("What does this page own");
    view.destroy();
  });
});
