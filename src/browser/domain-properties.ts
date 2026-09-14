import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { AicEditor, type SaveFeedback, type SaveState } from "../editor";
import { makePropertiesBlockExtension } from "../core/security-block.js";
import { aicMarkdownLanguage } from "../language";
import { validateDomainProperties } from "./library";

const EMPTY_PROPERTIES = "---\n# aic-fields: v2\n---\n\n";

export interface DomainPropertiesOptions {
  origin: string;
  /** Null means no saved record; an invalid string is never rendered as source. */
  initialText?: string | null;
  onChange: (text: string) => void;
  onSave: (text: string) => boolean | Promise<boolean>;
  onEditingChange?: (editing: boolean) => void;
}

type SavedText = { kind: "empty" | "valid" | "invalid"; text: string | null };

function safeSavedText(text: string | null): SavedText {
  if (text === null) return { kind: "empty", text: null };
  try {
    return { kind: "valid", text: validateDomainProperties(text) };
  } catch {
    return { kind: "invalid", text: null };
  }
}

/** A read-only domain card with an explicit, short-lived editing surface. */
export class DomainPropertiesView {
  readonly element: HTMLElement;
  private readonly document: Document;
  private readonly content: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly feedback: HTMLElement;
  private saved: SavedText;
  private editor: AicEditor | null = null;
  private preview: EditorView | null = null;
  private draftText: string | null = null;
  private pending = false;
  private pendingSave: Promise<boolean> | null = null;
  private externalPending = false;
  private disposed = false;
  private saveState: SaveState = "placeholder";
  private saveFeedback: SaveFeedback = "none";

  constructor(
    parent: HTMLElement,
    private readonly options: DomainPropertiesOptions,
  ) {
    this.document = parent.ownerDocument;
    this.saved = safeSavedText(options.initialText ?? null);
    this.element = this.document.createElement("section");
    this.element.className = "browser-domain-properties";
    this.element.dataset.editing = "false";
    const header = this.document.createElement("header");
    header.className = "browser-domain-properties-header";
    const origin = this.document.createElement("span");
    origin.className = "browser-domain-properties-origin";
    origin.textContent = options.origin;
    this.action = this.document.createElement("button");
    this.action.type = "button";
    this.action.className = "browser-button browser-domain-properties-action";
    this.action.addEventListener("click", () => {
      if (this.editing) void this.finishEditing();
      else this.startEditing();
    });
    header.append(origin, this.action);
    this.feedback = this.document.createElement("p");
    this.feedback.className = "browser-domain-properties-feedback";
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.content = this.document.createElement("div");
    this.content.className = "browser-domain-properties-content";
    this.element.append(header, this.feedback, this.content);
    parent.append(this.element);
    this.renderPreview();
  }

  get editing(): boolean {
    return this.editor !== null;
  }

  get value(): string | null {
    return this.editor?.value ?? this.draftText ?? this.saved.text;
  }

