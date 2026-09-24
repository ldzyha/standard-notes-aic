export type UiBlock =
  | "button"
  | "toolbar"
  | "menu"
  | "notice"
  | "field"
  | "card"
  | "tree"
  | "context";

export type UiModifiers = {
  button:
    | "default"
    | "ghost"
    | "danger"
    | "normal"
    | "compact"
    | "touch"
    | "icon-only"
    | "unsaved";
  toolbar: "compact" | "wrap";
  menu: "compact";
  notice: "info" | "success" | "warning" | "error";
  field: "compact" | "invalid" | "masked" | "composite" | "unlabelled" | "icon";
  card:
    | "compact"
    | "security"
    | "properties"
    | "readonly"
    | "empty"
    | "details"
    | "embedded";
  tree: "compact" | "ancestors";
  context: "compact" | "empty" | "editing";
};

export type UiElements = {
  button: "icon" | "label";
  toolbar: "group" | "title" | "actions";
  menu: "title" | "item" | "separator" | "hint";
  notice: "message" | "actions";
  field:
    "label" | "control" | "hint" | "error" | "value" | "status" | "actions";
  card:
    | "header"
    | "title"
    | "body"
    | "actions"
    | "section"
    | "section-title"
    | "section-actions"
    | "footer";
  tree: "group" | "item" | "row" | "label" | "actions";
  context: "title" | "path" | "item" | "link" | "current";
};

export const UI_COMPONENTS: {
  readonly [Block in UiBlock]: Readonly<{
    modifiers: readonly UiModifiers[Block][];
    elements: readonly UiElements[Block][];
  }>;
};

export function applyUiComponent<
  Block extends UiBlock,
  Element extends HTMLElement,
>(
  element: Element,
  block: Block,
  modifiers?: readonly UiModifiers[Block][],
  elementName?: UiElements[Block],
): Element;

export function createUiButton(
  document: Document,
  options: Readonly<{
    label: string;
    text?: string;
    variant?: "default" | "ghost" | "danger";
    size?: "compact" | "normal" | "touch";
    iconOnly?: boolean;
  }>,
): HTMLButtonElement;
