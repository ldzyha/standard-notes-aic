import { EditorView, WidgetType } from "@codemirror/view";
export function toggleTaskMarker(view: EditorView, from: number): boolean;
export class TaskMarkerWidget extends WidgetType {
  constructor(from: number, checked: boolean, readOnly: boolean);
  eq(other: TaskMarkerWidget): boolean;
  ignoreEvent(): boolean;
  toDOM(view: EditorView): HTMLElement;
}
