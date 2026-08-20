import type { EditorView } from "@codemirror/view";
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

function actionButton(
  label: string,
  title: string,
  command: AicCommand,
  getView: () => EditorView,
  document: Document,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "aic-toolbar-button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", () => command(getView()));
  return button;
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
    actionButton("B", "Bold (Ctrl/Command+B)", toggleBold, getView, document),
    actionButton(
      "I",
      "Italic (Ctrl/Command+I)",
      toggleItalic,
      getView,
      document,
    ),
    actionButton("S", "Strikethrough", toggleStrike, getView, document),
    actionButton("<> ", "Inline code", toggleInlineCode, getView, document),
    actionButton(
      "Link",
      "Insert link (Ctrl/Command+K)",
      insertLink,
      getView,
      document,
    ),
  );

  const listGroup = group("Lists", document);
  listGroup.append(
    actionButton(
      "•",
      "Bullet list",
      (view) => toggleList(view, "bullet"),
      getView,
      document,
    ),
    actionButton(
      "1.",
      "Ordered list",
      (view) => toggleList(view, "ordered"),
      getView,
      document,
    ),
    actionButton(
      "☑",
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

  toolbar.append(blockGroup, inlineGroup, listGroup, insertGroup);
  return Object.freeze({
    element: toolbar,
    setReadOnly(readOnly: boolean) {
      toolbar
        .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        )
        .forEach((control) => {
          control.disabled = readOnly;
        });
    },
  });
}
