import type { EditorView } from "@codemirror/view";
import { createIconButton } from "./core/structured-preview.js";
import {
  insertLink,
  toggleList,
  toggleStrike,
  type AicCommand,
} from "./commands";

export type ToolbarController = Readonly<{
  element: HTMLElement;
  setReadOnly: (readOnly: boolean) => void;
}>;

function actionButton(
  icon: string,
  title: string,
  command: AicCommand,
  getView: () => EditorView,
  document: Document,
) {
  return createIconButton(document, {
    label: title,
    icon,
    className: "aic-toolbar-button",
    onActivate: () => command(getView()),
  });
}

function group(label: string, document: Document) {
  const element = document.createElement("div");
  element.className = "aic-toolbar__group aic-toolbar-group";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", label);
  return element;
}

export function createToolbar(
  getView: () => EditorView,
  document: Document = globalThis.document,
): ToolbarController {
  const toolbar = document.createElement("header");
  toolbar.className = "aic-toolbar aic-toolbar--compact aic-toolbar--wrap";
  toolbar.setAttribute("aria-label", "AIC formatting");

  const inlineGroup = group("Inline formatting", document);
  inlineGroup.append(
    actionButton("strike", "Strikethrough", toggleStrike, getView, document),
  );
  inlineGroup.append(
    actionButton(
      "link",
      "Insert link (Ctrl/Command+K)",
      insertLink,
      getView,
      document,
    ),
  );

  const listGroup = group("Lists", document);
  listGroup.append(
    actionButton(
      "bullet-list",
      "Bullet list",
      (view) => toggleList(view, "bullet"),
      getView,
      document,
    ),
    actionButton(
      "ordered-list",
      "Ordered list",
      (view) => toggleList(view, "ordered"),
      getView,
      document,
    ),
    actionButton(
      "task-list",
      "Task list",
      (view) => toggleList(view, "task"),
      getView,
      document,
    ),
  );
  toolbar.append(inlineGroup, listGroup);

  return Object.freeze({
    element: toolbar,
    setReadOnly(readOnly: boolean) {
      toolbar
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((control) => {
          if (
            control.classList.contains("aic-source-mode-toggle") ||
            control.dataset.aicReadonlyAction === "true"
          )
            return;
          control.disabled = readOnly;
        });
    },
  });
}
