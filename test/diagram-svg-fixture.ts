import { parseDiagram } from "../src/core/diagram-model.js";

// Semantic SVG fixtures exercise our overlay adapter. Real Mermaid geometry is
// additionally checked by the production browser regression (all three types).
export async function renderDiagramFixture(source: string) {
  if (!("getBBox" in SVGElement.prototype))
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: -50, y: -20, width: 100, height: 40 }),
    });
  const parsed = parseDiagram(source);
  if (!parsed.ok) throw new Error(parsed.reason);
  const model = parsed.model;
  const nodes = model.nodes
    .map((node, index) =>
      model.type === "sequenceDiagram"
        ? `<g data-et="participant" data-id="${node.id}" transform="translate(${index * 140},0)"><rect width="100" height="40"/></g>`
        : `<g class="node" id="fixture-${model.type === "flowchart" ? "flowchart" : "classId"}-${node.id}-${index}" transform="translate(${index * 140},0)"><rect width="100" height="40"/></g>`,
    )
    .join("");
  const ordered =
    model.type === "sequenceDiagram"
      ? model.steps
          .filter((step) => step.kind === "message")
          .map((step) => model.edges.find((edge) => edge.id === step.edgeId)!)
      : model.edges;
  const edges = ordered
    .map((edge, index) =>
      model.type === "sequenceDiagram"
        ? `<text class="messageText">Message</text><line data-et="message" data-from="${edge.from}" data-to="${edge.to}" data-id="i${index}" x1="0" y1="60" x2="140" y2="60"/>`
        : `<path data-edge="true" data-id="${model.type === "flowchart" ? "L" : "id"}_${edge.from}_${edge.to}_${index}" d="M0 60 L140 60"/><g class="edgeLabel"><g class="label" data-id="${model.type === "flowchart" ? "L" : "id"}_${edge.from}_${edge.to}_${index}"><text>Relationship</text></g></g>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -30 400 200">${edges}${nodes}</svg>`;
}

export function activate(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
