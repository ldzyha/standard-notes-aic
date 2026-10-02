import { AicEditor, type SaveFeedback, type SaveState } from "../editor";

export interface DomainPropertiesOptions {
  origin: string;
  scope?: "domain" | "global";
  initialText?: string | null;
  onChange: (text: string) => void;
  onSave: (text: string) => boolean | Promise<boolean>;
}

/** A scope uses the same Markdown editor and acknowledged save owner as Current. */
export class DomainPropertiesView {
  readonly element: HTMLElement;
  private readonly editor: AicEditor;
  private baseText: string;
  private pendingSave: Promise<boolean> | null = null;
  private disposed = false;

  constructor(
    parent: HTMLElement,
    private readonly options: DomainPropertiesOptions,
  ) {
    this.baseText = options.initialText ?? "";
    this.element = parent.ownerDocument.createElement("section");
    this.element.className = "browser-domain-properties";
    this.element.dataset.scope = options.scope ?? "domain";
    this.element.dataset.editing = "true";
    this.element.setAttribute(
      "aria-label",
      options.scope === "global"
        ? "Global notes"
        : `Shared notes for ${options.origin}`,
    );
    parent.append(this.element);
    this.editor = new AicEditor(this.element, {
      document: parent.ownerDocument,
      initialText: this.baseText,
      showEditorHelp: false,
      onChange: (text) => {
        if (!this.disposed) this.options.onChange(text);
      },
      onSave: () => this.save(),
    });
  }

  get value(): string {
    return this.editor.value;
  }

  /** Saving never replaces the mounted editor, its selection, or its undo history. */
  save(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.pendingSave) return this.pendingSave;
    const text = this.editor.value;
    const operation = Promise.resolve()
      .then(() => this.options.onSave(text))
      .then((saved) => {
        if (this.disposed || !saved) return false;
        this.baseText = text;
        // The ACK belongs to the submitted text, not any later keystroke.
        return this.editor.value === text;
      })
      .catch(() => false)
      .finally(() => {
        if (this.pendingSave === operation) this.pendingSave = null;
      });
    this.pendingSave = operation;
    return operation;
  }

  /** Adopt an acknowledged/clean observation without replacing a local draft. */
  update(text: string | null): void {
    if (this.disposed) return;
    const next = text ?? "";
    const clean = this.editor.value === this.baseText;
    if (clean && !this.pendingSave && this.editor.value !== next)
      this.editor.updateDocument(next);
    this.baseText = next;
  }

  setSaveState(
    state: SaveState,
    pending = false,
    feedback: SaveFeedback = "none",
  ): void {
    this.editor.setSaveState(state, pending, feedback);
  }

  refreshTheme(): void {
    this.editor.refreshTheme();
    this.editor.view.requestMeasure();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.editor.destroy();
    this.element.remove();
  }
}
