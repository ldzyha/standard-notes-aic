export const DIAGRAM_BUILDER_VERSION: "0.1.0";
export function createDiagramBuilder(
  document: Document,
  options: {
    source: string;
    readOnly?: boolean;
    theme?: "dark" | "default";
    render?: (source: string, theme: "dark" | "default") => Promise<string>;
    onRender?: () => void;
    onCopy?: (source: string) => boolean | void | Promise<boolean | void>;
    onApply?: (source: string) => boolean | void;
    onClose?: () => void;
  },
): {
  element: HTMLElement;
  apply(): boolean;
  getSource(): string;
  setApplyBlocked(reason: string): void;
  whenRendered(): Promise<boolean>;
  destroy(): void;
};
