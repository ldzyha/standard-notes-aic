import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { blockViewExtensions } from "./block-views";
import { makeCodeFenceExtension } from "./code-fence-extension";
import { aicKeymap } from "./commands";
import { aicMarkdownLanguage } from "./language";
import { linkActionsExtension } from "./link-actions";
import { markdownDecorations } from "./markdown-decorations";
import { makeMermaidExtension, refreshMermaidTheme } from "./mermaid-extension";
import type { MermaidTheme } from "./mermaid-render";
import { createToolbar, type ToolbarController } from "./toolbar";
import { detailsExtensions } from "./details-extension";

export type AicEditorOptions = {
  document?: Document;
  initialText?: string;
  readOnly?: boolean;
  onChange?: (text: string) => void;
};

export type SaveState = "dirty" | "saved" | "placeholder" | "unavailable";

function parseRgb(value: string): [number, number, number] | null {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "transparent") return null;
  const alpha = /^rgba\([^)]*(?:,|\/)\s*([\d.]+%?)\s*\)$/iu.exec(normalized);
  if (alpha?.[1] && Number.parseFloat(alpha[1]) === 0) return null;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(normalized);
  if (hex?.[1]) {
    const source =
      hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit).join("")
        : hex[1];
    return [0, 2, 4].map((offset) =>
      Number.parseInt(source.slice(offset, offset + 2), 16),
    ) as [number, number, number];
  }
  const rgb =
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/iu.exec(
      normalized,
    );
  return rgb?.[1] && rgb[2] && rgb[3]
    ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    : null;
}

export function detectTheme(
  document: Document = globalThis.document,
): MermaidTheme {
  const style = document.defaultView?.getComputedStyle(
    document.documentElement,
  );
  const background =
    style?.getPropertyValue("--sn-stylekit-background-color") ||
    style?.getPropertyValue("--background") ||
    style?.backgroundColor ||
    "";
  const rgb = parseRgb(background);
  if (rgb) {
    const luminance =
      (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luminance < 0.45 ? "dark" : "default";
  }
  if (
    style?.colorScheme?.includes("dark") ||
    document.documentElement.classList.contains("dark")
  )
    return "dark";
  return document.defaultView?.matchMedia?.("(prefers-color-scheme: dark)")
    .matches
    ? "dark"
    : "default";
}

function wirePreviewSelection(view: EditorView, document: Document): void {
  view.dom.addEventListener(
    "keydown",
    (event) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "a"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      document.getSelection()?.removeAllRanges();
      view.dispatch({
        selection: { anchor: 0, head: view.state.doc.length },
        scrollIntoView: true,
        userEvent: "select",
      });
      view.focus();
    },
    true,
  );
  const previewForNode = (node: Node | null): HTMLElement | null => {
    const element =
      node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
    return (
      element?.closest<HTMLElement>(
        "[data-aic-source-from][data-aic-source-to]",
      ) ?? null
    );
  };
  view.dom.addEventListener(
    "pointerup",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("textarea,input,[contenteditable='true']")) return;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) return;
      const preview =
        previewForNode(selection.anchorNode) ??
        previewForNode(selection.focusNode);
      if (!preview || !view.dom.contains(preview)) return;
      const from = Number(preview.dataset.aicSourceFrom);
      const to = Number(preview.dataset.aicSourceTo);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to)
        return;
      selection.removeAllRanges();
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
        userEvent: "select.pointer",
      });
      view.focus();
    },
    true,
  );
}

export class AicEditor {
  readonly element: HTMLElement;
  readonly editorHost: HTMLElement;
  readonly view: EditorView;
  readonly toolbar: ToolbarController;

  private readonly document: Document;
  private readonly readOnlyCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly onChange: (text: string) => void;
  private suppressChange = false;
  private currentReadOnly: boolean;
  private lineSeparator = "\n";

  constructor(parent: HTMLElement, options: AicEditorOptions = {}) {
    this.document = options.document ?? parent.ownerDocument;
    this.onChange = options.onChange ?? (() => {});
    this.currentReadOnly = options.readOnly ?? false;
    this.element = this.document.createElement("section");
    this.element.className = "aic-editor";
    this.editorHost = this.document.createElement("div");
    this.editorHost.className = "aic-editor-host";
    let view: EditorView | null = null;
    this.toolbar = createToolbar(() => {
      if (!view) throw new Error("AIC editor is not ready");
      return view;
    }, this.document);
    this.element.append(this.toolbar.element, this.editorHost);
    parent.append(this.element);

    view = new EditorView({
      state: this.createState(options.initialText ?? ""),
      parent: this.editorHost,
      root: this.document,
    });
    this.view = view;
    wirePreviewSelection(this.view, this.document);
    this.toolbar.setReadOnly(this.currentReadOnly);
    this.element.dataset.readOnly = String(this.currentReadOnly);
    this.element.dataset.saveState = "unavailable";
    this.refreshTheme();
    this.view.requestMeasure();
  }

  private extensions(): Extension[] {
    return [
      this.readOnlyCompartment.of(
        EditorState.readOnly.of(this.currentReadOnly),
      ),
      this.editableCompartment.of(
        EditorView.editable.of(!this.currentReadOnly),
      ),
      EditorState.allowMultipleSelections.of(true),
      EditorState.tabSize.of(2),
      aicMarkdownLanguage(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      history(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      placeholder("Write in Markdown…"),
      EditorView.contentAttributes.of({
        "aria-label": "AIC Markdown note",
        spellcheck: "true",
        autocapitalize: "sentences",
      }),
      keymap.of([
        ...aicKeymap,
        ...closeBracketsKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      markdownDecorations,
      makeCodeFenceExtension(this.document),
      blockViewExtensions(),
      detailsExtensions(),
      makeMermaidExtension({
        theme: () => detectTheme(this.document),
        document: this.document,
      }),
      linkActionsExtension(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || this.suppressChange) return;
        this.onChange(this.serialize(update.state));
      }),
    ];
  }

  private createState(document: string): EditorState {
    this.lineSeparator = document.includes("\r\n")
      ? "\r\n"
      : document.includes("\r")
        ? "\r"
        : "\n";
    return EditorState.create({ doc: document, extensions: this.extensions() });
  }

  private serialize(state: EditorState): string {
    const source = state.doc.toString();
    return this.lineSeparator === "\n"
      ? source
      : source.replaceAll("\n", this.lineSeparator);
  }

  get value(): string {
    return this.serialize(this.view.state);
  }

  setDocument(document: string): boolean {
    const text = String(document ?? "");
    if (text === this.value) return false;
    this.suppressChange = true;
    this.view.setState(this.createState(text));
    this.view.requestMeasure();
    this.suppressChange = false;
    return true;
  }

  setReadOnly(readOnly: boolean): boolean {
    if (this.currentReadOnly === readOnly) return false;
    this.currentReadOnly = readOnly;
    this.view.dispatch({
      effects: [
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
        this.editableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
    this.toolbar.setReadOnly(readOnly);
    this.element.dataset.readOnly = String(readOnly);
    return true;
  }

  setSaveState(state: SaveState): void {
    this.element.dataset.saveState = state;
  }

  refreshTheme(): MermaidTheme {
    const theme = detectTheme(this.document);
    this.element.dataset.theme = theme;
    if (this.view) this.view.dispatch({ effects: refreshMermaidTheme.of() });
    return theme;
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
    this.element.remove();
  }
}
