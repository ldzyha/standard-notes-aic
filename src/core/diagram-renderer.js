/** Bind our bounded semantic model to Mermaid 11's rendered SVG, never to label text. */
export function mapDiagramSvg(svg, model) {
  const nodes = new Map();
  const edges = new Map();
  const sequence = model.type === "sequenceDiagram";
  const candidates = [
    ...svg.querySelectorAll(
      sequence ? '[data-et="participant"][data-id]' : "g.node",
    ),
  ];
  for (const node of model.nodes) {
    const prefix = model.type === "flowchart" ? "flowchart" : "classId";
    const matches = candidates.filter((element) =>
      sequence
        ? element.getAttribute("data-id") === node.id
        : new RegExp(`-${prefix}-${node.id}-\\d+$`, "u").test(element.id),
    );
    if (matches.length !== 1)
      throw new Error(
        `Cannot safely locate Mermaid element ${node.id}. Edit its source instead.`,
      );
    nodes.set(node.id, matches[0]);
  }
  const paths = [
    ...svg.querySelectorAll(
      sequence ? '[data-et="message"]' : '[data-edge="true"]',
    ),
  ];
  const ordered = sequence
    ? model.steps
        .filter((step) => step.kind === "message")
        .map((step) => model.edges.find((edge) => edge.id === step.edgeId))
    : model.edges;
  if (paths.length !== ordered.length)
    throw new Error(
      "Mermaid relationship mapping changed. Edit its source instead.",
    );
  for (let index = 0; index < ordered.length; index++) {
    const edge = ordered[index];
    const path = paths[index];
    const identity = path.getAttribute("data-id") || "";
    const matches = sequence
      ? path.getAttribute("data-from") === edge.from &&
        path.getAttribute("data-to") === edge.to
      : identity.startsWith(
          `${model.type === "flowchart" ? "L" : "id"}_${edge.from}_${edge.to}_`,
        );
    if (!matches)
      throw new Error(
        `Cannot safely locate Mermaid relationship ${edge.id}. Edit its source instead.`,
      );
    edges.set(edge.id, path);
  }
  return { nodes, edges };
}

/** Trusted, accessible hit targets follow the real SVG paths and node geometry. */
export function bindDiagramSvg(
  svg,
  model,
  { readOnly = false, onSelect, onConnect },
) {
  const document = svg.ownerDocument;
  const mapping = mapDiagramSvg(svg, model);
  const sequenceLabels = [...svg.querySelectorAll(".messageText")];
  const selectTarget = (element, key, label) => {
    element.dataset.select = key;
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", label);
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(key);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onSelect(key);
      }
    });
  };
  for (const item of model.nodes) {
    const element = mapping.nodes.get(item.id);
    element.classList.add("aic-db-node");
    element.dataset.nodeId = item.id;
    selectTarget(element, `node:${item.id}`, `Edit element: ${item.label}`);
    const bounds = element.getBBox();
    const port = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    port.setAttribute("class", "aic-db-port");
    port.setAttribute("cx", String(bounds.x + bounds.width));
    port.setAttribute("cy", String(bounds.y + bounds.height / 2));
    port.setAttribute("r", "7");
    // Mermaid scopes node-shape rules with an SVG id; our port is not a node shape.
    port.style.fill = "var(--db-port-fill, var(--db-bg))";
    port.style.stroke = "var(--db-accent)";
    port.style.strokeWidth = "2px";
    port.setAttribute("role", "button");
    port.setAttribute("tabindex", readOnly ? "-1" : "0");
    port.setAttribute("aria-label", `Connect ${item.label}`);
    port.setAttribute("aria-disabled", String(readOnly));
    port.dataset.portId = item.id;
    for (const type of ["pointerdown", "click"])
      port.addEventListener(type, (event) => {
        event.stopPropagation();
        if (!readOnly) onConnect(event, item.id);
      });
    port.addEventListener("keydown", (event) => {
      if (!readOnly && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        port.dispatchEvent(
          new document.defaultView.MouseEvent("click", { bubbles: true }),
        );
      }
    });
    element.append(port);
  }
  let messageIndex = 0;
  for (const [id, path] of mapping.edges) {
    const edge = model.edges.find((item) => item.id === id);
    path.dataset.edgeId = id;
    const hit = path.cloneNode(false);
    for (const attribute of [...hit.attributes]) {
      if (!["d", "x1", "x2", "y1", "y2", "transform"].includes(attribute.name))
        hit.removeAttributeNode(attribute);
    }
    hit.setAttribute("class", "aic-db-edge-hit");
    hit.dataset.edgeId = id;
    selectTarget(
      hit,
      `edge:${id}`,
      `Edit relationship line: ${edge.from} ${edge.kind} ${edge.to}`,
    );
    path.after(hit);
    const label =
      model.type === "sequenceDiagram"
        ? sequenceLabels[messageIndex++]
        : [...svg.querySelectorAll(".edgeLabel .label[data-id]")]
            .find(
              (element) =>
                element.getAttribute("data-id") ===
                path.getAttribute("data-id"),
            )
            ?.closest(".edgeLabel");
    if (label) {
      label.classList.add("aic-db-edge-label");
      label.dataset.edgeId = id;
      selectTarget(
        label,
        `edge:${id}`,
        `Edit relationship: ${edge.label || `${edge.from} ${edge.kind} ${edge.to}`}`,
      );
    }
  }
  return mapping;
}
