import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

export const SLASH_SNIPPETS_CORE_VERSION = "1.1.0";
export const SLASH_SNIPPET_PLACEHOLDER =
  "Write in Markdown… Type / for templates";

const GROUP_BY_COMMAND = Object.freeze({
  page: "pages",
  "page-architecture": "pages",
  "page-capability": "pages",
  "page-decision": "pages",
  purpose: "structure",
  "high-level": "structure",
  "owned-detail": "structure",
  errors: "assurance",
  verification: "assurance",
  "open-questions": "assurance",
  bibliography: "references",
  glossary: "references",
  "mapping-table": "data",
  comparison: "data",
  tasks: "data",
  flowchart: "diagrams",
  sequence: "diagrams",
  "class-diagram": "diagrams",
  timeline: "diagrams",
  code: "content",
  details: "content",
  synthesis: "content",
});

const define = (command, kind, title, question, template) =>
  Object.freeze({
    command,
    kind,
    group: GROUP_BY_COMMAND[command],
    title,
    question,
    template,
  });

export const DOCUMENTATION_SNIPPETS = Object.freeze([
  define(
    "page",
    "page",
    "Progressive documentation page",
    "What single question does this page own, and how should understanding deepen from top to bottom?",
    [
      "# ${1:Page title}",
      "",
      "> **Purpose:** ${2:What does this page own, what outcome does it enable, and what remains outside its boundary?}",
      "",
      "## High-level design",
      "",
      "*${3:What single question does this page answer, and from which perspective?}*",
      "",
      "${4:Give the highest-level answer using one primary representation.}",
      "",
      "## ${5:Owned detail}",
      "",
      "*${6:What must the reader understand next?}*",
      "",
      "${7:Explain the lifecycle progressively from intent to structure, execution, and edge cases.}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "page-architecture",
    "page",
    "Architecture ownership page",
    "Which modules own each contract, and how do dependencies cross those ownership boundaries?",
    [
      "# ${1:System or capability}",
      "",
      "> **Purpose:** ${2:What architecture does this page own, for whom, and at what abstraction level?}",
      "",
      "## High-level design",
      "",
      "*${3:Which stable modules and ownership boundaries answer the page question?}*",
      "",
      "```mermaid",
      "classDiagram",
      "direction LR",
      "class ${4:Owner}",
      "class ${5:Consumer}",
      "${5} --> ${4}: ${6:uses contract}",
      "```",
      "",
      "## ${7:Owned contract}",
      "",
      "${8:What input, responsibility, output, and boundary belong to this owner?}",
      "",
      "## Runtime implications",
      "",
      "${9:How does this structure affect execution, failure isolation, or change scope?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "page-capability",
    "page",
    "Capability profile page",
    "Which shopper-visible behavior is enabled by configured, allowlisted, and valid data?",
    [
      "# ${1:Capability profile}",
      "",
      "> **Purpose:** ${2:Which business-visible capability does this page define, and what does it deliberately not infer?}",
      "",
      "## Capability contract",
      "",
      "*${3:What outcome can the user observe?}*",
      "",
      "${4:State the behavior in business language before implementation detail.}",
      "",
      "## Applicability",
      "",
      "| Requirement | Enabling data or configuration | When absent |",
      "| --- | --- | --- |",
      "| ${5:Capability condition} | ${6:Validated input} | ${7:Behavior remains absent} |",
      "",
      "## Delivery delta",
      "",
      "| Requested outcome | Existing reusable capability | Product contribution or reusable development |",
      "| --- | --- | --- |",
      "| ${8:Visible change} | ${9:Current support} | ${10:Delivery class and reason} |",
      "",
      "## Verification",
      "",
      "| Case or scope | Expected result or verification |",
      "| --- | --- |",
      "| ${11:Acceptance fixture} | ${12:Observable result} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "page-decision",
    "page",
    "Decision and migration page",
    "What is being decided, what evidence supports it, and how does the system move safely from current to target?",
    [
      "# ${1:Decision title}",
      "",
      "> **Purpose:** ${2:What decision does this page own, what outcome follows, and what is outside its scope?}",
      "",
      "## Context",
      "",
      "*${3:Which current constraint or problem makes a decision necessary?}*",
      "",
      "${4:Summarize the evidence and relevant boundary.}",
      "",
      "## Decision",
      "",
      "${5:State the chosen direction and its owner directly.}",
      "",
      "## Migration path",
      "",
      "1. ${6:First safe transition}",
      "2. ${7:Next transition with verification}",
      "3. ${8:Completion and cleanup boundary}",
      "",
      "## Consequences",
      "",
      "| Effect | Benefit, cost, or recovery |",
      "| --- | --- |",
      "| ${9:Material consequence} | ${10:Why it is acceptable or how it is handled} |",
      "",
      "## Open questions",
      "",
      "1. ${11:Which genuine unresolved decision remains?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "bibliography",
    "section",
    "Bibliography section",
    "Which external or related sources does the reader need before the page can answer its question?",
    [
      "## Bibliography",
      "",
      "- [${1:Source or page title}](${2:URL}) — ${3:Why is this source relevant?}",
      "- [${4:Related owner page}](${5:URL})",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "glossary",
    "section",
    "Page-local glossary",
    "Which terms could change the reader's interpretation of this page?",
    [
      "## Glossary",
      "",
      "| Term | Meaning | Example or detail |",
      "| --- | --- | --- |",
      "| ${1:Term} | ${2:What does it mean in this page?} | ${3:What example removes ambiguity?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "purpose",
    "section",
    "Purpose boundary",
    "What does this page own, what outcome does it enable, and what remains outside its boundary?",
    [
      "> **Purpose:** ${1:What does this page own, what outcome does it enable, and what remains outside its boundary?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "high-level",
    "section",
    "High-level answer",
    "What is the highest useful answer to the page's central question?",
    [
      "## High-level design",
      "",
      "*${1:What should the reader understand before any implementation detail?}*",
      "",
      "${2:Answer with one diagram, table, list, or prose representation.}",
      "",
      "*${3:Why does this structure matter or what does it lead to?}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "owned-detail",
    "section",
    "Owned detail section",
    "Which next layer belongs on this page rather than in a different owner?",
    [
      "## ${1:Owned subject}",
      "",
      "*${2:What specific question does this section answer?}*",
      "",
      "${3:Lead with the direct answer.}",
      "",
      "${4:Add only the supporting lifecycle, contract, or edge-case detail needed here.}",
      "",
      "*${5:What relationship or consequence should the reader retain?}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "errors",
    "section",
    "Error handling section",
    "Which failures materially change continuation, observability, recovery, or partial success?",
    [
      "## Error handling",
      "",
      "| Condition | Behavior or recovery |",
      "| --- | --- |",
      "| ${1:Material failure condition} | ${2:What stops or continues, what is observable, and how is it recovered?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "verification",
    "section",
    "Verification section",
    "Which branches, contracts, integrations, or failure paths need observable proof?",
    [
      "## Verification",
      "",
      "| Case or scope | Expected result or verification |",
      "| --- | --- |",
      "| ${1:Case, branch, or contract} | ${2:What observable result proves it?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "open-questions",
    "section",
    "Open questions section",
    "Which unresolved decisions would materially change ownership, architecture, contract, or scope?",
    [
      "## Open questions",
      "",
      "1. ${1:Which genuine unresolved decision remains?}",
      "2. ${2:Which independent decision still needs an owner?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "mapping-table",
    "block",
    "Repeated mapping table",
    "Which entities share one stable set of fields that is easier to compare row by row?",
    [
      "| ${1:Entity} | ${2:Owner or input} | ${3:Behavior or output} |",
      "| --- | --- | --- |",
      "| ${4:First entity} | ${5:Who defines it or what enables it?} | ${6:What result follows?} |",
      "| ${7:Second entity} | ${8:Who defines it or what enables it?} | ${9:What result follows?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "comparison",
    "block",
    "Current and target comparison",
    "Which differences affect behavior, ownership, migration, or acceptance?",
    [
      "| Concern | Current behavior | Target behavior | Owner or migration step |",
      "| --- | --- | --- | --- |",
      "| ${1:Material concern} | ${2:What happens now?} | ${3:What should happen?} | ${4:Who changes it or how?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "flowchart",
    "block",
    "Process or decision flowchart",
    "Which decisions, branches, or transformations are difficult to understand linearly?",
    [
      "```mermaid",
      "flowchart LR",
      '    A["${1:Input or central question}"] --> B["${2:Owned decision or process}"]',
      '    B --> C["${3:Outcome or consumer}"]',
      '    B -. "${4:failure or optional path}" .-> D["${5:Recovery or omission}"]',
      "```",
      "",
      "*${6:What conclusion should the reader draw from this flow?}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "sequence",
    "block",
    "Runtime sequence diagram",
    "Which calls, responses, ordering constraints, or lifecycle timing must remain explicit?",
    [
      "```mermaid",
      "sequenceDiagram",
      "    participant A as ${1:Actor}",
      "    participant O as ${2:Owner}",
      "    participant C as ${3:Consumer}",
      "    A->>O: ${4:Input or request}",
      "    O->>O: ${5:Validation or processing}",
      "    O-->>C: ${6:Result or event}",
      "```",
      "",
      "*${7:Which ordering or ownership fact does this sequence establish?}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "class-diagram",
    "block",
    "Module ownership diagram",
    "Which modules, contracts, dependencies, and stable ownership boundaries matter?",
    [
      "```mermaid",
      "classDiagram",
      "direction LR",
      "class ${1:Owner}",
      "class ${2:Consumer}",
      "class ${3:Dependency}",
      "${2} --> ${1}: ${4:uses contract}",
      "${1} --> ${3}: ${5:delegates capability}",
      "```",
      "",
      "*${6:Which fact has one owner, and which modules only consume it?}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "timeline",
    "block",
    "Delivery or lifecycle timeline",
    "Which real phases or duration explain how the entity changes over time?",
    [
      "```mermaid",
      "timeline",
      "    title ${1:Lifecycle or delivery progression}",
      "    ${2:Current phase} : ${3:Current state or evidence}",
      "    ${4:Transition phase} : ${5:Change and verification}",
      "    ${6:Target phase} : ${7:Accepted outcome}",
      "```",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "code",
    "block",
    "Code example",
    "Which minimal executable or configuration fragment proves the behavior without taking over the explanation?",
    [
      "```${1:language}",
      "${2:Minimal relevant code or configuration}",
      "```",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "details",
    "block",
    "Optional details accordion",
    "Which supporting detail is useful on demand but would interrupt the primary reading path?",
    [
      ">>>|open| ${1:Supporting detail}",
      "",
      "${2:What optional evidence, example, or implementation note belongs here?}",
      "",
      "<<<",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "tasks",
    "block",
    "Verification task list",
    "Which concrete checks must be completed without turning unresolved decisions into tasks?",
    [
      "- [ ] ${1:Verify the primary behavior}",
      "- [ ] ${2:Verify the material failure or boundary}",
      "- [ ] ${3:Verify ownership, links, and absence of duplication}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "synthesis",
    "block",
    "Section synthesis",
    "What relationship, consequence, or decision follows from the section without repeating it?",
    [
      "*${1:Why does this section matter, and what follows from it?}*",
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

export function slashSnippetQuery(state, pos) {
  if (state.readOnly || codeContext(state, pos)) return null;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const match = /\/[\p{L}\p{N}_-]*$/u.exec(before);
  if (!match || before.slice(0, match.index).trim()) return null;
  const text = match[0];
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

const GROUP_NAMES = Object.freeze({
  pages: "Page templates",
  structure: "Page structure",
  assurance: "Risks & verification",
  references: "References",
  data: "Tables & lists",
  diagrams: "Diagrams",
  content: "Content blocks",
});

function sections(hasPageContent) {
  const order = hasPageContent
    ? [
        "structure",
        "assurance",
        "references",
        "data",
        "diagrams",
        "content",
        "pages",
      ]
    : [
        "pages",
        "structure",
        "assurance",
        "references",
        "data",
        "diagrams",
        "content",
      ];
  return Object.freeze(
    Object.fromEntries(
      order.map((group, rank) => [
        group,
        Object.freeze({ name: GROUP_NAMES[group], rank }),
      ]),
    ),
  );
}

export function slashSnippetCompletions(context) {
  const query = slashSnippetQuery(context.state, context.pos);
  if (!query) return null;
  const menuSections = sections(query.hasPageContent);
  return {
    from: query.from,
    options: DOCUMENTATION_SNIPPETS.map((entry) =>
      snippetCompletion(entry.template, {
        label: "/" + entry.command,
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
    maxRenderedOptions: 40,
    icons: false,
  });
}
