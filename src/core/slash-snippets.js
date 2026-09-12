import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { NOTE_PROMPTS } from "./note-template.js";
import { securityTemplate } from "./security-model.js";

export const SLASH_SNIPPETS_CORE_VERSION = "1.2.0";
export const SLASH_SNIPPET_PLACEHOLDER =
  "Write in Markdown… Type / for templates";

const GROUP_BY_COMMAND = Object.freeze({
  page: "pages",
  "page-architecture": "pages",
  "page-capability": "pages",
  "page-decision": "pages",
  section: "structure",
  context: "structure",
  noise: "structure",
  wave: "structure",
  implementation: "structure",
  "high-level": "structure",
  "owned-detail": "structure",
  errors: "assurance",
  verification: "assurance",
  "open-questions": "assurance",
  bibliography: "references",
  glossary: "references",
  list: "data",
  "list-numbered": "data",
  checklist: "data",
  table: "data",
  "mapping-table": "data",
  comparison: "data",
  tasks: "data",
  flowchart: "diagrams",
  "entity-map": "diagrams",
  sequence: "diagrams",
  "class-diagram": "diagrams",
  timeline: "diagrams",
  code: "content",
  details: "content",
  security: "content",
  synthesis: "content",
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

export const DOCUMENTATION_SNIPPETS = Object.freeze([
  define(
    "page",
    "page",
    "Progressive documentation page",
    "Which questions does this page answer, for which reader, and where should they go deeper?",
    [
      "# ${1:Page title}",
      "",
      "**Questions**",
      "",
      "- ${2:What does the reader need to understand or do?}",
      "- ${3:Which related question needs another perspective?}",
      "",
      "**Answer.** ${4:Give the useful answer now. Combine text, lists, tables or diagrams only where they help; distinguish facts, recommendations and unknowns.}",
      "",
      "## ${5:Subject to explore}",
      "",
      "**${6:Which part of the answer needs a closer look?}**",
      "",
      "${7:Answer at this scale. Link to parent context and shared definitions instead of repeating them.}",
      "",
      "### ${8:Further detail, if useful}",
      "",
      "**${9:What does the reader need to know next?}**",
      "",
      "${10:Add the evidence or explanation needed for this question; remove details that do not help.}",
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
      "**${2:How is this system composed, and how do its parts work together?}**",
      "",
      "${3:Answer at the useful scale for the reader. Name the system boundary and link to inherited context.}",
      "",
      "## Structure and dependencies",
      "",
      "**${4:Which entities are contained here, and which are external dependencies?}**",
      "",
      "${5:Describe the relationships. Add an entity map or class diagram if it explains them better.}",
      "",
      "## ${6:Contract or interaction to explore}",
      "",
      "**${7:Which inputs, outputs, transitions or responsibilities need more detail?}**",
      "",
      "${8:Explain this part; link to a child or shared module when its own description is needed.}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "page-capability",
    "page",
    "Capability profile page",
    "Which observable behavior is needed, what already supports it, and what remains unknown?",
    [
      "# ${1:Capability profile}",
      "",
      "**${2:What should the user be able to do or observe?}**",
      "",
      "${3:Answer in the reader's language. State the behavior and its boundary before implementation detail.}",
      "",
      "## Conditions",
      "",
      "**${4:Under which conditions is this behavior available?}**",
      "",
      "| Condition | Existing support or evidence | Behavior outside the condition |",
      "| --- | --- | --- |",
      "| ${5:Required condition} | ${6:Actual capability or configuration} | ${7:Known behavior or open decision} |",
      "",
      "## Delivery delta",
      "",
      "**What needed capability is missing from existing functionality and configuration?**",
      "",
      "| Requested outcome | Existing reusable capability | Product contribution or reusable development |",
      "| --- | --- | --- |",
      "| ${8:Visible change} | ${9:Current support} | ${10:Delivery class and reason} |",
      "",
      "## Verification",
      "",
      "**How will the reader know the expected behavior is present?**",
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
      "**${2:Which decision is needed, and what result should it enable?}**",
      "",
      "${3:State the recommended direction and why. Explicitly mark whether it is proposed, approved or still open.}",
      "",
      "## Context",
      "",
      "**Which current facts and constraints support this direction?**",
      "",
      "${4:Link to evidence and inherited context. Separate observed facts from expectations.}",
      "",
      "## Migration path",
      "",
      "**What changes, in which dependency order, and how is each result verified?**",
      "",
      "| Step | Prerequisite | Required change | Verifiable result |",
      "| --- | --- | --- | --- |",
      "| 1 | ${5:Initial prerequisite} | ${6:First safe change} | ${7:Observable result} |",
      "| 2 | Result of step 1 | ${8:Next change, including dependency removal if replacing a component} | ${9:Completion and cleanup criterion} |",
      "",
      "### Error handling",
      "",
      "**What if a transition fails?**",
      "",
      "${10:Name the affected step, failure signal, safe continuation or recovery and how to verify it.}",
      "",
      "## Consequences",
      "",
      "**Which benefits, costs and limits follow from this direction?**",
      "",
      "| Effect | Benefit, cost, or recovery |",
      "| --- | --- |",
      "| ${11:Material consequence} | ${12:Why it is acceptable or how it is handled} |",
      "",
      "## Open questions",
      "",
      "**What still needs review before proceeding?**",
      "",
      "${13:Name the unresolved choice, its effect and the evidence or decision needed. Remove this section if nothing remains open.}",
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
      "**Which sources does this answer rely on?**",
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
      "**Which terms need a local definition or a link to their shared definition?**",
      "",
      "| Term | Meaning | Example or detail |",
      "| --- | --- | --- |",
      "| ${1:Term} | ${2:What does it mean in this page?} | ${3:What example removes ambiguity?} |",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "section",
    "section",
    "Question and answer section",
    "Which part of the surrounding answer needs its own question, answer and further detail?",
    [
      "## ${1:Subject at this scale}",
      "",
      "**${2:Which question or related questions does this section answer?}**",
      "",
      "${3:Give the direct answer. Use the forms that make it understandable.}",
      "",
      "${4:Add needed evidence or further detail; link to shared definitions instead of repeating them.}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "high-level",
    "section",
    "High-level answer",
    "How is the solution arranged overall, and how do its main parts relate?",
    [
      "## High-level design",
      "",
      "**${1:What should the reader understand before implementation detail?}**",
      "",
      "${2:Give the overall answer. Combine text with a diagram, table or list where it helps.}",
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
      "**${2:Which part of the surrounding answer does this section explain?}**",
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
      "### Error handling",
      "",
      "**Which implementation step can fail, and what should happen then?**",
      "",
      "| Step and condition | Behavior or recovery | Verifiable result |",
      "| --- | --- | --- |",
      "| ${1:Affected step and failure signal} | ${2:What stops or continues, and how is it recovered?} | ${3:How is safe recovery observed?} |",
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
      "**Which scenarios prove the answer, including its boundaries and failures?**",
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
      "**What is not yet known or agreed, and how does it affect the answer?**",
      "",
      "- ${1:Unresolved question} — ${2:Impact and evidence or decision needed}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "context",
    "section",
    "Parent and shared context",
    "Which parent descriptions and shared definitions does this local answer depend on?",
    [
      "## Context and relationships",
      "",
      "**What is inherited, and what does this description add?**",
      "",
      "${1:Name the local subject and boundary without copying the parent's explanation.}",
      "",
      "- Parent: [${2:Parent description}](${3:parent.md}) — ${4:Which context is inherited?}",
      "- Shared definition: [${5:Module or rule}](${6:shared.md}) — ${7:How is it used here? This need not be a parent.}",
      "- Detail: [${8:Child description}](${9:detail.md}) — ${10:Which part is explained at a closer scale?}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "noise",
    "section",
    "Noise to investigate",
    "What is unclear, where did it arise, and what must be learned before there is an executable path?",
    [
      "## Noise — ${1:Unclear subject}",
      "",
      `**${NOTE_PROMPTS.noiseQuestion}**`,
      "",
      "${2:Describe the need or uncertainty. Is this an unknown task, a short interruption or residual context from completed work?}",
      "",
      `**${NOTE_PROMPTS.noiseContext}**`,
      "",
      "${3:Link to the originating task or context. Explain the impact and whether work can continue.}",
      "",
      `**${NOTE_PROMPTS.noiseResearch}**`,
      "",
      "- ${4:Question to investigate} — ${5:Available evidence and next observation or conversation}",
      "",
      `**${NOTE_PROMPTS.noiseOutcome}**`,
      "",
      "${6:Record what became clear. Build the wave instruction in this same note when there is one task; link separate waves only for distinct results. A pause or justified refusal may also resolve the noise.}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "wave",
    "section",
    "Wave with an executable path",
    "What result will this task produce, in which dependency order, and how will it be verified?",
    [
      "## Wave — ${1:Expected result}",
      "",
      `**${NOTE_PROMPTS.waveResult}**`,
      "",
      "${2:State the observable result. Keep the originating noise and context linked in this same note.}",
      "",
      `**${NOTE_PROMPTS.waveBoundary}**`,
      "",
      "${3:Define the boundary, prerequisites and dependencies. If there are distinct results, link their separate waves.}",
      "",
      "### Instruction",
      "",
      `**${NOTE_PROMPTS.waveInstruction}**`,
      "",
      "| Step | Prerequisite | Action | Verifiable result |",
      "| --- | --- | --- | --- |",
      "| 1 | ${4:Required starting condition} | ${5:First action} | ${6:Evidence this step is complete} |",
      "| 2 | Result of step 1 | ${7:Next dependent action} | ${8:Evidence the expected result is reached} |",
      "",
      "#### Deviations and new noise",
      "",
      `**${NOTE_PROMPTS.waveDeviation}**`,
      "",
      "${9:Name known deviations and recovery. Clarify small noises and continue; link out noise needing separate research. Stop dependent work if its path is no longer understood.}",
      "",
      "### Result and closure",
      "",
      `**${NOTE_PROMPTS.waveClosure}**`,
      "",
      "${10:Record evidence of the result or a justified refusal. Keep unresolved noise linked; distinguish it from residual context that needs a pause or attention reset.}",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "implementation",
    "section",
    "Dependency-ordered implementation",
    "What must change, under which prerequisites, and what observable result confirms each step?",
    [
      "## Implementation",
      "",
      "**What changes are needed to produce the described answer?**",
      "",
      "${1:State the implementation direction and whether it is recommended or agreed. Link to required contracts and definitions.}",
      "",
      "| Step | Prerequisite | Required change | Verifiable result |",
      "| --- | --- | --- | --- |",
      "| 1 | ${2:Known prerequisite} | ${3:First change} | ${4:Observable result} |",
      "| 2 | Result of step 1 | ${5:Dependent change} | ${6:Completion criterion, including removal of replaced dependencies} |",
      "",
      "### Error handling",
      "",
      "**What changes when a step fails or returns an unexpected result?**",
      "",
      "| Step and condition | Behavior or recovery | Verifiable result |",
      "| --- | --- | --- |",
      "| ${7:Affected step and failure signal} | ${8:Safe continuation or recovery} | ${9:Evidence recovery worked} |",
      "",
      "${0}",
    ].join("\n"),
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
    "States and event transitions",
    "Which states can this entity occupy, and which events and conditions change its state?",
    [
      "**${1:Which entity or nested process is shown, at what scale?}**",
      "",
      "```mermaid",
      "flowchart LR",
      '    A["${2:Initial state}"] -->|"${3:Starting event}"| B["${4:In-progress state}"]',
      '    B -->|"${5:Success event or condition}"| C["${6:Completed state}"]',
      '    B -->|"${7:Failure event}"| D["${8:Failure state}"]',
      '    D -->|"${9:Recovery event}"| B',
      "```",
      "",
      "*${10:Explain the boundary and link to a closer description of a state or transition when needed.}*",
      "",
      "${0}",
    ].join("\n"),
  ),
  define(
    "entity-map",
    "block",
    "Entity overview and drill-down",
    "Which main entities are related, and where can the reader explore each at a closer scale?",
    [
      "**${1:Which system and its main entities does this overview cover?}**",
      "",
      "```mermaid",
      "flowchart TB",
      "    %% aic:entity-map",
      '    System["${2:System}"] -->|contains| Module["${3:Module}"]',
      '    Module -->|contains| Component["${4:Component}"]',
      '    Module -. depends on .-> Shared["${5:Shared module}"]',
      "```",
      "",
      "- [${3:Module}](${6:module.md}) — ${7:Which lifecycle or structure is described here?}",
      "- [${4:Component}](${8:component.md}) — ${9:Which closer interaction or process is described here?}",
      "- [${5:Shared module}](${10:shared.md}) — ${11:Which common definition is owned here?}",
      "",
      "*An entity map explains composition and relationships; use /timeline for chronological events.*",
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
      "**Which participants interact, and in what order?**",
      "",
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
      "class ${2:ContainedEntity}",
      "class ${3:Dependency}",
      "${1:Owner} *-- ${2:ContainedEntity}: ${4:contains}",
      "${1:Owner} ..> ${3:Dependency}: ${5:depends on}",
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
    "Chronological events timeline",
    "Which events or phases occurred first and next, and which dates or periods matter?",
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
  define(
    "security",
    "block",
    "Security block",
    "Which service, login, one-time code and labeled credentials belong together?",
    securityTemplate(),
    ["password", "authenticator", "two-factor", "2fa", "secret"],
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
  pages: "Pages",
  structure: "Structure",
  assurance: "Review",
  references: "References",
  data: "Tables & lists",
  diagrams: "Diagrams",
  content: "Blocks",
});

export function slashSnippetSections(hasPageContent) {
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