  private renderPreview(): void {
    this.preview?.destroy();
    this.preview = null;
    this.content.replaceChildren();
    this.element.dataset.editing = "false";
    this.action.textContent = "Edit shared properties";
    this.action.disabled = false;
    this.action.removeAttribute("aria-busy");
    if (this.saved.kind !== "valid" || this.saved.text === null) {
      const message = this.document.createElement("p");
      message.className = "browser-domain-properties-empty";
      message.textContent =
        this.saved.kind === "invalid"
          ? "Shared properties cannot be displayed. Edit to repair them."
          : "No shared properties yet.";
      this.content.append(message);
      return;
    }
    this.preview = new EditorView({
      parent: this.content,
      root: this.document,
      state: EditorState.create({
        doc: this.saved.text,
        extensions: [
          aicMarkdownLanguage(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Shared properties preview",
          }),
          makePropertiesBlockExtension({
            document: this.document,
            previewOnly: true,
          }),
        ],
      }),
    });
  }

  startEditing(initialDraftText?: string): void {
    if (this.disposed || this.editing) return;
    this.preview?.destroy();
    this.preview = null;
    this.content.replaceChildren();
    // A restored draft is intentionally editable source. Never route it through
    // the read-only preview, where incomplete Properties could expose secrets.
    if (initialDraftText !== undefined) this.draftText = initialDraftText;
    const text = this.draftText ?? this.saved.text ?? EMPTY_PROPERTIES;
    this.editor = new AicEditor(this.content, {
      document: this.document,
      initialText: text,
      compactToolbar: true,
      onChange: (next) => {
        this.draftText = next;
        this.options.onChange(next);
      },
      onSave: () => this.persist(),
    });
    this.editor.setSaveState(
      this.saveState,
      this.pending || this.externalPending,
      this.saveFeedback,
    );
    this.element.dataset.editing = "true";
    this.action.textContent = "Done";
    this.reflectAction();
    this.feedback.textContent = "";
    this.options.onEditingChange?.(true);
    this.editor.focus();
  }

  private reflectAction(): void {
    // Blur can request a save between pointer-down/focus and Done's click.
    // Keep this native button operable for both mouse and keyboard activation.
    this.action.disabled = false;
    this.action.setAttribute(
      "aria-busy",
      String(this.pending || this.externalPending),
    );
  }

  private persist(): Promise<boolean> {
    if (this.pendingSave) return this.pendingSave;
    const operation = this.persistCurrent().finally(() => {
      if (this.pendingSave === operation) this.pendingSave = null;
    });
    this.pendingSave = operation;
    return operation;
  }

  private async persistCurrent(): Promise<boolean> {
    if (this.disposed || !this.editor) return false;
    const text = this.editor.value;
    if (
      this.draftText === null &&
      this.saved.kind !== "invalid" &&
      text === (this.saved.text ?? EMPTY_PROPERTIES)
    ) {
      this.draftText = null;
      return true;
    }
    try {
      validateDomainProperties(text);
    } catch {
      this.feedback.textContent =
        "Finish a valid Properties block before saving.";
      return false;
    }
    this.pending = true;
    this.reflectAction();
    const editingEditor = this.editor;
    try {
      const saved = await this.options.onSave(text);
      if (this.disposed || this.editor !== editingEditor) return false;
      if (!saved) {
        this.feedback.textContent =
          "Shared properties were not saved. Try again.";
        return false;
      }
      // A boolean ACK cannot prove that edits made during the await were
      // included. Keep the latest source and require a fresh Done/ACK.
      if (this.editor.value !== text) {
        this.draftText = this.editor.value;
        this.feedback.textContent =
          "New changes were made while saving. Choose Done again to finish.";
        return false;
      }
      this.saved = safeSavedText(text);
      this.draftText = null;
      this.feedback.textContent = "";
      return true;
    } catch {
      if (!this.disposed)
        this.feedback.textContent =
          "Shared properties were not saved. Try again.";
      return false;
    } finally {
      this.pending = false;
      if (!this.disposed) this.reflectAction();
    }
  }

  async finishEditing(): Promise<boolean> {
    const editingEditor = this.editor;
    if (!editingEditor) return false;
    if (!(await this.persist())) return false;
    if (this.disposed || this.editor !== editingEditor) return false;
    this.editor.destroy();
    this.editor = null;
    this.renderPreview();
    this.options.onEditingChange?.(false);
    return true;
  }

  /** Sync a clean editor; never replace a dirty draft or its selection. */
  update(text: string | null): void {
    if (this.disposed) return;
    const next = safeSavedText(text);
    if (next.kind === this.saved.kind && next.text === this.saved.text) return;
    const editor = this.editor;
    const wasClean =
      editor !== null &&
      this.draftText === null &&
      editor.value === (this.saved.text ?? EMPTY_PROPERTIES);
    this.saved = next;
    if (!editor) this.renderPreview();
    else if (wasClean && next.kind !== "invalid")
      editor.updateDocument(next.text ?? EMPTY_PROPERTIES);
    else if (editor.value === next.text) this.draftText = null;
  }

  setSaveState(
    state: SaveState,
    pending = false,
    feedback: SaveFeedback = "none",
  ): void {
    this.saveState = state;
    this.saveFeedback = feedback;
    this.externalPending = pending;
    if (this.editing) this.reflectAction();
    this.editor?.setSaveState(state, pending, feedback);
  }

  refreshTheme(): void {
    this.editor?.refreshTheme();
    this.preview?.requestMeasure();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.editor?.destroy();
    this.editor = null;
    this.preview?.destroy();
    this.preview = null;
    this.element.remove();
  }
}
