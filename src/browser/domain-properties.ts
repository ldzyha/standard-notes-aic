import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { AicEditor, type SaveFeedback, type SaveState } from "../editor";
import { makeSecurityBlockExtension } from "../core/security-block.js";
import {
  AIC_EMPTY_DOCUMENT,
  parseSecurityDocument,
} from "../core/security-model.js";
import { aicMarkdownLanguage } from "../language";
import { validateDomainProperties } from "./library";
import { applyUiComponent, createUiButton } from "../core/ui-system.js";

const EMPTY_PROPERTIES = AIC_EMPTY_DOCUMENT;

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
    const validated = validateDomainProperties(text);
    const parsed = parseSecurityDocument(validated);
    const kind =
      parsed.ok &&
      parsed.model.sections.every((section) => section.fields.length === 0)
        ? "empty"
        : "valid";
    return { kind, text: validated };
  } catch {
    return { kind: "invalid", text };
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
    applyUiComponent(this.element, "context", ["compact"]);
    this.element.dataset.editing = "false";
    const header = this.document.createElement("header");
    header.className = "browser-domain-properties-header";
    const origin = this.document.createElement("span");
    origin.className = "browser-domain-properties-origin";
    origin.textContent = options.origin;
    origin.title = options.origin;
    this.action = createUiButton(this.document, {
      label: "Edit shared properties",
      text: "Shared properties",
      variant: "ghost",
      size: "compact",
    });
    this.action.classList.add(
      "browser-button",
      "browser-domain-properties-action",
    );
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
    const displayed =
      this.draftText === null ? this.saved : safeSavedText(this.draftText);
    this.element.dataset.editing = "false";
    this.element.dataset.empty = String(displayed.kind === "empty");
    this.element.classList.toggle(
      "aic-context--empty",
      displayed.kind === "empty",
    );
    this.element.classList.remove("aic-context--editing");
    this.action.textContent = displayed.kind === "empty" ? "Shared" : "Edit";
    this.action.setAttribute("aria-label", "Edit shared properties");
    this.action.title =
      displayed.kind === "empty"
        ? `Add shared properties for ${this.options.origin}`
        : "Edit shared properties";
    this.action.disabled = false;
    this.action.removeAttribute("aria-busy");
    if (displayed.kind !== "valid" || displayed.text === null) {
      if (displayed.kind === "empty") return;
      const message = this.document.createElement("p");
      message.className = "browser-domain-properties-empty";
      message.textContent =
        "Use an aic block for shared fields. Edit to repair the saved text.";
      this.content.append(message);
      return;
    }
    this.preview = new EditorView({
      parent: this.content,
      root: this.document,
      state: EditorState.create({
        doc: displayed.text,
        extensions: [
          aicMarkdownLanguage(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Shared properties preview",
          }),
          makeSecurityBlockExtension({
            document: this.document,
            previewOnly: true,
            canPreviewChange: () =>
              !this.disposed &&
              !this.editor &&
              !this.pending &&
              !this.externalPending,
            onPreviewChange: (before: string, after: string) =>
              this.changePreview(before, after),
          }),
        ],
      }),
    });
  }

  /** State-only field intents use the same revisioned draft/save owner as editing. */
  private async changePreview(before: string, after: string): Promise<boolean> {
    const preview = this.preview;
    if (
      this.disposed ||
      this.editor ||
      this.pending ||
      this.externalPending ||
      !preview ||
      preview.state.doc.toString() !== before
    )
      return false;
    try {
      validateDomainProperties(after);
    } catch {
      return false;
    }
    this.pending = true;
    preview.dom.inert = true;
    preview.dom.setAttribute("aria-busy", "true");
    this.draftText = after;
    preview.dispatch({
      changes: { from: 0, to: preview.state.doc.length, insert: after },
    });
    this.options.onChange(after);
    try {
      const acknowledged = await this.options.onSave(after);
      if (this.disposed) return false;
      if (acknowledged && this.value === after) {
        this.saved = safeSavedText(after);
        this.draftText = null;
        this.feedback.textContent = "";
        return true;
      }
      this.feedback.textContent =
        "Field state was not saved. Your local change is kept; edit to retry.";
      return false;
    } catch {
      if (!this.disposed)
        this.feedback.textContent =
          "Field state was not saved. Your local change is kept; edit to retry.";
      return false;
    } finally {
      this.pending = false;
      // New widgets mounted while a save is pending are intentionally disabled.
      // Rebuild from the acknowledged/local draft with current host availability.
      if (!this.disposed && !this.editor) this.renderPreview();
    }
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
      showEditorHelp: false,
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
    this.element.classList.add("aic-context--editing");
    this.element.classList.remove("aic-context--empty");
    this.element.dataset.empty = "false";
    this.action.textContent = "Done";
    this.action.setAttribute("aria-label", "Done");
    this.action.title = "Save and finish editing shared properties";
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
        "Finish a valid aic block before saving. Check its highlighted error in the editor.";
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
    const availabilityChanged = this.externalPending !== pending;
    this.saveState = state;
    this.saveFeedback = feedback;
    this.externalPending = pending;
    if (this.editing) this.reflectAction();
    this.editor?.setSaveState(state, pending, feedback);
    if (availabilityChanged && !this.editing && !this.pending)
      this.renderPreview();
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
