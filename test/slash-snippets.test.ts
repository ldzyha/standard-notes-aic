import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  hasNextSnippetField,
  nextSnippetField,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { renderMermaidSvg } from "../src/mermaid-render";
import { mermaidFences } from "../src/mermaid-source";
import {
  DOCUMENTATION_SNIPPETS,
  SLASH_SNIPPETS_CORE_VERSION,
  slashSnippetCompletions,
  slashSnippetExtension,
  slashSnippetQuery,
  slashSnippetSearchText,
  slashSnippetTemplate,
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
    expect(SLASH_SNIPPETS_CORE_VERSION).toBe("1.2.0");
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
        ({ command, question, template }) =>
          question.endsWith("?") &&
          (template.includes("${") ||
            (command === "security" &&
              template.startsWith("```aic-security\n"))),
      ),
    ).toBe(true);
    expect(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        "page",
        "page-architecture",
        "page-capability",
        "page-decision",
        "section",
        "noise",
        "wave",
        "implementation",
        "entity-map",
        "verification",
        "list",
        "list-numbered",
        "checklist",
        "table",
        "flowchart",
        "sequence",
        "class-diagram",
        "timeline",
        "code",
        "details",
        "security",
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
    const section = empty.options.find(({ label }) => label === "/section")!;
    expect(page.section).toMatchObject({ name: "Pages", rank: 0 });
    expect(section.section).toMatchObject({ name: "Structure", rank: 1 });

    const pageState = state("# Existing\n\n/");
    const inPage = slashSnippetCompletions(
      new CompletionContext(pageState, pageState.doc.length, false),
    )!;
    expect(
      inPage.options.find(({ label }) => label === "/section")?.section,
    ).toMatchObject({ name: "Structure", rank: 0 });
    expect(
      inPage.options.find(({ label }) => label === "/errors")?.section,
    ).toMatchObject({ name: "Review", rank: 1 });
    expect(
      inPage.options.find(({ label }) => label === "/glossary")?.section,
    ).toMatchObject({ name: "References", rank: 2 });
    expect(
      inPage.options.find(({ label }) => label === "/flowchart")?.section,
    ).toMatchObject({ name: "Diagrams", rank: 4 });
    expect(inPage.options.every(({ info }) => info === undefined)).toBe(true);
    expect(
      inPage.options.find(({ label }) => label === "/page")?.section,
    ).toMatchObject({ name: "Pages", rank: 6 });
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
    ).toContain("What does the reader need");
    view.destroy();
  });

  it("opens immediately when slash is typed in an editable Markdown document", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [aicMarkdownLanguage(), slashSnippetExtension()],
      }),
    });

    view.dispatch({
      changes: { from: 0, insert: "/" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(completionStatus(view.state)).toBe("active");
    view.destroy();
  });

  it("inserts simple lists, a checkbox and a table without imposing a page structure", () => {
    const examples = [
      {
        command: "list",
        title: "List",
        expected:
          "- What is the first point?\n- Which distinct point belongs here?\n- What else matters at this level?\n\n",
      },
      {
        command: "list-numbered",
        title: "Numbered list",
        expected:
          "1. What comes first?\n2. What follows?\n3. What completes the sequence?\n\n",
      },
      {
        command: "checklist",
        title: "Checklist",
        expected: "- [ ] What needs to be done?",
      },
      {
        command: "table",
        title: "Table",
        expected:
          "| Item | Detail |\n| --- | --- |\n| First item | What should the reader know? |\n| Second item | What should the reader know? |\n\n",
      },
    ];
    for (const { command, title, expected } of examples) {
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        parent,
        state: state("# Existing\n\n/" + command),
      });
      const context = new CompletionContext(
        view.state,
        view.state.doc.length,
        true,
        view,
      );
      const result = slashSnippetCompletions(context)!;
      const item = result.options.find(
        ({ label, displayLabel }) => (displayLabel ?? label) === "/" + command,
      )!;
      expect(item.detail).toBe(title);
      expect(item.section).toMatchObject({ name: "Tables & lists" });
      if (typeof item.apply !== "function")
        throw new Error("snippet apply is missing");
      item.apply(view, item, result.from, context.pos);
      expect(view.state.doc.toString()).toBe("# Existing\n\n" + expected);
      expect(hasNextSnippetField(view.state)).toBe(true);
      view.destroy();
      parent.remove();
    }
    for (const command of ["mapping-table", "comparison", "tasks"]) {
      expect(
        DOCUMENTATION_SNIPPETS.some((entry) => entry.command === command),
      ).toBe(true);
    }
  });

  it("finds one checklist through its command and checkbox/tasklist search aliases", async () => {
    const entry = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "checklist",
    )!;
    expect(entry.template).toBe("- [ ] ${1:What needs to be done?}${0}");
    expect(entry.searchTerms).toEqual(["checkbox", "tasklist"]);
    expect(slashSnippetSearchText(entry)).toBe(
      "/checklist /checkbox /tasklist",
    );
    expect(
      DOCUMENTATION_SNIPPETS.filter(({ command }) =>
        ["checklist", "checkbox", "tasklist"].includes(command),
      ),
    ).toHaveLength(1);
    for (const query of ["/checklist", "/checkbox", "/tasklist"]) {
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: query,
          selection: { anchor: query.length },
          extensions: [aicMarkdownLanguage(), slashSnippetExtension()],
        }),
      });
      startCompletion(view);
      await expect
        .poll(() =>
          currentCompletions(view.state).map(
            ({ label, displayLabel }) => displayLabel ?? label,
          ),
        )
        .toEqual(["/checklist"]);
      const item = currentCompletions(view.state)[0]!;
      if (typeof item.apply !== "function")
        throw new Error("snippet apply is missing");
      item.apply(view, item, 0, query.length);
      expect(view.state.doc.toString()).toBe("- [ ] What needs to be done?");
      expect(
        view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
      ).toBe("What needs to be done?");
      view.destroy();
      parent.remove();
    }
  });

  it("does not offer checklist aliases in code, prose or a read-only document", () => {
    for (const command of ["checklist", "checkbox", "tasklist"]) {
      for (const source of [
        "```markdown\n/" + command + "\n```",
        "~~~markdown\n/" + command + "\n~~~",
        "`/" + command + "`",
        "Existing /" + command,
      ]) {
        const pos = source.indexOf("/" + command) + command.length + 1;
        expect(
          slashSnippetCompletions(
            new CompletionContext(state(source), pos, true),
          ),
        ).toBeNull();
      }
      expect(
        slashSnippetQuery(state("/" + command, true), command.length + 1),
      ).toBeNull();
    }
  });

  it("filters /list to list forms and /list-numbered to the ordered form", async () => {
    for (const [query, expected] of [
      ["/list", ["/list", "/list-numbered", "/checklist"]],
      ["/list-numbered", ["/list-numbered"]],
    ] as const) {
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: query,
          selection: { anchor: query.length },
          extensions: [aicMarkdownLanguage(), slashSnippetExtension()],
        }),
      });
      startCompletion(view);
      await expect
        .poll(() =>
          currentCompletions(view.state).map(
            ({ label, displayLabel }) => displayLabel ?? label,
          ),
        )
        .toEqual(expected);
      view.destroy();
      parent.remove();
    }
  });

  it("uses Core question-answer-detail pages without compulsory metadata or purpose", () => {
    for (const entry of DOCUMENTATION_SNIPPETS) {
      expect(entry.template).not.toMatch(/Purpose:|## Purpose|## Proposal/u);
      expect(entry.template).not.toMatch(
        /single question|one primary representation/u,
      );
      expect(entry.template).not.toMatch(/^---\n/u);
    }
    const page = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "page",
    )!;
    expect(page.template).toContain("**Questions**");
    expect(page.template.indexOf("**Answer.")).toBeLessThan(
      page.template.indexOf("## "),
    );
    expect(page.template).toContain("### ");
    expect(
      DOCUMENTATION_SNIPPETS.some(({ command }) => command === "purpose"),
    ).toBe(false);
  });

  it("keeps noise research and wave instructions in the same note with verifiable steps", () => {
    const noise = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "noise",
    )!;
    const wave = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "wave",
    )!;
    const implementation = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "implementation",
    )!;
    expect(noise.kind).toBe("section");
    expect(noise.template).toContain("same note");
    expect(noise.template).toContain("does it block the current task");
    expect(wave.template).toContain("Result of step 1");
    expect(wave.template).toContain("justified refusal");
    expect(wave.template).toContain("Deviations and new noise");
    for (const entry of [wave, implementation]) {
      expect(entry.template).toContain("Prerequisite");
      expect(entry.template).toContain("Verifiable result");
    }
    expect(implementation.template).toContain("### Error handling");
  });

  it("distinguishes entity overview, state transitions, composition and chronology", () => {
    const byCommand = Object.fromEntries(
      DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
    );
    expect(byCommand["entity-map"]!.template).toContain("flowchart TB");
    expect(byCommand["entity-map"]!.template).toContain("module.md");
    expect(byCommand["entity-map"]!.template).not.toContain("\ntimeline\n");
    expect(byCommand.flowchart!.template).toContain("Initial state");
    expect(byCommand.flowchart!.template).toContain("Recovery event");
    expect(byCommand["class-diagram"]!.template).toContain("*--");
    expect(byCommand["class-diagram"]!.template).toContain("..>");
    expect(byCommand.timeline!.template).toContain("\ntimeline\n");
  });

  it("nests sections within surrounding content but ignores fenced and metadata headings", () => {
    const section = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "section",
    )!;
    const wave = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "wave",
    )!;
    expect(slashSnippetTemplate(section)).toMatch(/^# /u);
    expect(slashSnippetTemplate(section, "# Page\n\n")).toMatch(/^## /u);
    expect(slashSnippetTemplate(section, "# Page\n\n## Module\n\n")).toMatch(
      /^### /u,
    );
    expect(
      slashSnippetTemplate(
        section,
        "---\n###### comment\n---\n# Page\n~~~md\n##### sample\n~~~\n",
      ),
    ).toMatch(/^## /u);
    expect(slashSnippetTemplate(wave, "# Page\n\n## Module\n")).toContain(
      "#### Instruction",
    );
    expect(slashSnippetTemplate(wave, "###### Deep\n")).not.toMatch(/^#{7}/mu);
    const page = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "page",
    )!;
    expect(slashSnippetTemplate(page, "### Existing\n")).toBe(page.template);
  });

  it("inserts Core wave sections through the real completion adapter", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: state("# Existing\n\n/wave"),
    });
    const context = new CompletionContext(
      view.state,
      view.state.doc.length,
      true,
      view,
    );
    const result = slashSnippetCompletions(context)!;
    const item = result.options.find(({ label }) => label === "/wave")!;
    if (typeof item.apply !== "function")
      throw new Error("snippet apply is missing");
    item.apply(view, item, result.from, context.pos);
    expect(view.state.doc.toString()).toContain("## Wave — Expected result");
    expect(view.state.doc.toString()).toContain("### Instruction");
    expect(view.state.doc.toString()).not.toContain("${");
    view.destroy();
  });

  it("expands every shared template and renders every diagram example", async () => {
    for (const entry of DOCUMENTATION_SNIPPETS) {
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        parent,
        state: state("/" + entry.command),
      });
      const context = new CompletionContext(
        view.state,
        view.state.doc.length,
        true,
        view,
      );
      const result = slashSnippetCompletions(context)!;
      const item = result.options.find(
        ({ label, displayLabel }) =>
          (displayLabel ?? label) === "/" + entry.command,
      )!;
      if (typeof item.apply !== "function")
        throw new Error("snippet apply is missing");
      item.apply(view, item, result.from, context.pos);
      const expanded = view.state.doc.toString();
      expect(expanded, entry.command).not.toContain("${");
      for (const diagram of mermaidFences(expanded)) {
        const svg = await renderMermaidSvg({
          source: diagram.source,
          theme: "default",
        });
        expect(svg, entry.command).toMatch(/^<svg/u);
      }
      view.destroy();
      parent.remove();
    }
  }, 20_000);
});
