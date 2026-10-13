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
import { securityTemplate } from "../src/core/security-model.js";
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
  it("offers only DDK sections, Markdown blocks, diagrams and the AIC block", () => {
    expect(SLASH_SNIPPETS_CORE_VERSION).toBe("2.0.0");
    expect(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).toEqual([
      "aic",
      "list",
      "list-numbered",
      "checklist",
      "table",
      "code",
      "details",
      "section",
      "glossary",
      "bibliography",
      "high-level-design",
      "detailed-view",
      "error-handling",
      "test-cases",
      "open-question",
      "flowchart",
      "sequence",
      "state-diagram",
    ]);
    expect(new Set(DOCUMENTATION_SNIPPETS.map(({ kind }) => kind))).toEqual(
      new Set(["section", "block"]),
    );
    expect(new Set(DOCUMENTATION_SNIPPETS.map(({ group }) => group))).toEqual(
      new Set(["blocks", "sections", "diagrams"]),
    );
    expect(
      DOCUMENTATION_SNIPPETS.every(
        ({ command, kind, group, question, template }) =>
          question.endsWith("?") &&
          (kind === "section") === (group === "sections") &&
          (template.includes("${") ||
            (command === "aic" && template.startsWith("```aic\n"))),
      ),
    ).toBe(true);
  });

  it("finds the AIC block by its name and by its former security aliases", async () => {
    const entry = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "aic",
    )!;
    expect(entry.title).toBe("AIC block (fields, secrets, codes)");
    expect(entry.template).toBe(securityTemplate());
    expect(entry.searchTerms).toEqual([
      "security",
      "password",
      "authenticator",
      "two-factor",
      "2fa",
      "secret",
      "fields",
      "properties",
      "credentials",
    ]);
    for (const query of ["/aic", "/security", "/2fa", "/properties"]) {
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
        .poll(
          () =>
            currentCompletions(view.state).map(
              ({ label, displayLabel }) => displayLabel ?? label,
            )[0],
        )
        .toBe("/aic");
      view.destroy();
      parent.remove();
    }
  });

  it("keeps former command words as aliases of the DDK names", () => {
    const byCommand = Object.fromEntries(
      DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
    );
    for (const [command, alias] of [
      ["high-level-design", "high-level"],
      ["error-handling", "errors"],
      ["test-cases", "verification"],
      ["open-question", "open-questions"],
    ] as const) {
      expect(byCommand[alias]).toBeUndefined();
      expect(slashSnippetSearchText(byCommand[command]!)).toContain(
        "/" + alias,
      );
    }
    for (const removed of [
      "page",
      "page-architecture",
      "page-capability",
      "page-decision",
      "context",
      "noise",
      "wave",
      "implementation",
      "owned-detail",
      "synthesis",
      "entity-map",
      "class-diagram",
      "timeline",
      "mapping-table",
      "comparison",
      "tasks",
      "security",
    ])
      expect(byCommand[removed]).toBeUndefined();
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
    expect(slashSnippetQuery(state("Text /list"), 10)).toBeNull();
    const fenced = "~~~text\n/list\n~~~";
    expect(
      slashSnippetQuery(state(fenced), fenced.indexOf("/list") + 5),
    ).toBeNull();
    expect(slashSnippetQuery(state("/list", true), 5)).toBeNull();
  });

  it("keeps one group order in an empty note and inside a page", () => {
    for (const doc of ["/", "# Existing\n\n/"]) {
      const current = state(doc);
      const { options } = slashSnippetCompletions(
        new CompletionContext(current, current.doc.length, false),
      )!;
      const section = (command: string) =>
        options.find(
          ({ label, displayLabel }) =>
            (displayLabel ?? label) === "/" + command,
        )?.section;
      expect(section("aic")).toMatchObject({ name: "Blocks", rank: 0 });
      expect(section("table")).toMatchObject({ name: "Blocks", rank: 0 });
      expect(section("section")).toMatchObject({ name: "Sections", rank: 1 });
      expect(section("glossary")).toMatchObject({ name: "Sections", rank: 1 });
      expect(section("flowchart")).toMatchObject({ name: "Diagrams", rank: 2 });
      expect(options.every(({ info }) => info === undefined)).toBe(true);
    }
  });

  it("replaces the slash token and exposes the title, question and answer as Tab stops", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "/section",
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
    const section = result.options.find(({ label }) => label === "/section")!;
    if (typeof section.apply !== "function")
      throw new Error("snippet apply is missing");
    section.apply(view, section, result.from, context.pos);

    expect(view.state.doc.toString()).toBe(
      "# Title\n\n*What does the reader need to know or do?*\n\nAnswer\n\n",
    );
    const selected = () =>
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      );
    expect(selected()).toBe("Title");
    expect(hasNextSnippetField(view.state)).toBe(true);
    expect(nextSnippetField(view)).toBe(true);
    expect(selected()).toBe("What does the reader need to know or do?");
    expect(nextSnippetField(view)).toBe(true);
    expect(selected()).toBe("Answer");
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
      expect(item.section).toMatchObject({ name: "Blocks" });
      if (typeof item.apply !== "function")
        throw new Error("snippet apply is missing");
      item.apply(view, item, result.from, context.pos);
      expect(view.state.doc.toString()).toBe("# Existing\n\n" + expected);
      expect(hasNextSnippetField(view.state)).toBe(true);
      view.destroy();
      parent.remove();
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

  it("ranks list forms first for /list and the ordered form first for /list-numbered", async () => {
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
        .toEqual(expect.arrayContaining([...expected]));
      expect(
        currentCompletions(view.state)
          .slice(0, expected.length)
          .map(({ label, displayLabel }) => displayLabel ?? label),
      ).toEqual(expected);
      view.destroy();
      parent.remove();
    }
  });

  it("writes every DDK section as a title, one italic question and the DDK answer shape", () => {
    const byCommand = Object.fromEntries(
      DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
    );
    const body = (command: string, title: string, question: string) => {
      const { template, title: name, question: asked } = byCommand[command]!;
      expect(name).toBe(title);
      expect(asked).toBe(question);
      const head = `## ${title}\n\n*${question}*\n\n`;
      expect(template.startsWith(head), command).toBe(true);
      return template.slice(head.length);
    };
    for (const entry of DOCUMENTATION_SNIPPETS.filter(
      ({ kind }) => kind === "section",
    )) {
      expect(entry.template, entry.command).toMatch(
        /^## .+\n\n\*.+\?\}?\*\n\n/u,
      );
      expect(entry.template, entry.command).not.toContain("**Which");
      expect(entry.template, entry.command).not.toContain("—");
    }
    expect(byCommand.section!.template).toBe(
      "## ${1:Title}\n\n*${2:What does the reader need to know or do?}*\n\n${3:Answer}\n\n${0}",
    );
    const glossary = body(
      "glossary",
      "Glossary",
      "Which terms need a shared definition?",
    );
    expect(glossary).toContain("- **${1:Term}** - ${2:definition}\n");
    expect(glossary).not.toContain("|");
    expect(
      body(
        "bibliography",
        "Bibliography",
        "Which sources support this document?",
      ),
    ).toBe("- ${1:Title} - ${2:Author} (${3:link})\n\n${0}");
    const design = body(
      "high-level-design",
      "High-level design",
      "How do the main parts work together?",
    );
    expect(design).toMatch(/^```mermaid\nflowchart LR\n/u);
    expect(design).toContain(
      "```\n\n| Part | Responsibility | Dependency |\n| --- | --- | --- |\n| ${1:Entry point} |",
    );
    expect(
      body(
        "detailed-view",
        "Detailed view",
        "What happens step by step, and who owns each step?",
      ),
    ).toMatch(
      /^\| Step \| Owner \| Behavior \| Completion condition \|\n\| --- \| --- \| --- \| --- \|\n\| 1 \| /u,
    );
    expect(
      body(
        "error-handling",
        "Error handling",
        "What can fail, and how should the system respond?",
      ),
    ).toMatch(
      /^\| Failure \| Response \| Recovery \/ cleanup \|\n\| --- \| --- \| --- \|\n/u,
    );
    expect(
      body(
        "test-cases",
        "Test cases",
        "How will we verify the expected behavior?",
      ),
    ).toMatch(
      /^\| Scenario \/ precondition \| Action \| Expected result \|\n\| --- \| --- \| --- \|\n/u,
    );
    const open = body(
      "open-question",
      "Open question",
      "What do we still need to decide?",
    );
    expect(open).not.toMatch(/^[-|]/mu);
  });

  it("offers the three DDK diagram types as plain Mermaid fences", () => {
    const byCommand = Object.fromEntries(
      DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
    );
    for (const [command, title, type] of [
      ["flowchart", "Flowchart", "flowchart LR"],
      ["sequence", "Sequence diagram", "sequenceDiagram"],
      ["state-diagram", "State diagram", "stateDiagram-v2"],
    ] as const) {
      const entry = byCommand[command]!;
      expect(entry.title).toBe(title);
      expect(entry.kind).toBe("block");
      expect(entry.template.startsWith("```mermaid\n" + type + "\n")).toBe(
        true,
      );
    }
  });

  it("nests sections within surrounding content but ignores fenced and metadata headings", () => {
    const section = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "section",
    )!;
    const table = DOCUMENTATION_SNIPPETS.find(
      ({ command }) => command === "table",
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
    expect(slashSnippetTemplate(section, "###### Deep\n")).not.toMatch(
      /^#{7}/mu,
    );
    expect(slashSnippetTemplate(table, "### Existing\n")).toBe(table.template);
  });

  it("inserts a DDK section through the real completion adapter", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: state("# Existing\n\n/error-handling"),
    });
    const context = new CompletionContext(
      view.state,
      view.state.doc.length,
      true,
      view,
    );
    const result = slashSnippetCompletions(context)!;
    const item = result.options.find(
      ({ displayLabel }) => displayLabel === "/error-handling",
    )!;
    if (typeof item.apply !== "function")
      throw new Error("snippet apply is missing");
    item.apply(view, item, result.from, context.pos);
    expect(view.state.doc.toString()).toBe(
      "# Existing\n\n## Error handling\n\n*What can fail, and how should the system respond?*\n\n| Failure | Response | Recovery / cleanup |\n| --- | --- | --- |\n| Failure | Response | Recovery / cleanup |\n\n",
    );
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
