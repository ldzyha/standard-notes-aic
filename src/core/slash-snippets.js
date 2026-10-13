import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { securityTemplate } from "./security-model.js";

export const SLASH_SNIPPETS_CORE_VERSION = "2.0.0";
export const SLASH_SNIPPET_PLACEHOLDER =
  "Write in Markdown… Type / for templates";

const GROUP_BY_COMMAND = Object.freeze({
  aic: "blocks",
  list: "blocks",
  "list-numbered": "blocks",
  checklist: "blocks",
  table: "blocks",
  code: "blocks",
  details: "blocks",
  section: "sections",
  glossary: "sections",
  bibliography: "sections",
  "high-level-design": "sections",
  "detailed-view": "sections",
  "error-handling": "sections",
  "test-cases": "sections",
  "open-question": "sections",
  flowchart: "diagrams",
  sequence: "diagrams",
  "state-diagram": "diagrams",
});

const define = (command, kind, title, question, template, searchTerms = []) =>
  Object.freeze({
    command,
    kind,
    group: GROUP_BY_COMMAND[command],
    title,
    question,
    template,
    searchTerms: Object.freeze([...searchTerms]),
  });

// Sections follow the DDK block shape: title, one italic question, answer in
// the simplest fitting format. Blocks and diagrams are plain Markdown primitives.
export const DOCUMENTATION_SNIPPETS = Object.freeze([
  define(
    "aic",
    "block",
    "AIC block (fields, secrets, codes)",
    "Which fields, secrets and one-time codes belong together?",
    securityTemplate(),
    [
      "security",
      "password",
      "authenticator",
      "two-factor",
      "2fa",
      "secret",
      "fields",
      "properties",
      "credentials",
    ],
  ),
  define(
    "list",
    "block",
    "List",
    "Which separate points answer the current question, with one idea per item?",
    [
      "- ${1:What is the first point?}",
      "- ${2:Which distinct point belongs here?}",
      "- ${3:What else matters at this level?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "list-numbered",
    "block",
    "Numbered list",
    "Which points need an explicit order, with one idea per item?",
    [
      "1. ${1:What comes first?}",
      "2. ${2:What follows?}",
      "3. ${3:What completes the sequence?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "checklist",
    "block",
    "Checklist",
    "What needs to be done or checked, one item at a time?",
    "- [ ] ${1:What needs to be done?}${0}",
    ["checkbox", "tasklist"],
  ),
  define(
    "table",
    "block",
    "Table",
    "Which items share the same fields and are clearer to read row by row?",
    [
      "| ${1:Item} | ${2:Detail} |",
      "| --- | --- |",
      "| ${3:First item} | ${4:What should the reader know?} |",
      "| ${5:Second item} | ${6:What should the reader know?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "code",
    "block",
    "Code block",
    "Which code or configuration fragment does the reader need?",
    ["```${1:language}", "${2:code}", "```", "", "${0}"].join("\n"),
  ),
  define(
    "details",
    "block",
    "Collapsible details",
    "Which supporting detail is useful on demand?",
    [
      ">>>|open| ${1:Summary}",
      "",
      "${2:Supporting detail}",
      "",
      "<<<",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "section",
    "section",
    "Section",
    "What does the reader need to know or do?",
    [
      "## ${1:Title}",
      "",
      "*${2:What does the reader need to know or do?}*",
      "",
      "${3:Answer}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "glossary",
    "section",
    "Glossary",
    "Which terms need a shared definition?",
    [
      "## Glossary",
      "",
      "*Which terms need a shared definition?*",
      "",
      "- **${1:Term}** - ${2:definition}",
      "- **${3:Term}** - ${4:definition}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "bibliography",
    "section",
    "Bibliography",
    "Which sources support this document?",
    [
      "## Bibliography",
      "",
      "*Which sources support this document?*",
      "",
      "- ${1:Title} - ${2:Author} (${3:link})",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "high-level-design",
    "section",
    "High-level design",
    "How do the main parts work together?",
    [
      "## High-level design",
      "",
      "*How do the main parts work together?*",
      "",
      "```mermaid",
      "flowchart LR",
      '    entry["${1:Entry point}"]',
      '    module["${2:Shared module}"]',
      '    data["${3:Data store}"]',
      "",
      '    entry -->|"${4:request}"| module',
      '    module -->|"${5:read / write}"| data',
      "```",
      "",
      "| Part | Responsibility | Dependency |",
      "| --- | --- | --- |",
      "| ${1:Entry point} | ${6:Responsibility} | ${7:Dependency} |",
      "| ${2:Shared module} | ${8:Responsibility} | ${9:Dependency} |",
      "| ${3:Data store} | ${10:Responsibility} | ${11:Dependency} |",
      "",
      "${0}",
    ].join("\n"),
    ["high-level"],
  ),
  define(
    "detailed-view",
    "section",
    "Detailed view",
    "What happens step by step, and who owns each step?",
    [
      "## Detailed view",
      "",
      "*What happens step by step, and who owns each step?*",
      "",
      "| Step | Owner | Behavior | Completion condition |",
      "| --- | --- | --- | --- |",
      "| 1 | ${1:Owner} | ${2:Behavior} | ${3:Completion condition} |",
      "| 2 | ${4:Owner} | ${5:Behavior} | ${6:Completion condition} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "error-handling",
    "section",
    "Error handling",
    "What can fail, and how should the system respond?",
    [
      "## Error handling",
      "",
      "*What can fail, and how should the system respond?*",
      "",
      "| Failure | Response | Recovery / cleanup |",
      "| --- | --- | --- |",
      "| ${1:Failure} | ${2:Response} | ${3:Recovery / cleanup} |",
      "",
      "${0}",
    ].join("\n"),
    ["errors"],
  ),
  define(
    "test-cases",
    "section",
    "Test cases",
    "How will we verify the expected behavior?",
    [
      "## Test cases",
      "",
      "*How will we verify the expected behavior?*",
      "",
      "| Scenario / precondition | Action | Expected result |",
      "| --- | --- | --- |",
      "| ${1:Scenario / precondition} | ${2:Action} | ${3:Expected result} |",
      "",
      "${0}",
    ].join("\n"),
    ["verification"],
  ),
  define(
    "open-question",
    "section",
    "Open question",
    "What do we still need to decide?",
    [
      "## Open question",
      "",
      "*What do we still need to decide?*",
      "",
      "${1:State the decision, the options, and who decides.}",
      "",
      "${0}",
    ].join("\n"),
    ["open-questions"],
  ),
  define(
    "flowchart",
    "block",
    "Flowchart",
    "How do the parts connect, flow or branch?",
    [
      "```mermaid",
      "flowchart LR",
      '    start["${1:Start}"]',
      '    check{"${2:Decision?}"}',
      '    done["${3:Result}"]',
      '    other["${4:Other result}"]',
      "",
      '    start -->|"${5:action}"| check',
      '    check -->|"${6:yes}"| done',
      '    check -->|"${7:no}"| other',
      "```",
      "",
      "*${8:What to read from the diagram, and which paths were left out.}*",
      "",
      "${0}",
    ].join("\n"),
    ["mermaid"],
  ),
  define(
    "sequence",
    "block",
    "Sequence diagram",
    "Which messages pass between the actors, in what order?",
    [
      "```mermaid",
      "sequenceDiagram",
      "    participant a as ${1:Actor}",
      "    participant b as ${2:Other actor}",
      "    a->>b: ${3:request}",
      "    b-->>a: ${4:response}",
      "```",
      "",
      "*${5:What to read from the diagram, and which paths were left out.}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "state-diagram",
    "block",
    "State diagram",
    "Which states can one thing be in, and what moves it between them?",
    [
      "```mermaid",
      "stateDiagram-v2",
      '    state "${1:First state}" as first',
      '    state "${2:Next state}" as next',
      "",
      "    [*] --> first",
      "    first --> next: ${3:event}",
      "    next --> [*]: ${4:event}",
      "```",
      "",
      "*${5:What to read from the diagram, and which paths were left out.}*",
      "",
      "${0}",
    ].join("\n"),
  ),
]);

function codeContext(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedCode" || node.name === "InlineCode") return true;
    node = node.parent;
  }
  return false;
}

function surroundingHeadingLevel(source) {
  let level = 0;
  let fence = null;
  let frontmatter = false;
  const lines = source.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index === 0 && line === "---") {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (/^(?:---|\.\.\.)\s*$/u.test(line)) frontmatter = false;
      continue;
    }
    const run = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (run) {
      if (!fence) fence = run[1];
      else if (
        run[1][0] === fence[0] &&
        run[1].length >= fence.length &&
        !run[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})(?:\s|$)/u.exec(line);
    if (heading) level = heading[1].length;
  }
  return level;
}

export function slashSnippetTemplate(entry, sourceBeforeCursor = "") {
  if (entry.kind !== "section") return entry.template;
  const headings = [...entry.template.matchAll(/^(#{1,6})\s/gmu)];
  if (!headings.length) return entry.template;
  const base = Math.min(...headings.map((match) => match[1].length));
  const target = Math.min(6, surroundingHeadingLevel(sourceBeforeCursor) + 1);
  return entry.template.replace(/^(#{1,6})(?=\s)/gmu, (heading) =>
    "#".repeat(Math.min(6, target + heading.length - base)),
  );
}

/** Search aliases share one catalog item and never change the visible command. */
export function slashSnippetSearchText(entry) {
  return [entry.command, ...(entry.searchTerms ?? [])]
    .map((term) => "/" + term)
    .join(" ");
}

export function slashSnippetToken(lineBeforeCursor) {
  const match = /\/[\p{L}\p{N}_-]*$/u.exec(lineBeforeCursor);
  if (!match || lineBeforeCursor.slice(0, match.index).trim()) return null;
  return match[0];
}

export function slashSnippetQuery(state, pos) {
  if (state.readOnly || codeContext(state, pos)) return null;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const text = slashSnippetToken(before);
  if (!text) return null;
  return Object.freeze({
    from: pos - text.length,
    to: pos,
    text,
    hasPageContent:
      state.doc
        .sliceString(0, pos - text.length)
        .concat(state.doc.sliceString(pos))
        .trim().length > 0,
  });
}

export const SLASH_SNIPPET_GROUP_NAMES = Object.freeze({
  blocks: "Blocks",
  sections: "Sections",
  diagrams: "Diagrams",
});

const GROUP_ORDER = Object.freeze(["blocks", "sections", "diagrams"]);

/** One fixed group order; hosts may still pass their page-content flag. */
export function slashSnippetSections() {
  return Object.freeze(
    Object.fromEntries(
      GROUP_ORDER.map((group, rank) => [
        group,
        Object.freeze({ name: SLASH_SNIPPET_GROUP_NAMES[group], rank }),
      ]),
    ),
  );
}

export function slashSnippetCompletions(context) {
  const query = slashSnippetQuery(context.state, context.pos);
  if (!query) return null;
  const menuSections = slashSnippetSections(query.hasPageContent);
  const sourceBeforeCursor = context.state.sliceDoc(0, query.from);
  return {
    from: query.from,
    options: DOCUMENTATION_SNIPPETS.map((entry) =>
      snippetCompletion(slashSnippetTemplate(entry, sourceBeforeCursor), {
        label: slashSnippetSearchText(entry),
        ...(entry.searchTerms.length
          ? { displayLabel: "/" + entry.command, sortText: "/" + entry.command }
          : {}),
        detail: entry.title,
        type: "text",
        section: menuSections[entry.group],
      }),
    ),
    validFor: /^\/[\p{L}\p{N}_-]*$/u,
  };
}

export function slashSnippetExtension() {
  return autocompletion({
    override: [slashSnippetCompletions],
    activateOnTyping: true,
    activateOnTypingDelay: 0,
    maxRenderedOptions: 40,
    icons: false,
  });
}
