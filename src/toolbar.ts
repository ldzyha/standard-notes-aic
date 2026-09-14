import type { EditorView } from "@codemirror/view";
import { createIconButton } from "./core/structured-preview.js";
import {
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertMermaid,
  insertProperties,
  insertTable,
  setBlockKind,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleList,
  toggleStrike,
  type AicCommand,
  type BlockKind,
} from "./commands";

export type ToolbarController = Readonly<{
  element: HTMLElement;
  setReadOnly: (readOnly: boolean) => void;
}>;

let nextTrayId = 0;

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
  element.className = "aic-toolbar-group";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", label);
  return element;
}

function option(select: HTMLSelectElement, value: string, label: string) {
  const element = select.ownerDocument.createElement("option");
  element.value = value;
  element.textContent = label;
  select.append(element);
}

export function createToolbar(
  getView: () => EditorView,
  document: Document = globalThis.document,
  options: { compact?: boolean } = {},
): ToolbarController {
  const toolbar = document.createElement("header");
  toolbar.className = "aic-toolbar";
  toolbar.setAttribute("aria-label", "AIC formatting");

  const blockGroup = group("Block style", document);
  const block = document.createElement("select");
  block.className = "aic-toolbar-select";
  block.setAttribute("aria-label", "Block style");
  option(block, "", "Style");
  option(block, "paragraph", "Paragraph");
  for (let level = 1; level <= 6; level++)
    option(block, String(level), `Heading ${level}`);
  option(block, "quote", "Quote");
  block.addEventListener("change", () => {
    if (!block.value) return;
    const value: BlockKind = /^\d$/u.test(block.value)
      ? (Number(block.value) as BlockKind)
      : (block.value as BlockKind);
    setBlockKind(getView(), value);
    block.value = "";
  });
  blockGroup.append(block);

  const inlineGroup = group("Inline formatting", document);
  inlineGroup.append(
    actionButton(
      "bold",
      "Bold (Ctrl/Command+B)",
      toggleBold,
      getView,
      document,
    ),
    actionButton(
      "italic",
      "Italic (Ctrl/Command+I)",
      toggleItalic,
      getView,
      document,
    ),
    actionButton("strike", "Strikethrough", toggleStrike, getView, document),
    actionButton("code", "Inline code", toggleInlineCode, getView, document),
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

  const insertGroup = group("Insert block", document);
  const insert = document.createElement("select");
  insert.className = "aic-toolbar-select";
  insert.setAttribute("aria-label", "Insert block");
  option(insert, "", "Insert");
  option(insert, "table", "Table");
  option(insert, "properties", "Properties");
  option(insert, "code", "Code block");
  option(insert, "mermaid", "Mermaid");
  option(insert, "rule", "Horizontal rule");
  const insertCommands: Record<string, AicCommand> = {
    table: insertTable,
    properties: insertProperties,
    code: insertCodeFence,
    mermaid: insertMermaid,
    rule: insertHorizontalRule,
  };
  insert.addEventListener("change", () => {
    insertCommands[insert.value]?.(getView());
    insert.value = "";
  });
  insertGroup.append(insert);

  if (options.compact) {
    toolbar.classList.add("aic-toolbar--compact");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "aic-toolbar-button aic-formatting-toggle";
    trigger.textContent = "Formatting";
    trigger.setAttribute("aria-expanded", "false");

    const tray = document.createElement("div");
    tray.className = "aic-toolbar-tray";
    tray.id = `aic-formatting-tray-${++nextTrayId}`;
    tray.hidden = true;
    trigger.setAttribute("aria-controls", tray.id);
    tray.append(blockGroup, inlineGroup, listGroup, insertGroup);

    const setOpen = (open: boolean) => {
      if (!open && tray.contains(document.activeElement)) trigger.focus();
      tray.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    // Match the shared icon buttons: pointer activation should not steal the
    // editor selection that the formatting commands will act on.
    trigger.addEventListener("pointerdown", (event) => event.preventDefault());
    trigger.addEventListener("click", () => setOpen(tray.hidden));
    tray.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.focus();
    });
    toolbar.append(trigger, tray);
  } else {
    toolbar.append(blockGroup, inlineGroup, listGroup, insertGroup);
  }
  return Object.freeze({
    element: toolbar,
    setReadOnly(readOnly: boolean) {
      toolbar
        .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        )
        .forEach((control) => {
          if (
            control.classList.contains("aic-formatting-toggle") ||
            control.classList.contains("aic-source-mode-toggle")
          )
            return;
          control.disabled = readOnly;
        });
    },
  });
}
