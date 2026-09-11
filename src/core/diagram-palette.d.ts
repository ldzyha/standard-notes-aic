import type { DiagramType } from "./diagram-model.js";

export const DIAGRAM_PALETTE_MIME: "application/x-aic-diagram-element+json";
export const DIAGRAM_ELEMENTS: Readonly<
  Record<
    DiagramType,
    readonly Readonly<{ kind: string; label: string; action: string }>[]
  >
>;
export type DiagramPaletteElement = Readonly<{ kind: string; label: string }>;
export function diagramElements(
  type: DiagramType,
  profile?: "entity-map" | null,
): readonly Readonly<{ kind: string; label: string; action: string }>[];
export function createDiagramPalette(
  document: Document,
  options: {
    type: DiagramType;
    profile?: "entity-map" | null;
    readOnly?: boolean;
    onInsert?: (element: DiagramPaletteElement) => void;
  },
): {
  element: HTMLElement;
  canDrop(dataTransfer: DataTransfer | null): boolean;
  readDrop(dataTransfer: DataTransfer | null): DiagramPaletteElement | null;
  destroy(): void;
};
