/** A deliberately bounded Mermaid model. Unknown syntax is never discarded. */
export const DIAGRAM_MODEL_VERSION = "0.1.0";

export const DIAGRAM_RELATIONSHIPS = Object.freeze({
  flowchart: [
    { value: "-->", label: "Transition" },
    { value: "-.->", label: "Optional transition" },
    { value: "==>", label: "Emphasized transition" },
    { value: "---", label: "Association" },
  ],
  classDiagram: [
    { value: "*--", label: "Composition" },
    { value: "o--", label: "Aggregation" },
    { value: "-->", label: "Association" },
    { value: "..>", label: "Dependency" },
    { value: "<|--", label: "Inheritance (source is parent)" },
    { value: "<|..", label: "Realization (source is interface)" },
    { value: "--", label: "Association without direction" },
  ],
  sequenceDiagram: [
    { value: "->>", label: "Message" },
    { value: "-->>", label: "Reply" },
    { value: "->", label: "Solid message" },
    { value: "-->", label: "Dashed message" },
    { value: "-)", label: "Async message" },
    { value: "--)", label: "Async reply" },
  ],
});

const identifier = "[A-Za-z_][A-Za-z0-9_]*";
const nodeIdPattern = new RegExp(`^${identifier}$`);
const metadataPrefix = "%% aic-builder-layout ";
const maxElements = 200;

function failure(reason, line) {
  return { ok: false, reason, line };
}

function labelText(value) {
  const text = value.trim();
  return (text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text)
    .replace(/#quot;/g, '"')
    .replace(/#35;/g, "#")
    .replace(/<br\s*\/?\s*>/gi, "\n");
}

function quote(text) {
  return `"${String(text).replace(/#/g, "#35;").replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>")}"`;
}

function inlineLabel(text) {
  return String(text)
    .replace(/[\r\n]/g, " ")
    .replace(/;/g, "#59;");
}

function plainLabel(text) {
  return String(text).replace(/#59;/g, ";");
}

// Read a node before looking for links. Searching an entire statement for an
// arrow would also match arrows inside quoted node/edge labels.
function flowNodeAtStart(text) {
  const found = new RegExp(`^(${identifier})`).exec(text);
  if (!found || found[1] === "end") return null;
  const id = found[1];
  let end = id.length;
  const opening = text[end];
  const closing = { "[": "]", "{": "}", "(": ")" }[opening];
  const values = {};
  if (closing) {
    const start = ++end;
    let quoted = false;
    while (end < text.length) {
      if (text[end] === '"') quoted = !quoted;
      else if (!quoted && text[end] === closing) break;
      end++;
    }
    if (end === text.length || quoted) return null;
    const raw = text.slice(start, end).trim();
    if (!raw || (!/^"[^"\r\n]*"$/.test(raw) && /[[\]{}()";|<>]/.test(raw)))
      return null;
    values.label = labelText(raw);
    values.kind =
      opening === "{" ? "diamond" : opening === "(" ? "rounded" : "rectangle";
    end++;
  }
  return { id, values, rest: text.slice(end) };
}

function flowLinkAtStart(text) {
  // Keep the supported grammar explicit: one link per statement. The two
  // Mermaid label spellings share the same semantic relationship in the model.
  const compact = /^(-->|-\.->|==>|---)/.exec(text);
  if (compact) {
    let rest = text.slice(compact[0].length);
    let label = "";
    if (rest.startsWith("|")) {
      const labelled = /^\|\s*("[^"\r\n]*"|[^|"\r\n]*)\s*\|/.exec(rest);
      if (!labelled) return null;
      label = labelText(labelled[1]);
      rest = rest.slice(labelled[0].length);
    }
    // Requiring separation also avoids misreading A---oB's circle endpoint as
    // an ordinary open link to a node named oB.
    if (!/^\s+/.test(rest)) return null;
    return { kind: compact[1], label, rest: rest.trimStart() };
  }
  const opening = /^(--|-\.|==)\s+/.exec(text);
  if (!opening) return null;
  const closings =
    opening[1] === "-."
      ? [[".->", "-.->"]]
      : opening[1] === "=="
        ? [["==>", "==>"]]
        : [
            ["-->", "-->"],
            ["---", "---"],
          ];
  const start = opening[0].length;
  let quoted = false;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted || !/\s/.test(text[index - 1] ?? "")) continue;
    for (const [closing, kind] of closings) {
      if (
        !text.startsWith(closing, index) ||
        !/\s/.test(text[index + closing.length] ?? "")
      )
        continue;
      const raw = text.slice(start, index).trim();
      if (
        !raw ||
        (!/^"[^"\r\n]*"$/.test(raw) && /[[\]{}();|"<>]|--|-\.|==/.test(raw))
      )
        return null;
      return {
        kind,
        label: labelText(raw),
        rest: text.slice(index + closing.length).trimStart(),
      };
    }
  }
  return null;
}

