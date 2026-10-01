export type MermaidViewportController = Readonly<{
  viewport: HTMLDivElement;
  stage: HTMLDivElement;
  replaceContent: (node: Node | null) => void;
  refresh: () => boolean;
  destroy: () => boolean;
}>;

export function createMermaidViewport(
  document: Document,
): MermaidViewportController;
