export type MermaidViewportState = Readonly<{
  zoom: number;
  rotation: number;
}>;

export type MermaidViewportController = Readonly<{
  viewport: HTMLDivElement;
  stage: HTMLDivElement;
  controls: HTMLSpanElement;
  replaceContent: (node: Node | null) => void;
  refresh: () => boolean;
  readonly state: MermaidViewportState;
  destroy: () => boolean;
}>;

export const MERMAID_VIEW: Readonly<{
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
  quarterTurn: number;
}>;

export function createMermaidViewport(
  document: Document,
  options?: Partial<
    Pick<typeof MERMAID_VIEW, "minZoom" | "maxZoom" | "zoomStep">
  >,
): MermaidViewportController;
