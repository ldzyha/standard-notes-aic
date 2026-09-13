import { type EditorView, WidgetType } from "@codemirror/view";
export type DiagramCopyHandler = (
  source: string,
) => boolean | void | Promise<boolean | void>;
export type DiagramSessionOptions = {
  container: HTMLElement;
  theme?: "default" | "dark";
  hideElements?: readonly HTMLElement[];
  onCopy?: DiagramCopyHandler;
};
export function closeDiagramEditor(
  view: EditorView,
  container?: HTMLElement,
): void;
export function registerDiagramEditorHost(
  view: EditorView,
  container: HTMLElement,
  range: { from: number; to: number },
): void;
export function releaseDiagramEditorHost(view: EditorView): void;
/** Detach the current draft in raw source mode without applying or discarding it. */
export function suspendDiagramEditor(
  view: EditorView,
  suspended: boolean,
): void;
export function openDiagramEditor(
  view: EditorView,
  range: { from: number; to: number },
  options: DiagramSessionOptions,
): {
  element: HTMLDivElement;
  close(restoreFocus?: boolean): void;
  apply(): boolean;
  /** Source snapshot survives identity teardown; rejected inspector values are not serialized. */
  getSource(): string;
} | null;
export function createDiagramEditButton(
  view: EditorView,
  range: { from: number; to: number },
  options: DiagramSessionOptions | (() => DiagramSessionOptions),
): HTMLButtonElement;
export class DiagramSourceActionsWidget extends WidgetType {
  constructor(options: {
    from: number;
    to: number;
    source: string;
    readOnly?: boolean;
    theme?: "default" | "dark";
    onCopy?: DiagramCopyHandler;
  });
  eq(other: DiagramSourceActionsWidget): boolean;
  toDOM(view: EditorView): HTMLElement;
  destroy(element: HTMLElement): void;
  ignoreEvent(): boolean;
}
