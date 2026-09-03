export const CODE_FENCE_PREVIEW_CORE_VERSION: "1.0.0";

export function createCodeFencePreview(
  document: Document,
  options?: Readonly<{
    source?: unknown;
    language?: unknown;
    from?: number;
    to?: number;
    readOnly?: boolean;
    onCopy?: (source: string) => boolean | void | Promise<boolean | void>;
    onEdit?: () => void | Promise<void>;
  }>,
): HTMLDivElement;
