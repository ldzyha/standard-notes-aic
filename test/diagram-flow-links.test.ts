import { snippet } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { createDiagramBuilder } from "../src/core/diagram-builder.js";
import { parseDiagram, serializeDiagram } from "../src/core/diagram-model.js";
import { DOCUMENTATION_SNIPPETS } from "../src/core/slash-snippets.js";

afterEach(() => document.body.replaceChildren());

const screenshotSource = `flowchart LR
 A["Input or central question"] --> B["Owned decision or process"]
 B --> C["Outcome or consumer"]
 B -. "Failure or optional path" .-> D["Recovery or omission"]
`;

function model(source: string) {
  const parsed = parseDiagram(source);
  if (!parsed.ok) throw new Error(`Line ${parsed.line}: ${parsed.reason}`);
  return parsed.model;
}

async function verifyRoundTrip(source: string) {
  await expect(mermaid.parse(source)).resolves.toBeTruthy();
  const before = model(source);
  const output = serializeDiagram(before);
  expect(model(output)).toEqual(before);
  await expect(mermaid.parse(output)).resolves.toBeTruthy();
  return before;
}

// Exercise the actual CodeMirror snippet expansion, including repeated fields,
// instead of implementing another approximation of the template syntax here.
function renderTemplate(template: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create() });
  try {
    snippet(template)(view, { label: "test" }, 0, 0);
    return view.state.doc.toString();
  } finally {
    view.destroy();
    parent.remove();
  }
}

describe("Mermaid flowchart label spellings", () => {
  it("opens the previously shipped flowchart screenshot visually without changing its source", async () => {
    const parsed = await verifyRoundTrip(screenshotSource);
    expect(parsed.nodes.map(({ id }) => id)).toEqual(["A", "B", "C", "D"]);
    expect(parsed.edges[2]).toMatchObject({
      from: "B",
      to: "D",
      kind: "-.->",
      label: "Failure or optional path",
    });
    const onApply = vi.fn();
    const builder = createDiagramBuilder(document, {
      source: screenshotSource,
      onApply,
    });
    document.body.append(builder.element);
    try {
      expect(await builder.whenRendered()).toBe(true);
      expect(
        builder.element.querySelector<HTMLTextAreaElement>(".aic-db-source")!
          .hidden,
      ).toBe(true);
      expect(builder.element.querySelectorAll("[data-node-id]")).toHaveLength(
        4,
      );
      expect(builder.apply()).toBe(true);
      expect(onApply).toHaveBeenCalledWith(screenshotSource);
    } finally {
      builder.destroy();
    }
  });

  // Documented Mermaid inline forms (Links between nodes):
  // https://mermaid.js.org/syntax/flowchart.html#links-between-nodes
  it.each([
    ["A -. depends on .-> B", "-.->", "depends on"],
    [
      'A -. "Failure or optional path" .-> B',
      "-.->",
      "Failure or optional path",
    ],
    ["A -- succeeds --> B", "-->", "succeeds"],
    ['A -- "Success or fallback" --> B', "-->", "Success or fallback"],
    ["A == priority ==> B", "==>", "priority"],
    ['A == "Important event" ==> B', "==>", "Important event"],
    ["A -- association --- B", "---", "association"],
    ['A -- "Related entity" --- B', "---", "Related entity"],
    ['A -.->|"Optional event"| B', "-.->", "Optional event"],
    ["A -->|success| B", "-->", "success"],
    ['A ==>|"Priority event"| B', "==>", "Priority event"],
  ])("retains the meaning of %s", async (statement, kind, label) => {
    const parsed = await verifyRoundTrip(`flowchart LR\n ${statement}`);
    expect(parsed.edges).toEqual([
      { id: "E1", from: "A", to: "B", kind, label },
    ]);
  });

  it.each([
    ['A["A --> B stays text"] --> B["Next"]', "A --> B stays text", ""],
    [
      'A["A .-> B stays text"] -. "when --> is literal" .-> B["Next"]',
      "A .-> B stays text",
      "when --> is literal",
    ],
    [
      'A["A ==> B stays text"] == "when ==> is literal" ==> B["Next"]',
      "A ==> B stays text",
      "when ==> is literal",
    ],
    [
      'A["A ] --> B stays text"] -->|"literal | --> label"| B["Next"]',
      "A ] --> B stays text",
      "literal | --> label",
    ],
    [
      'A["Start"] -. "literal .-> delimiter" .-> B["Next"]',
      "Start",
      "literal .-> delimiter",
    ],
  ])(
    "does not turn quoted arrows into additional connections: %s",
    async (statement, nodeLabel, edgeLabel) => {
      const parsed = await verifyRoundTrip(`flowchart LR\n ${statement}`);
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.nodes[0]!.label).toBe(nodeLabel);
      expect(parsed.edges).toHaveLength(1);
      expect(parsed.edges[0]).toMatchObject({
        from: "A",
        to: "B",
        label: edgeLabel,
      });
    },
  );

  it.each([
    "A --> B --> C",
    "A -. optional .-> B --> C",
    "A -- first --> B == second ==> C",
    "A -- first ==> B --> C",
    'A -. "label" .-> B; C --> D',
    'A -. "unterminated .-> B',
    'A -. "first" "second" .-> B',
    'A -. label .-> B["Next"] unsupported',
    'A["Start"] --> B((Circle))',
    'A["Start"] --> B:::styled',
    "A & B --> C",
    "A---oB",
    'A["Unclosed --> B]',
    'A -. "unclosed .-> B["Next"]',
  ])(
    "keeps chains, unsupported syntax and malformed labels source-only: %s",
    (statement) => {
      const parsed = parseDiagram(`flowchart LR\n ${statement}`);
      expect(parsed.ok).toBe(false);
      expect(parsed).not.toHaveProperty("model");
    },
  );
});

describe("all shipped Mermaid templates", () => {
  const sourceOnlyTypes: Readonly<Record<string, string>> = {
    timeline: "timeline",
  };
  const diagramEntries = DOCUMENTATION_SNIPPETS.filter(({ template }) =>
    template.includes("```mermaid"),
  );

  it("includes the canonical flow, overview, class, sequence and intentional timeline examples", () => {
    expect(diagramEntries.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        "flowchart",
        "entity-map",
        "class-diagram",
        "sequence",
        "timeline",
      ]),
    );
  });

  it.each(diagramEntries)(
    "renders every /$command Mermaid fence and explicitly classifies visual support",
    async (entry) => {
      const expanded = renderTemplate(entry.template);
      const fences = [
        ...expanded.matchAll(/^```mermaid\s*\n([\s\S]*?)^```\s*$/gm),
      ];
      expect(fences.length).toBeGreaterThan(0);
      for (const fence of fences) {
        const source = fence[1]!;
        await expect(mermaid.parse(source)).resolves.toBeTruthy();
        const expectedSourceType = sourceOnlyTypes[entry.command];
        if (expectedSourceType) {
          expect(source.split("\n")[0]).toBe(expectedSourceType);
          const parsed = parseDiagram(source);
          expect(parsed.ok).toBe(false);
          expect(parsed).not.toHaveProperty("model");
        } else {
          const parsed = await verifyRoundTrip(source);
          if (entry.command === "entity-map") {
            expect(
              parsed.comments.some((comment) =>
                comment.includes("%% aic:entity-map"),
              ),
            ).toBe(true);
            expect(parsed.edges.at(-1)).toMatchObject({
              from: "Module",
              to: "Shared",
              kind: "-.->",
              label: "depends on",
            });
          }
        }
      }
    },
  );
});
