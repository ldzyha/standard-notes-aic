import type { StateField, Extension } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";

export const PREVIEW_RANGES_CORE_VERSION: "1.0.0";

export function providePreviewRanges(
  field: StateField<DecorationSet>,
): Extension;