/** Parsing succeeds only when every non-comment statement has a known meaning. */
export function parseDiagram(source) {
  const lines = String(source).split(/\r?\n/);
  const comments = [];
  const statements = [];
  let layout = null;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text) continue;
    if (text.startsWith(metadataPrefix)) {
      if (layout)
        return failure("Duplicate builder layout metadata.", index + 1);
      try {
        layout = JSON.parse(text.slice(metadataPrefix.length));
        if (
          layout.version !== 1 ||
          typeof layout.nodes !== "object" ||
          !layout.nodes
        )
          return failure("Unsupported builder layout metadata.", index + 1);
      } catch {
        return failure("Malformed builder layout metadata.", index + 1);
      }
    } else if (text.startsWith("%%")) {
      if (text.startsWith("%%{"))
        return failure(
          "Mermaid configuration directives need source editing.",
          index + 1,
        );
      comments.push(lines[index]);
    } else statements.push({ text, line: index + 1 });
  }
  const first = statements.shift();
  if (!first)
    return failure("Choose a Mermaid diagram type in source first.", 1);
  const graph = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)$/.exec(first.text);
  const type = graph ? "flowchart" : first.text;
  if (!Object.hasOwn(DIAGRAM_RELATIONSHIPS, type))
    return failure(
      "Visual editing supports flowchart, classDiagram, and sequenceDiagram.",
      first.line,
    );
  const model = {
    type,
    direction: graph?.[1] ?? "TB",
    nodes: [],
    edges: [],
    steps: [],
    comments,
  };
  const nodeMap = new Map();
  const addNode = (id, values = {}) => {
    if (!nodeMap.has(id)) {
      const node = {
        id,
        label: id,
        kind:
          type === "classDiagram"
            ? "class"
            : type === "sequenceDiagram"
              ? "participant"
              : "rectangle",
        members: [],
      };
      model.nodes.push(node);
      nodeMap.set(id, node);
    }
    Object.assign(nodeMap.get(id), values);
    return nodeMap.get(id);
  };
  const addEdge = (from, to, kind, label = "") => {
    addNode(from);
    addNode(to);
    const edge = { id: `E${model.edges.length + 1}`, from, to, kind, label };
    model.edges.push(edge);
    return edge;
  };
  let currentClass = null;
  const fragments = [];
  for (const statement of statements) {
    const { text, line } = statement;
    if (
      model.nodes.length + model.edges.length + model.steps.length >
      maxElements
    )
      return failure(
        "Large diagrams stay in source mode (200 visual elements maximum).",
        line,
      );
    if (type === "flowchart") {
      // A chain, style directive, subgraph, click action, or unknown shape fails closed.
      const from = flowNodeAtStart(text);
      if (!from)
        return failure(
          "This flowchart construct is not visually supported yet.",
          line,
        );
      if (!from.rest.trim()) {
        addNode(from.id, from.values);
        continue;
      }
      const link = /^\s+/.test(from.rest)
        ? flowLinkAtStart(from.rest.trimStart())
        : null;
      const to = link ? flowNodeAtStart(link.rest) : null;
      if (!link || !to || to.rest.trim())
        return failure("This flowchart statement needs source editing.", line);
      addNode(from.id, from.values);
      addNode(to.id, to.values);
      addEdge(from.id, to.id, link.kind, link.label);
    } else if (type === "classDiagram") {
      if (currentClass) {
        if (text === "}") currentClass = null;
        else if (
          /^[+\-#~]?[\w\s()[\],:<>?=*.]+$/u.test(text) &&
          !/[{};]/.test(text)
        )
          currentClass.members.push(text);
        else return failure("This class member needs source editing.", line);
        continue;
      }
      const direction = /^direction (TB|BT|LR|RL)$/.exec(text);
      if (direction) {
        model.direction = direction[1];
        continue;
      }
      const declaration = new RegExp(
        `^class\\s+(${identifier})(?:\\["([^"\\r\\n]*)"\\])?(\\s*\\{)?$`,
      ).exec(text);
      if (declaration) {
        const node = addNode(
          declaration[1],
          declaration[2] === undefined
            ? {}
            : { label: labelText(declaration[2]) },
        );
        if (declaration[3]) currentClass = node;
        continue;
      }
      const relationship = new RegExp(
        `^(${identifier})\\s+(\\*--|o--|-->|\\.\\.>|<\\|--|<\\|\\.\\.|--)\\s+(${identifier})(?:\\s*:\\s*(.*))?$`,
      ).exec(text);
      if (
        !relationship ||
        /;/.test((relationship[4] ?? "").replace(/#59;/g, ""))
      )
        return failure("This class relationship needs source editing.", line);
      addEdge(
        relationship[1],
        relationship[3],
        relationship[2],
        plainLabel(relationship[4] ?? ""),
      );
    } else {
      const participant = new RegExp(
        `^(actor|participant)\\s+(${identifier})(?:\\s+as\\s+(.+))?$`,
      ).exec(text);
      if (participant) {
        if (/[;{}]/.test((participant[3] ?? "").replace(/#59;/g, "")))
          return failure("This participant alias needs source editing.", line);
        addNode(participant[2], {
          kind: participant[1],
          label: plainLabel(participant[3] ?? participant[2]),
        });
        continue;
      }
      const message = new RegExp(
        `^(${identifier})(-->>|->>|-->|->|--\\)|-\\))(${identifier}):\\s*(.*)$`,
      ).exec(text);
      if (message) {
        if (/;/.test(message[4].replace(/#59;/g, "")))
          return failure(
            "Semicolon-separated sequence statements need source editing.",
            line,
          );
        const edge = addEdge(
          message[1],
          message[3],
          message[2],
          plainLabel(message[4]),
        );
        model.steps.push({
          id: `S${model.steps.length + 1}`,
          kind: "message",
          edgeId: edge.id,
        });
        continue;
      }
      const fragment = /^(alt|opt|loop)\s+(.+)$/.exec(text);
      if (fragment) {
        if (/[;{}]/.test(fragment[2].replace(/#59;/g, "")))
          return failure("This sequence fragment needs source editing.", line);
        const step = {
          id: `S${model.steps.length + 1}`,
          kind: fragment[1],
          label: plainLabel(fragment[2]),
        };
        model.steps.push(step);
        fragments.push({ kind: fragment[1], hadElse: false });
        continue;
      }
      const otherwise = /^else(?:\s+(.*))?$/.exec(text);
      if (
        otherwise &&
        fragments.at(-1)?.kind === "alt" &&
        !fragments.at(-1).hadElse
      ) {
        if (/[;{}]/.test((otherwise[1] ?? "").replace(/#59;/g, "")))
          return failure("This alternative needs source editing.", line);
        fragments.at(-1).hadElse = true;
        model.steps.push({
          id: `S${model.steps.length + 1}`,
          kind: "else",
          label: plainLabel(otherwise[1] ?? ""),
        });
      } else if (text === "end" && fragments.length) {
        fragments.pop();
        model.steps.push({ id: `S${model.steps.length + 1}`, kind: "end" });
      } else
        return failure(
          "This sequence construct is not visually supported yet.",
          line,
        );
    }
  }
  if (currentClass || fragments.length)
    return failure(
      "An open class or sequence fragment is not closed.",
      lines.length,
    );
  if (layout) {
    for (const [id, position] of Object.entries(layout.nodes)) {
      if (
        !nodeMap.has(id) ||
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        position.x < 0 ||
        position.y < 0 ||
        position.x > 100000 ||
        position.y > 100000
      )
        return failure(
          "Builder layout contains invalid or missing elements.",
          1,
        );
      if (type !== "sequenceDiagram")
        Object.assign(nodeMap.get(id), { x: position.x, y: position.y });
    }
  }
  return { ok: true, model };
}

/** Serialize only this model's supported grammar. Validate before offering Apply. */
export function serializeDiagram(model) {
  if (!Object.hasOwn(DIAGRAM_RELATIONSHIPS, model.type))
    throw new Error("Unsupported diagram type");
  const ids = new Set();
  for (const node of model.nodes) {
    if (!nodeIdPattern.test(node.id) || node.id === "end" || ids.has(node.id))
      throw new Error("Invalid or duplicate element identity");
    ids.add(node.id);
  }
  for (const edge of model.edges) {
    if (
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      !DIAGRAM_RELATIONSHIPS[model.type].some(
        ({ value }) => edge.kind === value,
      )
    )
      throw new Error("Invalid relationship");
  }
  const lines = [
    ...(model.comments ?? []),
    model.type === "flowchart" ? `flowchart ${model.direction}` : model.type,
  ];
  if (model.type === "classDiagram" && model.direction !== "TB")
    lines.push(`    direction ${model.direction}`);
  for (const node of model.nodes) {
    if (model.type === "flowchart") {
      const shape = {
        rectangle: ["[", "]"],
        diamond: ["{", "}"],
        rounded: ["(", ")"],
      }[node.kind];
      if (!shape) throw new Error("Unsupported state shape");
      lines.push(`    ${node.id}${shape[0]}${quote(node.label)}${shape[1]}`);
    } else if (model.type === "classDiagram") {
      const alias = node.label !== node.id ? `[${quote(node.label)}]` : "";
      lines.push(`    class ${node.id}${alias}`);
      if (node.members.length)
        lines.push(
          `    class ${node.id} {`,
          ...node.members.map((member) => `        ${member}`),
          "    }",
        );
    } else {
      if (!["actor", "participant"].includes(node.kind))
        throw new Error("Invalid participant kind");
      lines.push(
        `    ${node.kind} ${node.id}${node.label !== node.id ? ` as ${inlineLabel(node.label)}` : ""}`,
      );
    }
  }
  if (model.type === "sequenceDiagram") {
    let depth = 1;
    const used = new Set();
    for (const step of model.steps) {
      if (["end", "else"].includes(step.kind)) depth--;
      const indent = "    ".repeat(Math.max(1, depth));
      if (step.kind === "message") {
        const edge = model.edges.find(({ id }) => id === step.edgeId);
        if (!edge || used.has(edge.id))
          throw new Error("Invalid message identity");
        used.add(edge.id);
        lines.push(
          `${indent}${edge.from}${edge.kind}${edge.to}: ${inlineLabel(edge.label)}`,
        );
      } else
        lines.push(
          `${indent}${step.kind}${step.kind === "end" ? "" : ` ${inlineLabel(step.label ?? "")}`}`,
        );
      if (["alt", "opt", "loop", "else"].includes(step.kind)) depth++;
    }
    if (used.size !== model.edges.length)
      throw new Error("Missing ordered message");
  } else {
    for (const edge of model.edges)
      lines.push(
        model.type === "flowchart"
          ? `    ${edge.from} ${edge.kind}${edge.label ? `|${quote(edge.label)}|` : ""} ${edge.to}`
          : `    ${edge.from} ${edge.kind} ${edge.to}${edge.label ? ` : ${inlineLabel(edge.label)}` : ""}`,
      );
  }
  const positions = Object.fromEntries(
    model.nodes
      .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
      .map(({ id, x, y }) => [id, { x: Math.round(x), y: Math.round(y) }]),
  );
  if (model.type !== "sequenceDiagram" && Object.keys(positions).length)
    lines.push(
      `${metadataPrefix}${JSON.stringify({ version: 1, nodes: positions })}`,
    );
  const result = lines.join("\n");
  const check = parseDiagram(result);
  if (!check.ok) throw new Error(check.reason);
  return result;
}

export function nextDiagramId(items, prefix) {
  const ids = new Set(items.map(({ id }) => id));
  let number = 1;
  while (ids.has(`${prefix}${number}`)) number++;
  return `${prefix}${number}`;
}

/** Sequence order is semantic. Messages may move only within their current branch. */
export function moveSequenceMessage(model, edgeId, delta) {
  const index = model.steps.findIndex(
    (step) => step.kind === "message" && step.edgeId === edgeId,
  );
  const other = index + Math.sign(delta);
  if (index < 0 || !delta || model.steps[other]?.kind !== "message")
    return false;
  [model.steps[index], model.steps[other]] = [
    model.steps[other],
    model.steps[index],
  ];
  return true;
}
