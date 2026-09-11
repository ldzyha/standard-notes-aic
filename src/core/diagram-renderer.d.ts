import type { DiagramModel } from "./diagram-model.js";
export function mapDiagramSvg(
  svg: SVGSVGElement,
  model: DiagramModel,
): {
  nodes: Map<string, SVGGraphicsElement>;
  edges: Map<string, SVGGraphicsElement>;
};
export function bindDiagramSvg(
  svg: SVGSVGElement,
  model: DiagramModel,
  options: {
    readOnly?: boolean;
    onSelect: (key: string) => void;
    onConnect: (event: Event, id: string) => void;
  },
): ReturnType<typeof mapDiagramSvg>;
