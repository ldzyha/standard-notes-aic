export const DIAGRAM_MODEL_VERSION: "0.1.0";
export type DiagramType = "flowchart" | "classDiagram" | "sequenceDiagram";
export type DiagramNode = {
  id: string;
  label: string;
  kind: string;
  members: string[];
  x?: number;
  y?: number;
};
export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label: string;
};
export type DiagramStep = {
  id: string;
  kind: string;
  label?: string;
  edgeId?: string;
};
export type DiagramModel = {
  type: DiagramType;
  direction: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps: DiagramStep[];
  comments: string[];
};
export const DIAGRAM_RELATIONSHIPS: Readonly<
  Record<DiagramType, readonly { value: string; label: string }[]>
>;
export function parseDiagram(
  source: string,
):
  | { ok: true; model: DiagramModel }
  | { ok: false; reason: string; line: number };
export function serializeDiagram(model: DiagramModel): string;
export function nextDiagramId(
  items: readonly { id: string }[],
  prefix: string,
): string;
export function moveSequenceMessage(
  model: DiagramModel,
  edgeId: string,
  delta: number,
): boolean;
