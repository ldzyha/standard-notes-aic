import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { AicEditor } from "../editor";
import {
  localAIAvailability,
  localAIProtectedRanges,
  reviewLocalText,
  validateLocalReplacement,
  type LocalAIReview,
} from "../core/local-ai.js";
import { applyUiComponent, createUiButton } from "../core/ui-system.js";
import "./ai-controls.css";

export type LocalAIHost = Readonly<{
  editor: AicEditor;
  compact?: boolean;
  identity(): string;
  isReadonly(): boolean;
  onNotice(message: string): void;
}>;
export type LocalAIControls = Readonly<{
  cancel(): void;
  dispose(): void;
}>;

/** The existing editor and save owner remain authoritative. */
export function attachLocalAI(
  container: HTMLElement,
  host: LocalAIHost,
): LocalAIControls {
  const document = container.ownerDocument;
  const controls = document.createElement("section");
  controls.className = "aic-local-ai";
  if (host.compact) {
    controls.classList.add("aic-local-ai--compact");
    controls.hidden = true;
  }
  controls.setAttribute("aria-label", "Local writing assistance");
  const toolbar = applyUiComponent(document.createElement("div"), "toolbar", [
    "compact",
    "wrap",
  ]);
  const grammar = createUiButton(document, {
    label: "Fix grammar locally",
    text: "Fix grammar",
    variant: "ghost",
    size: "compact",
  });
  const improve = createUiButton(document, {
    label: "Improve prose locally",
    text: "Improve",
    variant: "ghost",
    size: "compact",
  });
  const cancelButton = createUiButton(document, {
    label: "Cancel local AI",
    text: "Cancel",
    variant: "ghost",
    size: "compact",
  });
  cancelButton.hidden = true;
  const status = document.createElement("span");
  status.className = "aic-local-ai__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Checking local AI availability…";
  toolbar.append(grammar, improve, cancelButton, status);
  controls.append(toolbar);
  container.append(controls);
  let disposed = false;
  let request: AbortController | null = null;
  let preview: HTMLDialogElement | null = null;
  let operation = 0;

  const readonly = () =>
    disposed || host.isReadonly() || host.editor.view.state.readOnly;
  function clearPreview() {
    if (!preview) return;
    preview.replaceChildren();
    if (preview.open && typeof preview.close === "function") preview.close();
    preview.remove();
    preview = null;
  }
  function reflectBusy(busy: boolean) {
    grammar.disabled = busy;
    improve.disabled = busy;
    cancelButton.hidden = !busy;
    controls.setAttribute("aria-busy", String(busy));
  }
  function cancel() {
    operation += 1;
    request?.abort();
    request = null;
    clearPreview();
    reflectBusy(false);
    if (!disposed) status.textContent = "Local AI cancelled";
  }
  cancelButton.addEventListener("click", cancel);
  const onPageHide = () => dispose();
  document.defaultView?.addEventListener("pagehide", onPageHide);

  function showPreview(
    result: LocalAIReview,
    original: string,
    identity: string,
    selection: typeof host.editor.view.state.selection,
    from: number,
    to: number,
    currentOperation: number,
  ) {
    clearPreview();
    const dialog = document.createElement("dialog");
    preview = dialog;
    dialog.className = "aic-local-ai__preview";
    dialog.setAttribute("aria-label", "Review local AI suggestion");
    const heading = document.createElement("h2");
    heading.textContent = "Review suggestion";
    const hint = document.createElement("p");
    hint.textContent =
      "Check the wording and facts before applying. Editor Undo restores the original.";
    const replacement = document.createElement("pre");
    replacement.className = "aic-local-ai__replacement";
    replacement.textContent = result.text;
    const notes = document.createElement("p");
    notes.className = "aic-local-ai__notes";
    notes.textContent = result.notes.join(" ");
    const actions = applyUiComponent(document.createElement("div"), "toolbar", [
      "compact",
      "wrap",
    ]);
    const apply = createUiButton(document, {
      label: "Apply local AI suggestion",
      text: "Apply",
    });
    const discard = createUiButton(document, {
      label: "Discard local AI suggestion",
      text: "Cancel",
      variant: "ghost",
    });
    apply.addEventListener("click", () => {
      const state = host.editor.view.state;
      if (
        readonly() ||
        operation !== currentOperation ||
        host.identity() !== identity ||
        state.doc.toString() !== original ||
        !state.selection.eq(selection)
      ) {
        clearPreview();
        status.textContent =
          "The note or selection changed. Request a new suggestion.";
        host.onNotice(status.textContent);
        return;
      }
      try {
        const next = original.slice(0, from) + result.text + original.slice(to);
        validateLocalReplacement(original, next);
        host.editor.view.dispatch({
          changes: { from, to, insert: result.text },
          selection: { anchor: from + result.text.length },
          annotations: [
            Transaction.userEvent.of("input.aic-local-ai"),
            isolateHistory.of("full"),
          ],
        });
        clearPreview();
        status.textContent =
          "Suggestion applied. Use editor Undo to restore it.";
        host.editor.view.focus();
      } catch {
        clearPreview();
        status.textContent =
          "The suggestion could not be applied safely. Your note is unchanged.";
        host.onNotice(status.textContent);
      }
    });
    discard.addEventListener("click", () => {
      clearPreview();
      status.textContent = "Suggestion discarded";
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      clearPreview();
      status.textContent = "Suggestion discarded";
    });
    actions.append(discard, apply);
    dialog.append(heading, hint, replacement, notes, actions);
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  async function run(mode: "grammar" | "improve") {
    if (readonly()) {
      host.onNotice("Unlock an editable note to use local AI.");
      return;
    }
    if (request) return;
    clearPreview();
    const state = host.editor.view.state;
    const original = state.doc.toString();
    const selection = state.selection;
    if (selection.ranges.length !== 1) {
      host.onNotice("Use one text selection for local AI.");
      return;
    }
    const from = selection.main.empty ? 0 : selection.main.from;
    const to = selection.main.empty ? original.length : selection.main.to;
    if (
      !selection.main.empty &&
      localAIProtectedRanges(original).some(
        (range) => range.from < to && range.to > from,
      )
    ) {
      host.onNotice(
        "Select prose outside protected code, links, HTML and properties.",
      );
      return;
    }
    const identity = host.identity();
    const controller = new AbortController();
    request = controller;
    const currentOperation = ++operation;
    reflectBusy(true);
    try {
      // create() runs directly from this user action; availability checks never
      // prepare or download a model in the background.
      const result = await reviewLocalText({
        text: original.slice(from, to),
        mode,
        signal: controller.signal,
        onProgress(message) {
          if (
            !disposed &&
            operation === currentOperation &&
            !controller.signal.aborted
          )
            status.textContent = message;
        },
      });
      if (
        disposed ||
        operation !== currentOperation ||
        controller.signal.aborted
      )
        return;
      if (
        readonly() ||
        host.identity() !== identity ||
        host.editor.view.state.doc.toString() !== original ||
        !host.editor.view.state.selection.eq(selection)
      ) {
        status.textContent =
          "The note or selection changed. Request a new suggestion.";
        return;
      }
      if (!result.changed) {
        status.textContent = "No changes needed";
        return;
      }
      status.textContent = "Suggestion ready for review";
      showPreview(
        result,
        original,
        identity,
        selection,
        from,
        to,
        currentOperation,
      );
    } catch (error) {
      if (
        disposed ||
        operation !== currentOperation ||
        controller.signal.aborted
      )
        return;
      status.textContent =
        error instanceof Error ? error.message : "Local AI could not finish.";
      host.onNotice(status.textContent);
    } finally {
      if (!disposed && operation === currentOperation) {
        request = null;
        reflectBusy(false);
      }
    }
  }
  grammar.addEventListener("click", () => void run("grammar"));
  improve.addEventListener("click", () => void run("improve"));
  void localAIAvailability().then((availability) => {
    if (disposed || operation !== 0) return;
    if (host.compact) controls.hidden = availability === "unavailable";
    status.textContent =
      availability === "available"
        ? "Local AI ready · select prose or review this note"
        : availability === "unavailable"
          ? "Built-in AI unavailable here · editing works offline"
          : "Local AI downloads on your first AI action";
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    document.defaultView?.removeEventListener("pagehide", onPageHide);
    status.textContent = "";
    controls.replaceChildren();
    controls.remove();
  }
  return Object.freeze({ cancel, dispose });
}
