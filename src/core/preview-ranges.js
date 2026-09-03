import { EditorView } from "@codemirror/view";

export const PREVIEW_RANGES_CORE_VERSION = "1.0.0";

/**
 * Expose one preview field both as visible decorations and as atomic ranges.
 *
 * CodeMirror must know that a replaced source range is one navigation unit.
 * Otherwise vertical cursor motion may enter an invisible range, cause the
 * preview to disappear mid-command, and lose the intended screen column.
 */
export function providePreviewRanges(field) {
  return [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ];
}
