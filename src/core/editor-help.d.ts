export type EditorHelpHost = "browser" | "standard-notes" | "vscode";

/** Build inert guide content; the host owns popover placement and lifecycle. */
export function createEditorHelp(
  document: Document,
  options: Readonly<{ host: EditorHelpHost }>,
): HTMLElement;
